import {
  BLOB_V2_FRAGMENT_REATTACH_SECONDS,
  BLOB_V2_FRAGMENT_RETURN_SECONDS,
  BLOB_V2_FRAGMENT_WITHER_SECONDS,
  BLOB_V2_MAX_FRAGMENTS,
  BLOB_V2_MIN_FRAGMENT_BIOMASS,
  freezeItems,
  freezeVector,
  type BlobCellId,
  type BlobFragmentId,
  type BlobFragmentMotionResolver,
  type BlobFragmentObservation,
  type BlobFragmentSnapshot,
  type BlobFragmentState,
  type BlobIslandId,
  type BlobIslandTransform,
  type BlobOrganismEvent,
  type BlobVector3,
  type BlobWoundId,
} from "@engine/blob/v2/BlobV2Types";
import { clamp, copyVector, distanceSquared, normalized, normalizedQuaternion, rigidTransform, rotateVector, setVector, type MutableBlobVector3 } from "@engine/blob/v2/BlobMath";
import type { BlobTopology } from "@engine/blob/v2/BlobTopology";
import type { BlobWoundSystem } from "@engine/blob/v2/BlobWoundSystem";

export interface BlobFragmentRecord {
  readonly id: BlobFragmentId;
  readonly islandId: BlobIslandId;
  readonly generation: number;
  readonly woundId: BlobWoundId;
  state: BlobFragmentState;
  readonly position: MutableBlobVector3;
  readonly velocity: MutableBlobVector3;
  readonly detachedAt: number;
  stateStartedAt: number;
  readonly cellIds: BlobCellId[];
  damageRemainder: number;
  reattachProgress: number;
  needsPath: boolean;
  pathRequested: boolean;
  stalledSeconds: number;
  lastOwnerDistance: number;
}

export interface BlobFragmentDamageResult {
  readonly found: boolean;
  readonly biomassLost: number;
  readonly died: boolean;
}

type BlobEventEmitter = (event: BlobOrganismEvent) => void;

export class BlobFragmentSystem {
  private readonly fragmentsById = new Map<BlobFragmentId, BlobFragmentRecord>();
  private nextFragmentId = 1;

  constructor(
    private readonly topology: BlobTopology,
    private readonly wounds: BlobWoundSystem,
    private readonly emit: BlobEventEmitter,
    private readonly returnSpeed = 1.8,
    private readonly reattachDistance = 0.45,
  ) {
    if (!(returnSpeed > 0) || !Number.isFinite(returnSpeed)) throw new RangeError("Blob fragment return speed must be finite and positive");
    if (!(reattachDistance > 0) || !Number.isFinite(reattachDistance)) throw new RangeError("Blob reattach distance must be finite and positive");
  }

  get records(): readonly BlobFragmentRecord[] {
    return [...this.fragmentsById.values()].sort((a, b) => a.id - b.id);
  }

  get livingCount(): number {
    return this.records.filter((fragment) => fragment.state !== "Attached" && fragment.state !== "Dead").length;
  }

  get(id: BlobFragmentId): BlobFragmentRecord | undefined {
    return this.fragmentsById.get(id);
  }

  detach(
    requestedBiomass: number,
    woundId: BlobWoundId,
    position: BlobVector3,
    velocity: BlobVector3,
    now: number,
  ): BlobFragmentRecord | null {
    if (this.livingCount >= BLOB_V2_MAX_FRAGMENTS) return null;
    const id = this.nextFragmentId++;
    const detached = this.topology.detachCombatFragment(id, requestedBiomass);
    if (!detached || detached.cellIds.length < 1) return null;
    const record: BlobFragmentRecord = {
      id,
      islandId: detached.islandId,
      generation: detached.generation,
      woundId,
      state: "Detaching",
      position: copyVector(position),
      velocity: copyVector(velocity),
      detachedAt: now,
      stateStartedAt: now,
      cellIds: [...detached.cellIds],
      damageRemainder: 0,
      reattachProgress: 0,
      needsPath: false,
      pathRequested: false,
      stalledSeconds: 0,
      lastOwnerDistance: Number.POSITIVE_INFINITY,
    };
    this.fragmentsById.set(id, record);
    this.emit({ type: "fragmentDetached", fragmentId: id, woundId, biomass: detached.cellIds.length });
    return record;
  }

  damage(fragmentId: BlobFragmentId, damage: number, now: number): BlobFragmentDamageResult {
    const fragment = this.fragmentsById.get(fragmentId);
    if (!fragment || fragment.state === "Attached" || fragment.state === "Dead") {
      return Object.freeze({ found: false, biomassLost: 0, died: false });
    }
    if (!Number.isFinite(damage) || damage <= 0) {
      return Object.freeze({ found: true, biomassLost: 0, died: false });
    }
    const accumulated = fragment.damageRemainder + damage;
    const erosion = Math.floor(accumulated / 6);
    fragment.damageRemainder = accumulated - erosion * 6;
    let biomassLost = 0;
    if (erosion > 0) {
      const removed = this.topology.erodeFragment(fragmentId, erosion);
      biomassLost += removed.length;
      this.removeCellIds(fragment, removed);
    }
    const remaining = this.topology.biomassForFragment(fragmentId);
    let died = false;
    if (remaining < BLOB_V2_MIN_FRAGMENT_BIOMASS) {
      const removed = this.topology.killFragment(fragmentId);
      biomassLost += removed.length;
      this.removeCellIds(fragment, removed);
      this.transition(fragment, "Dead", now);
      this.wounds.markFragmentLost(fragment.woundId, fragment.id);
      died = true;
      this.emit({
        type: "fragmentDestroyed",
        fragmentId: fragment.id,
        woundId: fragment.woundId,
        biomassLost,
      });
      this.pruneTerminalHistory();
    }
    if (biomassLost > 0) this.emitBiomassChanged("fragment-damage");
    return Object.freeze({ found: true, biomassLost, died });
  }

  advance(
    now: number,
    fixedDelta: number,
    ownerPosition: BlobVector3,
    observations: Readonly<Record<number, BlobFragmentObservation>> | undefined,
    gravity: number,
    motionResolver?: BlobFragmentMotionResolver,
  ): void {
    for (const fragment of this.records) {
      if (fragment.state === "Attached" || fragment.state === "Dead") continue;
      const observation = observations?.[fragment.id];
      if (observation?.position) {
        fragment.position.x = observation.position.x;
        fragment.position.y = observation.position.y;
        fragment.position.z = observation.position.z;
      }
      if (observation?.velocity) {
        fragment.velocity.x = observation.velocity.x;
        fragment.velocity.y = observation.velocity.y;
        fragment.velocity.z = observation.velocity.z;
      }
      const motionStart = copyVector(fragment.position);
      const ownerDistanceBeforeMotion = Math.sqrt(distanceSquared(motionStart, ownerPosition));

      if (fragment.state !== "Withering" && now + 1e-9 >= fragment.detachedAt + BLOB_V2_FRAGMENT_RETURN_SECONDS) {
        this.transition(fragment, "Withering", now);
        fragment.velocity.x = 0;
        fragment.velocity.y = 0;
        fragment.velocity.z = 0;
        fragment.needsPath = false;
      }

      switch (fragment.state) {
        case "Detaching":
          this.integrateBallistic(fragment, fixedDelta, gravity);
          if (now > fragment.stateStartedAt + 1e-9) this.transition(fragment, "Ballistic", now);
          break;
        case "Ballistic":
          this.integrateBallistic(fragment, fixedDelta, gravity);
          if (observation?.grounded === true || now - fragment.stateStartedAt >= 0.45) {
            this.transition(fragment, "Returning", now);
            fragment.lastOwnerDistance = Math.sqrt(distanceSquared(fragment.position, ownerPosition));
          }
          break;
        case "Returning":
          this.advanceReturn(fragment, ownerPosition, observation, fixedDelta);
          break;
        case "Reattaching":
          this.advanceReattach(fragment, ownerPosition, now);
          break;
        case "Withering":
          if (now + 1e-9 >= fragment.stateStartedAt + BLOB_V2_FRAGMENT_WITHER_SECONDS) {
            const removed = this.topology.killFragment(fragment.id);
            this.removeCellIds(fragment, removed);
            this.transition(fragment, "Dead", now);
            this.wounds.markFragmentLost(fragment.woundId, fragment.id);
            this.emit({
              type: "fragmentWithered",
              fragmentId: fragment.id,
              woundId: fragment.woundId,
              biomassLost: removed.length,
            });
            if (removed.length > 0) this.emitBiomassChanged("fragment-wither");
          }
          break;
      }
      if (
        motionResolver &&
        (fragment.state === "Ballistic" || fragment.state === "Returning")
      ) {
        const radius = Math.max(0.18, Math.cbrt(Math.max(1, this.topology.biomassForFragment(fragment.id))) * 0.12);
        const resolved = motionResolver(
          fragment.id,
          fragment.islandId,
          motionStart,
          fragment.position,
          fragment.velocity,
          radius,
        );
        if (resolved) {
          if ("position" in resolved) {
            setVector(fragment.position, resolved.position);
            if (resolved.velocity) setVector(fragment.velocity, resolved.velocity);
            if (resolved.grounded && fragment.state === "Ballistic") {
              this.transition(fragment, "Returning", now);
              fragment.lastOwnerDistance = Math.sqrt(distanceSquared(fragment.position, ownerPosition));
            }
          } else {
            setVector(fragment.position, resolved);
          }
        }
      }
      if (fragment.state === "Returning") {
        this.finalizeReturn(
          fragment,
          ownerPosition,
          observation,
          fixedDelta,
          now,
          ownerDistanceBeforeMotion,
        );
      }
    }
    this.pruneTerminalHistory();
  }

  snapshot(now: number): readonly BlobFragmentSnapshot[] {
    return freezeItems(
      this.records.map((fragment) => {
        const currentBiomass = fragment.state === "Attached"
          ? fragment.cellIds.length
          : this.topology.biomassForFragment(fragment.id);
        return {
          id: fragment.id,
          islandId: fragment.islandId,
          generation: fragment.generation,
          woundId: fragment.woundId,
          state: fragment.state,
          biomass: currentBiomass,
          cellIds: Object.freeze([...fragment.cellIds].sort((a, b) => a - b)),
          position: freezeVector(fragment.position),
          velocity: freezeVector(fragment.velocity),
          detachedAt: fragment.detachedAt,
          stateStartedAt: fragment.stateStartedAt,
          age: Math.max(0, now - fragment.detachedAt),
          reattachProgress: fragment.state === "Attached" ? 1 : fragment.reattachProgress,
          witherProgress: fragment.state === "Withering"
            ? clamp((now - fragment.stateStartedAt) / BLOB_V2_FRAGMENT_WITHER_SECONDS, 0, 1)
            : fragment.state === "Dead" && fragment.cellIds.length === 0 ? 1 : 0,
          damageRemainder: fragment.damageRemainder,
          needsPath: fragment.needsPath,
        };
      }),
    ) as readonly BlobFragmentSnapshot[];
  }

  transformIsland(islandId: BlobIslandId, transform: BlobIslandTransform): boolean {
    const fragment = this.records.find((candidate) => candidate.islandId === islandId);
    if (!fragment || fragment.state === "Attached" || fragment.state === "Dead") return false;
    const rotation = normalizedQuaternion(transform.rotation);
    setVector(fragment.position, rigidTransform(fragment.position, rotation, transform.translation));
    setVector(fragment.velocity, rotateVector(fragment.velocity, rotation));
    fragment.lastOwnerDistance = Number.POSITIVE_INFINITY;
    return true;
  }

  setIslandVelocity(islandId: BlobIslandId, velocity: BlobVector3): boolean {
    const fragment = this.records.find((candidate) => candidate.islandId === islandId);
    if (!fragment || fragment.state === "Attached" || fragment.state === "Dead") return false;
    setVector(fragment.velocity, velocity);
    return true;
  }

  assertInvariants(): void {
    let biomass = 0;
    let living = 0;
    for (const fragment of this.fragmentsById.values()) {
      if (fragment.state === "Attached" || fragment.state === "Dead") continue;
      living++;
      const topologyBiomass = this.topology.biomassForFragment(fragment.id);
      if (topologyBiomass !== fragment.cellIds.length) {
        throw new Error(`Fragment ${fragment.id} cell ownership is inconsistent`);
      }
      biomass += topologyBiomass;
    }
    if (living > BLOB_V2_MAX_FRAGMENTS) throw new Error("Blob autonomous fragment cap exceeded");
    if (biomass !== this.topology.fragmentBiomass) throw new Error("Blob fragment biomass invariant failed");
  }

  private advanceReturn(
    fragment: BlobFragmentRecord,
    ownerPosition: BlobVector3,
    observation: BlobFragmentObservation | undefined,
    fixedDelta: number,
  ): void {
    const lineOfSight = observation?.lineOfSightToOwner ?? true;
    const steering = lineOfSight
      ? normalized({
          x: ownerPosition.x - fragment.position.x,
          y: ownerPosition.y - fragment.position.y,
          z: ownerPosition.z - fragment.position.z,
        }, { x: 0, y: 0, z: 0 })
      : observation?.pathVelocity
        ? normalized(observation.pathVelocity, { x: 0, y: 0, z: 0 })
        : { x: 0, y: 0, z: 0 };
    fragment.velocity.x = steering.x * this.returnSpeed;
    fragment.velocity.y = steering.y * this.returnSpeed;
    fragment.velocity.z = steering.z * this.returnSpeed;
    fragment.position.x += fragment.velocity.x * fixedDelta;
    fragment.position.y += fragment.velocity.y * fixedDelta;
    fragment.position.z += fragment.velocity.z * fixedDelta;
  }

  private finalizeReturn(
    fragment: BlobFragmentRecord,
    ownerPosition: BlobVector3,
    observation: BlobFragmentObservation | undefined,
    fixedDelta: number,
    now: number,
    beforeDistance: number,
  ): void {
    const lineOfSight = observation?.lineOfSightToOwner ?? true;
    const afterDistance = Math.sqrt(distanceSquared(fragment.position, ownerPosition));
    // Progress is measured only after the authoritative motion resolver has
    // committed collision/portal movement. Measuring the optimistic steering
    // position let blocked fragments avoid path requests or even begin a
    // reattach through a wall before collision resolution ran.
    const progress = beforeDistance - afterDistance;
    fragment.lastOwnerDistance = afterDistance;
    if (progress < this.returnSpeed * fixedDelta * 0.15) fragment.stalledSeconds += fixedDelta;
    else fragment.stalledSeconds = 0;
    if (fragment.stalledSeconds + 1e-9 >= 0.55) {
      fragment.needsPath = true;
      if (!fragment.pathRequested) {
        fragment.pathRequested = true;
        this.emit({ type: "fragmentPathRequested", fragmentId: fragment.id });
      }
    } else if (lineOfSight || observation?.pathVelocity) {
      fragment.needsPath = false;
      fragment.pathRequested = false;
    }

    if (afterDistance <= this.reattachDistance) {
      this.transition(fragment, "Reattaching", now);
      fragment.reattachProgress = 0;
      this.wounds.beginReattach(fragment.woundId);
    }
  }

  private advanceReattach(fragment: BlobFragmentRecord, ownerPosition: BlobVector3, now: number): void {
    fragment.reattachProgress = clamp(
      (now - fragment.stateStartedAt) / BLOB_V2_FRAGMENT_REATTACH_SECONDS,
      0,
      1,
    );
    this.wounds.setReattachProgress(fragment.woundId, fragment.reattachProgress);
    const remaining = 1 - fragment.reattachProgress;
    fragment.position.x = ownerPosition.x + (fragment.position.x - ownerPosition.x) * remaining;
    fragment.position.y = ownerPosition.y + (fragment.position.y - ownerPosition.y) * remaining;
    fragment.position.z = ownerPosition.z + (fragment.position.z - ownerPosition.z) * remaining;
    if (fragment.reattachProgress < 1) return;
    const biomass = this.topology.biomassForFragment(fragment.id);
    this.topology.reattachCombatFragment(fragment.id);
    this.wounds.close(fragment.woundId);
    this.transition(fragment, "Attached", now);
    this.emit({
      type: "fragmentReattached",
      fragmentId: fragment.id,
      woundId: fragment.woundId,
      biomass,
    });
  }

  private integrateBallistic(fragment: BlobFragmentRecord, fixedDelta: number, gravity: number): void {
    fragment.velocity.y -= Math.max(0, gravity) * fixedDelta;
    fragment.position.x += fragment.velocity.x * fixedDelta;
    fragment.position.y += fragment.velocity.y * fixedDelta;
    fragment.position.z += fragment.velocity.z * fixedDelta;
  }

  private transition(fragment: BlobFragmentRecord, state: BlobFragmentState, now: number): void {
    fragment.state = state;
    fragment.stateStartedAt = now;
  }

  private removeCellIds(fragment: BlobFragmentRecord, removed: readonly BlobCellId[]): void {
    if (removed.length === 0) return;
    const removedSet = new Set(removed);
    for (let index = fragment.cellIds.length - 1; index >= 0; index--) {
      const id = fragment.cellIds[index];
      if (id !== undefined && removedSet.has(id)) fragment.cellIds.splice(index, 1);
    }
  }

  private emitBiomassChanged(reason: "fragment-damage" | "fragment-wither"): void {
    const biomass = this.topology.biomassSnapshot();
    this.emit({
      type: "biomassChanged",
      total: biomass.total,
      attached: biomass.attached,
      fragments: biomass.fragments,
      reason,
    });
  }

  /**
   * Terminal snapshots are useful for presentation and diagnostics, but an
   * organism can split hundreds of times over a long session. Retain a small,
   * deterministic history while keeping runtime memory and snapshot cost
   * bounded; IDs remain monotonic and are never reused.
   */
  private pruneTerminalHistory(): void {
    const maximumHistory = BLOB_V2_MAX_FRAGMENTS * 2;
    const terminal = [...this.fragmentsById.values()]
      .filter((fragment) => fragment.state === "Attached" || fragment.state === "Dead")
      .sort((a, b) => a.stateStartedAt - b.stateStartedAt || a.id - b.id);
    const removeCount = terminal.length - maximumHistory;
    for (let index = 0; index < removeCount; index++) {
      const fragment = terminal[index];
      if (fragment) this.fragmentsById.delete(fragment.id);
    }
  }
}
