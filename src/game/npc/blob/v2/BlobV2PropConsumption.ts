import RAPIER from "@dimforge/rapier3d-compat";
import type { BlobConsumptionResult, BlobOrganismSnapshot, BlobVector3 } from "@engine/blob/v2";
import { BLOB_V2_INITIAL_BIOMASS, BlobOrganismController } from "@engine/blob/v2";
import { PhysicsWorld, type PhysicsMetadata } from "@engine/physics/PhysicsWorld";
import {
  BlobPreyClaimService,
  blobPreyClaims,
} from "@game/npc/blob/BlobPreyClaimService";
import { measureBlobV2Coverage } from "@game/npc/blob/v2/BlobV2Coverage";
import { Object3D, Quaternion, Vector3 } from "three";

const DEFAULT_CONSUME_SECONDS = 1.5;
const DEFAULT_BIOMASS = 4;
const DEFAULT_COVERAGE_PADDING = 0.55;
const DEFAULT_SINK_DISTANCE = 0.45;
const DEFAULT_MINIMUM_SCALE = 0.35;
const PARTICLE_REACH_SCALE = 1.8;
const IDENTITY_ROTATION = new Quaternion();

interface PropPreyMetadata {
  readonly biomass?: number;
  readonly consumeSeconds?: number;
}

type ConsumablePhysicsMetadata = Omit<PhysicsMetadata, "blobConsumable"> & {
  readonly blobConsumable?:
    | boolean
    | {
        readonly biomass?: number;
        readonly consumeSeconds?: number;
      };
  readonly blobPrey?: PropPreyMetadata;
};

export interface BlobV2PropDigestProgress {
  readonly propId: string;
  readonly position: BlobVector3;
  readonly progress: number;
  readonly consumeSeconds: number;
}

export interface BlobV2PropConsumedEvent {
  readonly propId: string;
  readonly position: BlobVector3;
  readonly biomass: number;
  readonly result: BlobConsumptionResult;
}

export interface BlobV2PropConsumptionOptions {
  /** Stable organism id used by the shared prey-claim authority. */
  readonly ownerId: string;
  readonly claimService?: BlobPreyClaimService;
  readonly fallbackConsumeSeconds?: number;
  readonly fallbackBiomass?: number;
  readonly coveragePadding?: number;
  readonly sinkDistance?: number;
  /** Fraction of the visual's original scale at the end of digestion. */
  readonly minimumScale?: number;
  readonly onProgress?: (progress: BlobV2PropDigestProgress) => void;
  readonly onConsumed?: (event: BlobV2PropConsumedEvent) => void;
}

interface ActiveProp {
  readonly body: RAPIER.RigidBody;
  readonly handle: number;
  readonly claimId: string;
  readonly propId: string;
  readonly visual: Object3D | null;
  readonly visualOffset: Vector3;
  readonly originalScale: Vector3;
  readonly consumeSeconds: number;
  readonly biomass: number;
  elapsed: number;
}

interface PropCandidate {
  readonly body: RAPIER.RigidBody;
  readonly metadata: ConsumablePhysicsMetadata;
}

/**
 * V2 adapter for dynamic prop absorption. It deliberately ignores actors and
 * fragments: only an attached particle from the main island can provide
 * continuous coverage, and only a `kind: dynamic` body marked
 * `blobConsumable` can enter the transaction.
 */
export class BlobV2PropConsumption {
  private readonly active = new Map<number, ActiveProp>();
  private readonly claimService: BlobPreyClaimService;
  private readonly fallbackConsumeSeconds: number;
  private readonly fallbackBiomass: number;
  private readonly coveragePadding: number;
  private readonly sinkDistance: number;
  private readonly minimumScale: number;
  private elapsedSeconds = 0;
  private disposed = false;

  constructor(
    private readonly controller: BlobOrganismController,
    private readonly physics: PhysicsWorld,
    private readonly options: BlobV2PropConsumptionOptions,
  ) {
    if (!options.ownerId) throw new Error("Blob prop consumption requires a non-empty ownerId");
    this.claimService = options.claimService ?? blobPreyClaims;
    this.fallbackConsumeSeconds = finiteNonNegative(
      options.fallbackConsumeSeconds,
      DEFAULT_CONSUME_SECONDS,
    );
    this.fallbackBiomass = finitePositive(options.fallbackBiomass, DEFAULT_BIOMASS);
    this.coveragePadding = finiteNonNegative(options.coveragePadding, DEFAULT_COVERAGE_PADDING);
    this.sinkDistance = finiteNonNegative(options.sinkDistance, DEFAULT_SINK_DISTANCE);
    this.minimumScale = clamp(
      Number.isFinite(options.minimumScale) ? options.minimumScale! : DEFAULT_MINIMUM_SCALE,
      0,
      1,
    );
  }

  tick(deltaSeconds: number, snapshot: BlobOrganismSnapshot = this.controller.snapshot()): void {
    if (this.disposed) return;
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError("Blob prop consumption delta must be finite and non-negative");
    }
    this.elapsedSeconds += deltaSeconds;

    if (snapshot.overrideState === "Dead" || snapshot.overrideState === "Dying") {
      this.cancelAll();
      return;
    }

    const particles = attachedMainParticles(snapshot);
    if (particles.length === 0) {
      this.cancelAll();
      return;
    }

    const scale = Math.cbrt(Math.max(0, snapshot.biomass.total) / BLOB_V2_INITIAL_BIOMASS);
    const candidates = this.findCandidates(snapshot, particles, scale);
    const covered = new Set<number>();

    for (const candidate of candidates.values()) {
      if (!candidate.body.isValid()) continue;
      const position = candidate.body.translation();
      const coverage = measureBlobV2Coverage(position, particles, {
        targetRadius: 0.2,
        padding: this.coveragePadding,
        biomassScale: scale,
        previouslyEnveloped: this.active.has(candidate.body.handle),
      });
      if (!coverage.enveloped) continue;
      covered.add(candidate.body.handle);
      this.advanceCandidate(candidate, deltaSeconds, snapshot.overrideState === "Frozen");
    }

    for (const [handle, prop] of [...this.active]) {
      if (covered.has(handle)) continue;
      this.cancel(prop, true);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelAll();
  }

  private findCandidates(
    snapshot: BlobOrganismSnapshot,
    particles: ReturnType<typeof attachedMainParticles>,
    biomassScale: number,
  ): Map<number, PropCandidate> {
    const candidates = new Map<number, PropCandidate>();
    let queryRadius = 0;
    for (const particle of particles) {
      const dx = particle.position.x - snapshot.core.position.x;
      const dy = particle.position.y - snapshot.core.position.y;
      const dz = particle.position.z - snapshot.core.position.z;
      queryRadius = Math.max(
        queryRadius,
        Math.sqrt(dx * dx + dy * dy + dz * dz) +
          (particle.radius * PARTICLE_REACH_SCALE + this.coveragePadding) * biomassScale,
      );
    }

    this.physics.world.intersectionsWithShape(
      snapshot.core.position,
      IDENTITY_ROTATION,
      new RAPIER.Ball(Math.max(0.05, queryRadius)),
      (collider) => {
        const body = collider.parent();
        if (!body?.isDynamic() || candidates.has(body.handle)) return true;
        const metadata = this.physics.getColliderMetadata(collider) as
          | ConsumablePhysicsMetadata
          | undefined;
        if (!isConsumableProp(metadata)) return true;
        candidates.set(body.handle, { body, metadata });
        return true;
      },
    );
    return candidates;
  }

  private advanceCandidate(
    candidate: PropCandidate,
    deltaSeconds: number,
    frozen: boolean,
  ): void {
    const { body, metadata } = candidate;
    let prop = this.active.get(body.handle);
    if (!prop) {
      const claimId = propClaimId(metadata, body.handle);
      if (!this.claimService.claim(claimId, this.options.ownerId, this.elapsedSeconds)) return;
      const visual = this.physics.getBoundMesh(body) ?? null;
      const bodyPosition = body.translation();
      prop = {
        body,
        handle: body.handle,
        claimId,
        propId: metadata.id,
        visual,
        visualOffset: visual
          ? visual.position.clone().sub(new Vector3(bodyPosition.x, bodyPosition.y, bodyPosition.z))
          : new Vector3(),
        originalScale: visual?.scale.clone() ?? new Vector3(1, 1, 1),
        consumeSeconds: consumeSeconds(metadata, this.fallbackConsumeSeconds),
        biomass: biomassValue(metadata, this.fallbackBiomass),
        elapsed: 0,
      };
      this.active.set(body.handle, prop);
      this.emitProgress(prop, bodyPosition, 0);
    } else if (!this.claimService.isOwnedBy(prop.claimId, this.options.ownerId)) {
      this.cancel(prop, false);
      return;
    }

    if (!frozen) prop.elapsed = Math.min(prop.consumeSeconds, prop.elapsed + deltaSeconds);
    const progress = prop.consumeSeconds === 0 ? 1 : clamp(prop.elapsed / prop.consumeSeconds, 0, 1);
    this.animate(prop, progress);
    this.emitProgress(prop, body.translation(), progress);
    if (!frozen && progress >= 1) this.complete(prop);
  }

  private animate(prop: ActiveProp, progress: number): void {
    if (!prop.visual || !prop.body.isValid()) return;
    const position = prop.body.translation();
    const eased = smoothstep(progress);
    const scale = 1 - (1 - this.minimumScale) * eased;
    prop.visual.position.set(
      position.x + prop.visualOffset.x,
      position.y + prop.visualOffset.y - this.sinkDistance * eased,
      position.z + prop.visualOffset.z,
    );
    prop.visual.scale.copy(prop.originalScale).multiplyScalar(scale);
  }

  private restoreVisual(prop: ActiveProp): void {
    if (!prop.visual) return;
    prop.visual.scale.copy(prop.originalScale);
    if (!prop.body.isValid()) return;
    const position = prop.body.translation();
    prop.visual.position.set(
      position.x + prop.visualOffset.x,
      position.y + prop.visualOffset.y,
      position.z + prop.visualOffset.z,
    );
  }

  private complete(prop: ActiveProp): void {
    if (!this.active.delete(prop.handle)) return;
    if (!prop.body.isValid() || !this.claimService.isOwnedBy(prop.claimId, this.options.ownerId)) {
      this.restoreVisual(prop);
      this.claimService.release(prop.claimId, this.options.ownerId);
      return;
    }

    const translation = prop.body.translation();
    const position = frozenPosition(translation);
    prop.visual?.removeFromParent();
    this.physics.removeBody(prop.body);
    if (!this.claimService.complete(prop.claimId, this.options.ownerId)) return;

    const result = this.controller.consumeBiomass(prop.biomass);
    this.options.onConsumed?.(Object.freeze({
      propId: prop.propId,
      position,
      biomass: prop.biomass,
      result,
    }));
  }

  private cancel(prop: ActiveProp, emitReset: boolean): void {
    if (!this.active.delete(prop.handle)) return;
    this.restoreVisual(prop);
    this.claimService.release(prop.claimId, this.options.ownerId);
    if (emitReset) {
      const position = prop.body.isValid() ? prop.body.translation() : { x: 0, y: 0, z: 0 };
      this.emitProgress(prop, position, 0);
    }
  }

  private cancelAll(): void {
    for (const prop of [...this.active.values()]) this.cancel(prop, true);
  }

  private emitProgress(
    prop: ActiveProp,
    position: { readonly x: number; readonly y: number; readonly z: number },
    progress: number,
  ): void {
    this.options.onProgress?.(Object.freeze({
      propId: prop.propId,
      position: frozenPosition(position),
      progress: clamp(progress, 0, 1),
      consumeSeconds: prop.consumeSeconds,
    }));
  }
}

function attachedMainParticles(snapshot: BlobOrganismSnapshot) {
  const main = snapshot.islands.find((island) => island.kind === "main");
  if (!main) return [];
  const cellIds = new Set(
    snapshot.cells
      .filter((cell) => cell.islandId === main.id && cell.membership === "attached")
      .map((cell) => cell.id),
  );
  return snapshot.particles.filter(
    (particle) => particle.islandId === main.id && cellIds.has(particle.cellId),
  );
}

function isConsumableProp(
  metadata: ConsumablePhysicsMetadata | undefined,
): metadata is ConsumablePhysicsMetadata {
  return Boolean(
    metadata &&
      metadata.kind === "dynamic" &&
      metadata.characterId !== "blob" &&
      metadata.blobConsumable !== undefined &&
      metadata.blobConsumable !== false,
  );
}

function propClaimId(metadata: ConsumablePhysicsMetadata, bodyHandle: number): string {
  return `blob-prop:${metadata.ownerId ?? metadata.id}:${bodyHandle}`;
}

function consumeSeconds(metadata: ConsumablePhysicsMetadata, fallback: number): number {
  const consumable = typeof metadata.blobConsumable === "object"
    ? metadata.blobConsumable
    : undefined;
  return finiteNonNegative(
    metadata.blobPrey?.consumeSeconds ?? consumable?.consumeSeconds,
    fallback,
  );
}

function biomassValue(metadata: ConsumablePhysicsMetadata, fallback: number): number {
  const consumable = typeof metadata.blobConsumable === "object"
    ? metadata.blobConsumable
    : undefined;
  return finitePositive(metadata.blobPrey?.biomass ?? consumable?.biomass, fallback);
}

function finiteNonNegative(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! >= 0 ? value! : fallback;
}

function finitePositive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! > 0 ? value! : fallback;
}

function frozenPosition(position: {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}): BlobVector3 {
  return Object.freeze({ x: position.x, y: position.y, z: position.z });
}

function smoothstep(value: number): number {
  const clamped = clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
