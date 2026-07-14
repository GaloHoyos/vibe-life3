import {
  BLOB_V2_SHED_WITHER_SECONDS,
  freezeVector,
  type BlobOrganismEvent,
  type BlobShedDropletId,
  type BlobShedDropletSnapshot,
  type BlobVector3,
} from "@engine/blob/v2/BlobV2Types";
import type { MutableBlobVector3 } from "@engine/blob/v2/BlobMath";

interface BlobShedDropletRecord {
  readonly id: BlobShedDropletId;
  readonly biomass: number;
  readonly position: MutableBlobVector3;
  readonly velocity: MutableBlobVector3;
  readonly radius: number;
  readonly createdAt: number;
}

type BlobEventEmitter = (event: BlobOrganismEvent) => void;

/**
 * Short-lived authority for biomass that cannot become a combat fragment.
 * These records are ballistic presentation sources only: they do not own
 * topology cells, consume a fragment slot, navigate, attack or reattach.
 */
export class BlobShedSystem {
  private readonly dropletsById = new Map<BlobShedDropletId, BlobShedDropletRecord>();
  private nextDropletId = 1;

  constructor(private readonly emit: BlobEventEmitter) {}

  get livingCount(): number {
    return this.dropletsById.size;
  }

  spawnCluster(
    requestedBiomass: number,
    position: BlobVector3,
    impulse: BlobVector3,
    now: number,
  ): readonly BlobShedDropletId[] {
    if (!Number.isFinite(requestedBiomass) || requestedBiomass <= 0) return Object.freeze([]);
    const total = Math.max(1, Math.floor(requestedBiomass));
    const count = Math.min(3, total, Math.max(2, Math.ceil(total / 8)));
    const base = Math.floor(total / count);
    const remainder = total % count;
    const ids: BlobShedDropletId[] = [];

    for (let index = 0; index < count; index++) {
      const biomass = base + (index < remainder ? 1 : 0);
      const id = this.nextDropletId++;
      // Golden-angle spread is deterministic and avoids every cluster tracing
      // the exact same ballistic line without introducing simulation RNG.
      const angle = id * 2.399963229728653;
      const spread = 0.42 + Math.cbrt(biomass) * 0.09;
      const radialX = Math.cos(angle);
      const radialZ = Math.sin(angle);
      const record: BlobShedDropletRecord = {
        id,
        biomass,
        position: {
          x: position.x + radialX * 0.035,
          y: position.y + 0.025 + index * 0.012,
          z: position.z + radialZ * 0.035,
        },
        velocity: {
          x: impulse.x * 0.42 + radialX * spread,
          y: impulse.y * 0.42 + 0.55 + index * 0.08,
          z: impulse.z * 0.42 + radialZ * spread,
        },
        radius: 0.075 + Math.cbrt(biomass) * 0.055,
        createdAt: now,
      };
      this.dropletsById.set(id, record);
      ids.push(id);
      this.emit({ type: "shedDropletSpawned", dropletId: id, biomass });
    }
    return Object.freeze(ids);
  }

  advance(now: number, fixedDelta: number, gravity: number): void {
    const drag = Math.exp(-1.4 * fixedDelta);
    for (const droplet of this.dropletsById.values()) {
      if (now + 1e-9 >= droplet.createdAt + BLOB_V2_SHED_WITHER_SECONDS) {
        this.dropletsById.delete(droplet.id);
        this.emit({
          type: "shedDropletWithered",
          dropletId: droplet.id,
          biomass: droplet.biomass,
        });
        continue;
      }
      droplet.velocity.y -= Math.max(0, gravity) * fixedDelta;
      droplet.position.x += droplet.velocity.x * fixedDelta;
      droplet.position.y += droplet.velocity.y * fixedDelta;
      droplet.position.z += droplet.velocity.z * fixedDelta;
      droplet.velocity.x *= drag;
      droplet.velocity.y *= drag;
      droplet.velocity.z *= drag;
    }
  }

  snapshot(now: number): readonly BlobShedDropletSnapshot[] {
    return Object.freeze(
      [...this.dropletsById.values()]
        .sort((a, b) => a.id - b.id)
        .map((droplet) => {
          const age = Math.max(0, now - droplet.createdAt);
          return Object.freeze({
            id: droplet.id,
            biomass: droplet.biomass,
            position: freezeVector(droplet.position),
            velocity: freezeVector(droplet.velocity),
            radius: droplet.radius,
            createdAt: droplet.createdAt,
            age,
            witherProgress: Math.min(1, age / BLOB_V2_SHED_WITHER_SECONDS),
          });
        }),
    );
  }

  assertInvariants(): void {
    for (const droplet of this.dropletsById.values()) {
      if (!Number.isInteger(droplet.id) || droplet.id < 1) {
        throw new Error("Blob shed droplet IDs must be positive integers");
      }
      if (!Number.isInteger(droplet.biomass) || droplet.biomass < 1) {
        throw new Error(`Blob shed droplet ${droplet.id} has invalid biomass`);
      }
      if (!(droplet.radius > 0) || !Number.isFinite(droplet.radius)) {
        throw new Error(`Blob shed droplet ${droplet.id} has invalid radius`);
      }
      for (const value of [
        droplet.position.x,
        droplet.position.y,
        droplet.position.z,
        droplet.velocity.x,
        droplet.velocity.y,
        droplet.velocity.z,
        droplet.createdAt,
      ]) {
        if (!Number.isFinite(value)) {
          throw new Error(`Blob shed droplet ${droplet.id} contains non-finite state`);
        }
      }
    }
  }
}
