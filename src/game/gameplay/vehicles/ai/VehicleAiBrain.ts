import type { VehicleAiDefinition, VehicleAiBehavior } from '@game/levels/LevelDefinition';
import type {
  VehicleAiSignals,
  VehicleAiState,
  VehicleAiTarget,
  VehicleBrainContext,
  VehicleBrainDecision,
  VehicleControlCommand,
  VehicleCrewAiAction,
  VehicleNavigationProfile,
  VehicleNavPoint,
  VehicleRecoveryAction,
} from './VehicleAiTypes';
import { VEHICLE_CREW_DECISION } from '@game/config/vehicleAi.config';
import {
  clamp,
  headingBetween,
  headingToVector,
  planarDistance,
  stableSide,
} from './VehicleAiMath';
import {
  stoppedCommand,
  VehiclePathFollower,
  type VehiclePathFollowerTuning,
} from './VehiclePathFollower';

export interface VehicleAiBrainTuning {
  nearDistance?: number;
  midDistance?: number;
  farDistance?: number;
  nearTickRate?: number;
  midTickRate?: number;
  farTickRate?: number;
  dormantTickRate?: number;
  goalTolerance?: number;
  escortDistance?: number;
  flankDistance?: number;
  retreatDistance?: number;
  /** Fracción de casco por debajo de la cual rompe contacto. 0 = nunca huye. */
  fleeThreshold?: number;
  /** Distancia de combate preferida como fracción del alcance del arma. */
  engagementRangeFactor?: number;
  /** Arco que avanza por tick al orbitar un blanco, en radianes. */
  strafeArc?: number;
  /** Si puede abandonar temporalmente su misión para pelear o huir. */
  allowMissionDeviation?: boolean;
  /** Cuánto puede durar el desvío antes de retomar la misión. */
  deviationBudgetSeconds?: number;
  /** Descanso obligatorio en la misión después de agotar el presupuesto. */
  deviationCooldownSeconds?: number;
  /** Cuánto barre el último-visto antes de darlo por perdido. */
  searchSeconds?: number;
  follower?: VehiclePathFollowerTuning;
}

const NO_SIGNALS: VehicleAiSignals = { horn: false, headlights: null };
/** Bloqueo sostenido a partir del cual el conductor toca bocina. */
const HORN_BLOCKED_SECONDS = 1.2;
const HORN_COOLDOWN_SECONDS = 3;
/** Cada cuánto un vehículo en órbita cambia de mano, para no ser monótono. */
const SIDE_HOLD_SECONDS = 7;

export class VehicleAiBrain {
  private readonly follower: VehiclePathFollower;
  private behavior: VehicleAiBehavior;
  private state: VehicleAiState = 'idle';
  private secondsUntilTick = 0;
  private elapsedSinceTick = 0;
  private stuckSeconds = 0;
  private wasStuck = false;
  private recoveryAttempts = 0;
  private recoverySide: 1 | -1;
  private patrolIndex = 0;
  private previousGoal: VehicleNavPoint | null = null;
  private deviationSeconds = 0;
  private deviationCooldown = 0;
  private searchSeconds = 0;
  private engageSide: 1 | -1;
  private sideHoldSeconds = 0;
  private blockedSeconds = 0;
  private hornCooldown = 0;

  constructor(
    readonly vehicleId: string,
    private readonly definition: VehicleAiDefinition,
    private readonly profile: VehicleNavigationProfile,
    private readonly tuning: VehicleAiBrainTuning = {},
  ) {
    this.follower = new VehiclePathFollower(profile, tuning.follower ?? {});
    this.behavior = definition.behavior;
    this.recoverySide = stableSide(vehicleId, 1);
    this.engageSide = stableSide(vehicleId, 2);
  }

  /**
   * Adelanta el reloj sin decidir y dice si en este frame toca decidir. Permite
   * que el caller no arme el contexto completo (raycasts, obstáculos, markers)
   * en los ~90 % de frames en los que la decisión no cambia.
   *
   * Después de un `true` hay que llamar a `update(0, context)`: el delta ya está
   * acumulado. `update(delta, context)` sin `advance` sigue siendo válido.
   */
  advance(delta: number): boolean {
    const safeDelta = Math.max(0, Math.min(delta, 0.25));
    this.elapsedSinceTick += safeDelta;
    this.secondsUntilTick -= safeDelta;
    return this.secondsUntilTick <= 0;
  }

  update(delta: number, context: VehicleBrainContext): VehicleBrainDecision | null {
    const safeDelta = Math.max(0, Math.min(delta, 0.25));
    this.elapsedSinceTick += safeDelta;
    this.secondsUntilTick -= safeDelta;
    if (this.secondsUntilTick > 0) return null;
    const tickInterval = this.tickInterval(context);
    this.secondsUntilTick = tickInterval;
    const tickDelta = Math.max(1e-4, this.elapsedSinceTick);
    this.elapsedSinceTick = 0;
    this.updateStuckState(tickDelta, context);
    this.updateTimers(tickDelta, context);

    const recovery = this.recoveryAction(context);
    const crewAction = this.resolveCrewAction(context, recovery);
    this.state = this.resolveState(context, recovery, crewAction);
    if (this.state === 'engaging' || this.state === 'pursuing' || this.state === 'searching') {
      if (this.deviationCountsAgainstMission()) this.deviationSeconds += tickDelta;
    } else if (this.state !== 'evading') {
      this.deviationSeconds = Math.max(0, this.deviationSeconds - tickDelta * 0.5);
    }

    let goal = this.resolveGoal(context);
    let requestPlan =
      goal !== null &&
      (!context.route || !routeEndsNear(context.route.points, goal, this.goalTolerance()));
    if (goalChanged(goal, this.previousGoal, this.goalTolerance())) requestPlan = goal !== null;
    this.previousGoal = goal;

    let control = context.route && goal
      ? this.follower.update({
          delta: Math.max(tickDelta, tickInterval),
          pose: context.pose,
          speed: context.speed,
          path: context.route,
          obstacles: context.obstacles,
          shapeCasts: context.shapeCasts,
          ...(context.externalSpeedLimit !== undefined
            ? { speedLimit: context.externalSpeedLimit }
            : {}),
        })
      : stoppedCommand();
    if (this.state === 'stopped' || goal === null) control = stoppedCommand();

    // El override de recovery va último: es lo único que puede pedir acelerador
    // sin tener un goal alcanzable, que es justamente el caso de estar trabado.
    if (recovery !== 'none') {
      const override = recoveryControl(recovery, this.stuckSeconds, this.recoverySide);
      control = override ?? control;
      if (recovery === 'replan') requestPlan = true;
      if (recovery === 'passingBay' && context.passingBay) {
        goal = context.passingBay.position;
        requestPlan = true;
      }
    }

    return {
      tickInterval,
      behavior: this.behavior,
      state: this.state,
      goal,
      requestPlan,
      control,
      recovery,
      crewAction,
      signals: this.resolveSignals(context),
    };
  }

  reset(): void {
    this.secondsUntilTick = 0;
    this.elapsedSinceTick = 0;
    this.stuckSeconds = 0;
    this.wasStuck = false;
    this.recoveryAttempts = 0;
    this.patrolIndex = 0;
    this.previousGoal = null;
    this.state = 'idle';
    this.deviationSeconds = 0;
    this.deviationCooldown = 0;
    this.searchSeconds = 0;
    this.blockedSeconds = 0;
    this.hornCooldown = 0;
    this.follower.reset();
  }

  setBehavior(behavior: VehicleAiBehavior): void {
    if (this.behavior === behavior) return;
    this.behavior = behavior;
    this.reset();
  }

  getState(): VehicleAiState {
    return this.state;
  }

  private tickInterval(context: VehicleBrainContext): number {
    const distance = context.distanceToPlayer;
    if (distance <= (this.tuning.nearDistance ?? 45)) {
      return 1 / Math.max(1, this.tuning.nearTickRate ?? 10);
    }
    if (distance <= (this.tuning.midDistance ?? 120)) {
      return 1 / Math.max(1, this.tuning.midTickRate ?? 5);
    }
    if (distance <= (this.tuning.farDistance ?? 200)) {
      return 1 / Math.max(0.25, this.tuning.farTickRate ?? 2);
    }
    return 1 / Math.max(0.25, this.tuning.dormantTickRate ?? 0.5);
  }

  private updateTimers(delta: number, context: VehicleBrainContext): void {
    if (this.hornCooldown > 0) this.hornCooldown = Math.max(0, this.hornCooldown - delta);
    if (this.deviationCooldown > 0) {
      this.deviationCooldown = Math.max(0, this.deviationCooldown - delta);
    }
    this.blockedSeconds = context.blocked ? this.blockedSeconds + delta : 0;
    this.searchSeconds += this.state === 'searching' ? delta : 0;
    // La mano sólo cambia orbitando: una misión de flanqueo mantiene su lado.
    if (this.state === 'engaging') {
      this.sideHoldSeconds += delta;
      if (
        this.sideHoldSeconds >= SIDE_HOLD_SECONDS ||
        context.blocked ||
        context.turretAtTraverseLimit === true
      ) {
        this.sideHoldSeconds = 0;
        this.engageSide = this.engageSide === 1 ? -1 : 1;
      }
    } else {
      this.sideHoldSeconds = 0;
    }
    if (this.deviationSeconds > this.deviationBudget()) {
      this.deviationSeconds = 0;
      this.deviationCooldown = this.tuning.deviationCooldownSeconds ?? 6;
    }
  }

  private resolveState(
    context: VehicleBrainContext,
    recovery: VehicleRecoveryAction,
    crewAction: VehicleCrewAiAction,
  ): VehicleAiState {
    if (!context.driverAvailable && !context.replacementDriverAvailable) return 'stopped';
    // Bajarse en movimiento no existe: cualquier acción de tripulación frena
    // primero y `VehicleSystem` sólo la ejecuta con el vehículo ya detenido.
    if (crewAction !== 'none' && crewAction !== 'replaceDriver') return 'stopped';
    if (recovery !== 'none') return 'recovering';
    if (this.shouldFlee(context)) return 'evading';

    const threat = context.threat;
    if (threat && this.canEngage()) {
      if (threat.visible === true) {
        this.searchSeconds = 0;
        return 'engaging';
      }
      if (threat.memoryAge !== undefined) {
        const atLastKnown = planarDistance(context.pose.position, threat.position) <=
          this.goalTolerance() * 1.5;
        if (atLastKnown || this.searchSeconds > 0) {
          if (this.searchSeconds < (this.tuning.searchSeconds ?? 5)) return 'searching';
          this.searchSeconds = 0;
          return this.missionGoalExists(context) ? 'driving' : 'idle';
        }
        return 'pursuing';
      }
    }
    this.searchSeconds = 0;
    return this.missionGoalExists(context) ? 'driving' : 'idle';
  }

  private resolveGoal(context: VehicleBrainContext): VehicleNavPoint | null {
    switch (this.state) {
      case 'stopped':
      case 'idle':
        return null;
      case 'recovering':
        return this.missionGoal(context);
      case 'evading':
        return this.evadeGoal(context);
      case 'engaging':
        return this.engageGoal(context);
      case 'pursuing':
        return context.threat?.position ?? this.missionGoal(context);
      case 'searching':
        // Se queda quieto barriendo con la torreta: moverse a ciegas al último
        // punto visto es lo que hace que una IA parezca tonta.
        return null;
      case 'driving':
        return this.missionGoal(context);
    }
  }

  private missionGoalExists(context: VehicleBrainContext): boolean {
    return this.missionGoal(context) !== null;
  }

  private missionGoal(context: VehicleBrainContext): VehicleNavPoint | null {
    switch (this.behavior) {
      case 'hold':
        return null;
      case 'patrol':
        return this.patrolGoal(context);
      case 'escort':
        return context.escortTarget
          ? escortGoal(context.escortTarget, this.tuning.escortDistance ?? 8)
          : context.authoredGoal ?? null;
      case 'transport':
        return context.passengersOnboard === false
          ? null
          : context.authoredGoal ?? null;
      case 'intercept':
        return interceptGoal(
          context.pose.position,
          context.threat ?? context.escortTarget,
          this.profile.maxSpeed,
        ) ?? context.authoredGoal ?? null;
      case 'flank':
        return flankGoal(
          this.engageSide,
          context.pose.position,
          context.threat,
          this.tuning.flankDistance ?? 12,
        ) ?? context.authoredGoal ?? null;
      case 'retreat':
        return this.evadeGoal(context) ?? context.authoredGoal ?? null;
    }
  }

  /**
   * Punto de combate: a `preferredRange` del blanco. Fuera de banda el punto cae
   * sobre la línea que los une (se acerca o se aleja); dentro de banda el ángulo
   * avanza y el vehículo orbita, que es lo que se lee como "me está rodeando".
   */
  private engageGoal(context: VehicleBrainContext): VehicleNavPoint | null {
    const threat = context.threat;
    if (!threat) return this.missionGoal(context);
    const preferredRange = this.preferredEngagementRange(context);
    if (preferredRange <= 0.5) return threat.position;
    const distance = planarDistance(context.pose.position, threat.position);
    const angleToOwn = headingBetween(threat.position, context.pose.position);
    const inBand =
      distance <= preferredRange * 1.25 && distance >= preferredRange * 0.75;
    const arc = inBand ? (this.tuning.strafeArc ?? 0.5) * this.engageSide : 0;
    const forward = headingToVector(angleToOwn + arc);
    return [
      threat.position[0] + forward[0] * preferredRange,
      context.pose.position[1],
      threat.position[2] + forward[1] * preferredRange,
    ];
  }

  private preferredEngagementRange(context: VehicleBrainContext): number {
    const weaponRange = context.weaponRange ?? 0;
    if (weaponRange <= 0) return 0;
    const factor = clamp(this.tuning.engagementRangeFactor ?? 0.45, 0.1, 0.9);
    return Math.max(this.profile.halfLength * 2, weaponRange * factor);
  }

  /**
   * Rompe contacto alejándose del blanco. El marker de recovery sólo sirve si
   * de verdad se aleja: el nearest marker puede estar justo detrás del enemigo.
   */
  private evadeGoal(context: VehicleBrainContext): VehicleNavPoint | null {
    const away = retreatGoal(
      context.pose.position,
      context.threat,
      this.tuning.retreatDistance ?? 24,
    );
    const marker = context.retreatPoint;
    if (!marker) return away ?? context.authoredGoal ?? null;
    if (!context.threat || !away) return marker;
    const markerDistance = planarDistance(marker, context.threat.position);
    const currentDistance = planarDistance(context.pose.position, context.threat.position);
    return markerDistance > currentDistance ? marker : away;
  }

  private shouldFlee(context: VehicleBrainContext): boolean {
    const threshold = this.tuning.fleeThreshold ?? 0;
    if (threshold <= 0) return false;
    if (context.healthFraction > threshold) return false;
    // Sin nadie a quien temerle, un casco bajo no es motivo para abandonar.
    return context.threat !== undefined;
  }

  private canEngage(): boolean {
    if (this.missionIsCombat()) return true;
    if (!(this.tuning.allowMissionDeviation ?? false)) return false;
    return this.deviationCooldown <= 0;
  }

  private missionIsCombat(): boolean {
    return this.behavior === 'intercept' || this.behavior === 'flank';
  }

  private deviationCountsAgainstMission(): boolean {
    return !this.missionIsCombat();
  }

  private deviationBudget(): number {
    return this.tuning.deviationBudgetSeconds ?? 12;
  }

  private patrolGoal(context: VehicleBrainContext): VehicleNavPoint | null {
    const points = context.patrolPoints ?? [];
    if (points.length === 0) return context.authoredGoal ?? null;
    const current = points[this.patrolIndex % points.length];
    if (planarDistance(context.pose.position, current) <= this.goalTolerance()) {
      this.patrolIndex = (this.patrolIndex + 1) % points.length;
    }
    return points[this.patrolIndex % points.length];
  }

  private resolveCrewAction(
    context: VehicleBrainContext,
    recovery: VehicleRecoveryAction,
  ): VehicleCrewAiAction {
    if (!context.driverAvailable && context.replacementDriverAvailable) return 'replaceDriver';
    if (this.shouldAbandon(context, recovery)) return 'abandonVehicle';
    if (this.shouldDismountToPursue(context)) return 'dismountToPursue';
    if (this.behavior !== 'transport') return 'none';
    if (context.passengersOnboard === false) return 'requestBoarding';
    const goal = context.authoredGoal;
    if (
      context.passengersOnboard &&
      goal &&
      planarDistance(context.pose.position, goal) <= this.goalTolerance()
    ) {
      return 'requestDisembark';
    }
    return 'none';
  }

  /**
   * El vehículo dejó de servir para este objetivo: el blanco quedó donde no se
   * llega manejando —un interior, el otro lado de un barranco— y ya está cerca.
   * Es el patrón del APC de Half-Life 2: la infantería entra a pie y el casco se
   * queda afuera cubriendo la salida.
   *
   * El jugador a bordo cancela la idea: no se lo baja a la fuerza de su propio
   * vehículo.
   */
  private shouldDismountToPursue(context: VehicleBrainContext): boolean {
    if (context.hasPlayerOccupant || context.passengersOnboard === false) return false;
    if (context.threatReachableByVehicle !== false) return false;
    const threat = context.threat;
    if (!threat) return false;
    return (
      planarDistance(context.pose.position, threat.position) <=
      VEHICLE_CREW_DECISION.dismountRange
    );
  }

  /**
   * El vehículo agotó todas las maniobras para desatascarse y sigue sin
   * moverse: volcado, encajado o donde no hay salida. Bajarse es lo único que
   * queda.
   *
   * Un casco bajo NO alcanza para abandonar: para eso está `evading`, que es
   * huir manejando. Un vehículo que todavía anda siempre sirve más que un
   * vehículo vacío, y la destrucción ya dispara la evacuación por otro lado.
   */
  private shouldAbandon(
    context: VehicleBrainContext,
    recovery: VehicleRecoveryAction,
  ): boolean {
    if (context.hasPlayerOccupant) return false;
    return recovery === 'waitForSafeRecovery';
  }

  private resolveSignals(context: VehicleBrainContext): VehicleAiSignals {
    const blocker = context.blockedBy ?? null;
    const wantsHorn =
      this.blockedSeconds >= HORN_BLOCKED_SECONDS &&
      this.hornCooldown <= 0 &&
      blocker !== null &&
      blocker !== context.threat?.id &&
      this.state !== 'evading' &&
      this.state !== 'stopped';
    if (wantsHorn) this.hornCooldown = HORN_COOLDOWN_SECONDS;
    return {
      horn: wantsHorn,
      // Buscar con las luces prendidas es un aviso legible de "te está buscando".
      headlights: this.state === 'searching' ? true : null,
    };
  }

  private updateStuckState(delta: number, context: VehicleBrainContext): void {
    const tryingToMove =
      this.behavior !== 'hold' &&
      context.driverAvailable &&
      (context.route?.points.length ?? 0) > 0;
    if (context.overturned) {
      this.stuckSeconds = Math.max(this.stuckSeconds + delta, 10);
      this.wasStuck = true;
      return;
    }
    if (tryingToMove && context.blocked && Math.abs(context.speed) < 0.55) {
      this.stuckSeconds += delta;
      this.wasStuck = this.wasStuck || this.stuckSeconds >= 0.5;
      return;
    }
    if (!context.blocked || Math.abs(context.speed) > 1.2) {
      // Se desatascó: la próxima vez que se trabe prueba del otro lado, igual
      // que hace `NavigationLocomotion` con los humanoides.
      if (this.wasStuck) {
        this.recoveryAttempts += 1;
        this.recoverySide = this.recoverySide === 1 ? -1 : 1;
        this.wasStuck = false;
      }
      this.stuckSeconds = 0;
    }
  }

  private recoveryAction(context: VehicleBrainContext): VehicleRecoveryAction {
    if (this.stuckSeconds < 0.5) return 'none';
    if (this.stuckSeconds < 1.2) return 'brake';
    if (this.stuckSeconds < 2.5) return 'replan';
    if (this.stuckSeconds < 4.5 && this.profile.reverseAllowed) return 'reverse';
    if (this.stuckSeconds < 7) return 'rock';
    if (this.stuckSeconds < 10 && context.passingBay) return 'passingBay';
    const markerAllowsRecovery =
      context.recoveryMarker?.kind === 'recovery' &&
      context.recoveryMarker.allowRecoverySnap === true;
    if (
      this.definition.allowRecoverySnap &&
      markerAllowsRecovery &&
      !context.visibleToPlayer &&
      !context.hasPlayerOccupant
    ) {
      return 'selfRight';
    }
    return 'waitForSafeRecovery';
  }

  private goalTolerance(): number {
    return Math.max(this.profile.halfLength, this.tuning.goalTolerance ?? 3);
  }
}

function escortGoal(
  target: VehicleAiTarget,
  distance: number,
): VehicleNavPoint {
  const heading = target.heading ??
    (target.velocity && Math.hypot(target.velocity[0], target.velocity[2]) > 0.1
      ? headingBetween([0, 0, 0], target.velocity)
      : 0);
  const forward = headingToVector(heading);
  return [
    target.position[0] - forward[0] * distance,
    target.position[1],
    target.position[2] - forward[1] * distance,
  ];
}

function interceptGoal(
  ownPosition: VehicleNavPoint,
  target: VehicleAiTarget | undefined,
  maximumSpeed: number,
): VehicleNavPoint | null {
  if (!target) return null;
  const velocity = target.velocity ?? [0, 0, 0];
  const leadSeconds = clamp(
    planarDistance(ownPosition, target.position) / Math.max(1, maximumSpeed),
    0.35,
    3,
  );
  return [
    target.position[0] + velocity[0] * leadSeconds,
    target.position[1] + velocity[1] * leadSeconds,
    target.position[2] + velocity[2] * leadSeconds,
  ];
}

function flankGoal(
  side: 1 | -1,
  ownPosition: VehicleNavPoint,
  target: VehicleAiTarget | undefined,
  distance: number,
): VehicleNavPoint | null {
  if (!target) return null;
  const dx = target.position[0] - ownPosition[0];
  const dz = target.position[2] - ownPosition[2];
  const length = Math.max(0.001, Math.hypot(dx, dz));
  return [
    target.position[0] + (-dz / length) * distance * side,
    target.position[1],
    target.position[2] + (dx / length) * distance * side,
  ];
}

function retreatGoal(
  ownPosition: VehicleNavPoint,
  threat: VehicleAiTarget | undefined,
  distance: number,
): VehicleNavPoint | null {
  if (!threat) return null;
  const dx = ownPosition[0] - threat.position[0];
  const dz = ownPosition[2] - threat.position[2];
  const length = Math.max(0.001, Math.hypot(dx, dz));
  return [
    ownPosition[0] + (dx / length) * distance,
    ownPosition[1],
    ownPosition[2] + (dz / length) * distance,
  ];
}

function routeEndsNear(
  points: readonly { position: VehicleNavPoint }[],
  goal: VehicleNavPoint,
  tolerance: number,
): boolean {
  const end = points.at(-1);
  return end ? planarDistance(end.position, goal) <= tolerance : false;
}

function goalChanged(
  next: VehicleNavPoint | null,
  previous: VehicleNavPoint | null,
  tolerance: number,
): boolean {
  if (!next || !previous) return next !== previous;
  return planarDistance(next, previous) > tolerance;
}

function recoveryControl(
  action: VehicleRecoveryAction,
  stuckSeconds: number,
  side: 1 | -1,
): VehicleControlCommand | null {
  switch (action) {
    case 'none':
    case 'passingBay':
      return null;
    case 'brake':
    case 'replan':
    case 'selfRight':
    case 'waitForSafeRecovery':
      return stoppedCommand();
    case 'reverse':
      return {
        ...stoppedCommand(),
        throttle: 0.6,
        brake: 0,
        steering: 0.42 * side,
        reverse: true,
        targetSpeed: 4,
      };
    case 'rock': {
      const reverse = Math.floor(stuckSeconds / 0.55) % 2 === 0;
      return {
        ...stoppedCommand(),
        throttle: 0.72,
        brake: 0,
        steering: (reverse ? -0.65 : 0.65) * side,
        reverse,
        targetSpeed: 5,
      };
    }
  }
}
