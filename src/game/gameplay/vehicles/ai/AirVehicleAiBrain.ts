import {
  AIR_LANDING_ARRIVAL_RADIUS,
  AIR_TAKEOFF_CLEAR_ALTITUDE,
  VEHICLE_DEVIATION_BUDGET_SECONDS,
  defaultAllowsMissionDeviation,
  type VehiclePilotProfile,
} from '@game/config/vehicleAi.config';
import type {
  VehicleAiBehavior,
  VehicleAiDefinition,
} from '@game/levels/LevelDefinition';
import type {
  AirBrainContext,
  AirBrainDecision,
  AirFlightIntent,
  VehicleAirState,
} from './AirVehicleAiTypes';
import type { VehicleNavPoint } from './VehicleAiTypes';
import { planarDistance, stableJitter, stableSide } from './VehicleAiMath';

/** Cadencias de decisión por distancia al jugador, en segundos. */
const TICK_NEAR = 0.1;
const TICK_MID = 0.2;
const TICK_FAR = 0.5;
const NEAR_DISTANCE = 60;
const MID_DISTANCE = 160;

/** Cada cuánto se invierte el sentido de la órbita, para que no sea un reloj. */
const ORBIT_FLIP_SECONDS = 9;
const MAX_LANDING_ENTRY_PLANAR_SPEED = 3.5;
const MAX_LANDING_ENTRY_VERTICAL_SPEED = 2.5;
const MAX_LANDING_HEADING_ERROR = Math.PI / 9;
/** Distancia mínima que el destino debe moverse para justificar replanificar. */
const REPLAN_DISTANCE = 12;
/** Paciencia máxima esperando a la tripulación que viene en camino. */
const MAX_BOARDING_WAIT = 25;
/**
 * Cuánto adelanta el punto orbital sobre la marcación actual, en radianes. Es
 * lo que sostiene la velocidad de la órbita: el radio de standoff decide a qué
 * distancia se pelea, y este ángulo, a qué ritmo se rodea.
 */
const ORBIT_LEAD_ANGLE = 0.8;

export interface AirVehicleAiBrainTuning {
  cruiseAltitude: number;
  combatAltitude: number;
  cruiseSpeed: number;
  standoffRange: number;
  orbitSpeed: number;
  fleeThreshold: number;
  emergencyLandingThreshold: number;
  allowMissionDeviation: boolean;
  deviationBudgetSeconds: number;
}

export function airBrainTuning(
  vehicleId: string,
  profile: VehiclePilotProfile,
  ai: VehicleAiDefinition,
  weaponRange: number,
): AirVehicleAiBrainTuning {
  // Jitter determinista por aparato: dos helicópteros del mismo preset no
  // orbitan sincronizados como si fueran uno solo.
  const altitudeJitter = stableJitter(vehicleId, 11, 0.1);
  const rangeJitter = stableJitter(vehicleId, 12, 0.1);
  const standoff = weaponRange > 0
    ? weaponRange * profile.standoffRangeFactor * rangeJitter
    : 45 * rangeJitter;
  return {
    cruiseAltitude: profile.cruiseAltitude * altitudeJitter,
    combatAltitude: profile.combatAltitude * altitudeJitter,
    cruiseSpeed: profile.cruiseSpeed,
    standoffRange: standoff,
    orbitSpeed: profile.orbitSpeed,
    fleeThreshold: profile.fleeThreshold,
    emergencyLandingThreshold: profile.emergencyLandingThreshold,
    allowMissionDeviation:
      ai.allowMissionDeviation ?? defaultAllowsMissionDeviation(ai.behavior),
    deviationBudgetSeconds: VEHICLE_DEVIATION_BUDGET_SECONDS,
  };
}

/**
 * Cerebro de un aparato de ala rotatoria. Comparte la idea del terrestre —el
 * `behavior` autorado es la misión y el estado es lo que hace ahora— pero el
 * vocabulario táctico viene del gunship de HL2: orbitar a distancia de tiro,
 * romper contacto al quedar tocado, barrer el último-visto.
 *
 * Los tres estados propios del aire (despegue, aproximación, aterrizaje) no son
 * tácticos: son transiciones con una condición de salida física, y existen
 * porque un helicóptero no puede simplemente aparecer en el aire ni frenar en
 * seco sobre una plataforma.
 */
export class AirVehicleAiBrain {
  private behavior: VehicleAiBehavior;
  private state: VehicleAirState = 'grounded';
  private secondsUntilTick = 0;
  private elapsedSinceTick = 0;
  private orbitAngle = 0;
  private orbitSide: 1 | -1;
  private orbitFlipSeconds = 0;
  private deviationSeconds = 0;
  private searchSeconds = 0;
  private boardingWaitSeconds = 0;
  private lastPlanGoal: VehicleNavPoint | null = null;
  private patrolIndex = 0;
  private disembarkRequested = false;
  private takeoffStartHeight: number | null = null;
  /** Dónde subió la carga que lleva ahora. */
  private loadedAt: VehicleNavPoint | null = null;

  constructor(
    vehicleId: string,
    ai: VehicleAiDefinition,
    private readonly tuning: AirVehicleAiBrainTuning,
  ) {
    this.behavior = ai.behavior;
    this.orbitSide = stableSide(vehicleId, 13);
  }

  setBehavior(behavior: VehicleAiBehavior): void {
    if (this.behavior === behavior) return;
    this.behavior = behavior;
    this.deviationSeconds = 0;
    this.disembarkRequested = false;
    this.loadedAt = null;
  }

  getState(): VehicleAirState {
    return this.state;
  }

  reset(): void {
    this.state = 'grounded';
    this.secondsUntilTick = 0;
    this.elapsedSinceTick = 0;
    this.deviationSeconds = 0;
    this.searchSeconds = 0;
    this.boardingWaitSeconds = 0;
    this.lastPlanGoal = null;
    this.disembarkRequested = false;
    this.takeoffStartHeight = null;
    this.loadedAt = null;
  }

  /** Adelanta el reloj sin decidir; devuelve si toca tickear. */
  advance(delta: number): boolean {
    const safeDelta = Math.max(0, Math.min(delta, 0.25));
    this.elapsedSinceTick += safeDelta;
    this.secondsUntilTick -= safeDelta;
    return this.secondsUntilTick <= 0;
  }

  update(context: AirBrainContext, distanceToPlayer: number): AirBrainDecision {
    const tickDelta = Math.max(1e-4, this.elapsedSinceTick);
    this.elapsedSinceTick = 0;
    const tickInterval = resolveTickInterval(distanceToPlayer);
    this.secondsUntilTick = tickInterval;

    this.updateTimers(tickDelta);
    if (!context.passengersOnboard) {
      this.disembarkRequested = false;
      this.loadedAt = null;
    }
    this.boardingWaitSeconds = context.crewPending
      ? this.boardingWaitSeconds + tickDelta
      : 0;
    const previousState = this.state;
    const nextState = this.resolveState(context);
    if (nextState === 'takeoff' && previousState !== 'takeoff') {
      this.takeoffStartHeight = context.position[1];
    } else if (nextState !== 'takeoff') {
      this.takeoffStartHeight = null;
    }
    this.state = nextState;
    const intent = this.resolveIntent(context);
    const planGoal = this.resolvePlanGoal(intent);

    return {
      tickInterval,
      behavior: this.behavior,
      state: this.state,
      intent,
      planGoal,
      crewAction: this.resolveCrewAction(context),
    };
  }

  private updateTimers(delta: number): void {
    this.orbitFlipSeconds += delta;
    if (this.state === 'engaging' && this.orbitFlipSeconds >= ORBIT_FLIP_SECONDS) {
      this.orbitFlipSeconds = 0;
      this.orbitSide = this.orbitSide === 1 ? -1 : 1;
    }
    if (this.state === 'searching') this.searchSeconds += delta;
    else this.searchSeconds = 0;

    const deviating =
      this.state === 'engaging' ||
      this.state === 'pursuing' ||
      this.state === 'searching';
    if (deviating && !defaultAllowsMissionDeviation(this.behavior)) {
      this.deviationSeconds += delta;
    } else if (this.state !== 'evading') {
      this.deviationSeconds = Math.max(0, this.deviationSeconds - delta * 0.5);
    }
  }

  private resolveState(context: AirBrainContext): VehicleAirState {
    if (!context.pilotAvailable) {
      // Sin piloto sólo queda caer con estilo: si ya está en el suelo se queda,
      // y si está en el aire el seguidor lo posa con el rotor al ralentí.
      return context.grounded ? 'grounded' : 'landing';
    }

    if (context.landingGoAround && !context.grounded) return 'goAround';

    if (context.groundHold && context.grounded) return 'grounded';

    // Resolver un claro puede repartir decenas de raycasts entre varios ticks.
    // Mientras tanto se sostiene un hover estable en vez de descender a ciegas
    // o perseguir la coordenada cruda que quizá cae sobre una pared.
    if (
      context.landingRequested &&
      context.landingStatus === 'resolving' &&
      !context.landingSpot
    ) {
      return context.grounded ? 'grounded' : 'stopped';
    }

    if (context.healthFraction <= this.tuning.emergencyLandingThreshold) {
      if (context.grounded) return 'grounded';
      // Sin ningún sitio donde posarse, un aparato reventado baja donde esté;
      // con uno a la vista, primero se pone encima.
      if (!context.landingSpot) return 'landing';
      return this.readyToDescend(context) ? 'landing' : 'approach';
    }

    if (
      this.state === 'takeoff' &&
      !context.grounded &&
      !this.takeoffClearanceReached(context)
    ) {
      return 'takeoff';
    }

    if (this.wantsToLand(context)) {
      if (!context.grounded) {
        return this.readyToDescend(context) ? 'landing' : 'approach';
      }
      // Estar en el suelo no es haber llegado. Una recogida termina justo así:
      // posado donde estaba la gente, con la carga a bordo y el destino en otro
      // lado. Sin esto el aparato daba la misión por cumplida ahí mismo.
      return this.overLandingSpot(context) ? 'grounded' : 'takeoff';
    }

    if (context.grounded) {
      // Esperar a los que vienen llegando, pero no para siempre: si al que
      // falta lo matan en el camino, el aparato tiene que irse igual.
      if (context.crewPending && this.boardingWaitSeconds < MAX_BOARDING_WAIT) {
        return 'grounded';
      }
      return 'takeoff';
    }

    if (context.healthFraction <= this.tuning.fleeThreshold) return 'evading';

    const threat = context.threat;
    if (threat && this.canEngage()) {
      if (threat.visible === true) return 'engaging';
      if ((threat.memoryAge ?? Infinity) < 4) return 'pursuing';
      if (this.searchSeconds < 6) return 'searching';
    }
    return 'cruising';
  }

  private takeoffClearanceReached(context: AirBrainContext): boolean {
    if (Number.isFinite(context.altitude)) {
      return context.altitude >= AIR_TAKEOFF_CLEAR_ALTITUDE;
    }
    const startHeight = this.takeoffStartHeight ?? context.position[1];
    return context.position[1] - startHeight >= AIR_TAKEOFF_CLEAR_ALTITUDE;
  }

  /** Si la misión pide posarse ahora mismo. */
  private wantsToLand(context: AirBrainContext): boolean {
    if (context.landingRequested) return Boolean(context.landingSpot);
    // Una extracción manda sobre todo lo demás: hay gente esperando abajo.
    if (context.pickupAt) return true;
    if (this.disembarkRequested) return true;
    if (this.behavior !== 'transport') return false;
    if (!context.landingSpot) return false;
    // Con carga se posa a dejarla, salvo que la haya subido en este mismo sitio:
    // una recogida termina así, y volver a posarse ahí sería devolverla.
    if (context.passengersOnboard) return !this.justLoadedHere(context);
    // Un transporte sin carga ya cumplió. El spot puede sobrevivir un tick a la
    // descarga; no debe reactivar por sí solo una aproximación sin misión.
    return false;
  }

  /**
   * La carga que lleva subió acá mismo. Es lo que separa "llegué a destino" de
   * "acabo de recoger": sin la distinción, el aparato descargaba a los
   * rescatados dos segundos después de subirlos, en la misma zona.
   */
  private justLoadedHere(context: AirBrainContext): boolean {
    const loaded = this.loadedAt;
    if (!loaded) return false;
    return planarDistance(loaded, context.position) <= AIR_LANDING_ARRIVAL_RADIUS;
  }

  private overLandingSpot(context: AirBrainContext): boolean {
    const spot = context.landingSpot;
    if (!spot) return false;
    const planar = Math.hypot(
      spot.position[0] - context.position[0],
      spot.position[2] - context.position[2],
    );
    return planar <= AIR_LANDING_ARRIVAL_RADIUS;
  }

  private readyToDescend(context: AirBrainContext): boolean {
    if (!this.overLandingSpot(context)) return false;
    if (
      Math.hypot(context.velocity[0], context.velocity[2]) >
        MAX_LANDING_ENTRY_PLANAR_SPEED ||
      Math.abs(context.velocity[1]) > MAX_LANDING_ENTRY_VERTICAL_SPEED
    ) return false;
    const approachHeading = context.landingSpot?.approachHeading;
    return approachHeading === undefined ||
      Math.abs(wrappedAngle(approachHeading - context.heading)) <=
        MAX_LANDING_HEADING_ERROR;
  }

  private canEngage(): boolean {
    if (!this.tuning.allowMissionDeviation) return false;
    return this.deviationSeconds < this.tuning.deviationBudgetSeconds;
  }

  private resolveIntent(context: AirBrainContext): AirFlightIntent {
    const tuning = this.tuning;
    switch (this.state) {
      case 'grounded':
        return intent(null, 0, null, 0, false, true);
      case 'takeoff':
        // Subir en vertical sobre el propio punto: despegar en diagonal desde
        // una plataforma es cómo se engancha un patín en la baranda.
        return intent(
          [context.position[0], context.position[1], context.position[2]],
          tuning.cruiseAltitude,
          null,
          0,
          false,
          false,
        );
      case 'goAround':
        return intent(
          [context.position[0], context.position[1], context.position[2]],
          Math.max(
            AIR_TAKEOFF_CLEAR_ALTITUDE + 5,
            tuning.cruiseAltitude * 0.65,
          ),
          null,
          0,
          false,
          false,
        );
      case 'landing': {
        const spot = context.landingSpot?.position ?? null;
        return intent(spot, 0, null, 2, true, false);
      }
      case 'approach': {
        const landing = context.landingSpot?.position;
        const approachHeading = context.landingSpot?.approachHeading;
        const approachAltitude = Math.max(
          AIR_TAKEOFF_CLEAR_ALTITUDE + 5,
          tuning.cruiseAltitude * 0.6,
        );
        const spot: VehicleNavPoint | null = landing
          ? [landing[0], landing[1] + approachAltitude, landing[2]]
          : null;
        const facing: VehicleNavPoint | null = landing && approachHeading !== undefined
          ? [
              landing[0] + Math.sin(approachHeading) * 12,
              landing[1] + approachAltitude,
              landing[2] + Math.cos(approachHeading) * 12,
            ]
          : null;
        return intent(
          spot,
          approachAltitude,
          facing,
          tuning.cruiseSpeed * 0.6,
          false,
          false,
        );
      }
      case 'engaging':
        return this.orbitIntent(context);
      case 'pursuing':
      case 'searching': {
        const last = context.threat?.position ?? null;
        return intent(
          last,
          tuning.combatAltitude,
          last,
          tuning.cruiseSpeed,
          false,
          false,
        );
      }
      case 'evading': {
        const away = this.retreatPoint(context);
        return intent(away, tuning.cruiseAltitude * 1.25, null, tuning.cruiseSpeed, false, false);
      }
      case 'stopped':
        return intent(null, tuning.cruiseAltitude, null, 0, false, false);
      case 'cruising':
      default:
        return this.missionIntent(context);
    }
  }

  /**
   * Órbita de combate: el aparato viaja por la tangente del círculo de tiro
   * mientras el morro apunta al blanco. Ese desacople —ir para un lado mirando
   * para otro— es lo que le da ángulo a la torreta de puerta y lo que hace que
   * se lea como un helicóptero artillado y no como un avión.
   */
  private orbitIntent(context: AirBrainContext): AirFlightIntent {
    const threat = context.threat;
    if (!threat) return this.missionIntent(context);
    const radius = this.tuning.standoffRange;
    const current = Math.atan2(
      context.position[0] - threat.position[0],
      context.position[2] - threat.position[2],
    );
    // El punto orbital va a un ADELANTO FIJO sobre la marcación actual, no a
    // `orbitSpeed · delta`: con el paso del tick el blanco quedaba a un metro
    // del aparato, la frenada de llegada lo mataba y el helicóptero "orbitaba"
    // a 3 m/s. Reanclar cada tick lo mantiene pegado al círculo.
    this.orbitAngle = current + this.orbitSide * ORBIT_LEAD_ANGLE;
    const target: VehicleNavPoint = [
      threat.position[0] + Math.sin(this.orbitAngle) * radius,
      threat.position[1] + this.tuning.combatAltitude,
      threat.position[2] + Math.cos(this.orbitAngle) * radius,
    ];
    // Si la torreta agotó su recorrido, virar el casco es la única forma de
    // volver a tener el blanco en el cono.
    const facing: VehicleNavPoint = [
      threat.position[0],
      threat.position[1],
      threat.position[2],
    ];
    return intent(
      target,
      this.tuning.combatAltitude,
      facing,
      this.tuning.cruiseSpeed * (context.turretAtTraverseLimit ? 0.6 : 1),
      false,
      false,
    );
  }

  private missionIntent(context: AirBrainContext): AirFlightIntent {
    const tuning = this.tuning;
    const goal = this.missionGoal(context);
    return intent(goal, tuning.cruiseAltitude, null, tuning.cruiseSpeed, false, false);
  }

  private missionGoal(context: AirBrainContext): VehicleNavPoint | null {
    switch (this.behavior) {
      case 'hold':
        return null;
      case 'patrol': {
        const points = context.patrolPoints;
        if (!points || points.length === 0) return context.authoredGoal ?? null;
        const point = points[this.patrolIndex % points.length];
        const planar = Math.hypot(
          point[0] - context.position[0],
          point[2] - context.position[2],
        );
        if (planar <= REPLAN_DISTANCE) {
          this.patrolIndex = (this.patrolIndex + 1) % points.length;
        }
        return point;
      }
      case 'escort':
        return context.escortTarget?.position ?? context.authoredGoal ?? null;
      case 'retreat':
        return context.retreatPoint ?? this.retreatPoint(context);
      case 'intercept':
      case 'flank':
        return context.threat?.position ?? context.authoredGoal ?? null;
      case 'transport':
      default:
        return context.landingSpot?.position ?? context.authoredGoal ?? null;
    }
  }

  private retreatPoint(context: AirBrainContext): VehicleNavPoint | null {
    const threat = context.threat;
    if (!threat) return context.retreatPoint ?? null;
    const dx = context.position[0] - threat.position[0];
    const dz = context.position[2] - threat.position[2];
    const distance = Math.hypot(dx, dz);
    if (distance < 0.001) return context.retreatPoint ?? null;
    const scale = (this.tuning.standoffRange * 2.5) / distance;
    return [
      context.position[0] + dx * scale,
      context.position[1],
      context.position[2] + dz * scale,
    ];
  }

  /**
   * Sólo se pide ruta al planificador cuando el destino se movió de verdad. El
   * A* aéreo raycastea por tramo, así que replanificar cada tick con un blanco
   * que camina cuesta muchísimo y no cambia nada.
   */
  private resolvePlanGoal(flight: AirFlightIntent): VehicleNavPoint | null {
    const target = flight.target;
    if (!target) {
      this.lastPlanGoal = null;
      return null;
    }
    // En órbita y en aterrizaje el punto se recalcula por frame: pedir ruta
    // sería pedirla siempre.
    if (
      this.state === 'engaging' ||
      this.state === 'landing' ||
      this.state === 'takeoff' ||
      this.state === 'goAround'
    ) {
      this.lastPlanGoal = null;
      return null;
    }
    if (
      this.lastPlanGoal &&
      Math.hypot(
        this.lastPlanGoal[0] - target[0],
        this.lastPlanGoal[1] - target[1],
        this.lastPlanGoal[2] - target[2],
      ) < REPLAN_DISTANCE
    ) {
      return null;
    }
    this.lastPlanGoal = [target[0], target[1], target[2]];
    return this.lastPlanGoal;
  }

  /**
   * Pide embarco al posarse a recoger, y desembarco al posarse con carga EN EL
   * DESTINO. La zona importa: soltar a los rescatados en el mismo descampado
   * donde se los subió deshace la recogida entera.
   */
  private resolveCrewAction(
    context: AirBrainContext,
  ): AirBrainDecision['crewAction'] {
    if (this.state !== 'grounded' || !context.grounded) return 'none';
    if (context.pickupAt) {
      this.loadedAt = [...context.position];
      return 'requestBoarding';
    }
    if (
      context.passengersOnboard &&
      this.behavior === 'transport' &&
      this.overLandingSpot(context) &&
      !this.justLoadedHere(context)
    ) {
      this.disembarkRequested = true;
      return 'requestDisembark';
    }
    return 'none';
  }
}

function intent(
  target: VehicleNavPoint | null,
  targetAltitude: number,
  facing: VehicleNavPoint | null,
  cruiseSpeed: number,
  descend: boolean,
  shutdown: boolean,
): AirFlightIntent {
  return { target, targetAltitude, facing, cruiseSpeed, descend, shutdown };
}

function resolveTickInterval(distanceToPlayer: number): number {
  if (distanceToPlayer <= NEAR_DISTANCE) return TICK_NEAR;
  if (distanceToPlayer <= MID_DISTANCE) return TICK_MID;
  return TICK_FAR;
}

function wrappedAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
