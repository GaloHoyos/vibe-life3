import { Vector3 } from "three";
import {
  BLOB_V2_INITIAL_BIOMASS,
  type BlobConsumptionResult,
  type BlobOrganismController,
  type BlobOrganismSnapshot,
} from "@engine/blob/v2";
import type { CharacterId } from "@engine/characters/CharacterDefinition";
import type { RaycastSource } from "@engine/physics/Raycast";
import type { GameEventBus } from "@game/GameEvents";
import { BlobConfig } from "@game/config/blob.config";
import type {
  NpcCombatHandle,
  NpcCombatTickArgs,
} from "@game/npc/brain/NpcBrainContext";
import { blobPreyClaims } from "@game/npc/blob/BlobPreyClaimService";
import {
  measureBlobV2Coverage,
  type BlobV2CoverageResult,
} from "@game/npc/blob/v2/BlobV2Coverage";
import type { ActorSnapshot } from "@game/npc/core/INpc";

export type BlobV2PreyReleaseReason =
  | "contact-lost"
  | "claim-lost"
  | "consume-failed"
  | "owner-dead"
  | "disposed";

export interface BlobV2DigestProgress {
  readonly preyId: string;
  readonly position: Readonly<{ x: number; y: number; z: number }>;
  readonly progress: number;
  readonly consumeSeconds: number;
}

export interface BlobV2CombatOptions {
  readonly id: string;
  readonly controller: BlobOrganismController;
  /** Portal-aware LOS raycast supplied by the game adapter. */
  readonly raycast: RaycastSource;
  readonly eventBus: GameEventBus;
  readonly characterId?: CharacterId;
  readonly eyeHeight?: number;
  readonly onPreyClaimed?: (prey: ActorSnapshot) => void;
  /** Called while the organism should steer attached mass around this prey. */
  readonly onEnveloping?: (
    prey: ActorSnapshot,
    coverage: BlobV2CoverageResult,
  ) => void;
  /** Emitted once when real multi-sector coverage crosses the enter threshold. */
  readonly onPreyEnveloped?: (prey: ActorSnapshot) => void;
  readonly onPreyReleased?: (
    prey: ActorSnapshot,
    reason: BlobV2PreyReleaseReason,
  ) => void;
  /** Stable world-space value object suitable for a visual sink. */
  readonly onDigestProgress?: (state: BlobV2DigestProgress) => void;
  readonly onPreyConsumed?: (
    prey: ActorSnapshot,
    biomass: number,
    result: BlobConsumptionResult,
  ) => void;
}

const DEFAULT_EYE_HEIGHT = 0.35;
const DEFAULT_PREY_BIOMASS = 12;
const COMPLETION_EPSILON = 1e-9;
const TMP_ORIGIN = new Vector3();
const TMP_DIRECTION = new Vector3();

/**
 * Blob V2 contact combat and prey-consumption lifecycle.
 *
 * The controller remains the sole authority for Blob state, biomass, and core
 * healing. This adapter owns only world-facing contact damage and the global
 * prey claim. It reads immutable particle snapshots and deliberately excludes
 * combat fragments and scripted islands from contact/coverage decisions.
 */
export class BlobV2Combat implements NpcCombatHandle {
  private damageTimer = 0;
  private attackSoundTimer = 0;
  private claimedPrey: ActorSnapshot | null = null;
  private digestElapsed = 0;
  private digestStarted = false;
  private completionAttempted = false;
  private preyEnveloped = false;
  private ownerDead = false;
  private disposed = false;

  constructor(private readonly opts: BlobV2CombatOptions) {
    if (opts.id.trim().length === 0) {
      throw new Error("Blob V2 combat owner id cannot be empty");
    }
  }

  tick(args: NpcCombatTickArgs): void {
    if (this.disposed || this.ownerDead) return;
    if (!Number.isFinite(args.delta) || args.delta < 0) {
      throw new RangeError("Blob V2 combat delta must be finite and non-negative");
    }

    this.damageTimer = Math.max(0, this.damageTimer - args.delta);
    this.attackSoundTimer = Math.max(0, this.attackSoundTimer - args.delta);

    const snapshot = this.opts.controller.snapshot();
    if (isDead(snapshot)) {
      this.releaseForOwnerDeath();
      return;
    }

    // A corpse remains authoritative even when perception drops or switches
    // threats. Its retained snapshot supplies the stable digest target.
    if (this.claimedPrey && !actorIsAlive(this.claimedPrey)) {
      this.tickDigest(args, snapshot);
      return;
    }

    const threat = args.threat;
    if (!threat || !actorIsAlive(threat)) {
      if (this.claimedPrey) this.releaseClaim("contact-lost");
      return;
    }

    if (isBlobActor(threat, this.opts.id)) {
      if (this.claimedPrey) this.releaseClaim("contact-lost");
      return;
    }

    if (this.claimedPrey && this.claimedPrey.id !== threat.id) {
      this.releaseClaim("contact-lost");
    } else if (this.claimedPrey) {
      // Game rebuilds ActorSnapshot each frame; retain the newest real/portal
      // position until death, then freeze that exact snapshot for digestion.
      this.claimedPrey = threat;
    }

    const coverage = this.attachedMainCoverage(snapshot, threat);
    const hasContact =
      coverage.contact &&
      this.hasLineOfSight(args.position, threat);
    if (!hasContact) {
      if (this.claimedPrey?.id === threat.id) {
        this.releaseClaim("contact-lost");
      }
      this.opts.controller.setOrganismState("Hunt");
      return;
    }

    if (isConsumablePrey(threat)) {
      if (!this.claimPrey(threat, args.elapsed)) {
        // Another organism owns this prey. It remains completely authoritative:
        // a competing Blob neither envelopes nor kills the claimed target.
        this.opts.controller.setOrganismState("Hunt");
        return;
      }
      this.opts.onEnveloping?.(threat, coverage);
      this.opts.controller.setOrganismState("Envelop");
      if (!coverage.enveloped) {
        this.setEnveloped(threat, false);
        return;
      }
      this.setEnveloped(threat, true);
    }

    this.applyContactDamage(args, threat);

    // Never trust the frame snapshot after damage: it may still say alive even
    // though the entity died synchronously inside applyDamage.
    if (this.claimedPrey?.id === threat.id && !actorIsAlive(threat)) {
      this.beginDigest(threat);
    }
  }

  aim(): void {}

  tryFire(): boolean {
    return true;
  }

  reload(): void {}

  isReloading(): boolean {
    return false;
  }

  magazineEmpty(): boolean {
    return false;
  }

  effectiveRange(): number {
    return BlobConfig.v2.contact.baseRange * biomassReachScale(this.opts.controller.snapshot());
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.claimedPrey) this.releaseClaim("disposed", false);
    blobPreyClaims.releaseOwner(this.opts.id);
    if (!isDead(this.opts.controller.snapshot())) {
      this.opts.controller.setOrganismState("Hunt");
    }
  }

  private claimPrey(prey: ActorSnapshot, now: number): boolean {
    if (this.claimedPrey?.id === prey.id) {
      if (blobPreyClaims.isOwnedBy(prey.id, this.opts.id)) return true;
      this.releaseClaim("claim-lost");
      return false;
    }
    if (!blobPreyClaims.claim(prey.id, this.opts.id, now)) return false;

    this.claimedPrey = prey;
    this.digestElapsed = 0;
    this.digestStarted = false;
    this.completionAttempted = false;
    this.preyEnveloped = false;
    this.opts.onPreyClaimed?.(prey);
    return true;
  }

  private tickDigest(
    args: NpcCombatTickArgs,
    snapshot: BlobOrganismSnapshot,
  ): void {
    const prey = this.claimedPrey;
    if (!prey) return;
    if (!blobPreyClaims.isOwnedBy(prey.id, this.opts.id)) {
      this.releaseClaim("claim-lost");
      return;
    }

    const coverage = this.attachedMainCoverage(snapshot, prey);
    this.opts.onEnveloping?.(prey, coverage);
    const covered =
      coverage.enveloped &&
      this.hasLineOfSight(args.position, prey);
    if (!covered) {
      this.setEnveloped(prey, false);
      if (this.digestStarted || this.digestElapsed > 0) {
        this.emitDigestProgress(prey, 0);
      }
      this.digestStarted = false;
      this.digestElapsed = 0;
      this.opts.controller.setOrganismState("Envelop");
      return;
    }

    this.setEnveloped(prey, true);
    if (!this.digestStarted) this.beginDigest(prey);
    this.opts.controller.setOrganismState("Digest");
    this.digestElapsed += args.delta;

    const duration = digestDuration(prey);
    const progress = duration <= 0
      ? 1
      : Math.min(1, this.digestElapsed / duration);
    this.emitDigestProgress(prey, progress);
    if (duration > 0 && this.digestElapsed + COMPLETION_EPSILON < duration) return;

    this.completeDigest(prey);
  }

  private beginDigest(prey: ActorSnapshot): void {
    this.claimedPrey = prey;
    this.digestElapsed = 0;
    this.digestStarted = true;
    this.opts.controller.setOrganismState("Digest");
    this.emitDigestProgress(prey, 0);
  }

  private completeDigest(prey: ActorSnapshot): void {
    if (this.completionAttempted) return;
    this.completionAttempted = true;

    // The world removal happens first. Only its success permits the global
    // ownership transaction to complete, and only completed ownership grants
    // biomass. This ordering prevents duplicate growth from stale snapshots.
    const removed = prey.consumeByBlob?.(this.opts.id) ?? false;
    if (!removed) {
      this.releaseClaim("consume-failed");
      return;
    }
    if (!blobPreyClaims.complete(prey.id, this.opts.id)) {
      this.releaseClaim("claim-lost");
      return;
    }

    const biomass = preyBiomass(prey);
    const result = this.opts.controller.consumeBiomass(biomass);
    this.setEnveloped(prey, false);
    this.opts.onPreyConsumed?.(prey, biomass, result);
    this.clearClaimState();
    this.opts.controller.setOrganismState("Hunt");
  }

  private applyContactDamage(
    args: NpcCombatTickArgs,
    threat: ActorSnapshot,
  ): void {
    if (this.damageTimer > 0) return;
    this.damageTimer = BlobConfig.v2.contact.interval;

    TMP_DIRECTION.copy(threat.position).sub(args.position);
    if (TMP_DIRECTION.lengthSq() < 1e-6) TMP_DIRECTION.set(0, 0, 1);
    else TMP_DIRECTION.normalize();

    threat.entity.applyDamage(
      BlobConfig.v2.contact.damage,
      TMP_DIRECTION.clone(),
      undefined,
      this.opts.id,
      threat.position.clone(),
      "melee",
    );

    if (this.attackSoundTimer > 0) return;
    this.attackSoundTimer = BlobConfig.v2.contact.attackSoundInterval;
    this.opts.eventBus.emit("npc.attack", {
      id: this.opts.id,
      characterId: this.opts.characterId ?? "blob",
      position: args.position.clone(),
    });
  }

  private hasLineOfSight(
    ownerPosition: Vector3,
    target: ActorSnapshot,
  ): boolean {
    TMP_ORIGIN.copy(ownerPosition);
    TMP_ORIGIN.y += this.opts.eyeHeight ?? DEFAULT_EYE_HEIGHT;
    TMP_DIRECTION.copy(target.position).sub(TMP_ORIGIN);
    const distance = TMP_DIRECTION.length();
    if (distance <= 1e-4) return true;
    TMP_DIRECTION.divideScalar(distance);

    const hit = this.opts.raycast.cast(
      TMP_ORIGIN,
      TMP_DIRECTION,
      distance + 0.2,
      undefined,
      this.opts.id,
      (metadata) => metadata?.blobPermeable !== true,
    );
    return (hit?.metadata?.ownerId ?? hit?.metadata?.id) === target.id;
  }

  private attachedMainCoverage(
    snapshot: BlobOrganismSnapshot,
    target: ActorSnapshot,
  ): BlobV2CoverageResult {
    const mainIsland = snapshot.islands.find((island) => island.kind === "main");
    if (!mainIsland) {
      return measureBlobV2Coverage(target.position, [], {
        targetRadius: finiteRadius(target.radius),
      });
    }

    const attachedMainCells = new Set(
      snapshot.cells
        .filter((cell) =>
          cell.islandId === mainIsland.id && cell.membership === "attached"
        )
        .map((cell) => cell.id),
    );
    const particles = snapshot.particles.filter((particle) =>
      particle.islandId === mainIsland.id &&
      attachedMainCells.has(particle.cellId)
    );
    return measureBlobV2Coverage(target.position, particles, {
      targetRadius: Math.max(0.2, finiteRadius(target.radius)),
      biomassScale: biomassReachScale(snapshot),
      previouslyEnveloped: this.preyEnveloped,
    });
  }

  private setEnveloped(prey: ActorSnapshot, enveloped: boolean): void {
    if (this.preyEnveloped === enveloped) return;
    this.preyEnveloped = enveloped;
    setPreyEnveloped(prey, this.opts.id, enveloped);
    if (enveloped) this.opts.onPreyEnveloped?.(prey);
  }

  private releaseForOwnerDeath(): void {
    if (this.ownerDead) return;
    this.ownerDead = true;
    if (this.claimedPrey) this.releaseClaim("owner-dead", false);
    blobPreyClaims.releaseOwner(this.opts.id);
  }

  private releaseClaim(
    reason: BlobV2PreyReleaseReason,
    setHunt = true,
  ): void {
    const prey = this.claimedPrey;
    if (!prey) return;
    this.setEnveloped(prey, false);
    blobPreyClaims.release(prey.id, this.opts.id);
    if (this.digestStarted || this.digestElapsed > 0) {
      this.emitDigestProgress(prey, 0);
    }
    this.opts.onPreyReleased?.(prey, reason);
    this.clearClaimState();
    if (setHunt) this.opts.controller.setOrganismState("Hunt");
  }

  private clearClaimState(): void {
    this.claimedPrey = null;
    this.digestElapsed = 0;
    this.digestStarted = false;
    this.completionAttempted = false;
    this.preyEnveloped = false;
  }

  private emitDigestProgress(prey: ActorSnapshot, progress: number): void {
    this.opts.onDigestProgress?.(Object.freeze({
      preyId: prey.id,
      position: Object.freeze({
        x: prey.position.x,
        y: prey.position.y,
        z: prey.position.z,
      }),
      progress: Math.max(0, Math.min(1, progress)),
      consumeSeconds: digestDuration(prey),
    }));
  }
}

function actorIsAlive(actor: ActorSnapshot): boolean {
  return actor.entity.isAlive();
}

function isConsumablePrey(actor: ActorSnapshot): boolean {
  return actor.blobPrey != null;
}

function isBlobActor(actor: ActorSnapshot, ownerId: string): boolean {
  if (actor.id === ownerId) return true;
  const entity = actor.entity as typeof actor.entity & { characterId?: unknown };
  return entity.characterId === "blob";
}

function setPreyEnveloped(
  prey: ActorSnapshot,
  ownerId: string,
  enveloped: boolean,
): void {
  const entity = prey.entity as typeof prey.entity & {
    setBlobEnveloped?: (blobId: string, active: boolean) => void;
  };
  entity.setBlobEnveloped?.(ownerId, enveloped);
}

function isDead(snapshot: BlobOrganismSnapshot): boolean {
  return (
    snapshot.overrideState === "Dying" ||
    snapshot.overrideState === "Dead" ||
    snapshot.core.state === "Dying" ||
    snapshot.core.state === "Dead"
  );
}

function biomassReachScale(snapshot: BlobOrganismSnapshot): number {
  return Math.cbrt(Math.max(0, snapshot.biomass.total) / BLOB_V2_INITIAL_BIOMASS);
}

function finiteRadius(radius: number): number {
  return Number.isFinite(radius) && radius > 0 ? radius : 0.2;
}

function digestDuration(prey: ActorSnapshot): number {
  const configured = prey.blobPrey?.consumeSeconds ?? BlobConfig.v2.consumeSeconds;
  return Number.isFinite(configured) && configured >= 0
    ? configured
    : BlobConfig.v2.consumeSeconds;
}

function preyBiomass(prey: ActorSnapshot): number {
  const configured = prey.blobPrey?.biomass ?? DEFAULT_PREY_BIOMASS;
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_PREY_BIOMASS;
}
