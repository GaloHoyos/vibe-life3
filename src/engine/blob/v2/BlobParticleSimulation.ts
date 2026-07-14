import { Quaternion, Vector3 } from "three";
import { BlobSpatialHash, type SpatialHashItem } from "@engine/blob/BlobSpatialHash";
import {
  freezeItems,
  freezeVector,
  type BlobCellId,
  type BlobIslandId,
  type BlobIslandTransform,
  type BlobParticleSnapshot,
  type BlobStepInput,
  type BlobVector3,
} from "@engine/blob/v2/BlobV2Types";
import { clamp } from "@engine/blob/v2/BlobMath";
import type { BlobFragmentRecord } from "@engine/blob/v2/BlobFragmentSystem";
import type { BlobTopology } from "@engine/blob/v2/BlobTopology";

interface MutableBlobV2Particle extends SpatialHashItem {
  readonly cellId: BlobCellId;
  readonly index: number;
  readonly position: Vector3;
  readonly previousPosition: Vector3;
  readonly renderPosition: Vector3;
  readonly velocity: Vector3;
  readonly contactNormal: Vector3;
  contactAmount: number;
  islandId: number;
  membership: "attached" | "combat-fragment";
  active: boolean;
}

const TMP_A = new Vector3();
const TMP_B = new Vector3();

export class BlobParticleSimulation {
  readonly particleRadius: number;
  lastCandidateChecks = 0;

  private readonly particlesByCellId = new Map<BlobCellId, MutableBlobV2Particle>();
  private readonly particles: MutableBlobV2Particle[] = [];
  private readonly spatialHash: BlobSpatialHash<MutableBlobV2Particle>;

  constructor(
    private readonly topology: BlobTopology,
    private readonly seed: number,
    private readonly spawnCenter: BlobVector3,
    particleRadius = 0.16,
  ) {
    if (!(particleRadius > 0) || !Number.isFinite(particleRadius)) {
      throw new RangeError("Blob V2 particle radius must be finite and positive");
    }
    this.particleRadius = particleRadius;
    this.spatialHash = new BlobSpatialHash(particleRadius * 2.8);
    this.syncTopology([]);
    this.updateInterpolation(0);
  }

  fixedStep(
    fixedDelta: number,
    input: BlobStepInput,
    fragments: readonly BlobFragmentRecord[],
    allowParticleTargets = true,
  ): void {
    this.syncTopology(fragments);
    const desiredVelocity = input.desiredVelocity ?? { x: 0, y: 0, z: 0 };
    const gravity = Math.max(0, input.gravity ?? 0);
    const fragmentByIsland = new Map(
      fragments
        .filter((fragment) => fragment.state !== "Attached" && fragment.state !== "Dead")
        .map((fragment) => [fragment.islandId, fragment] as const),
    );

    for (const particle of this.particles) {
      particle.previousPosition.copy(particle.position);
      particle.contactNormal.set(0, 1, 0);
      particle.contactAmount = 0;
      if (particle.membership === "attached") {
        const target = allowParticleTargets ? input.particleTargets?.[particle.cellId] : undefined;
        if (target) {
          const strength = clamp(input.particleTargetStrength ?? 10, 0, 30);
          TMP_A.set(
            (target.x - particle.position.x) * strength,
            (target.y - particle.position.y) * strength,
            (target.z - particle.position.z) * strength,
          );
        } else {
          TMP_A.set(desiredVelocity.x, desiredVelocity.y, desiredVelocity.z);
        }
        particle.velocity.lerp(TMP_A, 0.22);
      } else {
        const fragment = fragmentByIsland.get(particle.islandId);
        if (fragment) {
          const offset = this.spawnOffset(particle.cellId, this.particleRadius * 2.2);
          TMP_A.set(
            fragment.position.x + offset.x,
            fragment.position.y + offset.y,
            fragment.position.z + offset.z,
          );
          TMP_B.subVectors(TMP_A, particle.position).multiplyScalar(7.5);
          TMP_A.set(fragment.velocity.x, fragment.velocity.y, fragment.velocity.z).add(TMP_B);
          particle.velocity.lerp(TMP_A, 0.35);
        }
      }
      particle.velocity.y -= gravity * fixedDelta;
      this.clampVelocity(particle.velocity, 18);
      particle.position.addScaledVector(particle.velocity, fixedDelta);
    }

    this.solveLocalFluidConstraints();
    this.resolveContacts(input);
    for (const particle of this.particles) {
      particle.velocity.subVectors(particle.position, particle.previousPosition).multiplyScalar(1 / fixedDelta);
      this.clampVelocity(particle.velocity, 18);
    }
  }

  updateInterpolation(alpha: number): void {
    const t = clamp(alpha, 0, 1);
    for (const particle of this.particles) {
      particle.renderPosition.lerpVectors(particle.previousPosition, particle.position, t);
    }
  }

  corePosition(): BlobVector3 {
    const core = this.particlesByCellId.get(this.topology.coreCellId);
    if (!core) return this.spawnCenter;
    return core.position;
  }

  synchronizeTopology(fragments: readonly BlobFragmentRecord[]): void {
    this.syncTopology(fragments);
    this.updateInterpolation(0);
  }

  /** Restores the constructor distribution for a fresh deterministic lab run. */
  resetForEvidence(center: BlobVector3): void {
    if (this.topology.fragmentBiomass !== 0) {
      throw new Error("Blob particle evidence reset requires fully attached biomass");
    }
    this.syncTopology([]);
    const spawnRadius = this.spawnRadiusForCount(this.particles.length);
    const coreOffset = this.spawnOffset(this.topology.coreCellId, spawnRadius);
    const anchor = TMP_A.set(
      center.x + coreOffset.x,
      center.y + coreOffset.y,
      center.z + coreOffset.z,
    );
    for (const particle of this.particles) {
      if (particle.cellId === this.topology.coreCellId) {
        particle.position.copy(anchor);
      } else {
        const offset = this.spawnOffset(particle.cellId, spawnRadius);
        particle.position.set(
          anchor.x + offset.x,
          anchor.y + offset.y,
          anchor.z + offset.z,
        );
      }
      particle.previousPosition.copy(particle.position);
      particle.renderPosition.copy(particle.position);
      particle.velocity.set(0, 0, 0);
      particle.contactNormal.set(0, 1, 0);
      particle.contactAmount = 0;
    }
    this.lastCandidateChecks = 0;
    this.updateInterpolation(0);
  }

  transformIsland(islandId: BlobIslandId, transform: BlobIslandTransform): boolean {
    const rotationLengthSq =
      transform.rotation.x * transform.rotation.x +
      transform.rotation.y * transform.rotation.y +
      transform.rotation.z * transform.rotation.z +
      transform.rotation.w * transform.rotation.w;
    if (!Number.isFinite(rotationLengthSq) || rotationLengthSq <= 1e-12) {
      throw new RangeError("Blob island rotation must be a finite, non-zero quaternion");
    }
    const inverseLength = 1 / Math.sqrt(rotationLengthSq);
    const rotation = {
      x: transform.rotation.x * inverseLength,
      y: transform.rotation.y * inverseLength,
      z: transform.rotation.z * inverseLength,
      w: transform.rotation.w * inverseLength,
    };
    const quaternion = new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
    let transformed = false;
    for (const particle of this.particles) {
      if (particle.islandId !== islandId) continue;
      // Keep all interpolation endpoints in the same frame so portal transit
      // cannot draw a one-frame streak across worlds.
      particle.position.applyQuaternion(quaternion).add(
        TMP_A.set(transform.translation.x, transform.translation.y, transform.translation.z),
      );
      particle.previousPosition.applyQuaternion(quaternion).add(TMP_A);
      particle.renderPosition.applyQuaternion(quaternion).add(TMP_A);
      particle.velocity.applyQuaternion(quaternion);
      transformed = true;
    }
    return transformed;
  }

  setIslandVelocity(islandId: BlobIslandId, velocity: BlobVector3): boolean {
    let updated = false;
    for (const particle of this.particles) {
      if (particle.islandId !== islandId) continue;
      particle.velocity.set(velocity.x, velocity.y, velocity.z);
      updated = true;
    }
    return updated;
  }

  snapshot(): readonly BlobParticleSnapshot[] {
    return freezeItems(
      this.particles.map((particle) => ({
        cellId: particle.cellId,
        islandId: particle.islandId,
        position: freezeVector(particle.position),
        previousPosition: freezeVector(particle.previousPosition),
        renderPosition: freezeVector(particle.renderPosition),
        velocity: freezeVector(particle.velocity),
        radius: this.particleRadius,
        contactNormal: freezeVector(particle.contactNormal),
        contactAmount: particle.contactAmount,
      })),
    ) as readonly BlobParticleSnapshot[];
  }

  private syncTopology(fragments: readonly BlobFragmentRecord[]): void {
    const cells = this.topology.cells();
    const liveIds = new Set(cells.map((cell) => cell.id));
    for (const [id] of this.particlesByCellId) {
      if (!liveIds.has(id)) this.particlesByCellId.delete(id);
    }
    const fragmentByIsland = new Map(fragments.map((fragment) => [fragment.islandId, fragment] as const));
    for (const cell of cells) {
      let particle = this.particlesByCellId.get(cell.id);
      if (!particle) {
        const center = fragmentByIsland.get(cell.islandId)?.position ?? this.corePosition();
        const offset = this.spawnOffset(cell.id, this.spawnRadiusForCount(cells.length));
        const position = new Vector3(center.x + offset.x, center.y + offset.y, center.z + offset.z);
        particle = {
          cellId: cell.id,
          index: cell.id,
          position,
          previousPosition: position.clone(),
          renderPosition: position.clone(),
          velocity: new Vector3(),
          contactNormal: new Vector3(0, 1, 0),
          contactAmount: 0,
          islandId: cell.islandId,
          membership: cell.membership,
          active: true,
        };
        this.particlesByCellId.set(cell.id, particle);
      } else if (particle.islandId !== cell.islandId && cell.membership === "combat-fragment") {
        const fragment = fragmentByIsland.get(cell.islandId);
        if (fragment) {
          const offset = this.spawnOffset(cell.id, this.particleRadius * 2.2);
          particle.position.set(
            fragment.position.x + offset.x,
            fragment.position.y + offset.y,
            fragment.position.z + offset.z,
          );
          particle.previousPosition.copy(particle.position);
          particle.renderPosition.copy(particle.position);
          particle.velocity.set(fragment.velocity.x, fragment.velocity.y, fragment.velocity.z);
        }
      }
      particle.islandId = cell.islandId;
      particle.membership = cell.membership;
    }
    this.particles.length = 0;
    this.particles.push(...[...this.particlesByCellId.values()].sort((a, b) => a.cellId - b.cellId));
  }

  private solveLocalFluidConstraints(): void {
    const separation = this.particleRadius * 1.55;
    const cohesionReach = this.particleRadius * 2.75;
    this.spatialHash.rebuild(this.particles);
    this.spatialHash.forEachPair(cohesionReach, (a, b, distanceSq) => {
      if (a.islandId !== b.islandId || distanceSq <= 1e-12) return;
      const distance = Math.sqrt(distanceSq);
      TMP_A.subVectors(b.position, a.position).multiplyScalar(1 / distance);
      if (distance < separation) {
        const correction = (separation - distance) * 0.42;
        a.position.addScaledVector(TMP_A, -correction);
        b.position.addScaledVector(TMP_A, correction);
      } else {
        const normalizedDistance = (distance - separation) / (cohesionReach - separation);
        const correction = Math.sin(Math.PI * normalizedDistance) * this.particleRadius * 0.012;
        a.position.addScaledVector(TMP_A, correction);
        b.position.addScaledVector(TMP_A, -correction);
      }
      // XSPH-like local viscosity keeps each island gel-like without making
      // velocity depend on iteration allocations.
      TMP_B.subVectors(b.velocity, a.velocity).multiplyScalar(0.018);
      a.velocity.add(TMP_B);
      b.velocity.addScaledVector(TMP_B, -1);
    });
    this.lastCandidateChecks = this.spatialHash.lastCandidateChecks;
  }

  private resolveContacts(input: BlobStepInput): void {
    const resolver = input.contactResolver;
    if (!resolver) return;
    for (const particle of this.particles) {
      const resolved = resolver(
        particle.cellId,
        particle.previousPosition,
        particle.position,
        this.particleRadius,
      );
      if (!resolved) continue;
      const desiredX = particle.position.x;
      const desiredY = particle.position.y;
      const desiredZ = particle.position.z;
      if ("position" in resolved) {
        particle.position.set(resolved.position.x, resolved.position.y, resolved.position.z);
        if (resolved.velocity) particle.velocity.set(resolved.velocity.x, resolved.velocity.y, resolved.velocity.z);
        this.recordContact(
          particle,
          desiredX,
          desiredY,
          desiredZ,
          resolved.normal,
          resolved.grounded === true,
        );
      } else {
        particle.position.set(resolved.x, resolved.y, resolved.z);
        this.recordContact(particle, desiredX, desiredY, desiredZ);
      }
    }
  }

  private recordContact(
    particle: MutableBlobV2Particle,
    desiredX: number,
    desiredY: number,
    desiredZ: number,
    suppliedNormal?: BlobVector3,
    grounded = false,
  ): void {
    const dx = particle.position.x - desiredX;
    const dy = particle.position.y - desiredY;
    const dz = particle.position.z - desiredZ;
    const correction = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (correction <= 1e-8 && !grounded && !suppliedNormal) return;
    particle.contactAmount = clamp(
      Math.max(grounded ? 0.35 : 0, correction / (this.particleRadius * 0.75)),
      0,
      1,
    );
    if (suppliedNormal) {
      particle.contactNormal.set(
        suppliedNormal.x,
        suppliedNormal.y,
        suppliedNormal.z,
      );
    } else if (correction > 1e-8) {
      particle.contactNormal.set(dx, dy, dz);
    } else {
      particle.contactNormal.set(0, 1, 0);
    }
    if (particle.contactNormal.lengthSq() <= 1e-10) {
      particle.contactNormal.set(0, 1, 0);
    } else {
      particle.contactNormal.normalize();
    }
  }

  private spawnRadiusForCount(count: number): number {
    return this.particleRadius * Math.cbrt(Math.max(1, count)) * 1.42;
  }

  private spawnOffset(cellId: number, radius: number): Vector3 {
    if (cellId === this.topology.coreCellId) return new Vector3();
    const u = this.random(cellId, 0);
    const v = this.random(cellId, 1);
    const w = this.random(cellId, 2);
    const angle = Math.PI * 2 * u;
    const diskRadius = radius * Math.sqrt(w);
    const height = radius * (0.22 * (1 - w) + (v - 0.5) * 0.18);
    return new Vector3(Math.cos(angle) * diskRadius, height, Math.sin(angle) * diskRadius);
  }

  private random(index: number, channel: number): number {
    let value = (index * 0x9e3779b1 + channel * 0x85ebca6b + this.seed) >>> 0;
    value ^= value >>> 16;
    value = Math.imul(value, 0x7feb352d);
    value ^= value >>> 15;
    value = Math.imul(value, 0x846ca68b);
    value ^= value >>> 16;
    return (value >>> 0) / 0x1_0000_0000;
  }

  private clampVelocity(velocity: Vector3, maximum: number): void {
    const lengthSq = velocity.lengthSq();
    if (!Number.isFinite(lengthSq)) {
      velocity.set(0, 0, 0);
    } else if (lengthSq > maximum * maximum) {
      velocity.setLength(maximum);
    }
  }
}
