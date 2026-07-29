import type { VehiclePresetDefinition } from '@game/config/vehicles.config';
import type { VehicleAiDefinition } from '@game/levels/LevelDefinition';
import type {
  VehicleBrainContext,
  VehicleBrainDecision,
  VehicleControlCommand,
  VehicleDrivingPath,
  VehicleNavigationBakeInput,
  VehicleNavigationProfile,
  VehicleNavPoint,
} from './VehicleAiTypes';
import {
  navigationProfileFromPreset,
} from './VehicleAiTypes';
import { headingBetween, planarDistance } from './VehicleAiMath';
import {
  createDefaultVehicleNavigationCache,
  type VehicleNavigationCache,
} from './VehicleNavigationCache';
import {
  VehicleNavigationPlanner,
  type VehiclePlannedRoute,
} from './VehicleNavigationPlanner';
import {
  createVehicleNavigationPlanClient,
  type VehicleNavigationPlanClientFactory,
  type VehicleNavigationPlanService,
} from './VehicleNavigationPlanClient';
import { VehicleAiBrain, type VehicleAiBrainTuning } from './VehicleAiBrain';

export interface VehicleAiRegistration {
  vehicleId: string;
  preset: VehiclePresetDefinition;
  ai: VehicleAiDefinition;
  tuning?: VehicleAiBrainTuning;
}

export interface VehicleAiUpdate {
  decision: VehicleBrainDecision;
  path: VehicleDrivingPath | null;
  pathChanged: boolean;
}

export interface VehicleAiSnapshot {
  vehicleId: string;
  profileId: string;
  behavior: VehicleAiDefinition['behavior'];
  goal: {
    position: VehicleNavPoint;
    heading: number | null;
  } | null;
  path: VehicleDrivingPath | null;
  lastDecision: VehicleBrainDecision | null;
}

interface VehicleAiRecord {
  profile: VehicleNavigationProfile;
  definition: VehicleAiDefinition;
  brain: VehicleAiBrain;
  goal: { position: VehicleNavPoint; heading: number | null } | null;
  plannedRoute: VehiclePlannedRoute | null;
  restoredPath: VehicleDrivingPath | null;
  lastDecision: VehicleBrainDecision | null;
  desiredPlanGoal: VehicleNavPoint | null;
  planGeneration: number;
  planPending: boolean;
  planRetrySeconds: number;
  planFailureCount: number;
  pathChangedPending: boolean;
}

export class VehicleAiSystem {
  private plannerClient: VehicleNavigationPlanService | null = null;
  private currentNavigationHash: string | null = null;
  private readonly vehicles = new Map<string, VehicleAiRecord>();

  constructor(
    private readonly cache: VehicleNavigationCache = createDefaultVehicleNavigationCache(),
    private readonly createPlanClient: VehicleNavigationPlanClientFactory =
      createVehicleNavigationPlanClient,
  ) {}

  async load(
    input: VehicleNavigationBakeInput,
  ): Promise<{ hash: string; cacheHit: boolean }> {
    this.plannerClient?.dispose();
    this.plannerClient = null;
    this.currentNavigationHash = null;
    const result = await VehicleNavigationPlanner.create(input, this.cache);
    this.plannerClient = await this.createPlanClient(
      result.planner.navigation,
      input.profiles,
      result.planner,
    );
    this.currentNavigationHash = result.planner.navigation.hash;
    for (const record of this.vehicles.values()) {
      record.plannedRoute = null;
      record.restoredPath = null;
      this.invalidatePendingPlan(record);
      record.pathChangedPending = false;
      record.brain.reset();
    }
    return { hash: result.planner.navigation.hash, cacheHit: result.cacheHit };
  }

  navigationHash(): string | null {
    return this.currentNavigationHash;
  }

  hasVehicle(vehicleId: string): boolean {
    return this.vehicles.has(vehicleId);
  }

  registerVehicle(registration: VehicleAiRegistration): boolean {
    this.unregisterVehicle(registration.vehicleId);
    if (!registration.ai.enabled) return false;
    const profile = navigationProfileFromPreset(registration.preset);
    if (profile.surface === 'rail') return false;
    this.vehicles.set(registration.vehicleId, {
      profile,
      definition: registration.ai,
      brain: new VehicleAiBrain(
        registration.vehicleId,
        registration.ai,
        profile,
        registration.tuning,
      ),
      goal: null,
      plannedRoute: null,
      restoredPath: null,
      lastDecision: null,
      desiredPlanGoal: null,
      planGeneration: 0,
      planPending: false,
      planRetrySeconds: 0,
      planFailureCount: 0,
      pathChangedPending: false,
    });
    return true;
  }

  unregisterVehicle(vehicleId: string): void {
    this.vehicles.delete(vehicleId);
  }

  setGoal(vehicleId: string, position: VehicleNavPoint, heading?: number): boolean {
    const record = this.vehicles.get(vehicleId);
    if (!record) return false;
    record.goal = {
      position: [...position],
      heading: heading ?? null,
    };
    record.plannedRoute = null;
    record.restoredPath = null;
    this.invalidatePendingPlan(record);
    return true;
  }

  clearGoal(vehicleId: string): boolean {
    const record = this.vehicles.get(vehicleId);
    if (!record) return false;
    record.goal = null;
    record.plannedRoute = null;
    record.restoredPath = null;
    this.invalidatePendingPlan(record);
    record.brain.reset();
    record.lastDecision = null;
    return true;
  }

  update(
    vehicleId: string,
    delta: number,
    context: VehicleBrainContext,
  ): VehicleAiUpdate | null {
    const record = this.vehicles.get(vehicleId);
    if (!record) return null;
    record.planRetrySeconds = Math.max(0, record.planRetrySeconds - Math.max(0, delta));
    const activePath =
      record.plannedRoute?.path ??
      record.restoredPath ??
      context.route;
    const authoredGoal = record.goal?.position ?? context.authoredGoal;
    const decision = record.brain.update(delta, {
      ...context,
      authoredGoal,
      route: activePath,
    });
    if (!decision) return null;

    record.desiredPlanGoal = decision.goal ? [...decision.goal] : null;
    let pathChanged = record.pathChangedPending;
    record.pathChangedPending = false;
    if (decision.goal && decision.requestPlan && this.plannerClient) {
      if (!record.planPending && record.planRetrySeconds <= 0) {
        const authoredHeading =
          record.goal &&
          record.goal.heading !== null &&
          planarDistance(record.goal.position, decision.goal) <=
            Math.max(3, record.profile.halfLength)
            ? record.goal.heading
            : null;
        const goalHeading =
          authoredHeading ??
          headingBetween(context.pose.position, decision.goal);
        this.requestPlan(
          vehicleId,
          record,
          context.pose,
          decision.goal,
          goalHeading,
        );
      }
    } else if (!decision.goal && (record.plannedRoute || record.restoredPath)) {
      this.invalidatePendingPlan(record);
      record.plannedRoute = null;
      record.restoredPath = null;
      pathChanged = true;
    }
    record.lastDecision = decision;
    return {
      decision,
      path: record.plannedRoute?.path ?? record.restoredPath ?? activePath ?? null,
      pathChanged,
    };
  }

  controlOutput(vehicleId: string): VehicleControlCommand | null {
    return this.vehicles.get(vehicleId)?.lastDecision?.control ?? null;
  }

  snapshot(vehicleId: string): VehicleAiSnapshot | null {
    const record = this.vehicles.get(vehicleId);
    if (!record) return null;
    return {
      vehicleId,
      profileId: record.profile.id,
      behavior: record.definition.behavior,
      goal: record.goal
        ? {
            position: [...record.goal.position],
            heading: record.goal.heading,
          }
        : null,
      path: clonePath(record.plannedRoute?.path ?? record.restoredPath ?? null),
      lastDecision: record.lastDecision,
    };
  }

  snapshots(): VehicleAiSnapshot[] {
    return [...this.vehicles.keys()]
      .sort()
      .map((vehicleId) => this.snapshot(vehicleId))
      .filter((snapshot): snapshot is VehicleAiSnapshot => snapshot !== null);
  }

  restoreSnapshot(snapshot: VehicleAiSnapshot): boolean {
    const record = this.vehicles.get(snapshot.vehicleId);
    if (!record || record.profile.id !== snapshot.profileId) return false;
    record.goal = snapshot.goal
      ? {
          position: [...snapshot.goal.position],
          heading: snapshot.goal.heading,
        }
      : null;
    record.plannedRoute = null;
    record.restoredPath = clonePath(snapshot.path);
    record.lastDecision = snapshot.lastDecision;
    this.invalidatePendingPlan(record);
    record.pathChangedPending = false;
    record.brain.reset();
    return true;
  }

  dispose(): void {
    this.plannerClient?.dispose();
    this.plannerClient = null;
    this.currentNavigationHash = null;
    this.vehicles.clear();
  }

  private requestPlan(
    vehicleId: string,
    record: VehicleAiRecord,
    start: VehicleBrainContext['pose'],
    goal: VehicleNavPoint,
    goalHeading: number,
  ): void {
    const plannerClient = this.plannerClient;
    if (!plannerClient) return;
    const generation = record.planGeneration + 1;
    record.planGeneration = generation;
    record.planPending = true;
    const requestedGoal: VehicleNavPoint = [...goal];
    void plannerClient.plan(
      record.profile.id,
      {
        position: [...start.position],
        heading: start.heading,
      },
      {
        position: requestedGoal,
        heading: goalHeading,
      },
    ).then((route) => {
      const current = this.vehicles.get(vehicleId);
      if (current !== record || current.planGeneration !== generation) return;
      current.planPending = false;
      if (!route) {
        this.deferPlanRetry(current);
        return;
      }
      current.planFailureCount = 0;
      current.planRetrySeconds = 0;
      const latestGoal = current.desiredPlanGoal;
      const goalTolerance = Math.max(3, current.profile.halfLength);
      if (
        !latestGoal ||
        planarDistance(latestGoal, requestedGoal) > goalTolerance
      ) {
        return;
      }
      current.plannedRoute = route;
      current.restoredPath = null;
      current.pathChangedPending = true;
    }).catch(() => {
      const current = this.vehicles.get(vehicleId);
      if (current !== record || current.planGeneration !== generation) return;
      current.planPending = false;
      this.deferPlanRetry(current);
    });
  }

  private invalidatePendingPlan(record: VehicleAiRecord): void {
    record.planGeneration += 1;
    record.planPending = false;
    record.planRetrySeconds = 0;
    record.planFailureCount = 0;
    record.desiredPlanGoal = null;
  }

  private deferPlanRetry(record: VehicleAiRecord): void {
    record.planFailureCount += 1;
    record.planRetrySeconds = Math.min(
      4,
      0.5 * 2 ** (record.planFailureCount - 1),
    );
  }
}

function clonePath(path: VehicleDrivingPath | null): VehicleDrivingPath | null {
  if (!path) return null;
  return {
    loop: path.loop,
    points: path.points.map((point) => ({
      ...point,
      position: [...point.position],
    })),
  };
}
