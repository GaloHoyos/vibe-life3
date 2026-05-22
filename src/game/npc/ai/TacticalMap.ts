import { Vector3 } from "three";
import type { NavGraph } from "@engine/ai/NavGraph";
import type { Raycast } from "@engine/physics/Raycast";
import type {
  DynamicBoxDefinition,
  LevelDefinition,
  StaticBoxDefinition,
} from "@game/levels/LevelDefinition";

export interface TacticalCoverPoint {
  id: string;
  sourceId: string;
  position: Vector3;
  normal: Vector3;
  peekLeft: Vector3;
  peekRight: Vector3;
  occupiedBy: string | null;
  lastScore: number;
  componentId: number | null;
}

export interface TacticalPoint {
  id: string;
  position: Vector3;
  componentId: number | null;
}

export interface TacticalMapSnapshot {
  coverCount: number;
  firingPositionCount: number;
  chokepointCount: number;
  roomClusterCount: number;
}

const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpDir = new Vector3();
const tmpEyes = new Vector3();
const DOWN = new Vector3(0, -1, 0);
const UP = new Vector3(0, 1, 0);

export class TacticalMap {
  private readonly coverPoints = new Map<string, TacticalCoverPoint>();
  private readonly firingPositions: TacticalPoint[] = [];
  private readonly chokepoints: TacticalPoint[] = [];
  private readonly roomClusters = new Map<number, TacticalPoint[]>();

  constructor(
    coverPoints: TacticalCoverPoint[],
    firingPositions: TacticalPoint[],
    chokepoints: TacticalPoint[],
  ) {
    for (const point of coverPoints) {
      this.coverPoints.set(point.id, {
        ...point,
        position: point.position.clone(),
        normal: point.normal.clone().normalize(),
        peekLeft: point.peekLeft.clone(),
        peekRight: point.peekRight.clone(),
      });
    }
    this.firingPositions = firingPositions.map((point) => ({
      ...point,
      position: point.position.clone(),
    }));
    this.chokepoints = chokepoints.map((point) => ({
      ...point,
      position: point.position.clone(),
    }));
    for (const point of this.firingPositions) {
      if (point.componentId === null) continue;
      const cluster = this.roomClusters.get(point.componentId) ?? [];
      cluster.push(point);
      this.roomClusters.set(point.componentId, cluster);
    }
  }

  claim(coverId: string, npcId: string): boolean {
    const point = this.coverPoints.get(coverId);
    if (!point) return false;
    if (point.occupiedBy !== null && point.occupiedBy !== npcId) return false;
    point.occupiedBy = npcId;
    return true;
  }

  release(coverId: string, npcId: string): void {
    const point = this.coverPoints.get(coverId);
    if (point?.occupiedBy === npcId) {
      point.occupiedBy = null;
    }
  }

  releaseAllOf(npcId: string): void {
    for (const point of this.coverPoints.values()) {
      if (point.occupiedBy === npcId) {
        point.occupiedBy = null;
      }
    }
  }

  getCoverPosition(coverId: string): Vector3 | null {
    return this.coverPoints.get(coverId)?.position.clone() ?? null;
  }

  findBestCover(
    npcId: string,
    npcPosition: Vector3,
    threatPosition: Vector3,
    maxDistance = 25,
    pathDistance?: (position: Vector3) => number | null,
    isAllowed?: (coverId: string) => boolean,
  ): { id: string; position: Vector3 } | null {
    let best: TacticalCoverPoint | null = null;
    let bestScore = 0;
    for (const point of this.coverPoints.values()) {
      if (isAllowed && !isAllowed(point.id)) continue;
      const distance = point.position.distanceTo(npcPosition);
      if (distance > maxDistance) continue;
      const routeDistance = pathDistance?.(point.position);
      if (routeDistance === null) continue;
      const score = this.scoreCover(point, npcId, npcPosition, threatPosition, routeDistance ?? distance);
      point.lastScore = score;
      if (score > bestScore) {
        bestScore = score;
        best = point;
      }
    }
    return best ? { id: best.id, position: best.position.clone() } : null;
  }

  isStillValid(
    coverId: string,
    npcId: string,
    threatPosition: Vector3,
  ): boolean {
    const point = this.coverPoints.get(coverId);
    if (!point) return false;
    if (point.occupiedBy !== null && point.occupiedBy !== npcId) return false;
    return this.blocksLineOfSight(point.position, threatPosition);
  }

  findFlankPosition(
    npcPosition: Vector3,
    threatPosition: Vector3,
    side: 1 | -1,
    maxDistance = 34,
    pathDistance?: (position: Vector3) => number | null,
  ): Vector3 | null {
    const toThreat = tmpA.copy(threatPosition).sub(npcPosition).setY(0);
    if (toThreat.lengthSq() < 0.01) return null;
    toThreat.normalize();
    const lateral = tmpB.set(-toThreat.z, 0, toThreat.x).multiplyScalar(side);

    let best: TacticalPoint | null = null;
    let bestScore = -Infinity;
    for (const point of this.firingPositions) {
      const route = pathDistance?.(point.position);
      if (route === null || (route ?? point.position.distanceTo(npcPosition)) > maxDistance) {
        continue;
      }
      const fromThreat = point.position.clone().sub(threatPosition).setY(0);
      if (fromThreat.lengthSq() < 9) continue;
      const lateralScore = fromThreat.normalize().dot(lateral);
      const rangeScore = Math.max(0, 18 - Math.abs(point.position.distanceTo(threatPosition) - 14));
      const score = lateralScore * 24 + rangeScore - (route ?? 0) * 0.25;
      if (score > bestScore) {
        bestScore = score;
        best = point;
      }
    }
    return best?.position.clone() ?? null;
  }

  findRetreatPosition(
    npcPosition: Vector3,
    threatPosition: Vector3,
    maxDistance = 28,
    pathDistance?: (position: Vector3) => number | null,
  ): Vector3 | null {
    let best: TacticalPoint | null = null;
    let bestScore = -Infinity;
    const currentThreatDistance = npcPosition.distanceTo(threatPosition);
    for (const point of this.firingPositions) {
      const route = pathDistance?.(point.position);
      if (route === null || (route ?? point.position.distanceTo(npcPosition)) > maxDistance) {
        continue;
      }
      const threatDistance = point.position.distanceTo(threatPosition);
      if (threatDistance <= currentThreatDistance + 2) continue;
      const score = threatDistance * 1.2 - (route ?? 0) * 0.45;
      if (score > bestScore) {
        bestScore = score;
        best = point;
      }
    }
    return best?.position.clone() ?? null;
  }

  findFiringPosition(
    npcPosition: Vector3,
    threatPosition: Vector3,
    maxDistance = 26,
    pathDistance?: (position: Vector3) => number | null,
  ): Vector3 | null {
    let best: TacticalPoint | null = null;
    let bestScore = -Infinity;
    for (const point of this.firingPositions) {
      const route = pathDistance?.(point.position);
      if (route === null || (route ?? point.position.distanceTo(npcPosition)) > maxDistance) {
        continue;
      }
      if (!this.hasLineOfSight(point.position, threatPosition)) continue;
      const threatDistance = point.position.distanceTo(threatPosition);
      const score = Math.max(0, 20 - Math.abs(threatDistance - 16)) - (route ?? 0) * 0.25;
      if (score > bestScore) {
        bestScore = score;
        best = point;
      }
    }
    return best?.position.clone() ?? null;
  }

  getSnapshot(): TacticalMapSnapshot {
    return {
      coverCount: this.coverPoints.size,
      firingPositionCount: this.firingPositions.length,
      chokepointCount: this.chokepoints.length,
      roomClusterCount: this.roomClusters.size,
    };
  }

  private scoreCover(
    point: TacticalCoverPoint,
    npcId: string,
    npcPosition: Vector3,
    threatPosition: Vector3,
    routeDistance: number,
  ): number {
    if (point.occupiedBy !== null && point.occupiedBy !== npcId) return -100;
    if (!this.blocksLineOfSight(point.position, threatPosition)) return 0;

    const distanceToNpc = point.position.distanceTo(npcPosition);
    const distanceToThreat = point.position.distanceTo(threatPosition);
    let score = 42;
    score += Math.max(0, 18 - distanceToNpc * 0.55);
    score += Math.max(0, 22 - routeDistance * 0.45);
    if (distanceToThreat < 4) score -= 30;
    if (distanceToThreat < distanceToNpc * 0.45) score -= 18;

    tmpDir.copy(threatPosition).sub(point.position).setY(0);
    if (tmpDir.lengthSq() > 0.01) {
      tmpDir.normalize();
      const normalFacingThreat = point.normal.clone().setY(0).normalize().dot(tmpDir);
      if (normalFacingThreat < -0.15) score += 8;
    }
    return score;
  }

  private blocksLineOfSight(fromCover: Vector3, threatPosition: Vector3): boolean {
    tmpEyes.copy(fromCover);
    tmpEyes.y += 1.35;
    tmpDir.copy(threatPosition).sub(tmpEyes);
    const distance = tmpDir.length();
    if (distance < 0.1) return false;
    tmpDir.divideScalar(distance);
    const hit = TacticalMapAnalyzer.sharedRaycast?.cast(tmpEyes, tmpDir, distance);
    if (!hit) return false;
    return (
      hit.metadata?.kind === "static" ||
      hit.metadata?.kind === "dynamic" ||
      hit.metadata?.kind === "door"
    );
  }

  private hasLineOfSight(from: Vector3, to: Vector3): boolean {
    tmpEyes.copy(from);
    tmpEyes.y += 1.45;
    tmpDir.copy(to).sub(tmpEyes);
    const distance = tmpDir.length();
    if (distance < 0.1) return false;
    tmpDir.divideScalar(distance);
    const hit = TacticalMapAnalyzer.sharedRaycast?.cast(tmpEyes, tmpDir, distance + 0.2);
    return !hit || hit.metadata?.kind === "player" || hit.metadata?.kind === "npc";
  }
}

export class TacticalMapAnalyzer {
  static sharedRaycast: Raycast | null = null;

  analyze(level: LevelDefinition, navGraph: NavGraph, raycast: Raycast): TacticalMap {
    TacticalMapAnalyzer.sharedRaycast = raycast;
    const cover: TacticalCoverPoint[] = [];
    const firing = this.collectFiringPositions(navGraph);
    const chokepoints = this.collectChokepoints(navGraph);
    const occupied = new Set<string>();
    for (const box of level.staticBoxes) {
      this.addCoverForBox(box, "static", navGraph, raycast, cover, occupied);
    }
    for (const box of level.dynamicBoxes) {
      this.addCoverForBox(box, "dynamic", navGraph, raycast, cover, occupied);
    }
    console.info("[TacticalMapAnalyzer] tactical map", {
      cover: cover.length,
      firing: firing.length,
      chokepoints: chokepoints.length,
    });
    return new TacticalMap(cover, firing, chokepoints);
  }

  private collectFiringPositions(navGraph: NavGraph): TacticalPoint[] {
    const snapshot = navGraph.getExportSnapshot();
    const out: TacticalPoint[] = [];
    let serial = 0;
    for (const node of snapshot.nodes) {
      if (node.edgeCount === 0) continue;
      if (serial % 2 === 0) {
        out.push({
          id: `fire-${node.id}`,
          position: node.position.clone(),
          componentId: node.componentId,
        });
      }
      serial += 1;
    }
    return out;
  }

  private collectChokepoints(navGraph: NavGraph): TacticalPoint[] {
    const snapshot = navGraph.getExportSnapshot();
    return snapshot.nodes
      .filter((node) => node.edgeCount > 0 && node.edgeCount <= 2)
      .map((node) => ({
        id: `choke-${node.id}`,
        position: node.position.clone(),
        componentId: node.componentId,
      }));
  }

  private addCoverForBox(
    box: StaticBoxDefinition | DynamicBoxDefinition,
    kind: "static" | "dynamic",
    navGraph: NavGraph,
    raycast: Raycast,
    out: TacticalCoverPoint[],
    occupied: Set<string>,
  ): void {
    if (!this.isCoverObstacle(box)) return;
    const [cx, cy, cz] = box.position;
    const [sx, sy, sz] = box.size;
    const sideSpecs = [
      { suffix: "n", normal: new Vector3(0, 0, -1), offset: sz / 2 + 0.85 },
      { suffix: "s", normal: new Vector3(0, 0, 1), offset: sz / 2 + 0.85 },
      { suffix: "e", normal: new Vector3(1, 0, 0), offset: sx / 2 + 0.85 },
      { suffix: "w", normal: new Vector3(-1, 0, 0), offset: sx / 2 + 0.85 },
    ];

    for (const side of sideSpecs) {
      const raw = new Vector3(cx, cy - sy / 2 + 0.2, cz);
      raw.addScaledVector(side.normal, side.offset);
      const grounded = this.snapToWalkableGround(raw, navGraph, raycast);
      if (!grounded) continue;
      if (!this.hasCharacterClearance(grounded, raycast)) continue;
      const key = `${Math.round(grounded.x * 2)}:${Math.round(grounded.y * 2)}:${Math.round(grounded.z * 2)}`;
      if (occupied.has(key)) continue;
      occupied.add(key);

      const right = new Vector3(-side.normal.z, 0, side.normal.x);
      const componentId = this.componentAt(navGraph, grounded);
      out.push({
        id: `auto-${kind}-${box.id}-${side.suffix}`,
        sourceId: box.id,
        position: grounded,
        normal: side.normal.clone(),
        peekLeft: grounded.clone().addScaledVector(right, -0.55),
        peekRight: grounded.clone().addScaledVector(right, 0.55),
        occupiedBy: null,
        lastScore: 0,
        componentId,
      });
    }
  }

  private isCoverObstacle(box: StaticBoxDefinition | DynamicBoxDefinition): boolean {
    const [, sy] = box.size;
    if (sy < 0.75) return false;
    if (/floor|roof|terrain|light|button/i.test(box.id)) return false;
    return true;
  }

  private snapToWalkableGround(
    raw: Vector3,
    navGraph: NavGraph,
    raycast: Raycast,
  ): Vector3 | null {
    const origin = raw.clone();
    origin.y += 4;
    const hit = raycast.cast(origin, DOWN, 8);
    if (!hit || hit.metadata?.kind === "door") return null;
    const grounded = hit.point.clone();
    grounded.y += 0.1;
    const nodeId = navGraph.nearestConnectedNode(grounded, 3.5, 1.4);
    if (nodeId === null) return null;
    const node = navGraph.getNode(nodeId);
    if (!node) return null;
    return node;
  }

  private hasCharacterClearance(position: Vector3, raycast: Raycast): boolean {
    const origin = position.clone();
    origin.y += 0.15;
    const hit = raycast.cast(origin, UP, 1.55);
    return !hit || (hit.metadata?.kind !== "static" && hit.metadata?.kind !== "door");
  }

  private componentAt(navGraph: NavGraph, position: Vector3): number | null {
    const nodeId = navGraph.nearestConnectedNode(position, 1.5, 0.8);
    return nodeId === null ? null : navGraph.connectedComponentOf(nodeId);
  }
}
