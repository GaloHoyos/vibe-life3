import type { VehiclePresetDefinition } from '@game/config/vehicles.config';
import type { VehicleAiDefinition } from '@game/levels/LevelDefinition';
import type {
  VehicleBrainContext,
  VehicleBrainDecision,
  VehicleControlCommand,
  VehicleDrivingPath,
  VehicleLaneEdge,
  VehicleLaneRoute,
  VehicleNavigationBakeInput,
  VehicleNavigationProfile,
  VehicleNavPoint,
} from './VehicleAiTypes';
import {
  navigationProfileFromPreset,
  profileHasNavGrid,
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
import {
  VehicleControlSmoother,
  type VehicleControlSmootherTuning,
} from './VehicleControlSmoother';
import { vehicleAiTuning } from './VehicleAiTuning';
import { vehicleLaneReservationKey } from './VehicleTrafficCoordinator';

export interface VehicleAiRegistration {
  vehicleId: string;
  preset: VehiclePresetDefinition;
  ai: VehicleAiDefinition;
  tuning?: VehicleAiBrainTuning;
  smoothing?: VehicleControlSmootherTuning;
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
  navigationHash?: string | null;
  laneRoute?: VehicleLaneRoute | null;
  lastDecision: VehicleBrainDecision | null;
}

interface VehicleAiRecord {
  profile: VehicleNavigationProfile;
  behavior: VehicleAiDefinition['behavior'];
  brain: VehicleAiBrain;
  smoother: VehicleControlSmoother;
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
  private readonly laneEdges = new Map<string, VehicleLaneEdge>();
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
    this.laneEdges.clear();
    for (const edge of result.planner.navigation.laneGraph.edges) {
      this.laneEdges.set(edge.id, edge);
    }
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
      record.smoother.reset();
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
    if (!profileHasNavGrid(profile)) return false;
    const tuning = vehicleAiTuning(
      registration.vehicleId,
      registration.preset,
      registration.ai,
    );
    this.vehicles.set(registration.vehicleId, {
      profile,
      behavior: registration.ai.behavior,
      brain: new VehicleAiBrain(
        registration.vehicleId,
        registration.ai,
        profile,
        registration.tuning ?? tuning.brain,
      ),
      smoother: new VehicleControlSmoother(registration.smoothing ?? tuning.smoother),
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

  setBehavior(
    vehicleId: string,
    behavior: VehicleAiDefinition['behavior'],
  ): boolean {
    const record = this.vehicles.get(vehicleId);
    if (!record) return false;
    record.behavior = behavior;
    record.brain.setBehavior(behavior);
    record.plannedRoute = null;
    record.restoredPath = null;
    record.lastDecision = null;
    this.invalidatePendingPlan(record);
    return true;
  }

  getBehavior(vehicleId: string): VehicleAiDefinition['behavior'] | null {
    return this.vehicles.get(vehicleId)?.behavior ?? null;
  }

  reservationKey(
    vehicleId: string,
    position: VehicleNavPoint,
  ): string | null {
    const route = this.vehicles.get(vehicleId)?.plannedRoute?.laneRoute;
    if (!route || route.edgeIds.length === 0) return null;
    let nearestIndex = 0;
    let nearestDistance = Infinity;
    for (let index = 0; index < route.points.length; index += 1) {
      const distance = planarDistance(position, route.points[index]);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    }
    if (nearestIndex >= route.points.length - 1) return null;
    const edgeId =
      route.edgeIds[Math.min(nearestIndex, route.edgeIds.length - 1)];
    const edge = edgeId ? this.laneEdges.get(edgeId) : null;
    return edge ? vehicleLaneReservationKey(edge) : null;
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
    record.smoother.reset();
    record.lastDecision = null;
    return true;
  }

  /**
   * Bookkeeping por frame: adelanta el reloj del cerebro y dice si en este frame
   * toca decidir. El caller sólo arma el contexto completo (raycasts, lista de
   * obstáculos, markers) cuando devuelve `true`, que es ~1 de cada 10 frames.
   *
   * Devolviendo `true` hay que llamar a `update(id, 0, context)`: el delta ya
   * quedó acumulado acá.
   */
  advance(vehicleId: string, delta: number): boolean {
    const record = this.vehicles.get(vehicleId);
    if (!record) return false;
    const step = Math.max(0, delta);
    record.planRetrySeconds = Math.max(0, record.planRetrySeconds - step);
    return record.brain.advance(step);
  }

  /**
   * Control suavizado del frame actual, a partir de la última decisión. Sin esto
   * el volante da escalones a la frecuencia de tick del cerebro.
   */
  smoothControl(vehicleId: string, delta: number): VehicleControlCommand | null {
    const record = this.vehicles.get(vehicleId);
    const decision = record?.lastDecision;
    if (!record || !decision) return null;
    return record.smoother.update(delta, decision.control, {
      immediate: decision.recovery !== 'none',
    });
  }

  getState(vehicleId: string): VehicleBrainDecision['state'] | null {
    return this.vehicles.get(vehicleId)?.lastDecision?.state ?? null;
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
      behavior: record.behavior,
      goal: record.goal
        ? {
            position: [...record.goal.position],
            heading: record.goal.heading,
          }
        : null,
      path: clonePath(record.plannedRoute?.path ?? record.restoredPath ?? null),
      navigationHash: this.currentNavigationHash,
      laneRoute: cloneLaneRoute(record.plannedRoute?.laneRoute ?? null),
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
    const restoredPath = clonePath(snapshot.path);
    const restoredLaneRoute =
      snapshot.navigationHash === this.currentNavigationHash
        ? cloneLaneRoute(snapshot.laneRoute ?? null)
        : null;
    record.plannedRoute =
      restoredPath && restoredLaneRoute
        ? {
            hash: this.currentNavigationHash ?? "restored",
            path: restoredPath,
            laneRoute: restoredLaneRoute,
            startManeuver: null,
            endManeuver: null,
          }
        : null;
    record.restoredPath = record.plannedRoute ? null : restoredPath;
    record.lastDecision = snapshot.lastDecision;
    record.behavior = snapshot.behavior;
    record.brain.setBehavior(snapshot.behavior);
    this.invalidatePendingPlan(record);
    record.pathChangedPending = false;
    record.brain.reset();
    record.smoother.reset();
    return true;
  }

  dispose(): void {
    this.plannerClient?.dispose();
    this.plannerClient = null;
    this.currentNavigationHash = null;
    this.laneEdges.clear();
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

function cloneLaneRoute(route: VehicleLaneRoute | null): VehicleLaneRoute | null {
  if (!route) return null;
  return {
    nodeIds: [...route.nodeIds],
    edgeIds: [...route.edgeIds],
    points: route.points.map((point) => [...point]),
    cost: route.cost,
  };
}
