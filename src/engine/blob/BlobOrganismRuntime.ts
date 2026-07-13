import { Quaternion, Vector3 } from "three";
import { BlobSpatialHash } from "@engine/blob/BlobSpatialHash";
import {
  BlobParticleRole,
  type BlobComponent,
  type BlobConstraint,
  type BlobControlEvent,
  type BlobOrganismOptions,
  type BlobParticle,
  type BlobParticleMotionResolver,
  type BlobPoseDefinition,
  type BlobPoseKind,
  type BlobStepInput,
  type BlobStepResult,
  type NpcTeleportTransform,
} from "@engine/blob/BlobTypes";

export const BLOB_INITIAL_PARTICLE_COUNT = 192;
export const BLOB_MAX_PARTICLE_COUNT = 250;
export const BLOB_FIXED_STEP_SECONDS = 1 / 30;
export const BLOB_MAX_RECOVERY_STEPS = 2;

export const BLOB_BASE_ROLE_COUNTS: Readonly<Record<BlobParticleRole, number>> = Object.freeze({
  [BlobParticleRole.Brain]: 1,
  [BlobParticleRole.Structural]: 24,
  [BlobParticleRole.Support]: 40,
  [BlobParticleRole.TendonEnd]: 16,
  [BlobParticleRole.Flesh]: 111,
});

const STRUCTURAL_FIRST = 1;
const STRUCTURAL_LAST = 24;
const SUPPORT_FIRST = 25;
const SUPPORT_LAST = 64;
const TENDON_FIRST = 65;
const TENDON_LAST = 80;
const FLESH_FIRST = 81;
const MAX_COMPONENTS = 6;
const DEFAULT_PARTICLE_RADIUS = 0.18;
const DEFAULT_BODY_RADIUS = 1.15;
const DEFAULT_SEPARATION = 0.29;
const DEFAULT_LOCOMOTION_SPEED = 3.6;
const DEFAULT_POSE_SECONDS = 0.8;
const EPSILON = 1e-8;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const CONSTRAINT_ITERATIONS = 3;
const RECONNECT_PER_SECOND = 1.75;
const EXPOSURE_DECAY_PER_SECOND = 0.045;
const MAX_CONSTRAINT_CORRECTION = 0.075;
const MAX_PARTICLE_SPEED = 10;
const GEL_COHESION_RANGE_SCALE = 1.75;
const GEL_COHESION_PER_PAIR = 0.0018;
const GEL_VISCOSITY = 0.035;
const STRUCTURE_TETHER_DISTANCE = 0.52;
const STRUCTURE_TETHER_RESPONSE = 0.055;
const IMPACT_RELAX_SECONDS = 0.38;
const MERGE_APPROACH_SPEED = 2.4;
const MERGE_ACCELERATION = 9;
const MERGE_ATTACH_DISTANCE = 0.82;
const MERGE_SHAPE_SPEED = 2.8;
const MERGE_SHAPE_RESPONSE = 5;
const MIN_RECONNECT_DISTANCE = 0.72;
const RECONNECT_REST_SCALE = 1.75;
const SPLIT_LAUNCH_SECONDS = 0.9;
const SPLIT_AUTO_MERGE_SECONDS = 3.5;

interface PoseTransition {
  definition: BlobPoseDefinition | null;
  reset: boolean;
  elapsed: number;
  duration: number;
  start: Vector3[];
  target: Vector3[];
}

interface MutableBlobParticle extends BlobParticle {
  role: BlobParticleRole;
}

const TMP_A = new Vector3();
const TMP_B = new Vector3();
const TMP_C = new Vector3();
const TMP_QUATERNION = new Quaternion();

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function smoothStep(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function roleForIndex(index: number): BlobParticleRole {
  if (index === 0) return BlobParticleRole.Brain;
  if (index <= STRUCTURAL_LAST) return BlobParticleRole.Structural;
  if (index <= SUPPORT_LAST) return BlobParticleRole.Support;
  if (index <= TENDON_LAST) return BlobParticleRole.TendonEnd;
  return BlobParticleRole.Flesh;
}

function radiusForRole(role: BlobParticleRole, base: number): number {
  switch (role) {
    case BlobParticleRole.Brain:
      return base * 1.75;
    case BlobParticleRole.Structural:
      return base * 0.9;
    case BlobParticleRole.TendonEnd:
      return base * 0.88;
    case BlobParticleRole.Support:
      return base * 0.94;
    case BlobParticleRole.Flesh:
      return base * 1.05;
  }
}

function indexRandom(index: number, salt: number, seed: number): number {
  let value = (index + 1) * 0x9e3779b1 + salt * 0x85ebca6b + seed;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

/**
 * Shared, deterministic simulation state for the compound Blob organism.
 * Rendering, motors, combat and scripting consume this object rather than
 * owning independent particle state.
 */
export class BlobOrganismRuntime {
  readonly center = new Vector3();
  readonly velocity = new Vector3();
  readonly particles: readonly BlobParticle[];
  readonly constraints: readonly BlobConstraint[];
  readonly components: readonly BlobComponent[];
  readonly maxParticleCount: number;
  readonly fixedStepSeconds = BLOB_FIXED_STEP_SECONDS;

  private readonly mutableParticles: MutableBlobParticle[];
  private readonly mutableConstraints: BlobConstraint[];
  private readonly mutableComponents: BlobComponent[];
  private readonly normalOffsets: Vector3[];
  private readonly spatialHash: BlobSpatialHash<MutableBlobParticle>;
  private readonly bodyRadius: number;
  private readonly separationDistance: number;
  private readonly locomotionSpeed: number;
  private readonly motionResolver: BlobParticleMotionResolver | undefined;
  private accumulator = 0;
  private simulationTime = 0;
  private activeCount: number;
  private exposureOpening = 0;
  private poseTransition: PoseTransition | null = null;
  private heldPose: BlobPoseDefinition | null = null;
  private heldPoseTargets: Vector3[] | null = null;
  private merging = false;
  private emittedMergeEvent = false;
  private splitLaunchUntil = -Infinity;
  private splitAutoMergeAt = Infinity;
  private readonly splitVelocities = Array.from(
    { length: MAX_COMPONENTS },
    () => new Vector3(),
  );
  private readonly events: BlobControlEvent[] = [];
  /** Per-particle grace period during which locomotion cannot erase an impact. */
  private readonly disturbedUntil: Float32Array;
  private shapeRelaxUntil = -Infinity;

  totalFixedSteps = 0;
  lastStepCount = 0;
  lastDroppedTime = 0;
  lastSeparationCandidateChecks = 0;

  constructor(options: BlobOrganismOptions = {}) {
    const requestedCapacity = Math.round(
      finiteOr(options.maxParticleCount, BLOB_MAX_PARTICLE_COUNT),
    );
    this.maxParticleCount = clamp(
      requestedCapacity,
      BLOB_INITIAL_PARTICLE_COUNT,
      BLOB_MAX_PARTICLE_COUNT,
    );
    this.activeCount = clamp(
      Math.round(finiteOr(options.initialParticleCount, BLOB_INITIAL_PARTICLE_COUNT)),
      BLOB_INITIAL_PARTICLE_COUNT,
      this.maxParticleCount,
    );
    const baseRadius = Math.max(0.04, finiteOr(options.particleRadius, DEFAULT_PARTICLE_RADIUS));
    this.bodyRadius = Math.max(baseRadius * 3, finiteOr(options.bodyRadius, DEFAULT_BODY_RADIUS));
    this.separationDistance = Math.max(
      baseRadius * 1.1,
      finiteOr(options.separationDistance, DEFAULT_SEPARATION),
    );
    this.locomotionSpeed = Math.max(0, finiteOr(options.locomotionSpeed, DEFAULT_LOCOMOTION_SPEED));
    this.motionResolver = options.motionResolver;
    const seed = Math.round(finiteOr(options.seed, 0x0b10b));
    if (options.center) this.center.copy(options.center);

    this.mutableParticles = [];
    this.disturbedUntil = new Float32Array(this.maxParticleCount);
    this.normalOffsets = [];
    for (let index = 0; index < this.maxParticleCount; index++) {
      const role = roleForIndex(index);
      const offset = this.makeNormalOffset(index, role, seed);
      const position = this.center.clone().add(offset);
      const active = index < this.activeCount;
      this.normalOffsets.push(offset);
      this.mutableParticles.push({
        index,
        role,
        position,
        previousPosition: position.clone(),
        renderPosition: position.clone(),
        velocity: new Vector3(),
        radius: radiusForRole(role, baseRadius),
        componentId: 0,
        active,
        scale: active ? 1 : 0,
        frozen: false,
      });
    }
    this.particles = this.mutableParticles;

    this.mutableConstraints = this.createConstraints();
    this.constraints = this.mutableConstraints;
    this.mutableComponents = [];
    for (let id = 0; id < MAX_COMPONENTS; id++) {
      this.mutableComponents.push({
        id,
        particleIndices: [],
        center: this.center.clone(),
        velocity: new Vector3(),
        active: id === 0,
      });
    }
    this.components = this.mutableComponents;
    this.spatialHash = new BlobSpatialHash<MutableBlobParticle>(
      this.separationDistance * GEL_COHESION_RANGE_SCALE,
    );
    this.refreshComponents();
    this.syncCenterAndVelocity();
  }

  get particleCount(): number {
    return this.activeCount;
  }

  get activeParticles(): readonly BlobParticle[] {
    return this.mutableParticles.slice(0, this.activeCount);
  }

  get componentCount(): number {
    let count = 0;
    for (const component of this.mutableComponents) if (component.active) count++;
    return count;
  }

  get currentPose(): BlobPoseDefinition | null {
    return this.heldPose ?? this.poseTransition?.definition ?? null;
  }

  get poseProgress(): number {
    if (!this.poseTransition) return this.heldPose ? 1 : 0;
    return clamp(this.poseTransition.elapsed / this.poseTransition.duration, 0, 1);
  }

  get isLocomotionPaused(): boolean {
    return this.poseTransition !== null || this.heldPose !== null;
  }

  get isMerging(): boolean {
    return this.merging;
  }

  /** Fixed-step clock used by renderers to hide temporarily severed tendons. */
  get simulationTimeSeconds(): number {
    return this.simulationTime;
  }

  get mergeProgress(): number {
    let total = 0;
    let count = 0;
    for (const constraint of this.mutableConstraints) {
      if (!constraint.active || constraint.connection >= 1) continue;
      total += constraint.connection;
      count++;
    }
    return count === 0 ? 1 : total / count;
  }

  get exposure(): number {
    return this.calculateExposure();
  }

  /** Fixed-step entry point. Large render frames can recover at most twice. */
  step(delta: number, input: BlobStepInput = {}): BlobStepResult {
    this.lastStepCount = 0;
    this.lastDroppedTime = 0;
    if (!(delta > 0) || !Number.isFinite(delta)) {
      this.updateRenderPositions(this.accumulator / BLOB_FIXED_STEP_SECONDS);
      return { steps: 0, alpha: this.accumulator / BLOB_FIXED_STEP_SECONDS, droppedTime: 0 };
    }
    if (input.frozen) {
      this.accumulator = 0;
      for (let index = 0; index < this.activeCount; index++) {
        const particle = this.mutableParticles[index];
        particle.frozen = true;
        particle.velocity.set(0, 0, 0);
        particle.previousPosition.copy(particle.position);
        particle.renderPosition.copy(particle.position);
      }
      this.velocity.set(0, 0, 0);
      return { steps: 0, alpha: 0, droppedTime: 0 };
    }
    for (let index = 0; index < this.activeCount; index++) {
      this.mutableParticles[index].frozen = false;
    }

    this.accumulator += delta;
    while (
      this.accumulator + Number.EPSILON >= BLOB_FIXED_STEP_SECONDS &&
      this.lastStepCount < BLOB_MAX_RECOVERY_STEPS
    ) {
      this.fixedStep(input);
      this.accumulator -= BLOB_FIXED_STEP_SECONDS;
      this.lastStepCount++;
    }
    if (this.accumulator >= BLOB_FIXED_STEP_SECONDS) {
      const remainder = this.accumulator % BLOB_FIXED_STEP_SECONDS;
      this.lastDroppedTime = this.accumulator - remainder;
      this.accumulator = remainder;
    }
    const alpha = clamp(this.accumulator / BLOB_FIXED_STEP_SECONDS, 0, 0.999999);
    this.updateRenderPositions(alpha);
    return { steps: this.lastStepCount, alpha, droppedTime: this.lastDroppedTime };
  }

  /** Compatibility alias for consumers that use animator-style naming. */
  update(delta: number, input: BlobStepInput = {}): BlobStepResult {
    return this.step(delta, input);
  }

  grow(amount: number): number {
    const wanted = Math.max(0, Math.floor(amount));
    const added = Math.min(wanted, this.maxParticleCount - this.activeCount);
    const oldCount = this.activeCount;
    this.activeCount += added;
    for (let index = oldCount; index < this.activeCount; index++) {
      const particle = this.mutableParticles[index];
      particle.active = true;
      particle.scale = 1;
      particle.componentId = 0;
      particle.position.copy(this.center).add(this.normalOffsets[index]);
      particle.previousPosition.copy(particle.position);
      particle.renderPosition.copy(particle.position);
      particle.velocity.copy(this.velocity);
    }
    this.refreshConstraintActivity();
    this.refreshComponents();
    return added;
  }

  applyImpulse(particleIndex: number, impulse: Vector3, breakSeconds = 1.1): boolean {
    const particle = this.mutableParticles[particleIndex];
    if (!particle?.active || !Number.isFinite(impulse.lengthSq())) return false;
    const magnitude = impulse.length();
    const inverseMass = particle.role === BlobParticleRole.Brain ? 0.35 : 1;
    particle.velocity.addScaledVector(impulse, inverseMass);
    this.clampParticleVelocity(particle);
    this.exposureOpening = clamp(this.exposureOpening + magnitude * 0.022, 0, 1);
    const until = this.simulationTime + Math.max(0, breakSeconds);
    for (const constraint of this.mutableConstraints) {
      if (
        constraint.active &&
        (constraint.particleA === particleIndex || constraint.particleB === particleIndex)
      ) {
        constraint.brokenUntil = Math.max(constraint.brokenUntil, until);
        constraint.connection = 0;
      }
    }
    return true;
  }

  applyImpulseAt(point: Vector3, impulse: Vector3, radius = 0.45): number {
    this.spatialHash.rebuild(this.mutableParticles);
    const impacted: Array<{ particle: MutableBlobParticle; weight: number }> = [];
    let totalWeight = 0;
    this.spatialHash.forEachNear(point, radius, (particle, distanceSquared) => {
      const falloff = 1 - Math.sqrt(distanceSquared) / radius;
      if (falloff <= 0) return;
      const weight = falloff * falloff;
      impacted.push({ particle, weight });
      totalWeight += weight;
    });
    if (impacted.length === 0 || totalWeight <= EPSILON) return 0;

    // `impulse` belongs to the hit, not to every particle in its kernel. The
    // old implementation multiplied bullet momentum by 10-20 and severed the
    // complete spring tree. Normalising the kernel produces a local gel dent
    // while conserving the requested total impulse.
    const magnitude = impulse.length();
    const affected = new Set<number>();
    for (const { particle, weight } of impacted) {
      const inverseMass = particle.role === BlobParticleRole.Brain ? 0.35 : 1;
      particle.velocity.addScaledVector(impulse, (weight / totalWeight) * inverseMass);
      this.clampParticleVelocity(particle);
      this.disturbedUntil[particle.index] = this.simulationTime + IMPACT_RELAX_SECONDS;
      affected.add(particle.index);
    }
    this.shapeRelaxUntil = Math.max(this.shapeRelaxUntil, this.simulationTime + 0.24);
    this.exposureOpening = clamp(
      this.exposureOpening + Math.min(0.16, magnitude * 0.012),
      0,
      1,
    );

    // Small-calibre fire indents the skin. Only energetic impacts temporarily
    // open tendons which actually cross the local kernel.
    if (magnitude >= 4.25) {
      const until = this.simulationTime + Math.min(0.75, 0.16 + magnitude * 0.055);
      const connection = magnitude >= 7 ? 0 : 0.45;
      for (const constraint of this.mutableConstraints) {
        if (!constraint.active) continue;
        const aHit = affected.has(constraint.particleA);
        const bHit = affected.has(constraint.particleB);
        if (aHit === bHit) continue;
        constraint.brokenUntil = Math.max(constraint.brokenUntil, until);
        constraint.connection = Math.min(constraint.connection, connection);
      }
    }
    return impacted.length;
  }

  applyRadialImpulse(origin: Vector3, radius: number, strength: number, upSpeed = 0): number {
    if (!(radius > 0) || strength === 0) return 0;
    const radiusSq = radius * radius;
    let impacted = 0;
    for (let index = 0; index < this.activeCount; index++) {
      const particle = this.mutableParticles[index];
      TMP_A.subVectors(particle.position, origin);
      const distanceSq = TMP_A.lengthSq();
      if (distanceSq > radiusSq) continue;
      const distance = Math.sqrt(distanceSq);
      if (distance > EPSILON) TMP_A.multiplyScalar(1 / distance);
      else TMP_A.set(1, 0, 0);
      const falloff = 1 - distance / radius;
      TMP_A.multiplyScalar(strength * falloff);
      TMP_A.y += upSpeed * falloff;
      const impulseMagnitude = TMP_A.length();
      const inverseMass = particle.role === BlobParticleRole.Brain ? 0.35 : 1;
      particle.velocity.addScaledVector(TMP_A, inverseMass);
      this.clampParticleVelocity(particle);
      this.disturbedUntil[particle.index] = this.simulationTime + 0.7;
      if (impulseMagnitude > 0.25) this.shapeRelaxUntil = this.simulationTime + 0.7;
      impacted++;
    }
    const affectedFraction = impacted / Math.max(1, this.activeCount);
    this.exposureOpening = clamp(
      this.exposureOpening + Math.abs(strength) * 0.035 * affectedFraction,
      0,
      1,
    );
    if (Math.abs(strength) >= 3.5) {
      const until = this.simulationTime + Math.min(1.4, 0.35 + Math.abs(strength) * 0.08);
      for (const constraint of this.mutableConstraints) {
        if (!constraint.active) continue;
        const a = this.mutableParticles[constraint.particleA];
        const b = this.mutableParticles[constraint.particleB];
        const aInside = a.position.distanceToSquared(origin) <= radiusSq;
        const bInside = b.position.distanceToSquared(origin) <= radiusSq;
        if (!aInside && !bInside) continue;
        constraint.brokenUntil = Math.max(constraint.brokenUntil, until);
        constraint.connection = Math.min(constraint.connection, Math.abs(strength) >= 7 ? 0 : 0.35);
      }
    }
    return impacted;
  }

  nearestParticle(point: Vector3, includeBrain = true): BlobParticle | null {
    let nearest: MutableBlobParticle | null = null;
    let nearestDistanceSq = Infinity;
    for (let index = includeBrain ? 0 : 1; index < this.activeCount; index++) {
      const particle = this.mutableParticles[index];
      const distanceSq = particle.position.distanceToSquared(point);
      if (distanceSq < nearestDistanceSq) {
        nearestDistanceSq = distanceSq;
        nearest = particle;
      }
    }
    return nearest;
  }

  /** Global fraction of the brain that is no longer protected by nearby mass. */
  calculateExposure(): number {
    const brain = this.mutableParticles[0];
    let protectedParticles = 0;
    let protectiveParticles = 0;
    const protectionRadiusSq = (this.bodyRadius * 1.28) ** 2;
    for (let index = 1; index < this.activeCount; index++) {
      const particle = this.mutableParticles[index];
      if (particle.scale <= 0.1) continue;
      protectiveParticles++;
      if (
        particle.componentId === brain.componentId &&
        particle.position.distanceToSquared(brain.position) <= protectionRadiusSq
      ) {
        protectedParticles++;
      }
    }
    const displaced =
      protectiveParticles > 0 ? 1 - protectedParticles / protectiveParticles : 1;
    let severed = 0;
    let liveConstraints = 0;
    for (const constraint of this.mutableConstraints) {
      if (!constraint.active) continue;
      liveConstraints++;
      if (constraint.brokenUntil > this.simulationTime || constraint.connection < 0.5) severed++;
    }
    const severedFraction = liveConstraints > 0 ? severed / liveConstraints : 0;
    return clamp(
      this.exposureOpening + displaced * 0.8 + severedFraction * 0.25,
      0,
      1,
    );
  }

  split(count = 3, impulseSpeed = 1.8): number {
    if (!Number.isInteger(count) || count < 2 || count > MAX_COMPONENTS) {
      throw new RangeError("Blob component count must be an integer from 2 through 6");
    }
    this.cancelPose();
    this.merging = false;
    this.emittedMergeEvent = false;
    const sectorWidth = (Math.PI * 2) / count;
    const halfSector = sectorWidth * 0.5;
    const componentDirections = Array.from({ length: count }, (_, componentId) => {
      const angle = componentId * sectorWidth;
      return new Vector3(Math.cos(angle), 0.32, Math.sin(angle)).normalize();
    });
    for (let componentId = 0; componentId < MAX_COMPONENTS; componentId++) {
      const direction = componentDirections[componentId];
      this.splitVelocities[componentId].copy(direction ?? TMP_A.set(0, 0, 0));
      this.splitVelocities[componentId].multiplyScalar(direction ? impulseSpeed : 0);
    }
    this.splitLaunchUntil = this.simulationTime + SPLIT_LAUNCH_SECONDS;
    this.splitAutoMergeAt = this.simulationTime + SPLIT_AUTO_MERGE_SECONDS;
    for (let index = 0; index < this.activeCount; index++) {
      const particle = this.mutableParticles[index];
      TMP_A.subVectors(particle.position, this.center);
      let componentId = 0;
      if (index !== 0 && TMP_A.x * TMP_A.x + TMP_A.z * TMP_A.z > EPSILON) {
        let angle = Math.atan2(TMP_A.z, TMP_A.x);
        if (angle < 0) angle += Math.PI * 2;
        componentId = Math.floor((angle + halfSector) / sectorWidth) % count;
      }
      particle.componentId = componentId;
      particle.velocity.add(this.splitVelocities[componentId]);
      this.clampParticleVelocity(particle);
      particle.previousPosition.copy(particle.position);
      particle.renderPosition.copy(particle.position);
    }
    for (const constraint of this.mutableConstraints) {
      if (!constraint.active) continue;
      const a = this.mutableParticles[constraint.particleA];
      const b = this.mutableParticles[constraint.particleB];
      if (a.componentId !== b.componentId) constraint.connection = 0;
    }
    this.refreshComponents();
    this.exposureOpening = Math.max(this.exposureOpening, 0.16 + count * 0.035);
    this.events.push({ type: "split", components: count });
    return this.componentCount;
  }

  /** Components first approach physically; their tendons reconnect only nearby. */
  merge(): boolean {
    if (this.componentCount <= 1 && !this.merging) return false;
    this.merging = true;
    this.emittedMergeEvent = false;
    this.splitAutoMergeAt = Infinity;
    return true;
  }

  setPose(pose: BlobPoseDefinition | BlobPoseKind): void {
    const definition: BlobPoseDefinition =
      typeof pose === "string" ? { kind: pose } : { ...pose };
    if (!this.isValidPoseKind(definition.kind)) {
      this.events.push({ type: "error", command: "setPose", reason: "unknown pose" });
      throw new RangeError(`Unknown blob pose: ${String(definition.kind)}`);
    }
    const target = this.buildPoseTargets(definition);
    this.poseTransition = {
      definition,
      reset: false,
      elapsed: 0,
      duration: Math.max(BLOB_FIXED_STEP_SECONDS, finiteOr(definition.duration, DEFAULT_POSE_SECONDS)),
      start: this.mutableParticles.map((particle) => particle.position.clone()),
      target,
    };
    this.heldPose = null;
    this.heldPoseTargets = null;
  }

  resetPose(duration = DEFAULT_POSE_SECONDS): void {
    const target = this.mutableParticles.map((particle, index) =>
      this.center.clone().add(this.normalOffsets[index]),
    );
    this.poseTransition = {
      definition: null,
      reset: true,
      elapsed: 0,
      duration: Math.max(BLOB_FIXED_STEP_SECONDS, finiteOr(duration, DEFAULT_POSE_SECONDS)),
      start: this.mutableParticles.map((particle) => particle.position.clone()),
      target,
    };
    this.heldPose = null;
    this.heldPoseTargets = null;
  }

  cancelPose(): void {
    this.poseTransition = null;
    this.heldPose = null;
    this.heldPoseTargets = null;
  }

  /**
   * Transforms every coupled state before returning, avoiding one-frame tears
   * between motor, render interpolation, hitboxes, constraints and pose anchors.
   */
  teleportPose(transform: NpcTeleportTransform): void {
    const sourceCenter = this.mutableParticles[0].position.clone();
    const sourceVelocity = this.velocity.clone();
    const rotation = transform.rotation
      ? TMP_QUATERNION.set(
          transform.rotation.x,
          transform.rotation.y,
          transform.rotation.z,
          transform.rotation.w,
        ).normalize()
      : TMP_QUATERNION.identity();
    const destination = TMP_A.copy(transform.position);
    const destinationVelocity = transform.velocity
      ? TMP_B.copy(transform.velocity)
      : TMP_B.copy(sourceVelocity).applyQuaternion(rotation);

    for (const particle of this.mutableParticles) {
      TMP_C.subVectors(particle.position, sourceCenter).applyQuaternion(rotation).add(destination);
      particle.position.copy(TMP_C);
      particle.previousPosition.copy(TMP_C);
      particle.renderPosition.copy(TMP_C);
      particle.velocity
        .sub(sourceVelocity)
        .applyQuaternion(rotation)
        .add(destinationVelocity);
    }
    for (const offset of this.normalOffsets) offset.applyQuaternion(rotation);
    this.transformPoseVectors(this.poseTransition?.start, sourceCenter, destination, rotation);
    this.transformPoseVectors(this.poseTransition?.target, sourceCenter, destination, rotation);
    this.transformPoseVectors(this.heldPoseTargets, sourceCenter, destination, rotation);
    this.center.copy(destination);
    this.velocity.copy(destinationVelocity);
    this.accumulator = 0;
    this.refreshComponents();
  }

  drainEvents(): BlobControlEvent[] {
    return this.events.splice(0, this.events.length);
  }

  roleCounts(activeOnly = true): Record<BlobParticleRole, number> {
    const counts: Record<BlobParticleRole, number> = {
      [BlobParticleRole.Brain]: 0,
      [BlobParticleRole.Structural]: 0,
      [BlobParticleRole.Support]: 0,
      [BlobParticleRole.TendonEnd]: 0,
      [BlobParticleRole.Flesh]: 0,
    };
    const end = activeOnly ? this.activeCount : this.mutableParticles.length;
    for (let index = 0; index < end; index++) counts[this.mutableParticles[index].role]++;
    return counts;
  }

  private fixedStep(input: BlobStepInput): void {
    this.simulationTime += BLOB_FIXED_STEP_SECONDS;
    this.totalFixedSteps++;
    for (let index = 0; index < this.activeCount; index++) {
      const particle = this.mutableParticles[index];
      particle.previousPosition.copy(particle.position);
    }
    if (
      !this.merging &&
      this.componentCount > 1 &&
      this.simulationTime >= this.splitAutoMergeAt
    ) {
      this.merge();
    }

    if (this.poseTransition) {
      this.advancePoseTransition();
    } else if (this.heldPose && this.heldPoseTargets) {
      this.holdPose();
    } else {
      this.integrateLocomotion(input);
      for (let iteration = 0; iteration < CONSTRAINT_ITERATIONS; iteration++) {
        this.solveConstraints();
      }
      this.applyGelNeighborhood();
      this.applyStructureTether();
    }
    this.resolveParticleMotions(input.motionResolver ?? this.motionResolver);
    this.exposureOpening = Math.max(
      0,
      this.exposureOpening - EXPOSURE_DECAY_PER_SECOND * BLOB_FIXED_STEP_SECONDS,
    );
    this.syncCenterAndVelocity();
    this.refreshComponents();
    if (this.merging && this.attachNearbyMergeComponents()) this.refreshComponents();
    this.advanceReconnection();
  }

  private integrateLocomotion(input: BlobStepInput): void {
    const anchor = input.anchor ?? input.center;
    TMP_A.set(0, 0, 0);
    if (input.desiredVelocity) {
      TMP_A.copy(input.desiredVelocity);
    } else if (input.target) {
      TMP_A.subVectors(input.target, this.center);
      const distance = TMP_A.length();
      if (distance > EPSILON) TMP_A.multiplyScalar(Math.min(this.locomotionSpeed, distance * 3) / distance);
    }
    if (anchor) {
      TMP_B.subVectors(anchor, this.center).multiplyScalar(4.5);
      const correctionLength = TMP_B.length();
      if (correctionLength > this.locomotionSpeed * 1.5 && correctionLength > EPSILON) {
        TMP_B.multiplyScalar((this.locomotionSpeed * 1.5) / correctionLength);
      }
      TMP_A.add(TMP_B);
    }

    for (let index = 0; index < this.activeCount; index++) {
      const particle = this.mutableParticles[index];
      if (particle.frozen) continue;
      // Locomotion translates one organism. Role-dependent response made flesh
      // lag metres behind the brain and turned the mass into a chain of lobes.
      // Deformation still comes from constraints, contacts, impacts and poses.
      const recentlyHit = this.disturbedUntil[index] > this.simulationTime;
      const blend = Math.min(1, (recentlyHit ? 1.8 : 6) * BLOB_FIXED_STEP_SECONDS);
      particle.velocity.lerp(TMP_A, blend);
    }
    if (!this.merging && this.simulationTime < this.splitLaunchUntil) {
      const launchBlend = Math.min(1, 10 * BLOB_FIXED_STEP_SECONDS);
      for (let index = 0; index < this.activeCount; index++) {
        const particle = this.mutableParticles[index];
        if (particle.frozen) continue;
        TMP_B.copy(TMP_A).add(this.splitVelocities[particle.componentId]);
        particle.velocity.lerp(TMP_B, launchBlend);
        this.clampParticleVelocity(particle);
      }
    }
    if (this.merging) this.applyMergeMotion();
    for (let index = 0; index < this.activeCount; index++) {
      const particle = this.mutableParticles[index];
      if (particle.frozen) continue;
      particle.position.addScaledVector(particle.velocity, BLOB_FIXED_STEP_SECONDS);
    }
  }

  private solveConstraints(): void {
    for (const constraint of this.mutableConstraints) {
      if (
        !constraint.active ||
        constraint.connection <= 0 ||
        constraint.brokenUntil > this.simulationTime
      ) {
        continue;
      }
      const a = this.mutableParticles[constraint.particleA];
      const b = this.mutableParticles[constraint.particleB];
      if (a.componentId !== b.componentId || !a.active || !b.active) continue;
      TMP_A.subVectors(b.position, a.position);
      const distance = TMP_A.length();
      if (distance <= EPSILON) continue;
      // A world contact must never turn one invisible particle into an
      // infinitely long tether. Very strained flesh links release and later
      // reconnect when surface tension brings the gel back together.
      if (
        !this.merging &&
        distance > constraint.restLength * (constraint.kind === "tendon" ? 2.4 : 3.1)
      ) {
        constraint.brokenUntil = this.simulationTime + 0.35;
        constraint.connection = Math.min(constraint.connection, 0.25);
        this.exposureOpening = Math.min(1, this.exposureOpening + 0.0015);
        continue;
      }
      const correctionDistance = clamp(
        (distance - constraint.restLength) *
          constraint.stiffness *
          constraint.connection *
          0.5,
        -MAX_CONSTRAINT_CORRECTION,
        MAX_CONSTRAINT_CORRECTION,
      );
      TMP_A.multiplyScalar(correctionDistance / distance);
      const aWeight = a.role === BlobParticleRole.Brain ? 0.2 : 1;
      const bWeight = b.role === BlobParticleRole.Brain ? 0.2 : 1;
      const inverseWeight = 1 / (aWeight + bWeight);
      a.position.addScaledVector(TMP_A, aWeight * inverseWeight);
      b.position.addScaledVector(TMP_A, -bWeight * inverseWeight);
    }
  }

  private applyGelNeighborhood(): void {
    this.spatialHash.rebuild(this.mutableParticles);
    const cohesionRange = this.separationDistance * GEL_COHESION_RANGE_SCALE;
    this.spatialHash.forEachPair(cohesionRange, (a, b, distanceSq) => {
      if (a.componentId !== b.componentId) return;
      let distance = Math.sqrt(distanceSq);
      if (distance <= EPSILON) {
        const angle = (a.index * 31 + b.index * 17) * GOLDEN_ANGLE;
        TMP_A.set(Math.cos(angle), 0.2, Math.sin(angle)).normalize();
        distance = 0;
      } else {
        TMP_A.subVectors(b.position, a.position).multiplyScalar(1 / distance);
      }
      if (distance < this.separationDistance) {
        const push = (this.separationDistance - distance) * 0.19;
        const aWeight = this.gelInverseMass(a);
        const bWeight = this.gelInverseMass(b);
        const inverseWeight = 2 / (aWeight + bWeight);
        a.position.addScaledVector(TMP_A, -push * aWeight * inverseWeight);
        b.position.addScaledVector(TMP_A, push * bWeight * inverseWeight);
      } else {
        const attraction =
          GEL_COHESION_PER_PAIR *
          (1 - (distance - this.separationDistance) / (cohesionRange - this.separationDistance));
        const aWeight = this.gelInverseMass(a);
        const bWeight = this.gelInverseMass(b);
        const inverseWeight = 2 / (aWeight + bWeight);
        a.position.addScaledVector(TMP_A, attraction * aWeight * inverseWeight);
        b.position.addScaledVector(TMP_A, -attraction * bWeight * inverseWeight);
      }
      TMP_B.subVectors(b.velocity, a.velocity).multiplyScalar(GEL_VISCOSITY * 0.5);
      if (a.role !== BlobParticleRole.Brain) a.velocity.add(TMP_B);
      if (b.role !== BlobParticleRole.Brain) b.velocity.sub(TMP_B);
    });
    this.lastSeparationCandidateChecks = this.spatialHash.lastCandidateChecks;
  }

  private gelInverseMass(particle: MutableBlobParticle): number {
    if (particle.role === BlobParticleRole.Brain) return 0.08;
    if (particle.role === BlobParticleRole.Structural) return 0.55;
    return 1;
  }

  /** Weak plastic shape matching for the internal skeleton, never the flesh. */
  private applyStructureTether(): void {
    if (this.componentCount !== 1 || this.simulationTime < this.shapeRelaxUntil) return;
    const brain = this.mutableParticles[0];
    for (let index = 1; index <= STRUCTURAL_LAST && index < this.activeCount; index++) {
      const particle = this.mutableParticles[index];
      TMP_A.copy(brain.position).add(this.normalOffsets[index]);
      TMP_B.subVectors(TMP_A, particle.position);
      const distance = TMP_B.length();
      if (distance <= STRUCTURE_TETHER_DISTANCE || distance <= EPSILON) continue;
      const correction = Math.min(
        0.025,
        (distance - STRUCTURE_TETHER_DISTANCE) * STRUCTURE_TETHER_RESPONSE,
      );
      particle.position.addScaledVector(TMP_B, correction / distance);
    }
  }

  private advanceReconnection(): void {
    let pending = false;
    for (const constraint of this.mutableConstraints) {
      if (!constraint.active || constraint.connection >= 1) continue;
      pending = true;
      if (constraint.brokenUntil > this.simulationTime) continue;
      const a = this.mutableParticles[constraint.particleA];
      const b = this.mutableParticles[constraint.particleB];
      if (!a.active || !b.active || a.componentId !== b.componentId) continue;
      const reconnectDistance = Math.max(
        MIN_RECONNECT_DISTANCE,
        constraint.restLength * RECONNECT_REST_SCALE,
      );
      if (a.position.distanceToSquared(b.position) > reconnectDistance * reconnectDistance) continue;
      constraint.connection = Math.min(
        1,
        constraint.connection + RECONNECT_PER_SECOND * BLOB_FIXED_STEP_SECONDS,
      );
    }
    if (!this.merging) return;
    this.merging = this.componentCount > 1 || pending;
    if (!this.merging && !this.emittedMergeEvent) {
      this.events.push({ type: "merged" });
      this.emittedMergeEvent = true;
    }
  }

  private applyMergeMotion(): void {
    const main = this.mutableComponents[0];
    if (!main.active) return;
    if (this.componentCount > 1) {
      for (let componentId = 1; componentId < this.mutableComponents.length; componentId++) {
        const component = this.mutableComponents[componentId];
        if (!component.active) continue;
        TMP_A.subVectors(main.center, component.center);
        const distance = TMP_A.length();
        if (distance <= EPSILON) continue;
        TMP_A.multiplyScalar(1 / distance);
        TMP_B.copy(main.velocity).addScaledVector(
          TMP_A,
          Math.min(MERGE_APPROACH_SPEED, distance * 2.5),
        );
        TMP_C.subVectors(TMP_B, component.velocity);
        const maxChange = MERGE_ACCELERATION * BLOB_FIXED_STEP_SECONDS;
        if (TMP_C.lengthSq() > maxChange * maxChange) TMP_C.setLength(maxChange);
        for (const particleIndex of component.particleIndices) {
          const particle = this.mutableParticles[particleIndex];
          particle.velocity.add(TMP_C);
          this.clampParticleVelocity(particle);
        }
      }
      return;
    }

    // Once every component overlaps, gently recover the canonical internal
    // layout so every severed edge can reconnect without a long-distance snap.
    const brainVelocity = this.mutableParticles[0].velocity;
    for (let index = 1; index < this.activeCount; index++) {
      const particle = this.mutableParticles[index];
      TMP_A.copy(this.center).add(this.normalOffsets[index]).sub(particle.position);
      const distance = TMP_A.length();
      if (distance <= EPSILON) continue;
      TMP_A.multiplyScalar(
        Math.min(MERGE_SHAPE_SPEED, distance * MERGE_SHAPE_RESPONSE) / distance,
      );
      TMP_B.copy(brainVelocity).add(TMP_A);
      particle.velocity.lerp(TMP_B, 0.2);
      this.clampParticleVelocity(particle);
    }
  }

  private attachNearbyMergeComponents(): boolean {
    if (!this.merging || this.componentCount <= 1) return false;
    const main = this.mutableComponents[0];
    let changed = false;
    for (let componentId = 1; componentId < this.mutableComponents.length; componentId++) {
      const component = this.mutableComponents[componentId];
      if (
        !component.active ||
        component.center.distanceToSquared(main.center) >
          MERGE_ATTACH_DISTANCE * MERGE_ATTACH_DISTANCE
      ) {
        continue;
      }
      for (const particleIndex of component.particleIndices) {
        this.mutableParticles[particleIndex].componentId = 0;
      }
      changed = true;
    }
    return changed;
  }

  private resolveParticleMotions(resolver: BlobParticleMotionResolver | undefined): void {
    if (!resolver) return;
    for (let index = 0; index < this.activeCount; index++) {
      const particle = this.mutableParticles[index];
      TMP_A.subVectors(particle.position, particle.previousPosition);
      const maxStepSpeed = particle.role === BlobParticleRole.Brain
        ? (this.disturbedUntil[index] > this.simulationTime
            ? MAX_PARTICLE_SPEED
            : Math.min(MAX_PARTICLE_SPEED, this.locomotionSpeed * 1.2))
        : MAX_PARTICLE_SPEED;
      const maxStepDistance = maxStepSpeed * BLOB_FIXED_STEP_SECONDS;
      if (TMP_A.lengthSq() > maxStepDistance * maxStepDistance) {
        particle.position
          .copy(particle.previousPosition)
          .add(TMP_A.setLength(maxStepDistance));
      }
      const resolved = resolver(particle, particle.previousPosition, particle.position);
      if (!resolved) continue;
      if ("position" in resolved) {
        particle.position.copy(resolved.position);
        if (resolved.velocity) particle.velocity.copy(resolved.velocity);
      } else {
        particle.position.copy(resolved);
      }
      this.clampParticleVelocity(particle);
    }
  }

  private clampParticleVelocity(particle: MutableBlobParticle): void {
    const lengthSq = particle.velocity.lengthSq();
    if (!Number.isFinite(lengthSq)) {
      particle.velocity.set(0, 0, 0);
      return;
    }
    if (lengthSq > MAX_PARTICLE_SPEED * MAX_PARTICLE_SPEED) {
      particle.velocity.setLength(MAX_PARTICLE_SPEED);
    }
  }

  private advancePoseTransition(): void {
    const transition = this.poseTransition;
    if (!transition) return;
    transition.elapsed = Math.min(transition.duration, transition.elapsed + BLOB_FIXED_STEP_SECONDS);
    const alpha = smoothStep(transition.elapsed / transition.duration);
    for (let index = 0; index < this.activeCount; index++) {
      const particle = this.mutableParticles[index];
      TMP_A.lerpVectors(transition.start[index], transition.target[index], alpha);
      particle.velocity.subVectors(TMP_A, particle.position).multiplyScalar(1 / BLOB_FIXED_STEP_SECONDS);
      particle.position.copy(TMP_A);
    }
    if (transition.elapsed + Number.EPSILON < transition.duration) return;
    if (transition.reset) {
      this.poseTransition = null;
      this.heldPose = null;
      this.heldPoseTargets = null;
      this.events.push({ type: "poseReset" });
      return;
    }
    this.heldPose = transition.definition;
    this.heldPoseTargets = transition.target;
    this.poseTransition = null;
    if (this.heldPose) {
      this.events.push({
        type: "poseReached",
        poseId: this.heldPose.id,
        pose: this.heldPose.kind,
      });
    }
  }

  private holdPose(): void {
    if (!this.heldPoseTargets) return;
    for (let index = 0; index < this.activeCount; index++) {
      const particle = this.mutableParticles[index];
      particle.velocity.set(0, 0, 0);
      particle.position.copy(this.heldPoseTargets[index]);
    }
  }

  private updateRenderPositions(alpha: number): void {
    const t = clamp(alpha, 0, 1);
    for (let index = 0; index < this.activeCount; index++) {
      const particle = this.mutableParticles[index];
      particle.renderPosition.lerpVectors(particle.previousPosition, particle.position, t);
    }
  }

  private syncCenterAndVelocity(): void {
    this.center.copy(this.mutableParticles[0].position);
    this.velocity.copy(this.mutableParticles[0].velocity);
  }

  private refreshComponents(): void {
    for (const component of this.mutableComponents) {
      component.active = false;
      component.particleIndices.length = 0;
      component.center.set(0, 0, 0);
      component.velocity.set(0, 0, 0);
    }
    for (let index = 0; index < this.activeCount; index++) {
      const particle = this.mutableParticles[index];
      const component = this.mutableComponents[particle.componentId];
      component.active = true;
      component.particleIndices.push(index);
      component.center.add(particle.position);
      component.velocity.add(particle.velocity);
    }
    for (const component of this.mutableComponents) {
      if (!component.active) {
        component.center.copy(this.center);
        continue;
      }
      const inverseCount = 1 / component.particleIndices.length;
      component.center.multiplyScalar(inverseCount);
      component.velocity.multiplyScalar(inverseCount);
    }
  }

  private createConstraints(): BlobConstraint[] {
    const constraints: BlobConstraint[] = [];
    const add = (kind: "structural" | "tendon", a: number, b: number, stiffness: number) => {
      constraints.push({
        index: constraints.length,
        kind,
        particleA: a,
        particleB: b,
        restLength: this.mutableParticles[a].position.distanceTo(this.mutableParticles[b].position),
        stiffness,
        active: a < this.activeCount && b < this.activeCount,
        connection: 1,
        brokenUntil: 0,
      });
    };

    for (let index = 1; index < this.maxParticleCount; index++) {
      let parent: number;
      if (index <= STRUCTURAL_LAST) {
        parent = index === STRUCTURAL_FIRST ? 0 : Math.floor((index - 2) / 3) + 1;
      } else if (index <= SUPPORT_LAST) {
        parent = STRUCTURAL_FIRST + ((index - SUPPORT_FIRST) % 24);
      } else if (index <= TENDON_LAST) {
        parent = STRUCTURAL_FIRST + ((index - TENDON_FIRST) % 24);
      } else {
        parent = STRUCTURAL_FIRST + ((index * 13) % SUPPORT_LAST);
      }
      add("structural", parent, index, 0.42);
    }
    // Elastic tendons are allocated for every arm and structural cross-link.
    for (let index = TENDON_FIRST; index <= TENDON_LAST && index < this.maxParticleCount; index++) {
      add("tendon", 0, index, 0.2);
    }
    for (let index = 1; index <= STRUCTURAL_LAST && index < this.maxParticleCount; index++) {
      const other = STRUCTURAL_FIRST + ((index + 7) % 24);
      if (other !== index) add("tendon", index, other, 0.16);
    }
    return constraints;
  }

  private refreshConstraintActivity(): void {
    for (const constraint of this.mutableConstraints) {
      constraint.active =
        constraint.particleA < this.activeCount && constraint.particleB < this.activeCount;
    }
  }

  private makeNormalOffset(index: number, role: BlobParticleRole, seed: number): Vector3 {
    if (index === 0) return new Vector3();
    const u = indexRandom(index, 0, seed);
    const v = indexRandom(index, 1, seed);
    const w = indexRandom(index, 2, seed);
    const theta = Math.PI * 2 * u;

    // Spawn already settled as the low, broad mound seen in Valve's demo.
    // Previously this was a tall sphere with several support particles below
    // the floor; gravity then crushed it into a torn sheet during its first
    // seconds. Supports now form a deterministic contact footprint and the
    // remaining roles fill a shallow dome above it.
    if (role === BlobParticleRole.Support) {
      const ordinal = index - SUPPORT_FIRST;
      const t = (ordinal + 0.5) / (SUPPORT_LAST - SUPPORT_FIRST + 1);
      const angle = ordinal * GOLDEN_ANGLE + seed * 0.0001;
      const radius = this.bodyRadius * 0.84 * Math.sqrt(t);
      return new Vector3(
        Math.cos(angle) * radius,
        -this.bodyRadius * 0.40 + 0.025 * Math.sin(angle * 2),
        Math.sin(angle) * radius,
      );
    }

    const roleScale = role === BlobParticleRole.Structural
      ? 0.58
      : role === BlobParticleRole.TendonEnd
        ? 1.02
        : 0.94;
    const diskRadius = this.bodyRadius * roleScale * Math.sqrt(0.08 + 0.92 * w);
    const normalized = diskRadius / (this.bodyRadius * roleScale);
    const dome = this.bodyRadius * (0.30 * (1 - normalized * normalized) - 0.22);
    const verticalJitter = (v - 0.5) * this.bodyRadius *
      (role === BlobParticleRole.Structural ? 0.22 : 0.34);
    return new Vector3(
      Math.cos(theta) * diskRadius,
      dome + verticalJitter,
      Math.sin(theta) * diskRadius,
    );
  }

  private buildPoseTargets(definition: BlobPoseDefinition): Vector3[] {
    const origin = definition.center ? new Vector3().copy(definition.center) : this.center.clone();
    const forward = definition.target
      ? new Vector3().subVectors(definition.target, origin)
      : definition.direction
        ? new Vector3().copy(definition.direction)
        : new Vector3(0, 0, 1);
    const requestedLength = finiteOr(definition.length, forward.length() || this.bodyRadius * 3);
    if (forward.lengthSq() <= EPSILON) forward.set(0, 0, 1);
    forward.normalize();
    const side = new Vector3().crossVectors(new Vector3(0, 1, 0), forward);
    if (side.lengthSq() <= EPSILON) side.set(1, 0, 0);
    else side.normalize();
    const up = new Vector3().crossVectors(forward, side).normalize();
    if (up.y < 0) up.negate();
    const radius = Math.max(0.1, finiteOr(definition.radius, this.bodyRadius));
    const width = Math.max(0.1, finiteOr(definition.width, radius * 2));
    const height = Math.max(0.1, finiteOr(definition.height, radius * 2));
    const depth = Math.max(0.02, finiteOr(definition.depth, this.separationDistance * 1.5));
    const targets = this.mutableParticles.map(() => origin.clone());
    const count = Math.max(1, this.activeCount - 1);

    for (let index = 1; index < this.activeCount; index++) {
      const ordinal = index - 1;
      const t = (ordinal + 0.5) / count;
      const angle = ordinal * GOLDEN_ANGLE;
      const target = targets[index];
      switch (definition.kind) {
        case "mound": {
          const diskRadius = radius * Math.sqrt(t);
          target
            .addScaledVector(side, Math.cos(angle) * diskRadius)
            .addScaledVector(forward, Math.sin(angle) * diskRadius)
            .addScaledVector(up, height * 0.55 * (1 - (diskRadius / radius) ** 2));
          break;
        }
        case "sphere":
        case "hemisphere": {
          const yRaw = 1 - 2 * t;
          const y = definition.kind === "hemisphere" ? Math.abs(yRaw) : yRaw;
          const ring = Math.sqrt(Math.max(0, 1 - yRaw * yRaw));
          const shell = radius * (0.58 + 0.42 * ((ordinal % 5) / 4));
          target
            .addScaledVector(side, Math.cos(angle) * ring * shell)
            .addScaledVector(forward, Math.sin(angle) * ring * shell)
            .addScaledVector(up, y * shell);
          break;
        }
        case "column": {
          const ring = radius * (0.45 + 0.25 * ((ordinal % 4) / 3));
          target
            .addScaledVector(side, Math.cos(angle) * ring)
            .addScaledVector(forward, Math.sin(angle) * ring)
            .addScaledVector(up, t * height);
          break;
        }
        case "tendril": {
          const length = definition.target
            ? origin.distanceTo(new Vector3().copy(definition.target))
            : requestedLength;
          const thickness = radius * 0.18 * Math.sin(Math.PI * t);
          target
            .addScaledVector(forward, length * t)
            .addScaledVector(side, Math.cos(angle) * thickness)
            .addScaledVector(up, Math.sin(angle) * thickness);
          break;
        }
        case "bridge": {
          const length = definition.target
            ? origin.distanceTo(new Vector3().copy(definition.target))
            : requestedLength;
          const thickness = depth * ((((ordinal * 17) % 11) / 10) - 0.5);
          target
            .addScaledVector(forward, length * t)
            .addScaledVector(side, thickness)
            .addScaledVector(up, Math.sin(Math.PI * t) * height);
          break;
        }
        case "wall": {
          const columns = Math.max(2, Math.ceil(Math.sqrt(count * (width / height))));
          const rows = Math.max(2, Math.ceil(count / columns));
          const column = ordinal % columns;
          const row = Math.floor(ordinal / columns);
          const across = columns <= 1 ? 0 : column / (columns - 1) - 0.5;
          const vertical = rows <= 1 ? 0 : row / (rows - 1);
          const layer = (((ordinal * 7) % 5) / 4 - 0.5) * depth;
          target
            .addScaledVector(side, across * width)
            .addScaledVector(up, vertical * height)
            .addScaledVector(forward, layer);
          break;
        }
      }
    }
    return targets;
  }

  private transformPoseVectors(
    vectors: Vector3[] | null | undefined,
    sourceCenter: Vector3,
    destination: Vector3,
    rotation: Quaternion,
  ): void {
    if (!vectors) return;
    for (const vector of vectors) {
      vector.sub(sourceCenter).applyQuaternion(rotation).add(destination);
    }
  }

  private isValidPoseKind(kind: string): kind is BlobPoseKind {
    return (
      kind === "mound" ||
      kind === "sphere" ||
      kind === "hemisphere" ||
      kind === "column" ||
      kind === "tendril" ||
      kind === "bridge" ||
      kind === "wall"
    );
  }
}

export type {
  BlobComponent,
  BlobConstraint,
  BlobControlEvent,
  BlobOrganismOptions,
  BlobParticle,
  BlobParticleMotionResolver,
  BlobPoseDefinition,
  BlobPoseKind,
  BlobStepInput,
  BlobStepResult,
  NpcTeleportTransform,
} from "@engine/blob/BlobTypes";
export { BlobParticleRole } from "@engine/blob/BlobTypes";
