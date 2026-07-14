import { Vector3 } from "three";
import type { CharacterId } from "@engine/characters/CharacterDefinition";
import type { BlobOrganismSnapshot } from "@engine/blob/v2";
import type { GameEventBus } from "@game/GameEvents";

export interface BlobV2AudioOptions {
  readonly ownerId: string;
  readonly characterId?: CharacterId;
  readonly eventBus: GameEventBus;
}

const MOVEMENT_THRESHOLD = 0.35;

/**
 * Snapshot-only sound adapter. Keeping this outside the presenter guarantees
 * that visual LOD and meshing cadence cannot suppress gameplay audio.
 */
export class BlobV2Audio {
  private readonly previousCore = new Vector3();
  private readonly currentCore = new Vector3();
  private hasPreviousCore = false;
  private movementSoundIn = 0;
  private topologySignature: string | null = null;
  private disposed = false;

  constructor(private readonly options: BlobV2AudioOptions) {
    if (!options.ownerId.trim()) throw new Error("Blob V2 audio owner id cannot be empty");
  }

  tick(deltaSeconds: number, snapshot: BlobOrganismSnapshot): void {
    if (this.disposed) return;
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError("Blob V2 audio delta must be finite and non-negative");
    }
    const position = snapshot.core.position;
    const current = this.currentCore.set(position.x, position.y, position.z);
    const speed = this.hasPreviousCore && deltaSeconds > 1e-8
      ? current.distanceTo(this.previousCore) / deltaSeconds
      : 0;
    this.previousCore.copy(current);
    this.hasPreviousCore = true;

    this.movementSoundIn = Math.max(0, this.movementSoundIn - deltaSeconds);
    if (
      snapshot.overrideState !== "Dead" &&
      snapshot.overrideState !== "Dying" &&
      speed > MOVEMENT_THRESHOLD &&
      this.movementSoundIn <= 0
    ) {
      // Faster flow produces denser, still deterministic slosh cadence.
      this.movementSoundIn = Math.max(0.28, Math.min(0.68, 0.72 - speed * 0.06));
      this.options.eventBus.emit("npc.footstep", {
        id: this.options.ownerId,
        characterId: this.options.characterId ?? "blob",
        position: current.clone(),
      });
    }

    const signature = snapshot.islands
      .filter((island) => island.kind !== "main")
      .map((island) => `${island.id}:${island.generation}:${island.kind}`)
      .sort()
      .join("|");
    if (this.topologySignature !== null && signature !== this.topologySignature) {
      this.options.eventBus.emit("npc.attack", {
        id: this.options.ownerId,
        characterId: this.options.characterId ?? "blob",
        position: current.clone(),
      });
    }
    this.topologySignature = signature;
  }

  dispose(): void {
    this.disposed = true;
    this.hasPreviousCore = false;
    this.topologySignature = null;
  }
}
