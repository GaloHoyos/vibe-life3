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
import { headingBetween } from './VehicleAiMath';
import {
  createDefaultVehicleNavigationCache,
  type VehicleNavigationCache,
} from './VehicleNavigationCache';
import {
  VehicleNavigationPlanner,
  type VehiclePlannedRoute,
} from './VehicleNavigationPlanner';
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
}

export class VehicleAiSystem {
  private planner: VehicleNavigationPlanner | null = null;
  private readonly vehicles = new Map<string, VehicleAiRecord>();

  constructor(
    private readonly cache: VehicleNavigationCache = createDefaultVehicleNavigationCache(),
  ) {}

  async load(
    input: VehicleNavigationBakeInput,
  ): Promise<{ hash: string; cacheHit: boolean }> {
    const result = await VehicleNavigationPlanner.create(input, this.cache);
    this.planner = result.planner;
    for (const record of this.vehicles.values()) {
      record.plannedRoute = null;
      record.restoredPath = null;
      record.brain.reset();
    }
    return { hash: result.planner.navigation.hash, cacheHit: result.cacheHit };
  }

  navigationHash(): string | null {
    return this.planner?.navigation.hash ?? null;
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
    return true;
  }

  clearGoal(vehicleId: string): boolean {
    const record = this.vehicles.get(vehicleId);
    if (!record) return false;
    record.goal = null;
    record.plannedRoute = null;
    record.restoredPath = null;
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

    let pathChanged = false;
    if (decision.goal && decision.requestPlan && this.planner) {
      const goalHeading =
        record.goal?.heading ??
        headingBetween(context.pose.position, decision.goal);
      const route = this.planner.plan(
        record.profile.id,
        context.pose,
        { position: decision.goal, heading: goalHeading },
      );
      if (route) {
        record.plannedRoute = route;
        record.restoredPath = null;
        pathChanged = true;
      }
    } else if (!decision.goal && (record.plannedRoute || record.restoredPath)) {
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
    record.brain.reset();
    return true;
  }

  dispose(): void {
    this.vehicles.clear();
    this.planner = null;
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
