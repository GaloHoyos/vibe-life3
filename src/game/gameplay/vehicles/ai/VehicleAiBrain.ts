import type { VehicleAiDefinition, VehicleAiBehavior } from '@game/levels/LevelDefinition';
import type {
  VehicleBrainContext,
  VehicleBrainDecision,
  VehicleControlCommand,
  VehicleCrewAiAction,
  VehicleNavigationProfile,
  VehicleNavPoint,
  VehicleRecoveryAction,
} from './VehicleAiTypes';
import {
  clamp,
  headingBetween,
  headingToVector,
  planarDistance,
} from './VehicleAiMath';
import { stoppedCommand, VehiclePathFollower } from './VehiclePathFollower';

export interface VehicleAiBrainTuning {
  nearDistance?: number;
  nearTickRate?: number;
  midTickRate?: number;
  goalTolerance?: number;
  escortDistance?: number;
  flankDistance?: number;
  retreatDistance?: number;
}

export class VehicleAiBrain {
  private readonly follower: VehiclePathFollower;
  private behavior: VehicleAiBehavior;
  private secondsUntilTick = 0;
  private elapsedSinceTick = 0;
  private stuckSeconds = 0;
  private patrolIndex = 0;
  private previousGoal: VehicleNavPoint | null = null;

  constructor(
    readonly vehicleId: string,
    private readonly definition: VehicleAiDefinition,
    private readonly profile: VehicleNavigationProfile,
    private readonly tuning: VehicleAiBrainTuning = {},
  ) {
    this.follower = new VehiclePathFollower(profile);
    this.behavior = definition.behavior;
  }

  update(delta: number, context: VehicleBrainContext): VehicleBrainDecision | null {
    const safeDelta = Math.max(0, Math.min(delta, 0.25));
    this.elapsedSinceTick += safeDelta;
    this.secondsUntilTick -= safeDelta;
    if (this.secondsUntilTick > 0) return null;
    const tickInterval = this.tickInterval(context.distanceToPlayer);
    this.secondsUntilTick = tickInterval;
    const tickDelta = Math.max(1e-4, this.elapsedSinceTick);
    this.elapsedSinceTick = 0;
    this.updateStuckState(tickDelta, context);

    let goal = this.resolveGoal(context);
    let crewAction = this.resolveCrewAction(context, goal);
    if (crewAction === 'requestBoarding') goal = null;
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
        })
      : stoppedCommand();

    const recovery = this.recoveryAction(context);
    if (recovery !== 'none') {
      const override = recoveryControl(recovery, this.stuckSeconds);
      control = override ?? control;
      if (recovery === 'replan') requestPlan = true;
      if (recovery === 'passingBay' && context.passingBay) {
        goal = context.passingBay.position;
        requestPlan = true;
      }
    }
    if (!context.driverAvailable && !context.replacementDriverAvailable) {
      control = stoppedCommand();
    }
    if (
      crewAction === 'requestDisembark' ||
      crewAction === 'requestBoarding'
    ) {
      control = stoppedCommand();
    }

    return {
      tickInterval,
      behavior: this.behavior,
      goal,
      requestPlan,
      control,
      recovery,
      crewAction,
    };
  }

  reset(): void {
    this.secondsUntilTick = 0;
    this.elapsedSinceTick = 0;
    this.stuckSeconds = 0;
    this.patrolIndex = 0;
    this.previousGoal = null;
    this.follower.reset();
  }

  setBehavior(behavior: VehicleAiBehavior): void {
    if (this.behavior === behavior) return;
    this.behavior = behavior;
    this.reset();
  }

  private tickInterval(distanceToPlayer: number): number {
    const near = distanceToPlayer <= (this.tuning.nearDistance ?? 45);
    const rate = near
      ? this.tuning.nearTickRate ?? 10
      : this.tuning.midTickRate ?? 5;
    return 1 / Math.max(1, rate);
  }

  private resolveGoal(context: VehicleBrainContext): VehicleNavPoint | null {
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
          this.vehicleId,
          context.pose.position,
          context.threat,
          this.tuning.flankDistance ?? 12,
        ) ?? context.authoredGoal ?? null;
      case 'retreat':
        return context.retreatPoint ??
          retreatGoal(
            context.pose.position,
            context.threat,
            this.tuning.retreatDistance ?? 24,
          ) ??
          context.authoredGoal ??
          null;
    }
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
    goal: VehicleNavPoint | null,
  ): VehicleCrewAiAction {
    if (!context.driverAvailable && context.replacementDriverAvailable) return 'replaceDriver';
    if (this.behavior !== 'transport') return 'none';
    if (context.passengersOnboard === false) return 'requestBoarding';
    if (
      context.passengersOnboard &&
      goal &&
      planarDistance(context.pose.position, goal) <= this.goalTolerance()
    ) {
      return 'requestDisembark';
    }
    return 'none';
  }

  private updateStuckState(delta: number, context: VehicleBrainContext): void {
    const tryingToMove =
      this.behavior !== 'hold' &&
      context.driverAvailable &&
      (context.route?.points.length ?? 0) > 0;
    if (context.overturned) {
      this.stuckSeconds = Math.max(this.stuckSeconds + delta, 10);
      return;
    }
    if (tryingToMove && context.blocked && Math.abs(context.speed) < 0.55) {
      this.stuckSeconds += delta;
      return;
    }
    if (!context.blocked || Math.abs(context.speed) > 1.2) this.stuckSeconds = 0;
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

export class VehicleAiCoordinator {
  private readonly brains = new Map<string, VehicleAiBrain>();

  register(
    vehicleId: string,
    definition: VehicleAiDefinition,
    profile: VehicleNavigationProfile,
    tuning?: VehicleAiBrainTuning,
  ): VehicleAiBrain {
    const brain = new VehicleAiBrain(vehicleId, definition, profile, tuning);
    this.brains.set(vehicleId, brain);
    return brain;
  }

  get(vehicleId: string): VehicleAiBrain | null {
    return this.brains.get(vehicleId) ?? null;
  }

  unregister(vehicleId: string): void {
    this.brains.delete(vehicleId);
  }

  clear(): void {
    this.brains.clear();
  }
}

function escortGoal(
  target: NonNullable<VehicleBrainContext['escortTarget']>,
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
  target: VehicleBrainContext['threat'],
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
  vehicleId: string,
  ownPosition: VehicleNavPoint,
  target: VehicleBrainContext['threat'],
  distance: number,
): VehicleNavPoint | null {
  if (!target) return null;
  const dx = target.position[0] - ownPosition[0];
  const dz = target.position[2] - ownPosition[2];
  const length = Math.max(0.001, Math.hypot(dx, dz));
  const side = stableSide(vehicleId);
  return [
    target.position[0] + (-dz / length) * distance * side,
    target.position[1],
    target.position[2] + (dx / length) * distance * side,
  ];
}

function retreatGoal(
  ownPosition: VehicleNavPoint,
  threat: VehicleBrainContext['threat'],
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

function stableSide(id: string): 1 | -1 {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 0x45d9f3b);
  }
  return (hash & 1) === 0 ? 1 : -1;
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
        steering: 0.42,
        reverse: true,
        targetSpeed: 4,
      };
    case 'rock': {
      const reverse = Math.floor(stuckSeconds / 0.55) % 2 === 0;
      return {
        ...stoppedCommand(),
        throttle: 0.72,
        brake: 0,
        steering: reverse ? -0.65 : 0.65,
        reverse,
        targetSpeed: 5,
      };
    }
  }
}

export function resolveVehicleBehaviorGoal(
  behavior: VehicleAiBehavior,
  vehicleId: string,
  profile: VehicleNavigationProfile,
  context: VehicleBrainContext,
): VehicleNavPoint | null {
  const definition: VehicleAiDefinition = { enabled: true, behavior };
  const brain = new VehicleAiBrain(vehicleId, definition, profile);
  return brain.update(0, context)?.goal ?? null;
}
