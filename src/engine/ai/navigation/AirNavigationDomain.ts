import { Vector3 } from "three";
import type { Raycast } from "@engine/physics/Raycast";
import type { NavAgentProfile, NavigationPath } from "./NavigationTypes";

const DIRECTIONS: ReadonlyArray<readonly [number, number, number]> = (() => {
  const result: Array<readonly [number, number, number]> = [];
  for (let x = -1; x <= 1; x += 1) {
    for (let y = -1; y <= 1; y += 1) {
      for (let z = -1; z <= 1; z += 1) {
        if (x !== 0 || y !== 0 || z !== 0) result.push([x, y, z]);
      }
    }
  }
  return result;
})();

interface SearchNode {
  key: string;
  x: number;
  y: number;
  z: number;
  g: number;
  f: number;
  parent: string | null;
}

const tmpOrigin = new Vector3();
const tmpDirection = new Vector3();
const tmpOffset = new Vector3();

/**
 * Navegación 3D dispersa: crea voxels solamente durante la consulta y usa
 * A* de 26 vecinos. Los segmentos se validan con un haz de rayos del radio
 * del agente, de modo que no confunde LOS puntual con clearance volumétrico.
 */
export class AirNavigationDomain {
  constructor(private readonly raycast: Raycast) {}

  findPath(from: Vector3, to: Vector3, profile: NavAgentProfile): NavigationPath | null {
    if (this.segmentClear(from, to, profile.radius)) {
      return pathFromPoints(from, [to.clone()]);
    }

    const cellSize = profile.airCellSize ?? 1.2;
    const padding = Math.max(8, from.distanceTo(to) * 0.25);
    const min = new Vector3(
      Math.min(from.x, to.x) - padding,
      Math.min(from.y, to.y) - padding,
      Math.min(from.z, to.z) - padding,
    );
    const max = new Vector3(
      Math.max(from.x, to.x) + padding,
      Math.max(from.y, to.y) + padding,
      Math.max(from.z, to.z) + padding,
    );
    const start = quantize(from, cellSize);
    const goal = quantize(to, cellSize);
    const startKey = keyOf(start[0], start[1], start[2]);
    const goalKey = keyOf(goal[0], goal[1], goal[2]);
    const nodes = new Map<string, SearchNode>();
    const closed = new Set<string>();
    const heap = new MinHeap();
    const first: SearchNode = {
      key: startKey,
      x: start[0],
      y: start[1],
      z: start[2],
      g: 0,
      f: gridDistance(start, goal),
      parent: null,
    };
    nodes.set(startKey, first);
    heap.push(first);

    let expanded = 0;
    let reached: SearchNode | null = null;
    while (heap.size > 0 && expanded < 5000) {
      const current = heap.pop()!;
      if (closed.has(current.key)) continue;
      closed.add(current.key);
      expanded += 1;
      if (current.key === goalKey) {
        reached = current;
        break;
      }
      const currentPoint = worldPoint(current.x, current.y, current.z, cellSize);
      for (const [dx, dy, dz] of DIRECTIONS) {
        const nx = current.x + dx;
        const ny = current.y + dy;
        const nz = current.z + dz;
        const point = worldPoint(nx, ny, nz, cellSize);
        if (
          point.x < min.x || point.y < min.y || point.z < min.z ||
          point.x > max.x || point.y > max.y || point.z > max.z
        ) continue;
        const neighborKey = keyOf(nx, ny, nz);
        if (closed.has(neighborKey)) continue;
        if (!this.segmentClear(currentPoint, point, profile.radius)) continue;
        const step = Math.hypot(dx, dy, dz);
        const tentative = current.g + step;
        const existing = nodes.get(neighborKey);
        if (existing && tentative >= existing.g) continue;
        const node: SearchNode = existing ?? {
          key: neighborKey,
          x: nx,
          y: ny,
          z: nz,
          g: Infinity,
          f: Infinity,
          parent: null,
        };
        node.g = tentative;
        node.f = tentative + gridDistance([nx, ny, nz], goal);
        node.parent = current.key;
        nodes.set(neighborKey, node);
        heap.push(node);
      }
    }
    if (!reached) return null;

    const raw: Vector3[] = [to.clone()];
    let cursor: SearchNode | undefined = reached;
    while (cursor?.parent) {
      raw.push(worldPoint(cursor.x, cursor.y, cursor.z, cellSize));
      cursor = nodes.get(cursor.parent);
    }
    raw.reverse();
    return pathFromPoints(from, this.smooth(from, raw, profile.radius));
  }

  private smooth(from: Vector3, raw: readonly Vector3[], radius: number): Vector3[] {
    const result: Vector3[] = [];
    let cursor = from;
    let i = 0;
    while (i < raw.length) {
      let furthest = i;
      for (let j = i + 1; j < raw.length; j += 1) {
        if (!this.segmentClear(cursor, raw[j], radius)) break;
        furthest = j;
      }
      result.push(raw[furthest].clone());
      cursor = raw[furthest];
      i = furthest + 1;
    }
    return result;
  }

  private segmentClear(from: Vector3, to: Vector3, radius: number): boolean {
    tmpDirection.copy(to).sub(from);
    const distance = tmpDirection.length();
    if (distance < 1e-4) return true;
    tmpDirection.divideScalar(distance);
    const offsets: ReadonlyArray<readonly [number, number, number]> = [
      [0, 0, 0], [radius, 0, 0], [-radius, 0, 0],
      [0, radius, 0], [0, -radius, 0], [0, 0, radius], [0, 0, -radius],
    ];
    for (const [x, y, z] of offsets) {
      tmpOffset.set(x, y, z);
      tmpOrigin.copy(from).add(tmpOffset);
      const hit = this.raycast.cast(tmpOrigin, tmpDirection, distance);
      const kind = hit?.metadata?.kind;
      if (hit && kind !== "npc" && kind !== "player" && kind !== "ragdoll") return false;
    }
    return true;
  }
}

class MinHeap {
  private readonly items: SearchNode[] = [];
  get size(): number { return this.items.length; }
  push(node: SearchNode): void {
    this.items.push(node);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].f <= node.f) break;
      this.items[i] = this.items[parent];
      i = parent;
    }
    this.items[i] = node;
  }
  pop(): SearchNode | undefined {
    if (this.items.length === 0) return undefined;
    const root = this.items[0];
    const tail = this.items.pop()!;
    if (this.items.length > 0) {
      let i = 0;
      while (true) {
        const left = i * 2 + 1;
        if (left >= this.items.length) break;
        const right = left + 1;
        const child = right < this.items.length && this.items[right].f < this.items[left].f
          ? right : left;
        if (this.items[child].f >= tail.f) break;
        this.items[i] = this.items[child];
        i = child;
      }
      this.items[i] = tail;
    }
    return root;
  }
}

function quantize(point: Vector3, size: number): [number, number, number] {
  return [Math.round(point.x / size), Math.round(point.y / size), Math.round(point.z / size)];
}
function keyOf(x: number, y: number, z: number): string { return `${x}:${y}:${z}`; }
function worldPoint(x: number, y: number, z: number, size: number): Vector3 {
  return new Vector3(x * size, y * size, z * size);
}
function gridDistance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
function pathFromPoints(from: Vector3, points: Vector3[]): NavigationPath {
  let length = 0;
  let previous = from;
  for (const point of points) {
    length += previous.distanceTo(point);
    previous = point;
  }
  return { points, actions: [], length, partial: false };
}
