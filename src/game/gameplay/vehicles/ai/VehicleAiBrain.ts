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
  type VehiclePathProgress,
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
/**
 * Cuánto puede un vehículo no acercarse a un blanco que perdió de vista antes
 * de soltar infantería, y cuántos metros cuentan como haberse acercado. Es
 * corto a propósito: un buggy raspando una pared es lo que el jugador está
 * mirando mientras espera que pase algo.
 */
const DISMOUNT_STALL_SECONDS = 3;
const APPROACH_PROGRESS_METERS = 1;
const VISIBLE_FOOT_DEPLOY_RANGE = 20;
const ENGAGEMENT_ANCHOR_SECONDS = 3;
const ENGAGEMENT_ANCHOR_MOVE_METERS = 8;
/** Cuánto pasa la meta del ataque en pasada detrás del blanco, para no frenar sobre él. */
const ATTACK_RUN_OVERSHOOT_METERS = 14;
const RECOVERY_SUCCESS_METERS = 5;
const RECOVERY_MIN_CLEARANCE = 1.25;

export class VehicleAiBrain {
  private readonly follower: VehiclePathFollower;
  private behavior: VehicleAiBehavior;
  private state: VehicleAiState = 'idle';
  private secondsUntilTick = 0;
  private elapsedSinceTick = 0;
  private recoveryActive = false;
  private recoveryElapsed = 0;
  private recoveryTravel = 0;
  private recoveryStart: VehicleNavPoint | null = null;
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
  private dismountRequested = false;
  private trackedThreatId: string | null = null;
  private closestApproach = Infinity;
  private approachStallSeconds = 0;
  private dismountCooldown = 0;
  private engageAnchor: VehicleNavPoint | null = null;
  private engageAnchorTarget: VehicleNavPoint | null = null;
  private engageAnchorSeconds = 0;

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
    this.updateRecoveryState(tickDelta, context);
    this.updateTimers(tickDelta, context);
    this.updateApproachProgress(tickDelta, context);

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
      ? this.followPath(Math.max(tickDelta, tickInterval), context)
      : stoppedCommand();
    if (this.state === 'stopped' || goal === null) control = stoppedCommand();

    // El override de recovery va último: es lo único que puede pedir acelerador
    // sin tener un goal alcanzable, que es justamente el caso de estar trabado.
    if (recovery !== 'none') {
      const override = recoveryControl(recovery, this.recoveryElapsed, this.recoverySide);
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
    this.recoveryActive = false;
    this.recoveryElapsed = 0;
    this.recoveryTravel = 0;
    this.recoveryStart = null;
    this.recoveryAttempts = 0;
    this.patrolIndex = 0;
    this.previousGoal = null;
    this.state = 'idle';
    this.deviationSeconds = 0;
    this.deviationCooldown = 0;
    this.searchSeconds = 0;
    this.blockedSeconds = 0;
    this.hornCooldown = 0;
    this.dismountRequested = false;
    this.trackedThreatId = null;
    this.closestApproach = Infinity;
    this.approachStallSeconds = 0;
    this.dismountCooldown = 0;
    this.engageAnchor = null;
    this.engageAnchorTarget = null;
    this.engageAnchorSeconds = 0;
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

  /**
   * Runs the physical path follower independently from the strategic tick.
   * The caller refreshes pose and speed every frame while route and obstacle
   * observations remain valid until the next perception update.
   */
  followPath(delta: number, context: VehicleBrainContext): VehicleControlCommand {
    const path = context.route;
    if (!path) return stoppedCommand();
    return this.follower.update({
      delta: Math.max(1e-4, delta),
      pose: context.pose,
      speed: context.speed,
      path,
      obstacles: context.obstacles,
      shapeCasts: context.shapeCasts,
      ...(context.externalSpeedLimit !== undefined
        ? { speedLimit: context.externalSpeedLimit }
        : {}),
    });
  }

  getPathProgress(): VehiclePathProgress | null {
    return this.follower.getProgress();
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
    if (this.dismountCooldown > 0) {
      this.dismountCooldown = Math.max(0, this.dismountCooldown - delta);
    }
    if (this.deviationCooldown > 0) {
      this.deviationCooldown = Math.max(0, this.deviationCooldown - delta);
    }
    this.blockedSeconds = context.blocked ? this.blockedSeconds + delta : 0;
    this.searchSeconds += this.state === 'searching' ? delta : 0;
    // La mano sólo cambia orbitando: una misión de flanqueo mantiene su lado.
    if (this.state === 'engaging') {
      this.engageAnchorSeconds += delta;
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
      this.engageAnchorSeconds = 0;
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
    if (threat && this.canEngage(context)) {
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
        return this.tacticalEngageGoal(context) ??
          (context.threat?.mobility === 'vehicle'
            ? interceptGoal(
                context.pose.position,
                context.threat,
                this.profile.maxSpeed,
              )
            : this.engageGoal(context));
      case 'pursuing':
        return this.tacticalEngageGoal(context) ??
          context.threat?.position ??
          this.missionGoal(context);
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
   * Metas de las tácticas que mandan sobre la pose de combate por defecto. El
   * ataque en pasada apunta más allá del blanco para no frenar encima suyo y la
   * reposición orbita hasta una pose desde la que el arma sí entra.
   */
  private tacticalEngageGoal(
    context: VehicleBrainContext,
  ): VehicleNavPoint | null {
    const threat = context.threat;
    if (!threat) return null;
    if (context.tactic === 'attackRun') {
      const lead = interceptGoal(
        context.pose.position,
        threat,
        this.profile.maxSpeed,
      ) ?? threat.position;
      const dx = lead[0] - context.pose.position[0];
      const dz = lead[2] - context.pose.position[2];
      const length = Math.max(0.001, Math.hypot(dx, dz));
      const overshoot = Math.max(
        ATTACK_RUN_OVERSHOOT_METERS,
        this.profile.halfLength * 4,
      );
      return [
        lead[0] + (dx / length) * overshoot,
        lead[1],
        lead[2] + (dz / length) * overshoot,
      ];
    }
    if (context.tactic === 'reposition') {
      if (context.tacticalAnchor) return context.tacticalAnchor;
      const distance = Math.max(
        this.preferredEngagementRange(context),
        this.tuning.flankDistance ?? 12,
      );
      return flankGoal(
        this.engageSide,
        context.pose.position,
        threat,
        distance,
      );
    }
    return null;
  }

  private engageGoal(context: VehicleBrainContext): VehicleNavPoint | null {
    const threat = context.threat;
    if (!threat) return this.missionGoal(context);
    if (context.tactic === 'suppress' && context.tacticalAnchor) {
      return context.tacticalAnchor;
    }
    const anchorStillValid =
      this.engageAnchor !== null &&
      this.engageAnchorTarget !== null &&
      this.engageAnchorSeconds < ENGAGEMENT_ANCHOR_SECONDS &&
      planarDistance(this.engageAnchorTarget, threat.position) <
        ENGAGEMENT_ANCHOR_MOVE_METERS &&
      !context.blocked &&
      context.turretAtTraverseLimit !== true;
    if (anchorStillValid) return this.engageAnchor;

    const preferredRange = this.preferredEngagementRange(context);
    if (preferredRange <= 0.5) return threat.position;
    const distance = planarDistance(context.pose.position, threat.position);
    const anchor = distance <= preferredRange * 1.1
      ? context.pose.position
      : standoffPoint(
          threat.position,
          context.pose.position,
          preferredRange,
        );
    this.engageAnchor = [...anchor];
    this.engageAnchorTarget = [...threat.position];
    this.engageAnchorSeconds = 0;
    return this.engageAnchor;
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

  private canEngage(context: VehicleBrainContext): boolean {
    if (
      context.tactic === 'intercept' ||
      context.tactic === 'attackRun' ||
      context.tactic === 'suppress' ||
      context.tactic === 'reposition' ||
      context.tactic === 'deploy' ||
      context.tactic === 'search'
    ) {
      return true;
    }
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
    if (
      context.tactic === 'replaceDriver' ||
      (!context.driverAvailable && context.replacementDriverAvailable)
    ) return 'replaceDriver';
    if (
      context.tactic === 'abandon' ||
      context.tactic === 'switchVehicle' ||
      context.tactic === 'requestExtraction'
    ) return 'abandonVehicle';
    if (this.shouldAbandon(context, recovery)) return 'abandonVehicle';
    this.rearmDismount(context);
    const tacticalDismount =
      !this.dismountRequested &&
      (context.tactic === 'deploy' || context.tactic === 'continueOnFoot') &&
      context.safeToDismount !== false;
    if (tacticalDismount || this.shouldDismountToPursue(context)) {
      // `VehicleSystem` sólo ejecuta la bajada con el vehículo ya detenido, así
      // que el compromiso se cierra recién ahí: cerrarlo al pedirla perdería la
      // orden mientras frena, y no cerrarlo nunca vaciaría el vehículo de a un
      // tripulante por tick.
      if ((context.planarSpeed ?? Math.abs(context.speed)) < 1) {
        this.dismountRequested = true;
        this.dismountCooldown = 10;
      }
      return 'dismountToPursue';
    }
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
   * El vehículo dejó de servir para este objetivo y lo que sigue es a pie. Es el
   * patrón del APC de Half-Life 2: la infantería entra y el casco se queda
   * afuera cubriendo la salida. Dos motivos lo disparan, los dos con el blanco
   * ya cerca:
   *
   *  - el blanco quedó en otra isla de la grilla: un interior, el otro lado de
   *    un barranco;
   *  - lo perdió de vista y dejó de acercársele. Eso cubre de una todo lo que
   *    en la práctica separa a un vehículo de su blanco y la grilla no ve: una
   *    pared a tres metros que igual da por alcanzable, un vano por el que no
   *    entra, o el último-visto ya pisado y nadie ahí. La bandera de la grilla
   *    dice cuándo es imposible; no acercarse dice cuándo da lo mismo.
   *
   * Quién baja y quién se queda lo decide `selectDisembarkingCrew`, que siempre
   * suelta al menos uno: que a bordo vaya un solo tripulante no es motivo para
   * quedarse sentado, es motivo para abandonar el vehículo.
   *
   * El jugador a bordo cancela la idea: no se lo baja a la fuerza de su propio
   * vehículo.
   */
  private shouldDismountToPursue(context: VehicleBrainContext): boolean {
    if (
      context.hasPlayerOccupant ||
      this.dismountRequested ||
      this.dismountCooldown > 0
    ) return false;
    const threat = context.threat;
    if (!threat) return false;
    if (threat.mobility === 'vehicle') return false;
    const distance = planarDistance(context.pose.position, threat.position);
    if (distance > VEHICLE_CREW_DECISION.dismountRange) return false;
    if (
      threat.mobility === 'foot' &&
      threat.visible === true &&
      distance <= VISIBLE_FOOT_DEPLOY_RANGE
    ) {
      return true;
    }
    if (context.threatReachableByVehicle === false) return true;
    return this.approachStallSeconds >= DISMOUNT_STALL_SECONDS;
  }

  /**
   * Hace cuánto que el vehículo no se acerca al blanco. Tenerlo a la vista
   * reinicia la cuenta: mientras hay contacto está haciendo su trabajo aunque
   * mantenga la distancia de tiro, y el estancamiento sólo significa algo
   * cuando lo que quiere es volver a encontrarlo.
   */
  private updateApproachProgress(
    delta: number,
    context: VehicleBrainContext,
  ): void {
    const threat = context.threat;
    if (!threat) {
      this.trackedThreatId = null;
      this.closestApproach = Infinity;
      this.approachStallSeconds = 0;
      return;
    }
    if (threat.id !== this.trackedThreatId) {
      this.trackedThreatId = threat.id;
      this.closestApproach = Infinity;
      this.approachStallSeconds = 0;
      this.dismountRequested = false;
      this.dismountCooldown = 0;
    }
    const distance = planarDistance(context.pose.position, threat.position);
    if (distance < this.closestApproach - APPROACH_PROGRESS_METERS) {
      this.closestApproach = Math.min(this.closestApproach, distance);
      this.approachStallSeconds = 0;
      return;
    }
    this.approachStallSeconds += delta;
  }

  /** Libera el compromiso cuando terminó el contacto; un target nuevo lo hace en updateApproachProgress. */
  private rearmDismount(context: VehicleBrainContext): void {
    if (!this.dismountRequested) return;
    const threat = context.threat;
    if (!threat && this.dismountCooldown <= 0) {
      this.dismountRequested = false;
    }
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

  private updateRecoveryState(delta: number, context: VehicleBrainContext): void {
    if (!this.recoveryActive) {
      if (!context.blocked && !context.overturned) return;
      this.recoveryActive = true;
      this.recoveryElapsed = 0;
      this.recoveryTravel = 0;
      this.recoveryStart = [...context.pose.position];
      const clearance = context.recoveryClearance;
      if (clearance && clearance.left !== clearance.right) {
        this.recoverySide = clearance.left > clearance.right ? 1 : -1;
      }
    }

    this.recoveryElapsed += delta;
    this.recoveryTravel = this.recoveryStart
      ? planarDistance(this.recoveryStart, context.pose.position)
      : 0;
    if (
      this.recoveryTravel >= RECOVERY_SUCCESS_METERS &&
      !context.blocked &&
      !context.overturned
    ) {
      this.recoveryActive = false;
      this.recoveryElapsed = 0;
      this.recoveryTravel = 0;
      this.recoveryStart = null;
      this.recoveryAttempts += 1;
      this.recoverySide = this.recoverySide === 1 ? -1 : 1;
    }
  }

  private recoveryAction(context: VehicleBrainContext): VehicleRecoveryAction {
    if (!this.recoveryActive) return 'none';
    if (context.overturned) this.recoveryElapsed = Math.max(this.recoveryElapsed, 10);
    const clearance = context.recoveryClearance;
    const rearClear = !clearance || clearance.rear >= RECOVERY_MIN_CLEARANCE;
    const frontClear = !clearance || clearance.front >= RECOVERY_MIN_CLEARANCE;
    if (this.recoveryElapsed < 0.3) return 'brake';
    if (this.recoveryElapsed < 0.9) return 'replan';
    if (
      this.recoveryElapsed < 3.4 &&
      this.profile.reverseAllowed &&
      rearClear
    ) return 'reverse';
    if (this.recoveryElapsed < 5.4 && frontClear) return 'forwardCounter';
    if (
      this.recoveryElapsed < 7.9 &&
      this.profile.reverseAllowed &&
      rearClear
    ) {
      return 'reverseOpposite';
    }
    if (this.recoveryElapsed < 9.9 && frontClear) return 'forwardCounterOpposite';
    if (this.recoveryElapsed < 12 && context.passingBay) return 'passingBay';
    const markerAllowsRecovery =
      context.recoveryMarker?.kind === 'recovery' &&
      context.recoveryMarker.allowRecoverySnap === true;
    if (
      this.definition.allowRecoverySnap &&
      markerAllowsRecovery &&
      !context.visibleToPlayer &&
      context.distanceToPlayer > 35 &&
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

function standoffPoint(
  target: VehicleNavPoint,
  ownPosition: VehicleNavPoint,
  distance: number,
): VehicleNavPoint {
  const dx = ownPosition[0] - target[0];
  const dz = ownPosition[2] - target[2];
  const length = Math.max(0.001, Math.hypot(dx, dz));
  return [
    target[0] + (dx / length) * distance,
    ownPosition[1],
    target[2] + (dz / length) * distance,
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
    case 'forwardCounter':
      return {
        ...stoppedCommand(),
        throttle: 0.68,
        brake: 0,
        steering: -0.58 * side,
        reverse: false,
        targetSpeed: 5,
      };
    case 'reverseOpposite':
      return {
        ...stoppedCommand(),
        throttle: 0.62,
        brake: 0,
        steering: -0.48 * side,
        reverse: true,
        targetSpeed: 4,
      };
    case 'forwardCounterOpposite':
      return {
        ...stoppedCommand(),
        throttle: 0.68,
        brake: 0,
        steering: 0.58 * side,
        reverse: false,
        targetSpeed: 5,
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
