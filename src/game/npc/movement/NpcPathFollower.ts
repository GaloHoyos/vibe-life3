import { Vector3 } from "three";
import type { NavGraph, NavPathStatus } from "@engine/ai/NavGraph";

export type NpcPathStatus = NavPathStatus | "never";
export type NpcRepathReason =
  | "never"
  | "interval"
  | "destination-moved"
  | "stuck-reset";
export type NpcPathUseReason =
  | "never"
  | "path"
  | "final-segment"
  | "direct-same-node"
  | "direct-start-missing"
  | "unreachable";

export interface NpcPathResolveResult {
  target: Vector3;
  targetNodeId: number | null;
  targetIsStair: boolean;
  shouldMove: boolean;
  pathUsed: boolean;
  reason: NpcPathUseReason;
}

export interface NpcPathDebugSnapshot {
  path: Vector3[];
  pathNodeIds: Array<number | null>;
  waypointIndex: number;
  nextWaypointNodeId: number | null;
  nextWaypoint: Vector3 | null;
  pathTarget: Vector3 | null;
  pathUsed: boolean;
  pathUseReason: NpcPathUseReason;
  requestedDestination: Vector3 | null;
  distanceToRequested: number | null;
  horizontalDistanceToRequested: number | null;
  verticalDeltaToRequested: number | null;
  lastStatus: NpcPathStatus;
  lastRepathReason: NpcRepathReason | null;
  lastRequestAt: number | null;
  lastProgressAt: number | null;
  startNodeId: number | null;
  goalNodeId: number | null;
  startComponentId: number | null;
  goalComponentId: number | null;
  startNodePosition: Vector3 | null;
  goalNodePosition: Vector3 | null;
}

/**
 * Sigue un path de waypoints A* devolviendo siempre el siguiente waypoint
 * intermedio como target. Re-pathea cuando:
 *  - no hay path
 *  - el destino cambiÃ³ > `repathDistance` metros desde la Ãºltima request
 *  - el tiempo desde la Ãºltima request supera `repathInterval`
 *
 * El Ãºltimo elemento del path es el destino real. Cuando el NPC estÃ¡ cerca
 * (`arriveDistance`) del waypoint actual, avanza al siguiente. Cuando avanza
 * al Ãºltimo, devuelve el destino directo y deja que el steering termine.
 *
   * Si `findPath` devuelve un solo punto, funciona como passthrough. Si
   * devuelve vacío, el destino no es navegable y el NPC mantiene posición.
   */
export class NpcPathFollower {
  private path: Vector3[] = [];
  private pathNodeIds: Array<number | null> = [];
  private waypointIndex = 0;
  private lastRequestAt = -Infinity;
  private readonly lastRequestedDestination = new Vector3(NaN, NaN, NaN);
  private readonly lastProgressPosition = new Vector3(NaN, NaN, NaN);
  private readonly lastPathTarget = new Vector3(NaN, NaN, NaN);
  private lastProgressAt = -Infinity;
  private lastStatus: NpcPathStatus = "never";
  private lastRepathReason: NpcRepathReason | null = null;
  private lastPathUsed = false;
  private lastPathUseReason: NpcPathUseReason = "never";
  private lastDistanceToRequested: number | null = null;
  private lastHorizontalDistanceToRequested: number | null = null;
  private lastVerticalDeltaToRequested: number | null = null;
  private lastStartNodeId: number | null = null;
  private lastGoalNodeId: number | null = null;
  private lastStartComponentId: number | null = null;
  private lastGoalComponentId: number | null = null;
  private lastStartNodePosition: Vector3 | null = null;
  private lastGoalNodePosition: Vector3 | null = null;

  constructor(
    private readonly repathInterval = 0.8,
    private readonly repathDistance = 3.0,
    private readonly arriveDistance = 1.6,
    private readonly arriveVerticalDistance = 1.4,
    private readonly stuckRepathTime = 2.4,
  ) {}

  /**
   * Llamar cada frame con la posiciÃ³n actual del NPC y el destino deseado.
   * Devuelve el waypoint que el motor debe perseguir AHORA.
   */
  nextWaypoint(
    navGraph: NavGraph,
    npcPosition: Vector3,
    destination: Vector3,
    elapsed: number,
  ): Vector3 {
    return this.resolve(navGraph, npcPosition, destination, elapsed).target;
  }

  resolve(
    navGraph: NavGraph,
    npcPosition: Vector3,
    destination: Vector3,
    elapsed: number,
  ): NpcPathResolveResult {
    this.updateProgress(npcPosition, elapsed);
    this.lastDistanceToRequested = npcPosition.distanceTo(destination);
    this.lastHorizontalDistanceToRequested = horizontalDistance(
      npcPosition,
      destination,
    );
    this.lastVerticalDeltaToRequested = destination.y - npcPosition.y;
    const elapsedSinceRequest = elapsed - this.lastRequestAt;
    const destinationMoved =
      !Number.isFinite(this.lastRequestedDestination.x) ||
      this.lastRequestedDestination.distanceTo(destination) > this.repathDistance;
    const neverRequested = this.lastRequestAt === -Infinity;

    let repathReason: NpcRepathReason | null = null;
    if (neverRequested) {
      repathReason = this.lastRepathReason === "stuck-reset" ? "stuck-reset" : "never";
    } else if (destinationMoved) {
      repathReason = "destination-moved";
    } else if (elapsedSinceRequest > this.repathInterval) {
      repathReason = "interval";
    }

    if (repathReason) {
      const result = navGraph.findPathDetailed(npcPosition, destination);
      this.path = result.path;
      this.pathNodeIds = result.pathNodeIds;
      this.waypointIndex = 0;
      this.lastRequestAt = elapsed;
      this.lastRequestedDestination.copy(destination);
      this.lastStatus = result.status;
      this.lastRepathReason = repathReason;
      this.lastStartNodeId = result.startNodeId;
      this.lastGoalNodeId = result.goalNodeId;
      this.lastStartComponentId = result.startComponentId;
      this.lastGoalComponentId = result.goalComponentId;
      this.lastStartNodePosition = result.startNodePosition?.clone() ?? null;
      this.lastGoalNodePosition = result.goalNodePosition?.clone() ?? null;
    }

    if (this.path.length === 0) {
      const target = npcPosition.clone();
      this.setLastResolvedTarget(target, false, "unreachable");
      return {
        target,
        targetNodeId: null,
        targetIsStair: false,
        shouldMove: false,
        pathUsed: false,
        reason: "unreachable",
      };
    }

    while (
      this.waypointIndex < this.path.length - 1 &&
      this.isWaypointReached(
        navGraph,
        npcPosition,
        this.path[this.waypointIndex],
        this.waypointIndex,
      )
    ) {
      const wasStairWaypoint = this.isStairWaypoint(navGraph, this.waypointIndex);
      this.waypointIndex += 1;
      if (wasStairWaypoint) {
        break;
      }
    }

    const target = (this.path[this.waypointIndex] ?? destination).clone();
    const targetNodeId = this.pathNodeIds[this.waypointIndex] ?? null;
    const targetIsStair = this.isStairWaypoint(navGraph, this.waypointIndex);
    const pathUsed =
      this.lastStatus === "ok" &&
      this.path.length > 1 &&
      this.waypointIndex < this.path.length - 1;
    const reason = pathUseReasonForStatus(this.lastStatus, pathUsed);
    this.setLastResolvedTarget(target, pathUsed, reason);
    return {
      target,
      targetNodeId,
      targetIsStair,
      shouldMove: true,
      pathUsed,
      reason,
    };
  }

  reset(): void {
    this.path = [];
    this.pathNodeIds = [];
    this.waypointIndex = 0;
    this.lastRequestAt = -Infinity;
    this.lastRequestedDestination.set(NaN, NaN, NaN);
    this.lastProgressPosition.set(NaN, NaN, NaN);
    this.lastPathTarget.set(NaN, NaN, NaN);
    this.lastProgressAt = -Infinity;
    this.lastStatus = "never";
    this.lastRepathReason = null;
    this.lastPathUsed = false;
    this.lastPathUseReason = "never";
    this.lastDistanceToRequested = null;
    this.lastHorizontalDistanceToRequested = null;
    this.lastVerticalDeltaToRequested = null;
    this.lastStartNodeId = null;
    this.lastGoalNodeId = null;
    this.lastStartComponentId = null;
    this.lastGoalComponentId = null;
    this.lastStartNodePosition = null;
    this.lastGoalNodePosition = null;
  }

  getDebugSnapshot(): NpcPathDebugSnapshot {
    return {
      path: this.path.map((point) => point.clone()),
      pathNodeIds: [...this.pathNodeIds],
      waypointIndex: this.waypointIndex,
      nextWaypointNodeId: this.pathNodeIds[this.waypointIndex] ?? null,
      nextWaypoint: this.path[this.waypointIndex]?.clone() ?? null,
      pathTarget: Number.isFinite(this.lastPathTarget.x)
        ? this.lastPathTarget.clone()
        : null,
      pathUsed: this.lastPathUsed,
      pathUseReason: this.lastPathUseReason,
      requestedDestination: Number.isFinite(this.lastRequestedDestination.x)
        ? this.lastRequestedDestination.clone()
        : null,
      distanceToRequested: this.lastDistanceToRequested,
      horizontalDistanceToRequested: this.lastHorizontalDistanceToRequested,
      verticalDeltaToRequested: this.lastVerticalDeltaToRequested,
      lastStatus: this.lastStatus,
      lastRepathReason: this.lastRepathReason,
      lastRequestAt:
        this.lastRequestAt === -Infinity ? null : this.lastRequestAt,
      lastProgressAt:
        this.lastProgressAt === -Infinity ? null : this.lastProgressAt,
      startNodeId: this.lastStartNodeId,
      goalNodeId: this.lastGoalNodeId,
      startComponentId: this.lastStartComponentId,
      goalComponentId: this.lastGoalComponentId,
      startNodePosition: this.lastStartNodePosition?.clone() ?? null,
      goalNodePosition: this.lastGoalNodePosition?.clone() ?? null,
    };
  }

  isDestinationUnreachable(): boolean {
    return (
      this.lastStatus === "empty-start-missing" ||
      this.lastStatus === "empty-goal-missing" ||
      this.lastStatus === "empty-no-route"
    );
  }

  private updateProgress(npcPosition: Vector3, elapsed: number): void {
    if (!Number.isFinite(this.lastProgressPosition.x)) {
      this.lastProgressPosition.copy(npcPosition);
      this.lastProgressAt = elapsed;
      return;
    }

    if (horizontalDistanceSq(this.lastProgressPosition, npcPosition) > 0.16) {
      this.lastProgressPosition.copy(npcPosition);
      this.lastProgressAt = elapsed;
      return;
    }

    if (
      this.path.length > 1 &&
      elapsed - this.lastProgressAt > this.stuckRepathTime
    ) {
      this.path = [];
      this.pathNodeIds = [];
      this.waypointIndex = 0;
      this.lastRequestAt = -Infinity;
      this.lastRequestedDestination.set(NaN, NaN, NaN);
      this.lastProgressPosition.copy(npcPosition);
      this.lastProgressAt = elapsed;
      this.lastStatus = "never";
      this.lastRepathReason = "stuck-reset";
      this.lastStartNodeId = null;
      this.lastGoalNodeId = null;
      this.lastStartComponentId = null;
      this.lastGoalComponentId = null;
      this.lastStartNodePosition = null;
      this.lastGoalNodePosition = null;
    }
  }

  private isWaypointReached(
    navGraph: NavGraph,
    npcPosition: Vector3,
    waypoint: Vector3,
    waypointIndex: number,
  ): boolean {
    const nearStair = this.isStairWaypoint(navGraph, waypointIndex);
    const arriveVerticalDistance = nearStair
      ? Math.min(this.arriveVerticalDistance, 1.15)
      : this.arriveVerticalDistance;
    const verticalOk =
      Math.abs(npcPosition.y - waypoint.y) < arriveVerticalDistance;
    if (!nearStair) {
      return (
        horizontalDistance(npcPosition, waypoint) < this.arriveDistance &&
        verticalOk
      );
    }
    return this.isStairWaypointReached(
      npcPosition,
      waypoint,
      waypointIndex,
      verticalOk,
    );
  }

  private isStairWaypointReached(
    npcPosition: Vector3,
    waypoint: Vector3,
    waypointIndex: number,
    verticalOk: boolean,
  ): boolean {
    if (!verticalOk) {
      return false;
    }
    if (
      horizontalDistance(npcPosition, waypoint) <
      Math.min(this.arriveDistance, 0.45)
    ) {
      return true;
    }
    if (waypointIndex === 0) {
      return false;
    }

    const previous = this.path[waypointIndex - 1];
    if (!previous) {
      return false;
    }
    const dx = waypoint.x - previous.x;
    const dz = waypoint.z - previous.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.001) {
      return false;
    }
    const ux = dx / length;
    const uz = dz / length;
    const toNpcX = npcPosition.x - waypoint.x;
    const toNpcZ = npcPosition.z - waypoint.z;
    const along = toNpcX * ux + toNpcZ * uz;
    const lateral = Math.abs(toNpcX * uz - toNpcZ * ux);
    return along > -0.05 && lateral < 0.65;
  }

  private isStairWaypoint(navGraph: NavGraph, waypointIndex: number): boolean {
    const nodeId = this.pathNodeIds[waypointIndex] ?? null;
    const previousNodeId =
      waypointIndex > 0 ? this.pathNodeIds[waypointIndex - 1] ?? null : null;
    const nextNodeId =
      waypointIndex < this.pathNodeIds.length - 1
        ? this.pathNodeIds[waypointIndex + 1] ?? null
        : null;
    return (
      navGraph.isStairNode(nodeId) ||
      navGraph.isStairNode(previousNodeId) ||
      navGraph.isStairNode(nextNodeId)
    );
  }

  private setLastResolvedTarget(
    target: Vector3,
    pathUsed: boolean,
    reason: NpcPathUseReason,
  ): void {
    this.lastPathTarget.copy(target);
    this.lastPathUsed = pathUsed;
    this.lastPathUseReason = reason;
  }
}

function pathUseReasonForStatus(
  status: NpcPathStatus,
  pathUsed: boolean,
): NpcPathUseReason {
  if (pathUsed) return "path";
  if (status === "direct-same-node") return "direct-same-node";
  if (status === "direct-start-missing") return "direct-start-missing";
  if (
    status === "empty-start-missing" ||
    status === "empty-goal-missing" ||
    status === "empty-no-route"
  ) {
    return "unreachable";
  }
  return status === "ok" ? "final-segment" : "path";
}

function horizontalDistance(
  a: Vector3 | { x: number; z: number },
  b: Vector3 | { x: number; z: number },
): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function horizontalDistanceSq(
  a: Vector3 | { x: number; z: number },
  b: Vector3 | { x: number; z: number },
): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}
