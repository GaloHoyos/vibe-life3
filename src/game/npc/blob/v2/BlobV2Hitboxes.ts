import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import type { Faction } from "@engine/ai/Faction";
import type { CharacterId } from "@engine/characters/CharacterDefinition";
import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { BlobOrganismController } from "@engine/blob/v2/BlobOrganismController";
import type {
  BlobDamageImpact,
  BlobDamageResult,
  BlobFragmentId,
  BlobIslandId,
  BlobOrganismSnapshot,
  BlobParticleSnapshot,
  BlobVector3,
  BlobWoundSnapshot,
} from "@engine/blob/v2/BlobV2Types";
import type { Damageable, DamageType } from "@shared/types/lifecycle";

const DEFAULT_MAIN_SENSOR_COUNT = 12;
const DEFAULT_FRAGMENT_SENSOR_COUNT = 6;
const DEFAULT_SHELL_RADIUS = 0.72;
const DEFAULT_FRAGMENT_RADIUS = 0.42;
const DEFAULT_CORE_RADIUS_SCALE = 1.2;
const MIN_SENSOR_RADIUS = 0.08;
const EPSILON = 1e-8;

type SensorKind = "shell" | "fragment" | "core";

interface SensorEntry {
  readonly kind: SensorKind;
  readonly slot: number;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly center: Vector3;
  baseRadius: number;
  radius: number;
  enabled: boolean;
  islandId: BlobIslandId | null;
  islandGeneration: number;
  fragmentId: BlobFragmentId | null;
}

export interface BlobV2PhysicsImpactEvent {
  readonly sensorKind: SensorKind;
  readonly sensorIndex: number;
  readonly islandId: BlobIslandId | null;
  readonly fragmentId: BlobFragmentId | null;
  readonly point: Vector3;
  readonly direction: Vector3;
  readonly normal: Vector3;
  readonly impulse: Vector3;
  readonly damage: number;
  readonly damageType: DamageType;
  readonly attackerId?: string;
  readonly result: BlobDamageResult;
}

export interface BlobV2CoreDamageEvent extends BlobV2PhysicsImpactEvent {
  readonly coreDamage: number;
}

export interface BlobV2HitboxesOptions {
  readonly physics: PhysicsWorld;
  readonly ownerId: string;
  readonly controller: BlobOrganismController;
  readonly characterId?: CharacterId;
  readonly faction?: Faction;
  readonly mainSensorCount?: number;
  readonly fragmentSensorCount?: number;
  readonly shellSensorRadius?: number;
  readonly fragmentSensorRadius?: number;
  readonly coreRadiusScale?: number;
  readonly isAlive?: () => boolean;
  readonly onMassImpact?: (event: BlobV2PhysicsImpactEvent) => void;
  readonly onCoreDamage?: (event: BlobV2CoreDamageEvent) => void;
}

/**
 * Physics-only adapter around BlobOrganismController. Sensor callbacks never
 * mutate a generic HP pool: every impact is routed through the V2 damage model.
 */
export class BlobV2Hitboxes {
  private readonly shellEntries: SensorEntry[] = [];
  private readonly fragmentEntries: SensorEntry[] = [];
  private readonly coreEntry: SensorEntry;
  private readonly allEntries: SensorEntry[] = [];
  private readonly canonicalExplosionDamageable: Damageable;
  private readonly candidateMinimumDistances: number[] = [];
  private readonly selectedCandidateIndices: number[] = [];
  private readonly centroid = new Vector3();
  private readonly tmpA = new Vector3();
  private latestSnapshot: BlobOrganismSnapshot;
  private removed = false;

  constructor(private readonly options: BlobV2HitboxesOptions) {
    if (!options.ownerId) {
      throw new Error("BlobV2Hitboxes: ownerId cannot be empty");
    }
    const mainSensorCount = positiveInteger(
      options.mainSensorCount ?? DEFAULT_MAIN_SENSOR_COUNT,
      "mainSensorCount",
    );
    const fragmentSensorCount = positiveInteger(
      options.fragmentSensorCount ?? DEFAULT_FRAGMENT_SENSOR_COUNT,
      "fragmentSensorCount",
    );
    const shellRadius = positive(
      options.shellSensorRadius ?? DEFAULT_SHELL_RADIUS,
      "shellSensorRadius",
    );
    const fragmentRadius = positive(
      options.fragmentSensorRadius ?? DEFAULT_FRAGMENT_RADIUS,
      "fragmentSensorRadius",
    );
    const coreRadiusScale = positive(
      options.coreRadiusScale ?? DEFAULT_CORE_RADIUS_SCALE,
      "coreRadiusScale",
    );

    this.latestSnapshot = options.controller.snapshot();
    this.canonicalExplosionDamageable = this.createExplosionDamageable();
    for (let slot = 0; slot < mainSensorCount; slot++) {
      this.shellEntries.push(
        this.createSensor("shell", slot, shellRadius),
      );
    }
    for (let slot = 0; slot < fragmentSensorCount; slot++) {
      this.fragmentEntries.push(
        this.createSensor("fragment", slot, fragmentRadius),
      );
    }
    this.coreEntry = this.createSensor(
      "core",
      0,
      this.latestSnapshot.core.radius * coreRadiusScale,
    );
    this.allEntries.push(
      ...this.shellEntries,
      ...this.fragmentEntries,
      this.coreEntry,
    );
    this.sync(this.latestSnapshot);
  }

  get activeSensorCount(): number {
    let count = 0;
    for (const entry of this.allEntries) if (entry.enabled) count++;
    return count;
  }

  sync(snapshot: BlobOrganismSnapshot = this.options.controller.snapshot()): void {
    if (this.removed) return;
    if (snapshot.version < this.latestSnapshot.version) return;
    this.latestSnapshot = snapshot;
    const mainIsland = snapshot.islands.find((island) => island.kind === "main");
    if (!mainIsland) {
      this.disableAll();
      return;
    }

    const coreCellIds = new Set(
      snapshot.cells.filter((cell) => cell.isCore).map((cell) => cell.id),
    );
    const mainParticles = snapshot.particles.filter(
      (particle) =>
        particle.islandId === mainIsland.id &&
        !coreCellIds.has(particle.cellId),
    );
    this.syncMainShell(mainParticles, snapshot, mainIsland.id);
    this.syncFragmentSensors(snapshot, mainIsland.id);
    this.syncCore(snapshot);
  }

  remove(): void {
    if (this.removed) return;
    this.removed = true;
    for (const entry of this.allEntries) {
      entry.enabled = false;
      this.options.physics.removeBody(entry.body);
    }
    this.shellEntries.length = 0;
    this.fragmentEntries.length = 0;
    this.allEntries.length = 0;
  }

  dispose(): void {
    this.remove();
  }

  private createSensor(
    kind: SensorKind,
    slot: number,
    radius: number,
  ): SensorEntry {
    const body = this.options.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased(),
    );
    const collider = this.options.physics.world.createCollider(
      RAPIER.ColliderDesc.ball(radius).setSensor(true),
      body,
    );
    const entry: SensorEntry = {
      kind,
      slot,
      body,
      collider,
      center: new Vector3(),
      baseRadius: radius,
      radius,
      enabled: false,
      islandId: null,
      islandGeneration: 0,
      fragmentId: null,
    };
    const damageable = this.createEntryDamageable(entry);
    this.options.physics.registerCollider(collider, {
      id: `${this.options.ownerId}-${kind}-${slot}`,
      ownerId: this.options.ownerId,
      kind: "npc",
      characterId: this.options.characterId ?? "blob",
      faction: this.options.faction ?? "zombies",
      damageable,
      explosionGroupId: this.options.ownerId,
      explosionDamageable: this.canonicalExplosionDamageable,
      // The controller owns the core's 2.5 multiplier. Applying it here would
      // double-multiply hits before they reach BlobCoreSystem.
      bodyPart: {
        name:
          kind === "core"
            ? "blob-core"
            : kind === "fragment"
              ? "blob-fragment"
              : "blob-mass",
        damageMultiplier: 1,
      },
    });
    collider.setEnabled(false);
    return entry;
  }

  private createEntryDamageable(entry: SensorEntry): Damageable {
    return {
      applyDamage: (
        amount,
        direction,
        _partName,
        attackerId,
        point,
        damageType,
      ) => {
        if (!this.isAlive()) return;
        this.routeImpact(
          entry,
          amount,
          direction,
          point,
          damageType ?? "bullet",
          attackerId,
          damageType === "explosive",
        );
      },
      isAlive: () => this.isAlive(),
    };
  }

  private createExplosionDamageable(): Damageable {
    return {
      applyDamage: (
        amount,
        direction,
        partName,
        attackerId,
        point,
        _damageType,
      ) => {
        if (!this.isAlive()) return;
        const entry = this.explosionEntry(partName, point);
        if (!entry) return;
        this.routeImpact(
          entry,
          amount,
          direction,
          point,
          "explosive",
          attackerId,
          true,
        );
      },
      isAlive: () => this.isAlive(),
    };
  }

  private routeImpact(
    entry: SensorEntry,
    amount: number,
    direction: Vector3 | undefined,
    point: Vector3 | undefined,
    damageType: DamageType,
    attackerId: string | undefined,
    explosive: boolean,
  ): void {
    if (!Number.isFinite(amount) || amount < 0 || this.removed) return;
    const snapshot = this.latestSnapshot;
    const physicalPoint = this.tmpA
      .set(
        point?.x ?? entry.center.x,
        point?.y ?? entry.center.y,
        point?.z ?? entry.center.z,
      )
      .clone();
    const targetCenter =
      entry.kind === "fragment" ? entry.center : vectorFrom(snapshot.core.position);
    const inward = normalizedInwardDirection(
      direction,
      physicalPoint,
      targetCenter,
    );

    let routedPoint = physicalPoint;
    let normal = outwardNormal(physicalPoint, targetCenter, inward);
    if (entry.kind === "core") {
      const corridorWound = findCoreCorridorWound(snapshot, inward, physicalPoint);
      if (corridorWound) {
        routedPoint = vectorFrom(corridorWound.point);
        normal = vectorFrom(corridorWound.normal).normalize();
      } else {
        // The aggregated hull can have tiny query gaps. A ray that reaches the
        // protected core still stresses the skin where it entered, never an
        // artificial wound at the center of the organism.
        routedPoint = this.projectCoreHitToSkin(snapshot, inward, physicalPoint);
        normal = inward.clone().multiplyScalar(-1);
      }
    }

    const impulseMagnitude = Math.min(
      explosive ? 12 : 8,
      0.45 + amount * (explosive ? 0.18 : 0.09),
    );
    const impulse = inward.clone().multiplyScalar(impulseMagnitude);
    const impact: BlobDamageImpact = {
      point: routedPoint,
      direction: inward,
      normal,
      impulse,
      damage: amount,
      cohesionEnergy: amount,
      explosive,
      ...(entry.fragmentId !== null
        ? { fragmentId: entry.fragmentId }
        : {}),
    };
    const result = this.options.controller.applyImpact(impact);
    // Reconcile immediately: a subsequent pellet/ray in the same render frame
    // must see the newly opened corridor or the destroyed fragment.
    this.sync(this.options.controller.snapshot());

    const event = createImpactEvent(
      entry,
      physicalPoint,
      inward,
      normal,
      impulse,
      amount,
      damageType,
      attackerId,
      result,
    );
    if (result.coreDamage > 0) {
      this.options.onCoreDamage?.({
        ...event,
        coreDamage: result.coreDamage,
      });
    } else {
      this.options.onMassImpact?.(event);
    }
  }

  private syncMainShell(
    particles: readonly BlobParticleSnapshot[],
    snapshot: BlobOrganismSnapshot,
    mainIslandId: BlobIslandId,
  ): void {
    const ordered = [...particles].sort((a, b) => a.cellId - b.cellId);
    const selected = this.selectHullRepresentatives(
      ordered,
      this.shellEntries.length,
    );
    for (let slot = 0; slot < this.shellEntries.length; slot++) {
      const entry = this.shellEntries[slot];
      const particle = selected[slot];
      entry.islandId = mainIslandId;
      entry.fragmentId = null;
      if (!particle) {
        this.setEnabled(entry, false);
        continue;
      }
      entry.center.set(
        particle.renderPosition.x,
        particle.renderPosition.y,
        particle.renderPosition.z,
      );
      entry.body.setTranslation(entry.center, false);
      const corridor = shellCorridorState(
        entry.center,
        entry.baseRadius,
        snapshot,
      );
      this.setRadius(entry, entry.baseRadius * corridor.radiusScale);
      this.setEnabled(entry, !corridor.disabled);
    }
  }

  private syncFragmentSensors(
    snapshot: BlobOrganismSnapshot,
    mainIslandId: BlobIslandId,
  ): void {
    const fragmentByIsland = new Map(
      snapshot.fragments
        .filter(
          (fragment) =>
            fragment.state !== "Attached" && fragment.state !== "Dead",
        )
        .map((fragment) => [fragment.islandId, fragment] as const),
    );
    const wanted = snapshot.islands
      .filter((island) => island.id !== mainIslandId)
      .sort((a, b) => a.id - b.id)
      .slice(0, this.fragmentEntries.length);
    const wantedKeys = new Set(
      wanted.map((island) => islandKey(island.id, island.generation)),
    );

    for (const entry of this.fragmentEntries) {
      if (
        entry.islandId !== null &&
        !wantedKeys.has(islandKey(entry.islandId, entry.islandGeneration))
      ) {
        this.clearFragmentEntry(entry);
      }
    }

    for (const island of wanted) {
      let entry = this.fragmentEntries.find(
        (candidate) =>
          candidate.islandId === island.id &&
          candidate.islandGeneration === island.generation,
      );
      entry ??= this.fragmentEntries.find(
        (candidate) => candidate.islandId === null,
      );
      if (!entry) break;

      const particles = snapshot.particles.filter(
        (particle) => particle.islandId === island.id,
      );
      if (particles.length === 0) {
        this.clearFragmentEntry(entry);
        continue;
      }
      entry.islandId = island.id;
      entry.islandGeneration = island.generation;
      entry.fragmentId = fragmentByIsland.get(island.id)?.id ?? null;
      computeCentroid(particles, entry.center);
      entry.body.setTranslation(entry.center, false);
      let bound = 0;
      for (const particle of particles) {
        this.tmpA.set(
          particle.renderPosition.x,
          particle.renderPosition.y,
          particle.renderPosition.z,
        );
        bound = Math.max(
          bound,
          this.tmpA.distanceTo(entry.center) + particle.radius,
        );
      }
      entry.baseRadius = Math.min(
        0.9,
        Math.max(
          this.options.fragmentSensorRadius ?? DEFAULT_FRAGMENT_RADIUS,
          bound,
        ),
      );
      this.setRadius(entry, entry.baseRadius);
      this.setEnabled(entry, true);
    }
  }

  private syncCore(snapshot: BlobOrganismSnapshot): void {
    this.coreEntry.center.set(
      snapshot.core.position.x,
      snapshot.core.position.y,
      snapshot.core.position.z,
    );
    this.coreEntry.body.setTranslation(this.coreEntry.center, false);
    this.coreEntry.islandId = snapshot.islands.find(
      (island) => island.kind === "main",
    )?.id ?? null;
    this.coreEntry.fragmentId = null;
    this.coreEntry.baseRadius =
      snapshot.core.radius *
      (this.options.coreRadiusScale ?? DEFAULT_CORE_RADIUS_SCALE);
    this.setRadius(this.coreEntry, this.coreEntry.baseRadius);
    this.setEnabled(this.coreEntry, snapshot.core.state !== "Dead");
  }

  private selectHullRepresentatives(
    candidates: readonly BlobParticleSnapshot[],
    maximum: number,
  ): BlobParticleSnapshot[] {
    this.selectedCandidateIndices.length = 0;
    if (candidates.length === 0 || maximum <= 0) return [];
    computeCentroid(candidates, this.centroid);

    let seed = 0;
    let seedDistance = -Infinity;
    for (let index = 0; index < candidates.length; index++) {
      const distance = vectorDistanceSquared(
        candidates[index].renderPosition,
        this.centroid,
      );
      if (
        distance > seedDistance + EPSILON ||
        (Math.abs(distance - seedDistance) <= EPSILON &&
          candidates[index].cellId < candidates[seed].cellId)
      ) {
        seed = index;
        seedDistance = distance;
      }
    }
    this.selectedCandidateIndices.push(seed);
    this.candidateMinimumDistances.length = candidates.length;
    for (let index = 0; index < candidates.length; index++) {
      this.candidateMinimumDistances[index] =
        index === seed
          ? -1
          : vectorDistanceSquared(
              candidates[index].renderPosition,
              candidates[seed].renderPosition,
            );
    }

    const wanted = Math.min(maximum, candidates.length);
    while (this.selectedCandidateIndices.length < wanted) {
      let best = -1;
      let bestScore = -Infinity;
      for (let index = 0; index < candidates.length; index++) {
        const minimumDistance = this.candidateMinimumDistances[index];
        if (minimumDistance < 0) continue;
        const radial = vectorDistanceSquared(
          candidates[index].renderPosition,
          this.centroid,
        );
        const score = minimumDistance + radial * 0.08;
        if (
          score > bestScore + EPSILON ||
          (Math.abs(score - bestScore) <= EPSILON &&
            (best < 0 || candidates[index].cellId < candidates[best].cellId))
        ) {
          best = index;
          bestScore = score;
        }
      }
      if (best < 0) break;
      this.selectedCandidateIndices.push(best);
      this.candidateMinimumDistances[best] = -1;
      for (let index = 0; index < candidates.length; index++) {
        if (this.candidateMinimumDistances[index] < 0) continue;
        this.candidateMinimumDistances[index] = Math.min(
          this.candidateMinimumDistances[index],
          vectorDistanceSquared(
            candidates[index].renderPosition,
            candidates[best].renderPosition,
          ),
        );
      }
    }
    return this.selectedCandidateIndices.map((index) => candidates[index]);
  }

  private explosionEntry(
    partName: string | undefined,
    point: Vector3 | undefined,
  ): SensorEntry | null {
    const candidates =
      partName === "blob-core"
        ? [this.coreEntry]
        : partName === "blob-fragment"
          ? this.fragmentEntries
          : this.shellEntries;
    let best: SensorEntry | null = null;
    let bestDistance = Infinity;
    for (const entry of candidates) {
      if (!entry.enabled) continue;
      const distance = point
        ? entry.center.distanceToSquared(point)
        : entry.slot;
      if (distance < bestDistance) {
        best = entry;
        bestDistance = distance;
      }
    }
    return best ?? this.shellEntries.find((entry) => entry.enabled) ?? null;
  }

  private projectCoreHitToSkin(
    snapshot: BlobOrganismSnapshot,
    inward: Vector3,
    physicalPoint: Vector3,
  ): Vector3 {
    const backwardX = -inward.x;
    const backwardY = -inward.y;
    const backwardZ = -inward.z;
    let distance = snapshot.core.radius;

    for (const entry of this.shellEntries) {
      if (!entry.enabled) continue;
      distance = Math.max(
        distance,
        raySphereExitDistance(
          physicalPoint,
          backwardX,
          backwardY,
          backwardZ,
          entry.center,
          entry.radius,
        ),
      );
    }

    if (distance <= snapshot.core.radius + EPSILON) {
      const mainId = snapshot.islands.find((island) => island.kind === "main")?.id;
      for (const particle of snapshot.particles) {
        if (particle.islandId !== mainId) continue;
        distance = Math.max(
          distance,
          raySphereExitDistance(
            physicalPoint,
            backwardX,
            backwardY,
            backwardZ,
            particle.renderPosition,
            particle.radius,
          ),
        );
      }
    }
    return new Vector3(
      physicalPoint.x + backwardX * distance,
      physicalPoint.y + backwardY * distance,
      physicalPoint.z + backwardZ * distance,
    );
  }

  private clearFragmentEntry(entry: SensorEntry): void {
    entry.islandId = null;
    entry.islandGeneration = 0;
    entry.fragmentId = null;
    this.setEnabled(entry, false);
  }

  private setEnabled(entry: SensorEntry, enabled: boolean): void {
    if (entry.enabled === enabled) return;
    entry.enabled = enabled;
    entry.collider.setEnabled(enabled);
  }

  private setRadius(entry: SensorEntry, radius: number): void {
    const safeRadius = Math.max(MIN_SENSOR_RADIUS, radius);
    if (Math.abs(safeRadius - entry.radius) <= 1e-5) return;
    entry.radius = safeRadius;
    entry.collider.setRadius(safeRadius);
  }

  private disableAll(): void {
    for (const entry of this.allEntries) this.setEnabled(entry, false);
  }

  private isAlive(): boolean {
    return (
      !this.removed &&
      (this.options.isAlive?.() ??
        this.latestSnapshot.core.state !== "Dead")
    );
  }
}

function shellCorridorState(
  center: Vector3,
  sensorRadius: number,
  snapshot: BlobOrganismSnapshot,
): { disabled: boolean; radiusScale: number } {
  let openness = 0;
  let intersectsOpenCorridor = false;
  for (const wound of snapshot.wounds) {
    if (!isOpenWound(wound)) continue;
    const inwardX = snapshot.core.position.x - wound.point.x;
    const inwardY = snapshot.core.position.y - wound.point.y;
    const inwardZ = snapshot.core.position.z - wound.point.z;
    const coreDistance = Math.sqrt(
      inwardX * inwardX + inwardY * inwardY + inwardZ * inwardZ,
    );
    if (coreDistance <= EPSILON) continue;
    const inverseDistance = 1 / coreDistance;
    const directionX = inwardX * inverseDistance;
    const directionY = inwardY * inverseDistance;
    const directionZ = inwardZ * inverseDistance;
    const relativeX = center.x - wound.point.x;
    const relativeY = center.y - wound.point.y;
    const relativeZ = center.z - wound.point.z;
    const along =
      relativeX * directionX +
      relativeY * directionY +
      relativeZ * directionZ;
    if (
      along + sensorRadius < 0 ||
      along - sensorRadius > coreDistance - snapshot.core.radius
    ) {
      continue;
    }
    const perpendicularSq = Math.max(
      0,
      relativeX * relativeX +
        relativeY * relativeY +
        relativeZ * relativeZ -
        along * along,
    );
    if (perpendicularSq > sensorRadius * sensorRadius) continue;
    intersectsOpenCorridor = true;
    const woundOpenness =
      wound.state === "Reattaching"
        ? Math.max(0, 1 - wound.reattachProgress)
        : 1;
    openness = Math.max(openness, woundOpenness);
  }
  return {
    // While the model still considers the wound open, an aggregate shell
    // sphere must not become a false blocker (or route a physical shell hit as
    // core damage). Reattachment closes atomically in the authoritative model.
    disabled: intersectsOpenCorridor,
    radiusScale: Math.max(0.15, 1 - openness),
  };
}

function findCoreCorridorWound(
  snapshot: BlobOrganismSnapshot,
  inward: Vector3,
  physicalPoint: Vector3,
): BlobWoundSnapshot | null {
  let best: BlobWoundSnapshot | null = null;
  let bestDistance = Infinity;
  for (const wound of snapshot.wounds) {
    if (!isOpenWound(wound)) continue;
    if (
      inward.x * wound.normal.x +
        inward.y * wound.normal.y +
        inward.z * wound.normal.z >=
      -1e-5
    ) {
      continue;
    }
    // The actual projectile line must pass through the geometric aperture.
    // Direction-only matching could otherwise route an oblique ray that hit a
    // different side of the core through an unrelated open wound.
    const woundToImpactX = physicalPoint.x - wound.point.x;
    const woundToImpactY = physicalPoint.y - wound.point.y;
    const woundToImpactZ = physicalPoint.z - wound.point.z;
    const impactAlong =
      woundToImpactX * inward.x +
      woundToImpactY * inward.y +
      woundToImpactZ * inward.z;
    if (impactAlong <= 0) continue;
    const impactPerpendicularSq = Math.max(
      0,
      woundToImpactX * woundToImpactX +
        woundToImpactY * woundToImpactY +
        woundToImpactZ * woundToImpactZ -
        impactAlong * impactAlong,
    );
    if (impactPerpendicularSq > wound.radius * wound.radius) continue;
    const toCoreX = snapshot.core.position.x - wound.point.x;
    const toCoreY = snapshot.core.position.y - wound.point.y;
    const toCoreZ = snapshot.core.position.z - wound.point.z;
    const along =
      toCoreX * inward.x +
      toCoreY * inward.y +
      toCoreZ * inward.z;
    if (along <= 0) continue;
    const perpendicularSq = Math.max(
      0,
      toCoreX * toCoreX +
        toCoreY * toCoreY +
        toCoreZ * toCoreZ -
        along * along,
    );
    if (perpendicularSq > snapshot.core.radius * snapshot.core.radius) continue;
    if (perpendicularSq < bestDistance) {
      best = wound;
      bestDistance = perpendicularSq;
    }
  }
  return best;
}

function normalizedInwardDirection(
  supplied: Vector3 | undefined,
  point: Vector3,
  target: Vector3,
): Vector3 {
  const direction = supplied?.clone() ?? target.clone().sub(point);
  if (direction.lengthSq() <= EPSILON) direction.set(0, 0, 1);
  direction.normalize();
  const toTarget = target.clone().sub(point);
  if (toTarget.lengthSq() > EPSILON && direction.dot(toTarget) < 0) {
    direction.multiplyScalar(-1);
  }
  return direction;
}

function outwardNormal(
  point: Vector3,
  target: Vector3,
  inward: Vector3,
): Vector3 {
  const normal = point.clone().sub(target);
  return normal.lengthSq() > EPSILON
    ? normal.normalize()
    : inward.clone().multiplyScalar(-1);
}

function createImpactEvent(
  entry: SensorEntry,
  point: Vector3,
  direction: Vector3,
  normal: Vector3,
  impulse: Vector3,
  damage: number,
  damageType: DamageType,
  attackerId: string | undefined,
  result: BlobDamageResult,
): BlobV2PhysicsImpactEvent {
  return {
    sensorKind: entry.kind,
    sensorIndex: entry.slot,
    islandId: entry.islandId,
    fragmentId: entry.fragmentId,
    point: point.clone(),
    direction: direction.clone(),
    normal: normal.clone(),
    impulse: impulse.clone(),
    damage,
    damageType,
    ...(attackerId ? { attackerId } : {}),
    result,
  };
}

function computeCentroid(
  particles: readonly BlobParticleSnapshot[],
  target: Vector3,
): Vector3 {
  target.set(0, 0, 0);
  if (particles.length === 0) return target;
  for (const particle of particles) {
    target.x += particle.renderPosition.x;
    target.y += particle.renderPosition.y;
    target.z += particle.renderPosition.z;
  }
  return target.multiplyScalar(1 / particles.length);
}

function vectorDistanceSquared(a: BlobVector3, b: BlobVector3): number {
  const x = a.x - b.x;
  const y = a.y - b.y;
  const z = a.z - b.z;
  return x * x + y * y + z * z;
}

function raySphereExitDistance(
  origin: BlobVector3,
  directionX: number,
  directionY: number,
  directionZ: number,
  center: BlobVector3,
  radius: number,
): number {
  const relativeX = origin.x - center.x;
  const relativeY = origin.y - center.y;
  const relativeZ = origin.z - center.z;
  const projected =
    relativeX * directionX +
    relativeY * directionY +
    relativeZ * directionZ;
  const distanceSq =
    relativeX * relativeX +
    relativeY * relativeY +
    relativeZ * relativeZ;
  const discriminant = projected * projected - (distanceSq - radius * radius);
  if (discriminant < 0) return 0;
  return Math.max(0, -projected + Math.sqrt(discriminant));
}

function vectorFrom(value: BlobVector3): Vector3 {
  return new Vector3(value.x, value.y, value.z);
}

function islandKey(id: BlobIslandId, generation: number): string {
  return `${id}:${generation}`;
}

function isOpenWound(wound: BlobWoundSnapshot): boolean {
  return (
    wound.state === "Breached" ||
    wound.state === "Exposed" ||
    wound.state === "Reattaching" ||
    wound.state === "Redistributing"
  );
}

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`BlobV2Hitboxes: ${name} must be finite and > 0`);
  }
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`BlobV2Hitboxes: ${name} must be a positive integer`);
  }
  return value;
}
