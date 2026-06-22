import type { Vector3 } from "three";
import type { ActorSnapshot } from "./INpc";

export class ActorSpatialIndex {
  private readonly cells = new Map<string, ActorSnapshot[]>();

  constructor(
    actors: readonly ActorSnapshot[],
    private readonly cellSize = 16,
  ) {
    for (const actor of actors) {
      const key = this.keyFor(actor.position);
      const bucket = this.cells.get(key) ?? [];
      bucket.push(actor);
      this.cells.set(key, bucket);
    }
  }

  query(position: Vector3, radius: number, excludeId?: string): ActorSnapshot[] {
    const result: ActorSnapshot[] = [];
    const radiusSq = radius * radius;
    const cellRadius = Math.ceil(radius / this.cellSize);
    const cx = Math.floor(position.x / this.cellSize);
    const cz = Math.floor(position.z / this.cellSize);

    for (let x = cx - cellRadius; x <= cx + cellRadius; x += 1) {
      for (let z = cz - cellRadius; z <= cz + cellRadius; z += 1) {
        const bucket = this.cells.get(`${x}:${z}`);
        if (!bucket) continue;
        for (const actor of bucket) {
          if (actor.id === excludeId) continue;
          if (actor.position.distanceToSquared(position) > radiusSq) continue;
          result.push(actor);
        }
      }
    }

    return result;
  }

  private keyFor(position: Vector3): string {
    const x = Math.floor(position.x / this.cellSize);
    const z = Math.floor(position.z / this.cellSize);
    return `${x}:${z}`;
  }
}
