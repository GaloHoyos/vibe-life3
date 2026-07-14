import {
  BLOB_V2_COHESION_DECAY_DELAY_SECONDS,
  BLOB_V2_COHESION_DECAY_PER_SECOND,
  BLOB_V2_COHESION_THRESHOLD,
  freezeItems,
  freezeVector,
  type BlobFragmentId,
  type BlobIslandTransform,
  type BlobVector3,
  type BlobWoundId,
  type BlobWoundSnapshot,
  type BlobWoundState,
} from "@engine/blob/v2/BlobV2Types";
import { clamp, copyVector, distanceSquared, normalized, normalizedQuaternion, rigidTransform, rotateVector, setVector, type MutableBlobVector3 } from "@engine/blob/v2/BlobMath";

export interface BlobWoundRecord {
  readonly id: BlobWoundId;
  readonly point: MutableBlobVector3;
  readonly normal: MutableBlobVector3;
  radius: number;
  state: BlobWoundState;
  cohesionEnergy: number;
  cohesionThreshold: number;
  repairDeficit: number;
  detachedBiomass: number;
  fragmentId: BlobFragmentId | null;
  readonly createdAt: number;
  lastImpactAt: number;
  openedAt: number | null;
  reattachProgress: number;
  sourceWoundId: BlobWoundId | null;
  lastDecayAt: number;
}

export interface BlobCohesionResult {
  readonly wound: BlobWoundRecord;
  readonly thresholdCrossed: boolean;
}

export interface BlobRepairResult {
  readonly used: number;
  readonly closedWoundIds: readonly BlobWoundId[];
}

export class BlobWoundSystem {
  private static readonly MAX_CLOSED_HISTORY = 24;
  private readonly woundsById = new Map<BlobWoundId, BlobWoundRecord>();
  private nextWoundId = 1;

  constructor(private readonly zoneRadius = 0.34) {}

  get records(): readonly BlobWoundRecord[] {
    return [...this.woundsById.values()].sort((a, b) => a.id - b.id);
  }

  get openRecords(): readonly BlobWoundRecord[] {
    return this.records.filter((wound) => this.isOpen(wound));
  }

  get(id: BlobWoundId): BlobWoundRecord | undefined {
    return this.woundsById.get(id);
  }

  accumulateCohesion(
    point: BlobVector3,
    normal: BlobVector3,
    energy: number,
    now: number,
  ): BlobCohesionResult {
    if (!Number.isFinite(energy) || energy < 0) throw new RangeError("Cohesion energy must be finite and non-negative");
    this.advance(now);
    const wound = this.findDamageZone(point) ?? this.createWound(point, normal, now);
    wound.lastImpactAt = now;
    if (wound.state !== "Stressed") return { wound, thresholdCrossed: false };
    const before = wound.cohesionEnergy;
    wound.cohesionEnergy = Math.min(wound.cohesionThreshold * 2, before + energy);
    return {
      wound,
      thresholdCrossed: before < wound.cohesionThreshold && wound.cohesionEnergy >= wound.cohesionThreshold,
    };
  }

  open(
    woundId: BlobWoundId,
    detachedBiomass: number,
    fragmentId: BlobFragmentId | null,
    now: number,
    radius?: number,
  ): BlobWoundRecord {
    const wound = this.require(woundId);
    wound.state = "Breached";
    wound.openedAt = now;
    wound.lastImpactAt = now;
    wound.detachedBiomass = Math.max(0, Math.floor(detachedBiomass));
    wound.repairDeficit = wound.detachedBiomass;
    wound.fragmentId = fragmentId;
    wound.reattachProgress = 0;
    if (radius !== undefined) wound.radius = Math.max(wound.radius, radius);
    return wound;
  }

  beginReattach(woundId: BlobWoundId): void {
    const wound = this.woundsById.get(woundId);
    if (!wound || wound.state === "Closed" || wound.state === "Redistributing") return;
    wound.state = "Reattaching";
    wound.reattachProgress = 0;
  }

  setReattachProgress(woundId: BlobWoundId, progress: number): void {
    const wound = this.woundsById.get(woundId);
    if (!wound || wound.state !== "Reattaching") return;
    wound.reattachProgress = clamp(progress, 0, 1);
  }

  close(woundId: BlobWoundId): boolean {
    const wound = this.woundsById.get(woundId);
    if (!wound || wound.state === "Closed") return false;
    wound.state = "Closed";
    wound.repairDeficit = 0;
    wound.fragmentId = null;
    wound.reattachProgress = 1;
    wound.cohesionEnergy = 0;
    this.pruneClosedHistory();
    return true;
  }

  markFragmentLost(woundId: BlobWoundId, fragmentId: BlobFragmentId): void {
    const wound = this.woundsById.get(woundId);
    if (!wound || wound.fragmentId !== fragmentId || wound.state === "Closed") return;
    wound.fragmentId = null;
    if (wound.state === "Reattaching" || wound.state === "Breached") wound.state = "Exposed";
    wound.reattachProgress = 0;
  }

  repairDeepest(amount: number): BlobRepairResult {
    let remaining = Math.max(0, Math.floor(amount));
    let used = 0;
    const closedWoundIds: BlobWoundId[] = [];
    const damaged = this.records
      .filter((wound) => wound.state !== "Closed" && wound.repairDeficit > 0)
      .sort((a, b) => b.repairDeficit - a.repairDeficit || a.id - b.id);
    for (const wound of damaged) {
      if (remaining <= 0) break;
      const repaired = Math.min(remaining, wound.repairDeficit);
      wound.repairDeficit -= repaired;
      remaining -= repaired;
      used += repaired;
      if (wound.repairDeficit <= 0) {
        this.close(wound.id);
        closedWoundIds.push(wound.id);
      } else if (wound.state === "Stressed") {
        wound.cohesionThreshold = this.thresholdForWeakness(wound.repairDeficit);
      }
    }
    return Object.freeze({ used, closedWoundIds: Object.freeze(closedWoundIds) });
  }

  canRedistribute(wound: BlobWoundRecord, now: number, lastDamageAt: number, delaySeconds: number): boolean {
    return (
      wound.state === "Exposed" &&
      wound.fragmentId === null &&
      wound.repairDeficit > 0 &&
      now - Math.max(lastDamageAt, wound.openedAt ?? wound.createdAt) + 1e-9 >= delaySeconds
    );
  }

  beginRedistribution(woundId: BlobWoundId): boolean {
    const wound = this.woundsById.get(woundId);
    if (!wound || wound.state !== "Exposed" || wound.fragmentId !== null || wound.repairDeficit <= 0) return false;
    wound.state = "Redistributing";
    return true;
  }

  cancelRedistribution(woundId: BlobWoundId): boolean {
    const wound = this.woundsById.get(woundId);
    if (!wound || wound.state !== "Redistributing") return false;
    wound.state = "Exposed";
    return true;
  }

  completeRedistribution(
    woundId: BlobWoundId,
    point: BlobVector3,
    normal: BlobVector3,
    now: number,
  ): BlobWoundRecord | null {
    const source = this.woundsById.get(woundId);
    if (!source || source.state !== "Redistributing") return null;
    const weakness = source.repairDeficit;
    const radius = source.radius;
    this.close(source.id);
    const relocated = this.createWound(point, normal, now, source.id);
    relocated.radius = radius;
    relocated.detachedBiomass = weakness;
    relocated.repairDeficit = weakness;
    relocated.cohesionThreshold = this.thresholdForWeakness(weakness);
    relocated.cohesionEnergy = 0;
    return relocated;
  }

  findOpenAt(point: BlobVector3): BlobWoundRecord | undefined {
    let selected: BlobWoundRecord | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const wound of this.woundsById.values()) {
      if (!this.isOpen(wound)) continue;
      const distance = distanceSquared(point, wound.point);
      if (distance <= wound.radius * wound.radius && distance < bestDistance) {
        selected = wound;
        bestDistance = distance;
      }
    }
    return selected;
  }

  advance(now: number): void {
    for (const wound of this.woundsById.values()) {
      if (wound.state === "Breached" && wound.openedAt !== null && now > wound.openedAt + 1e-9) {
        wound.state = "Exposed";
      }
      if (wound.state !== "Stressed" || wound.repairDeficit > 0) continue;
      const decayStart = wound.lastImpactAt + BLOB_V2_COHESION_DECAY_DELAY_SECONDS;
      if (now <= decayStart) continue;
      if (wound.cohesionEnergy <= 0) {
        wound.state = "Closed";
        continue;
      }
      const elapsed = Math.max(0, now - Math.max(decayStart, wound.lastDecayAt));
      wound.cohesionEnergy = Math.max(0, wound.cohesionEnergy - BLOB_V2_COHESION_DECAY_PER_SECOND * elapsed);
      wound.lastDecayAt = now;
      if (wound.cohesionEnergy <= 0) wound.state = "Closed";
    }
    this.pruneClosedHistory();
  }

  snapshot(): readonly BlobWoundSnapshot[] {
    return freezeItems(
      this.records.map((wound) => ({
        id: wound.id,
        point: freezeVector(wound.point),
        normal: freezeVector(wound.normal),
        radius: wound.radius,
        state: wound.state,
        cohesionEnergy: wound.cohesionEnergy,
        cohesionThreshold: wound.cohesionThreshold,
        repairDeficit: wound.repairDeficit,
        detachedBiomass: wound.detachedBiomass,
        fragmentId: wound.fragmentId,
        createdAt: wound.createdAt,
        lastImpactAt: wound.lastImpactAt,
        openedAt: wound.openedAt,
        reattachProgress: wound.reattachProgress,
        sourceWoundId: wound.sourceWoundId,
      })),
    ) as readonly BlobWoundSnapshot[];
  }

  transformAll(transform: BlobIslandTransform): void {
    const rotation = normalizedQuaternion(transform.rotation);
    for (const wound of this.woundsById.values()) {
      setVector(wound.point, rigidTransform(wound.point, rotation, transform.translation));
      setVector(wound.normal, rotateVector(wound.normal, rotation));
    }
  }

  private findDamageZone(point: BlobVector3): BlobWoundRecord | undefined {
    let selected: BlobWoundRecord | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const wound of this.woundsById.values()) {
      if (wound.state !== "Stressed") continue;
      const reach = Math.max(this.zoneRadius, wound.radius);
      const distance = distanceSquared(point, wound.point);
      if (distance <= reach * reach && distance < bestDistance) {
        selected = wound;
        bestDistance = distance;
      }
    }
    return selected;
  }

  private createWound(
    point: BlobVector3,
    normal: BlobVector3,
    now: number,
    sourceWoundId: BlobWoundId | null = null,
  ): BlobWoundRecord {
    const wound: BlobWoundRecord = {
      id: this.nextWoundId++,
      point: copyVector(point),
      normal: normalized(normal),
      radius: this.zoneRadius,
      state: "Stressed",
      cohesionEnergy: 0,
      cohesionThreshold: BLOB_V2_COHESION_THRESHOLD,
      repairDeficit: 0,
      detachedBiomass: 0,
      fragmentId: null,
      createdAt: now,
      lastImpactAt: now,
      openedAt: null,
      reattachProgress: 0,
      sourceWoundId,
      lastDecayAt: now,
    };
    this.woundsById.set(wound.id, wound);
    return wound;
  }

  private thresholdForWeakness(deficit: number): number {
    return clamp(BLOB_V2_COHESION_THRESHOLD - deficit * 1.25, 4, BLOB_V2_COHESION_THRESHOLD);
  }

  private pruneClosedHistory(): void {
    const closed = [...this.woundsById.values()]
      .filter((wound) => wound.state === "Closed")
      .sort((a, b) => a.id - b.id);
    const removeCount = closed.length - BlobWoundSystem.MAX_CLOSED_HISTORY;
    for (let index = 0; index < removeCount; index++) {
      const wound = closed[index];
      if (wound) this.woundsById.delete(wound.id);
    }
  }

  private isOpen(wound: BlobWoundRecord): boolean {
    return (
      wound.state === "Breached" ||
      wound.state === "Exposed" ||
      wound.state === "Reattaching" ||
      wound.state === "Redistributing"
    );
  }

  private require(id: BlobWoundId): BlobWoundRecord {
    const wound = this.woundsById.get(id);
    if (!wound) throw new Error(`Unknown blob wound ${id}`);
    return wound;
  }
}
