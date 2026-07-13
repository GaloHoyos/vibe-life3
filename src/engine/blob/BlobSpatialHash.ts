import type { Vector3 } from "three";

export interface SpatialHashItem {
  readonly index: number;
  readonly position: Vector3;
  readonly active: boolean;
}

/**
 * Small allocation-conscious uniform grid used by blob separation and local
 * impact queries. Pair iteration visits neighboring cells only and reports a
 * pair once (`a.index < b.index`).
 */
export class BlobSpatialHash<T extends SpatialHashItem> {
  private readonly cells = new Map<string, T[]>();
  private readonly activeItems: T[] = [];
  private inverseCellSize: number;
  /** Diagnostic counter used by benchmarks/tests to catch O(N^2) regressions. */
  lastCandidateChecks = 0;

  constructor(public cellSize: number) {
    if (!(cellSize > 0) || !Number.isFinite(cellSize)) {
      throw new RangeError("BlobSpatialHash cellSize must be finite and positive");
    }
    this.inverseCellSize = 1 / cellSize;
  }

  setCellSize(cellSize: number): void {
    if (!(cellSize > 0) || !Number.isFinite(cellSize)) {
      throw new RangeError("BlobSpatialHash cellSize must be finite and positive");
    }
    this.cellSize = cellSize;
    this.inverseCellSize = 1 / cellSize;
  }

  rebuild(items: readonly T[]): void {
    this.cells.clear();
    this.activeItems.length = 0;
    for (const item of items) {
      if (!item.active) continue;
      this.activeItems.push(item);
      const key = this.keyFor(item.position.x, item.position.y, item.position.z);
      let cell = this.cells.get(key);
      if (!cell) {
        cell = [];
        this.cells.set(key, cell);
      }
      cell.push(item);
    }
  }

  forEachPair(maxDistance: number, visit: (a: T, b: T, distanceSquared: number) => void): void {
    if (!(maxDistance > 0)) return;
    this.lastCandidateChecks = 0;
    const range = Math.max(1, Math.ceil(maxDistance * this.inverseCellSize));
    const maxDistanceSq = maxDistance * maxDistance;
    for (const a of this.activeItems) {
      const ax = this.cellCoord(a.position.x);
      const ay = this.cellCoord(a.position.y);
      const az = this.cellCoord(a.position.z);
      for (let x = ax - range; x <= ax + range; x++) {
        for (let y = ay - range; y <= ay + range; y++) {
          for (let z = az - range; z <= az + range; z++) {
            const cell = this.cells.get(`${x},${y},${z}`);
            if (!cell) continue;
            for (const b of cell) {
              if (b.index <= a.index) continue;
              this.lastCandidateChecks++;
              const dx = b.position.x - a.position.x;
              const dy = b.position.y - a.position.y;
              const dz = b.position.z - a.position.z;
              const distanceSquared = dx * dx + dy * dy + dz * dz;
              if (distanceSquared <= maxDistanceSq) visit(a, b, distanceSquared);
            }
          }
        }
      }
    }
  }

  forEachNear(position: Vector3, radius: number, visit: (item: T, distanceSquared: number) => void): void {
    if (!(radius > 0)) return;
    const range = Math.max(1, Math.ceil(radius * this.inverseCellSize));
    const radiusSq = radius * radius;
    const cx = this.cellCoord(position.x);
    const cy = this.cellCoord(position.y);
    const cz = this.cellCoord(position.z);
    for (let x = cx - range; x <= cx + range; x++) {
      for (let y = cy - range; y <= cy + range; y++) {
        for (let z = cz - range; z <= cz + range; z++) {
          const cell = this.cells.get(`${x},${y},${z}`);
          if (!cell) continue;
          for (const item of cell) {
            const dx = item.position.x - position.x;
            const dy = item.position.y - position.y;
            const dz = item.position.z - position.z;
            const distanceSquared = dx * dx + dy * dy + dz * dz;
            if (distanceSquared <= radiusSq) visit(item, distanceSquared);
          }
        }
      }
    }
  }

  private cellCoord(value: number): number {
    return Math.floor(value * this.inverseCellSize);
  }

  private keyFor(x: number, y: number, z: number): string {
    return `${this.cellCoord(x)},${this.cellCoord(y)},${this.cellCoord(z)}`;
  }
}
