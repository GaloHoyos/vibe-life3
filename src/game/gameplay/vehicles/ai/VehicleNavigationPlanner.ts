import type {
  VehicleNavMarkerDefinition,
  VehicleNavMarkerKind,
} from '@game/levels/LevelDefinition';
import type {
  VehicleDrivingPath,
  VehicleDrivingPathPoint,
  VehicleHybridPath,
  VehicleLaneRoute,
  VehicleNavigationBake,
  VehicleNavigationBakeInput,
  VehicleNavigationProfile,
  VehicleNavPoint,
  VehiclePose2D,
} from './VehicleAiTypes';
import { profileHasNavGrid } from './VehicleAiTypes';
import { HybridAStarPlanner, type HybridAStarOptions } from './HybridAStarPlanner';
import { VehicleLaneGraph } from './VehicleLaneGraph';
import type { VehicleNavigationCache } from './VehicleNavigationCache';
import { loadOrBakeVehicleNavigation } from './VehicleNavigationCache';
import { bakeVehicleNavigationAsync } from './VehicleNavigationBakeClient';
import { bakeVehicleNavigation } from './VehicleNavigationBake';
import { headingBetween, planarDistance } from './VehicleAiMath';
import { smoothVehiclePath } from './VehiclePathSmoother';

export interface VehiclePlannedRoute {
  hash: string;
  path: VehicleDrivingPath;
  laneRoute: VehicleLaneRoute | null;
  startManeuver: VehicleHybridPath | null;
  endManeuver: VehicleHybridPath | null;
}

export interface VehicleNavigationPlannerOptions {
  local?: HybridAStarOptions;
  laneSnapDistance?: number;
}

export class VehicleNavigationPlanner {
  private readonly profiles: ReadonlyMap<string, VehicleNavigationProfile>;
  private readonly laneGraph: VehicleLaneGraph;
  private readonly markersById: ReadonlyMap<string, VehicleNavMarkerDefinition>;
  private readonly localPlanners: ReadonlyMap<string, HybridAStarPlanner>;

  constructor(
    readonly navigation: VehicleNavigationBake,
    profiles: readonly VehicleNavigationProfile[],
  ) {
    this.profiles = new Map(profiles.map((profile) => [profile.id, profile]));
    this.laneGraph = new VehicleLaneGraph(navigation.laneGraph);
    this.markersById = new Map(navigation.markers.map((marker) => [marker.id, marker]));
    const localPlanners = new Map<string, HybridAStarPlanner>();
    for (const grid of navigation.grids) {
      const profileId = grid.profileId;
      const profile = this.profiles.get(profileId);
      if (profile && profileHasNavGrid(profile)) {
        localPlanners.set(profileId, new HybridAStarPlanner(grid, profile));
      }
    }
    this.localPlanners = localPlanners;
  }

  static async create(
    input: VehicleNavigationBakeInput,
    cache: VehicleNavigationCache,
  ): Promise<{ planner: VehicleNavigationPlanner; cacheHit: boolean }> {
    const result = await loadOrBakeVehicleNavigation(
      input,
      cache,
      async (source, expectedHash) => {
        let navigation: VehicleNavigationBake;
        try {
          navigation = await bakeVehicleNavigationAsync(source, {
            forceInline: typeof Worker === 'undefined',
          });
        } catch {
          navigation = bakeVehicleNavigation(source, expectedHash);
        }
        if (navigation.hash !== expectedHash) {
          throw new Error('El Worker vehicular devolvió un hash fuera de fecha.');
        }
        return navigation;
      },
    );
    return {
      planner: new VehicleNavigationPlanner(result.navigation, input.profiles),
      cacheHit: result.cacheHit,
    };
  }

  profile(id: string): VehicleNavigationProfile | null {
    return this.profiles.get(id) ?? null;
  }

  marker(id: string): VehicleNavMarkerDefinition | null {
    return this.markersById.get(id) ?? null;
  }

  nearestMarker(
    position: VehicleNavPoint,
    kind: VehicleNavMarkerKind,
    profileId?: string,
    maximumDistance = Infinity,
  ): VehicleNavMarkerDefinition | null {
    let result: VehicleNavMarkerDefinition | null = null;
    let bestDistance = maximumDistance;
    for (const marker of this.navigation.markers) {
      if (marker.kind !== kind) continue;
      if (
        profileId &&
        marker.allowedPresets &&
        !marker.allowedPresets.some((presetId) => presetId === profileId)
      ) continue;
      const distance = planarDistance(position, marker.position);
      if (
        distance < bestDistance ||
        (distance === bestDistance && result !== null && marker.id.localeCompare(result.id) < 0)
      ) {
        result = marker;
        bestDistance = distance;
      }
    }
    return result;
  }

  planLocal(
    profileId: string,
    start: VehiclePose2D,
    goal: VehiclePose2D,
    options?: HybridAStarOptions,
  ): VehicleHybridPath | null {
    return this.localPlanners.get(profileId)?.plan(start, goal, options) ?? null;
  }

  /**
   * Recorta la escalera del Hybrid A* antes de entregar la ruta. Sin esto el
   * seguidor recibe un serrucho de un metro por escalón, con el volante
   * moviéndose por la discretización y no por la geometría.
   */
  private smooth(
    profileId: string,
    points: readonly VehicleDrivingPathPoint[],
  ): VehicleDrivingPathPoint[] {
    const local = this.localPlanners.get(profileId);
    const profile = this.profiles.get(profileId);
    if (!local || !profile) return [...points];
    return smoothVehiclePath(points, {
      isClear: (from, to) => local.isClearBetween(from, to),
      maxSpacing: Math.max(4, profile.halfLength * 4),
      minimumTurnRadius: profile.minTurnRadius,
    });
  }

  planGlobal(start: VehicleNavPoint, goal: VehicleNavPoint): VehicleLaneRoute | null {
    return this.laneGraph.findRoute(start, goal);
  }

  /**
   * Metros de recorrido manejable entre dos puntos, o `null` si no se llega.
   * Barato a propósito: alimenta la comparación "¿voy en vehículo o a pie?",
   * que se hace muchas veces por segundo y no necesita la ruta, sólo el largo.
   */
  travelDistance(
    profileId: string,
    from: VehicleNavPoint,
    to: VehicleNavPoint,
  ): number | null {
    return this.localPlanners.get(profileId)?.travelDistance(from, to) ?? null;
  }

  isReachable(profileId: string, from: VehicleNavPoint, to: VehicleNavPoint): boolean {
    return this.localPlanners.get(profileId)?.isReachable(from, to) ?? false;
  }

  plan(
    profileId: string,
    start: VehiclePose2D,
    goal: VehiclePose2D,
    options: VehicleNavigationPlannerOptions = {},
  ): VehiclePlannedRoute | null {
    const profile = this.profiles.get(profileId);
    if (!profile || !profileHasNavGrid(profile)) return null;
    const laneRoute = this.planGlobal(start.position, goal.position);
    const snapDistance =
      options.laneSnapDistance ??
      Math.max(24, profile.minTurnRadius * 4);

    if (!laneRoute || laneRoute.points.length < 2) {
      const direct = this.planLocal(profileId, start, goal, options.local);
      if (!direct?.reachedGoal) return null;
      return {
        hash: this.navigation.hash,
        path: { points: this.smooth(profileId, hybridToDrivingPoints(direct)) },
        laneRoute: null,
        startManeuver: direct,
        endManeuver: null,
      };
    }

    const laneStart = laneRoute.points[0];
    const laneEnd = laneRoute.points[laneRoute.points.length - 1];
    if (
      planarDistance(start.position, laneStart) > snapDistance ||
      planarDistance(goal.position, laneEnd) > snapDistance
    ) {
      const direct = this.planLocal(profileId, start, goal, options.local);
      if (!direct?.reachedGoal) return null;
      return {
        hash: this.navigation.hash,
        path: { points: this.smooth(profileId, hybridToDrivingPoints(direct)) },
        laneRoute: null,
        startManeuver: direct,
        endManeuver: null,
      };
    }

    const secondLanePoint = laneRoute.points[1];
    const beforeLastLanePoint = laneRoute.points[laneRoute.points.length - 2];
    const startManeuver = this.planLocal(
      profileId,
      start,
      { position: laneStart, heading: headingBetween(laneStart, secondLanePoint) },
      options.local,
    );
    const endManeuver = this.planLocal(
      profileId,
      {
        position: laneEnd,
        heading: headingBetween(beforeLastLanePoint, laneEnd),
      },
      goal,
      options.local,
    );
    const startNeedsManeuver =
      planarDistance(start.position, laneStart) > profile.halfLength;
    const endNeedsManeuver =
      planarDistance(goal.position, laneEnd) > profile.halfLength;
    if (
      (startNeedsManeuver && !startManeuver?.reachedGoal) ||
      (endNeedsManeuver && !endManeuver?.reachedGoal)
    ) {
      const direct = this.planLocal(profileId, start, goal, options.local);
      if (!direct?.reachedGoal) return null;
      return {
        hash: this.navigation.hash,
        path: { points: this.smooth(profileId, hybridToDrivingPoints(direct)) },
        laneRoute: null,
        startManeuver: direct,
        endManeuver: null,
      };
    }
    const lanePoints = laneRoute.points.map<VehicleDrivingPathPoint>((position, index) => {
      const edge = index > 0
        ? this.laneGraph.edge(laneRoute.edgeIds[index - 1] ?? '')
        : null;
      return {
        position,
        direction: 'forward',
        speedLimit: edge?.speedLimit,
      };
    });
    const points = deduplicatePathPoints([
      ...this.smooth(profileId, hybridToDrivingPoints(startManeuver)),
      ...lanePoints,
      ...this.smooth(profileId, hybridToDrivingPoints(endManeuver)),
    ]);
    if (points.length === 0) return null;
    return {
      hash: this.navigation.hash,
      path: { points },
      laneRoute,
      startManeuver,
      endManeuver,
    };
  }
}

function hybridToDrivingPoints(
  path: VehicleHybridPath | null,
): VehicleDrivingPathPoint[] {
  return path?.points.map((point) => ({
    position: point.position,
    direction: point.direction,
    speedLimit: point.speedLimit ?? undefined,
  })) ?? [];
}

function deduplicatePathPoints(
  points: readonly VehicleDrivingPathPoint[],
): VehicleDrivingPathPoint[] {
  const result: VehicleDrivingPathPoint[] = [];
  for (const point of points) {
    const previous = result.at(-1);
    if (previous && planarDistance(previous.position, point.position) < 0.1) {
      result[result.length - 1] = point;
    } else {
      result.push(point);
    }
  }
  return result;
}
