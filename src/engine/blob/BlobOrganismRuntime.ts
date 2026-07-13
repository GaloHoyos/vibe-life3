import { Quaternion, Vector3 } from "three";
import { BlobSpatialHash } from "@engine/blob/BlobSpatialHash";
import {
  BlobParticleRole,
  type BlobComponent,
  type BlobConstraint,
  type BlobControlEvent,
  type BlobEnvelopTarget,
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
const GROUNDED_GRACE_SECONDS = 0.1;
const GRAVITY_TERMINAL_SPEED = 9;
const DETACH_MIN_PARTICLES = 3;
const DETACH_MAX_FRACTION = 0.3;
const DETACH_CONSTRAINT_BREAK_SECONDS = 0.45;
/** A chunk that cannot crawl home dissolves and re-grows inside the mass. */
const DETACH_REABSORB_SECONDS = 9;
const DETACH_DISSOLVE_SECONDS = 0.9;
const DETACH_ATTACH_DISTANCE_SCALE = 1.5;
const DETACH_CROSS_COHESION_SCALE = 4;
const BALLISTIC_MIN_AIR_SECONDS = 0.2;
const BALLISTIC_MAX_SECONDS = 2.5;
const BALLISTIC_LANDED_FRACTION = 0.3;
const DEFAULT_LAUNCH_STAGGER_SECONDS = 0.22;
const LAUNCH_MIN_UP_SCALE = 0.78;
const LAUNCH_LEAVE_FRACTION = 0.08;
const LAUNCH_LEAVE_BAND = 0.18;
const DEFAULT_STRAND_LINK_SCALE = 1;
const DEFAULT_STRAND_SECONDS = 0.45;
/** Ball-contact slack (× particle radius) folded into the membership reach. */
const STRAND_LINK_RADIUS_SCALE = 2.3;
const DEFAULT_CHUNK_HOP_UP_SPEED = 4.6;
const DEFAULT_CHUNK_HOP_FORWARD_SPEED = 3.4;
const DEFAULT_CHUNK_HOP_BLOCKED_SECONDS = 0.55;
const CHUNK_HOP_MIN_PROGRESS_FRACTION = 0.35;
const CHUNK_HOP_MIN_AIR_SECONDS = 0.3;
const CHUNK_HOP_MAX_AIR_SECONDS = 1.4;
const SCRAP_JOIN_RADIUS_SCALE = 1.25;
const SCALE_REGROW_SECONDS = 0.7;
const DEFAULT_CRAWL_RETURN_SPEED = 2.2;
const DEFAULT_DETACH_RETURN_DELAY = 0.55;
const DEFAULT_ENVELOP_FLOW_SPEED = 2.8;
const DEFAULT_ENVELOP_FRACTION = 0.62;
const DEFAULT_ENVELOP_SWIRL_SPEED = 0.55;

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

function squaredPlanarDistance(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
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
  private readonly seed: number;
  /** Per-particle support freshness reported back by the motion resolver. */
  private readonly groundedUntil: Float32Array;
  /** Flesh actively smothering a victim; its springs soften so the shell wins. */
  private readonly envelopingUntil: Float32Array;
  private readonly wavePhase: Float32Array;
  private readonly waveFrequencyScale: Float32Array;
  private readonly waveAmplitudeScale: Float32Array;
  private readonly envelopBand: Float32Array;
  private readonly waveAmplitude: number;
  private readonly waveFrequency: number;
  private readonly crawlReturnSpeed: number;
  private readonly detachReturnDelaySeconds: number;
  private readonly envelopFlowSpeed: number;
  private readonly envelopFraction: number;
  private readonly envelopSwirlSpeed: number;
  private readonly envelopPosition = new Vector3();
  private envelopRadius = 0;
  private envelopHeight = 0;
  private envelopActive = false;
  private ballistic = false;
  private ballisticLaunchedAt = -Infinity;
  private lastGroundedFraction = 0;
  /** Staggered leap wave: fixed-step time at which each particle lifts off. */
  private readonly launchAt: Float32Array;
  private readonly launchUpScale: Float32Array;
  private readonly launchVelocity = new Vector3();
  private pendingLaunchCount = 0;
  /** First fixed-step time a component-0 particle was beyond the gel's reach. */
  private readonly strandedSince: Float32Array;
  private readonly launchStaggerSeconds: number;
  /** Neighbor-to-neighbor reach that keeps a particle part of the organism. */
  private readonly strandLinkDistance: number;
  private readonly strandSeconds: number;
  /** BFS scratch: 1 while the particle can reach the brain through the gel. */
  private readonly strandConnected: Uint8Array;
  private readonly strandQueue: Int32Array;
  private readonly strandHash: BlobSpatialHash<MutableBlobParticle>;
  /** Sub-chunk scraps melting in place to re-grow hidden inside the mass. */
  private readonly dissolvingHome: Uint8Array;
  private readonly chunkHopUpSpeed: number;
  private readonly chunkHopForwardSpeed: number;
  private readonly chunkHopBlockedSeconds: number;
  /** While set, the chunk is mid-hop and crawl steering stays out of the way. */
  private readonly chunkHopUntil: number[];
  private readonly chunkBlockedSeconds: number[];
  private readonly chunkLastPlanarDistance: number[];
  private lastGravity = 0;
  /** Grounded fraction restricted to the particles that partake in a leap. */
  private lastMainGroundedFraction = 0;
  /** Simulation time at which each gunfire-severed chunk starts crawling home. */
  private readonly detachedReturnAt: number[];
  private readonly detachedSince: number[];
  private readonly pendingAttach: boolean[];
  private readonly componentGroundY: number[];

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
    this.seed = seed;
    this.waveAmplitude = Math.max(0, finiteOr(options.waveAmplitude, 0));
    this.waveFrequency = Math.max(0, finiteOr(options.waveFrequency, 0));
    this.crawlReturnSpeed = Math.max(
      0.2,
      finiteOr(options.crawlReturnSpeed, DEFAULT_CRAWL_RETURN_SPEED),
    );
    this.detachReturnDelaySeconds = Math.max(
      0,
      finiteOr(options.detachReturnDelaySeconds, DEFAULT_DETACH_RETURN_DELAY),
    );
    this.envelopFlowSpeed = Math.max(
      0.3,
      finiteOr(options.envelopFlowSpeed, DEFAULT_ENVELOP_FLOW_SPEED),
    );
    this.envelopFraction = clamp(
      finiteOr(options.envelopFraction, DEFAULT_ENVELOP_FRACTION),
      0,
      1,
    );
    this.envelopSwirlSpeed = finiteOr(options.envelopSwirlSpeed, DEFAULT_ENVELOP_SWIRL_SPEED);
    this.launchStaggerSeconds = Math.max(
      0,
      finiteOr(options.launchStaggerSeconds, DEFAULT_LAUNCH_STAGGER_SECONDS),
    );
    this.strandSeconds = Math.max(
      BLOB_FIXED_STEP_SECONDS,
      finiteOr(options.strandSeconds, DEFAULT_STRAND_SECONDS),
    );
    // Membership reach: the larger of the gel cohesion range and actual ball
    // contact, so heavily-overlapped tunings do not shred at the first bump.
    this.strandLinkDistance =
      Math.max(
        this.separationDistance * GEL_COHESION_RANGE_SCALE,
        baseRadius * STRAND_LINK_RADIUS_SCALE,
      ) * Math.max(0.5, finiteOr(options.strandLinkScale, DEFAULT_STRAND_LINK_SCALE));
    this.chunkHopUpSpeed = Math.max(
      0,
      finiteOr(options.chunkHopUpSpeed, DEFAULT_CHUNK_HOP_UP_SPEED),
    );
    this.chunkHopForwardSpeed = Math.max(
      0,
      finiteOr(options.chunkHopForwardSpeed, DEFAULT_CHUNK_HOP_FORWARD_SPEED),
    );
    this.chunkHopBlockedSeconds = Math.max(
      BLOB_FIXED_STEP_SECONDS,
      finiteOr(options.chunkHopBlockedSeconds, DEFAULT_CHUNK_HOP_BLOCKED_SECONDS),
    );
    if (options.center) this.center.copy(options.center);

    this.mutableParticles = [];
    this.disturbedUntil = new Float32Array(this.maxParticleCount);
    this.groundedUntil = new Float32Array(this.maxParticleCount);
    this.envelopingUntil = new Float32Array(this.maxParticleCount);
    this.wavePhase = new Float32Array(this.maxParticleCount);
    this.waveFrequencyScale = new Float32Array(this.maxParticleCount);
    this.waveAmplitudeScale = new Float32Array(this.maxParticleCount);
    this.envelopBand = new Float32Array(this.maxParticleCount);
    this.launchAt = new Float32Array(this.maxParticleCount).fill(-1);
    this.launchUpScale = new Float32Array(this.maxParticleCount).fill(1);
    this.strandedSince = new Float32Array(this.maxParticleCount).fill(-1);
    this.strandConnected = new Uint8Array(this.maxParticleCount);
    this.strandQueue = new Int32Array(this.maxParticleCount);
    this.dissolvingHome = new Uint8Array(this.maxParticleCount);
    this.chunkHopUntil = new Array<number>(MAX_COMPONENTS).fill(-Infinity);
    this.chunkBlockedSeconds = new Array<number>(MAX_COMPONENTS).fill(0);
    this.chunkLastPlanarDistance = new Array<number>(MAX_COMPONENTS).fill(Number.NaN);
    this.detachedReturnAt = new Array<number>(MAX_COMPONENTS).fill(-1);
    this.detachedSince = new Array<number>(MAX_COMPONENTS).fill(-1);
    this.pendingAttach = new Array<boolean>(MAX_COMPONENTS).fill(false);
    this.componentGroundY = new Array<number>(MAX_COMPONENTS).fill(Number.NaN);
    this.normalOffsets = [];
    for (let index = 0; index < this.maxParticleCount; index++) {
      const role = roleForIndex(index);
      const offset = this.makeNormalOffset(index, role, seed);
      const position = this.center.clone().add(offset);
      const active = index < this.activeCount;
      this.normalOffsets.push(offset);
      this.wavePhase[index] = indexRandom(index, 4, seed) * Math.PI * 2;
      this.waveFrequencyScale[index] = 0.7 + 0.6 * indexRandom(index, 5, seed);
      this.waveAmplitudeScale[index] = 0.55 + 0.9 * indexRandom(index, 6, seed);
      this.envelopBand[index] = indexRandom(index, 7, seed);
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
        groundY: this.center.y - this.bodyRadius * 0.45,
        detached: false,
      });
    }
    this.components = this.mutableComponents;
    this.spatialHash = new BlobSpatialHash<MutableBlobParticle>(
      this.separationDistance * GEL_COHESION_RANGE_SCALE,
    );
    this.strandHash = new BlobSpatialHash<MutableBlobParticle>(this.strandLinkDistance);
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

  /** True while a leap keeps the organism ballistic (locomotion suspended). */
  get airborne(): boolean {
    return this.ballistic;
  }

  /** Fraction of active particles the resolver reported as supported. */
  get groundedFraction(): number {
    return this.lastGroundedFraction;
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

  /**
   * Victim the flesh should smother. Eligible particles leave the mound and
   * flow over a capsule shell around it (npc_blob converged every element on
   * its enemy and shrank the group radius); `null` releases them.
   */
  setEnvelopTarget(target: BlobEnvelopTarget | null): void {
    if (!target) {
      this.envelopActive = false;
      return;
    }
    this.envelopPosition.set(target.position.x, target.position.y, target.position.z);
    this.envelopRadius = Math.max(0.15, finiteOr(target.radius, 0.4));
    this.envelopHeight = Math.max(0.3, finiteOr(target.height, 1.6));
    this.envelopActive = true;
  }

  /**
   * Severs the local kernel into a free-flying chunk that later crawls back and
   * re-merges (the T-1000 reassembly from Valve's blobulator experiment).
   * Returns how many particles were blown off; 0 when the hit was too small,
   * a choreographed pose is held, or no component slot could be recycled.
   */
  detachAt(point: Vector3, radius: number, velocity: Vector3): number {
    if (!(radius > 0) || this.isLocomotionPaused || !Number.isFinite(velocity.lengthSq())) {
      return 0;
    }
    const radiusSq = radius * radius;
    const indices: number[] = [];
    for (let index = 1; index < this.activeCount; index++) {
      const particle = this.mutableParticles[index];
      if (!particle.active || particle.frozen || particle.scale <= 0.1) continue;
      if (particle.position.distanceToSquared(point) <= radiusSq) indices.push(index);
    }
    if (indices.length < DETACH_MIN_PARTICLES) return 0;
    const cap = Math.max(
      DETACH_MIN_PARTICLES,
      Math.floor(this.activeCount * DETACH_MAX_FRACTION),
    );
    if (indices.length > cap) {
      indices.sort(
        (a, b) =>
          this.mutableParticles[a].position.distanceToSquared(point) -
          this.mutableParticles[b].position.distanceToSquared(point),
      );
      indices.length = cap;
    }

    const slot = this.claimChunkSlot(point);
    if (slot < 0) return 0;

    for (const index of indices) {
      const particle = this.mutableParticles[index];
      particle.componentId = slot;
      if (this.launchAt[index] >= 0) {
        this.launchAt[index] = -1;
        this.pendingLaunchCount--;
      }
      const jitter = 0.86 + 0.28 * indexRandom(index, 11, this.seed);
      particle.velocity.set(
        velocity.x * jitter,
        velocity.y * (0.9 + 0.2 * indexRandom(index, 12, this.seed)),
        velocity.z * jitter,
      );
      this.clampParticleVelocity(particle);
      this.disturbedUntil[index] = this.simulationTime + 1.1;
      this.groundedUntil[index] = 0;
    }
    this.severComponentConstraints(slot);
    this.detachedReturnAt[slot] = this.simulationTime + this.detachReturnDelaySeconds;
    this.detachedSince[slot] = this.simulationTime;
    this.pendingAttach[slot] = false;
    this.resetChunkHopState(slot);
    this.shapeRelaxUntil = Math.max(this.shapeRelaxUntil, this.simulationTime + 0.6);
    this.exposureOpening = clamp(
      this.exposureOpening + 0.07 + (indices.length / Math.max(1, this.activeCount)) * 0.6,
      0,
      1,
    );
    this.refreshComponents();
    return indices.length;
  }

  /**
   * Ballistic hop of the whole organism (the "hoppy blob" prototype and the
   * navmesh jump links). Locomotion steering pauses until enough particles
   * regain support; cohesion and constraints keep the mass in one piece.
   * The liquid has weight: brain and skeleton lift off at once, lower flesh
   * follows staggered with a flatter arc, and a sliver of grounded goo stays
   * glued to the floor (stranding later severs it into a chunk that crawls
   * back home).
   */
  launch(velocity: Vector3): void {
    if (!Number.isFinite(velocity.lengthSq())) return;
    this.cancelPose();
    this.ballistic = true;
    this.ballisticLaunchedAt = this.simulationTime;
    this.launchVelocity.copy(velocity);
    this.pendingLaunchCount = 0;
    let minY = Infinity;
    let maxY = -Infinity;
    let launchable = 0;
    for (let index = 0; index < this.activeCount; index++) {
      const particle = this.mutableParticles[index];
      if (this.isDetachedChunk(particle.componentId)) continue;
      launchable++;
      const y = particle.position.y;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const span = Math.max(EPSILON, maxY - minY);
    const leaveBudget = Math.floor(launchable * LAUNCH_LEAVE_FRACTION);
    let leftBehind = 0;
    for (let index = 0; index < this.activeCount; index++) {
      const particle = this.mutableParticles[index];
      this.launchAt[index] = -1;
      if (particle.frozen) continue;
      // Detached chunks are autonomous bodies crawling home: the organism's
      // leap neither lifts them nor counts them in its launch wave.
      if (this.isDetachedChunk(particle.componentId)) continue;
      // Skeleton and arms are direct brain anchors: they must fly with the
      // brain or their springs bleed the parabola dry. The wave lives in the
      // support/flesh bulk.
      const rigid =
        index === 0 ||
        particle.role === BlobParticleRole.Structural ||
        particle.role === BlobParticleRole.TendonEnd;
      const heightT = clamp((particle.position.y - minY) / span, 0, 1);
      if (
        !rigid &&
        particle.componentId === 0 &&
        leftBehind < leaveBudget &&
        heightT < LAUNCH_LEAVE_BAND &&
        this.groundedUntil[index] > this.simulationTime &&
        indexRandom(index, 24, this.seed) < 0.5
      ) {
        leftBehind++;
        continue;
      }
      this.launchUpScale[index] = rigid
        ? 1
        : LAUNCH_MIN_UP_SCALE + (1 - LAUNCH_MIN_UP_SCALE) * heightT;
      const delay = rigid
        ? 0
        : (1 - heightT) *
          this.launchStaggerSeconds *
          (0.7 + 0.6 * indexRandom(index, 25, this.seed));
      if (delay < BLOB_FIXED_STEP_SECONDS) {
        this.applyLaunchVelocity(index);
      } else {
        this.launchAt[index] = this.simulationTime + delay;
        this.pendingLaunchCount++;
      }
    }
  }

  private applyLaunchVelocity(index: number): void {
    const particle = this.mutableParticles[index];
    particle.velocity.set(
      this.launchVelocity.x + (indexRandom(index, 21, this.seed) - 0.5) * 0.5,
      this.launchVelocity.y *
        this.launchUpScale[index] *
        (0.94 + 0.12 * indexRandom(index, 23, this.seed)),
      this.launchVelocity.z + (indexRandom(index, 22, this.seed) - 0.5) * 0.5,
    );
    this.clampParticleVelocity(particle);
    this.groundedUntil[index] = 0;
  }

  private clearPendingLaunches(): void {
    if (this.pendingLaunchCount === 0) return;
    this.launchAt.fill(-1);
    this.pendingLaunchCount = 0;
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
    this.clearPendingLaunches();
    this.merging = false;
    this.emittedMergeEvent = false;
    // Scripted splits own every component slot: forget gunfire chunk state.
    for (let id = 1; id < MAX_COMPONENTS; id++) {
      this.detachedReturnAt[id] = -1;
      this.detachedSince[id] = -1;
      this.pendingAttach[id] = false;
      this.resetChunkHopState(id);
    }
    this.dissolvingHome.fill(0);
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
    this.clearPendingLaunches();
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
    this.clearPendingLaunches();
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
    this.launchVelocity.applyQuaternion(rotation);
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
    if (this.attachPendingComponents()) this.refreshComponents();
    if (this.merging && this.attachNearbyMergeComponents()) this.refreshComponents();
    this.advanceReconnection();
    if (this.detachStrandedParticles()) this.refreshComponents();
    this.advanceDetachedLifecycles();
    this.advanceChunkReturnHops();
    this.finishBallisticIfLanded();
  }

  private isDetachedChunk(componentId: number): boolean {
    return componentId !== 0 && this.detachedReturnAt[componentId] >= 0;
  }

  /** Free component slot, or the nearest detached one recycled into the hit. */
  private claimChunkSlot(point: Vector3): number {
    for (let id = 1; id < MAX_COMPONENTS; id++) {
      if (!this.mutableComponents[id].active) return id;
    }
    let slot = -1;
    let bestDistance = Infinity;
    for (let id = 1; id < MAX_COMPONENTS; id++) {
      if (this.detachedReturnAt[id] < 0) continue;
      const distance = this.mutableComponents[id].center.distanceToSquared(point);
      if (distance < bestDistance) {
        bestDistance = distance;
        slot = id;
      }
    }
    return slot;
  }

  private severComponentConstraints(slot: number): void {
    const breakUntil = this.simulationTime + DETACH_CONSTRAINT_BREAK_SECONDS;
    for (const constraint of this.mutableConstraints) {
      if (!constraint.active) continue;
      const aOut = this.mutableParticles[constraint.particleA].componentId === slot;
      const bOut = this.mutableParticles[constraint.particleB].componentId === slot;
      if (aOut === bOut) continue;
      constraint.connection = 0;
      constraint.brokenUntil = Math.max(constraint.brokenUntil, breakUntil);
    }
  }

  private resetChunkHopState(slot: number): void {
    this.chunkHopUntil[slot] = -Infinity;
    this.chunkBlockedSeconds[slot] = 0;
    this.chunkLastPlanarDistance[slot] = Number.NaN;
  }

  /**
   * Component-0 gel that lost contact with the main mass (blasted out,
   * dangling off a ledge, goo left glued to the floor by a hop) is already
   * torn physically, yet locomotion kept steering it on an invisible leash.
   * Membership is decided by gel connectivity — neighbor-to-neighbor reach
   * back to the brain — not by distance to it: unreachable goo becomes a
   * detached chunk with the same crawl-home/reabsorb lifecycle as gunfire
   * chunks, and scraps too small for a chunk join a returning chunk nearby
   * or melt where they lie to re-grow inside the mass.
   */
  private detachStrandedParticles(): boolean {
    if (
      this.merging ||
      this.isLocomotionPaused ||
      this.simulationTime < this.splitLaunchUntil
    ) {
      return false;
    }
    this.markConnectedToBrain();
    let stranded: number[] | null = null;
    let torn = 0;
    for (let index = 1; index < this.activeCount; index++) {
      const particle = this.mutableParticles[index];
      if (
        particle.componentId !== 0 ||
        particle.frozen ||
        particle.scale <= 0.1 ||
        this.dissolvingHome[index] === 1 ||
        this.launchAt[index] >= 0 ||
        this.envelopingUntil[index] > this.simulationTime ||
        this.strandConnected[index] === 1 ||
        // Mid-leap the gel is deliberately torn and streaming; only goo that
        // stayed on the ground counts as left behind.
        (this.ballistic && this.groundedUntil[index] <= this.simulationTime)
      ) {
        this.strandedSince[index] = -1;
        continue;
      }
      if (this.strandedSince[index] < 0) {
        this.strandedSince[index] = this.simulationTime;
      }
      (stranded ??= []).push(index);
      if (this.simulationTime - this.strandedSince[index] >= this.strandSeconds) torn++;
    }
    // The tear fires once any gel has hung beyond reach for the full window,
    // and it then takes every currently-stranded particle with it: staggered
    // threshold crossings must not burn one component slot per mini-batch.
    if (!stranded || torn < 1) return false;
    TMP_C.set(0, 0, 0);
    for (const index of stranded) TMP_C.add(this.mutableParticles[index].position);
    TMP_C.multiplyScalar(1 / stranded.length);

    if (stranded.length >= DETACH_MIN_PARTICLES) {
      const slot = this.claimChunkSlot(TMP_C);
      if (slot < 0) return false;
      for (const index of stranded) {
        this.mutableParticles[index].componentId = slot;
        this.strandedSince[index] = -1;
      }
      this.severComponentConstraints(slot);
      this.detachedReturnAt[slot] = this.simulationTime + this.detachReturnDelaySeconds;
      this.detachedSince[slot] = this.simulationTime;
      this.pendingAttach[slot] = false;
      this.resetChunkHopState(slot);
      this.exposureOpening = clamp(
        this.exposureOpening +
          0.05 +
          (stranded.length / Math.max(1, this.activeCount)) * 0.5,
        0,
        1,
      );
      return true;
    }

    // Scrap below chunk size: it rides a returning chunk passing nearby or
    // melts in place and re-grows hidden inside the mass — never a satellite
    // steered by a brain it can no longer feel.
    let joinSlot = -1;
    let bestDistanceSq = (this.bodyRadius * SCRAP_JOIN_RADIUS_SCALE) ** 2;
    for (let id = 1; id < MAX_COMPONENTS; id++) {
      if (this.detachedReturnAt[id] < 0 || !this.mutableComponents[id].active) continue;
      const distanceSq = this.mutableComponents[id].center.distanceToSquared(TMP_C);
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        joinSlot = id;
      }
    }
    if (joinSlot >= 0) {
      for (const index of stranded) {
        this.mutableParticles[index].componentId = joinSlot;
        this.strandedSince[index] = -1;
      }
      this.severComponentConstraints(joinSlot);
      return true;
    }
    for (const index of stranded) {
      this.dissolvingHome[index] = 1;
      this.strandedSince[index] = -1;
    }
    return false;
  }

  /** Marks every component-0 particle reachable from the brain through gel links. */
  private markConnectedToBrain(): void {
    this.strandConnected.fill(0);
    this.strandHash.rebuild(this.mutableParticles);
    this.strandConnected[0] = 1;
    this.strandQueue[0] = 0;
    let head = 0;
    let tail = 1;
    while (head < tail) {
      const current = this.mutableParticles[this.strandQueue[head++]];
      this.strandHash.forEachNear(current.position, this.strandLinkDistance, (neighbor) => {
        if (
          this.strandConnected[neighbor.index] === 1 ||
          neighbor.componentId !== 0 ||
          neighbor.scale <= 0.1 ||
          this.dissolvingHome[neighbor.index] === 1
        ) {
          return;
        }
        this.strandConnected[neighbor.index] = 1;
        this.strandQueue[tail++] = neighbor.index;
      });
    }
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

    const gravity = Math.max(0, finiteOr(input.gravity, 0));
    this.lastGravity = gravity;
    const planarSpeed = Math.hypot(TMP_A.x, TMP_A.z);
    const speedFactor = this.locomotionSpeed > EPSILON
      ? clamp(planarSpeed / this.locomotionSpeed, 0, 1)
      : 0;
    let waveRightX = 0;
    let waveRightZ = 0;
    const undulating =
      !this.ballistic &&
      !this.merging &&
      this.waveAmplitude > 0 &&
      this.waveFrequency > 0 &&
      planarSpeed > this.locomotionSpeed * 0.15 &&
      planarSpeed > EPSILON;
    if (undulating) {
      waveRightX = TMP_A.z / planarSpeed;
      waveRightZ = -TMP_A.x / planarSpeed;
    }
    const enveloping = this.envelopActive && !this.ballistic && !this.merging;
    const envelopEngageSq = (this.envelopRadius + this.bodyRadius * 1.7) ** 2;
    const envelopBaseY = Number.isFinite(this.componentGroundY[0])
      ? this.componentGroundY[0]
      : this.envelopPosition.y - this.envelopHeight * 0.5;

    for (let index = 0; index < this.activeCount; index++) {
      const particle = this.mutableParticles[index];
      if (particle.frozen) continue;
      let gravityApplies = gravity > 0;

      if (
        particle.componentId !== 0 &&
        !this.merging &&
        this.mutableComponents[particle.componentId].detached
      ) {
        // Severed chunk: an autonomous body, even while the organism leaps.
        // Ballistic during its launch grace or its own return hop, then a
        // ground crawl straight back to the main mass until proximity
        // re-attaches it. The brain's steering never reaches this goo.
        if (
          this.simulationTime >= this.detachedReturnAt[particle.componentId] &&
          this.simulationTime >= this.chunkHopUntil[particle.componentId]
        ) {
          const component = this.mutableComponents[particle.componentId];
          TMP_B.subVectors(this.mutableComponents[0].center, component.center);
          TMP_B.y = 0;
          const distance = TMP_B.length();
          if (distance > EPSILON) {
            TMP_B.multiplyScalar(this.crawlReturnSpeed / distance);
            const blend = Math.min(1, 5 * BLOB_FIXED_STEP_SECONDS);
            particle.velocity.x += (TMP_B.x - particle.velocity.x) * blend;
            particle.velocity.z += (TMP_B.z - particle.velocity.z) * blend;
          }
        }
      } else if (this.ballistic) {
        // In flight the mass is a projectile: gravity below, no steering.
        // Delayed flesh keeps its weight until the launch wave reaches it.
        if (this.launchAt[index] >= 0 && this.simulationTime >= this.launchAt[index]) {
          this.launchAt[index] = -1;
          this.pendingLaunchCount--;
          this.applyLaunchVelocity(index);
        } else if (index !== 0 && this.groundedUntil[index] > this.simulationTime) {
          // Goo the leap left on the floor keeps no steering; without it only
          // friction remains, so it stops instead of sliding after the
          // parabola at its pre-jump speed.
          const friction = Math.min(1, 6 * BLOB_FIXED_STEP_SECONDS);
          particle.velocity.x -= particle.velocity.x * friction;
          particle.velocity.z -= particle.velocity.z * friction;
        }
      } else if (this.dissolvingHome[index] === 1) {
        // Melting scrap holds its ground while it fades back into the mass.
        const friction = Math.min(1, 6 * BLOB_FIXED_STEP_SECONDS);
        particle.velocity.x -= particle.velocity.x * friction;
        particle.velocity.z -= particle.velocity.z * friction;
      } else if (
        enveloping &&
        index !== 0 &&
        particle.componentId === 0 &&
        (particle.role === BlobParticleRole.Flesh ||
          particle.role === BlobParticleRole.TendonEnd) &&
        this.envelopBand[index] < this.envelopFraction &&
        squaredPlanarDistance(particle.position, this.envelopPosition) <= envelopEngageSq
      ) {
        // Deterministic slot on a capsule shell around the victim, feet to
        // head, with a slow swirl so the sheath keeps flowing while it kills.
        const band = this.envelopBand[index] / Math.max(EPSILON, this.envelopFraction);
        const angle = index * GOLDEN_ANGLE + this.simulationTime * this.envelopSwirlSpeed;
        const shell = this.envelopRadius + particle.radius * 0.85;
        TMP_B.set(
          this.envelopPosition.x + Math.cos(angle) * shell - particle.position.x,
          envelopBaseY + 0.05 + band * this.envelopHeight - particle.position.y,
          this.envelopPosition.z + Math.sin(angle) * shell - particle.position.z,
        );
        const distance = TMP_B.length();
        if (distance > EPSILON) {
          TMP_B.multiplyScalar(Math.min(this.envelopFlowSpeed, distance * 6) / distance);
          particle.velocity.lerp(TMP_B, Math.min(1, 9 * BLOB_FIXED_STEP_SECONDS));
        }
        this.envelopingUntil[index] = this.simulationTime + 0.15;
        // Smothering flesh clings to the victim instead of raining off it.
        gravityApplies = false;
      } else {
        // Locomotion translates one organism. Role-dependent response made
        // flesh lag metres behind the brain and turned the mass into a chain
        // of lobes. Deformation still comes from constraints, contacts,
        // impacts and poses. Steering is horizontal: the vertical axis belongs
        // to gravity/support when a physics motor drives the organism.
        const recentlyHit = this.disturbedUntil[index] > this.simulationTime;
        const blend = Math.min(1, (recentlyHit ? 1.8 : 6) * BLOB_FIXED_STEP_SECONDS);
        particle.velocity.x += (TMP_A.x - particle.velocity.x) * blend;
        particle.velocity.z += (TMP_A.z - particle.velocity.z) * blend;
        if (gravity <= 0) {
          particle.velocity.y += (TMP_A.y - particle.velocity.y) * blend;
        }
        if (
          undulating &&
          index !== 0 &&
          (gravity <= 0 || this.groundedUntil[index] > this.simulationTime)
        ) {
          const wave = Math.sin(
            this.simulationTime * this.waveFrequency * this.waveFrequencyScale[index] +
              this.wavePhase[index],
          );
          const amplitude = this.waveAmplitude * this.waveAmplitudeScale[index] * speedFactor;
          particle.velocity.x += waveRightX * wave * amplitude;
          particle.velocity.z += waveRightZ * wave * amplitude;
        }
      }

      if (gravityApplies) {
        if (this.groundedUntil[index] > this.simulationTime && particle.velocity.y < 0) {
          particle.velocity.y = 0;
        } else {
          particle.velocity.y = Math.max(
            particle.velocity.y - gravity * BLOB_FIXED_STEP_SECONDS,
            -GRAVITY_TERMINAL_SPEED,
          );
        }
      }
      this.clampParticleVelocity(particle);
    }
    if (!this.merging && this.simulationTime < this.splitLaunchUntil) {
      const launchBlend = Math.min(1, 10 * BLOB_FIXED_STEP_SECONDS);
      for (let index = 0; index < this.activeCount; index++) {
        const particle = this.mutableParticles[index];
        if (particle.frozen || this.isDetachedChunk(particle.componentId)) continue;
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
      // Springs pull harder than the envelop flow can push; while an end is
      // smothering a victim the link softens so the shell shape can win.
      // Same yield across the launch wave: airborne mass must not stay
      // anchored to flesh still waiting on the ground, and while ballistic
      // every spring slackens — trailing goo streams behind the parabola
      // instead of stealing the brain's apex.
      const waveSoftness =
        (this.launchAt[constraint.particleA] >= 0) !==
        (this.launchAt[constraint.particleB] >= 0)
          ? 0.15
          : this.ballistic
            ? 0.35
            : 1;
      const softness =
        this.envelopingUntil[constraint.particleA] > this.simulationTime ||
        this.envelopingUntil[constraint.particleB] > this.simulationTime
          ? 0.3
          : waveSoftness;
      const correctionDistance = clamp(
        (distance - constraint.restLength) *
          constraint.stiffness *
          constraint.connection *
          0.5 *
          softness,
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
    const attachDistanceSq =
      (this.separationDistance * DETACH_ATTACH_DISTANCE_SCALE) ** 2;
    this.spatialHash.forEachPair(cohesionRange, (a, b, distanceSq) => {
      if (a.componentId !== b.componentId) {
        // A returning chunk that touches the main gel is absorbed: mark the
        // attach and pull both sides together so the merge reads as liquid.
        const detachedId = this.returningChunkIdForPair(a, b);
        if (detachedId < 0) return;
        if (distanceSq <= attachDistanceSq) {
          this.pendingAttach[detachedId] = true;
          return;
        }
        const distance = Math.sqrt(distanceSq);
        if (distance <= EPSILON) return;
        TMP_A.subVectors(b.position, a.position).multiplyScalar(1 / distance);
        const pull = GEL_COHESION_PER_PAIR * DETACH_CROSS_COHESION_SCALE;
        if (a.role !== BlobParticleRole.Brain) a.position.addScaledVector(TMP_A, pull);
        if (b.role !== BlobParticleRole.Brain) b.position.addScaledVector(TMP_A, -pull);
        return;
      }
      let distance = Math.sqrt(distanceSq);
      if (distance <= EPSILON) {
        const angle = (a.index * 31 + b.index * 17) * GOLDEN_ANGLE;
        TMP_A.set(Math.cos(angle), 0.2, Math.sin(angle)).normalize();
        distance = 0;
      } else {
        TMP_A.subVectors(b.position, a.position).multiplyScalar(1 / distance);
      }
      // Across the launch wave the gel is tearing: cohesion and viscosity
      // must not glue airborne mass to flesh still waiting on the ground.
      const waveTorn =
        (this.launchAt[a.index] >= 0) !== (this.launchAt[b.index] >= 0);
      if (distance < this.separationDistance) {
        const push = (this.separationDistance - distance) * 0.19;
        const aWeight = this.gelInverseMass(a);
        const bWeight = this.gelInverseMass(b);
        const inverseWeight = 2 / (aWeight + bWeight);
        a.position.addScaledVector(TMP_A, -push * aWeight * inverseWeight);
        b.position.addScaledVector(TMP_A, push * bWeight * inverseWeight);
      } else if (!waveTorn) {
        const attraction =
          GEL_COHESION_PER_PAIR *
          (1 - (distance - this.separationDistance) / (cohesionRange - this.separationDistance));
        const aWeight = this.gelInverseMass(a);
        const bWeight = this.gelInverseMass(b);
        const inverseWeight = 2 / (aWeight + bWeight);
        a.position.addScaledVector(TMP_A, attraction * aWeight * inverseWeight);
        b.position.addScaledVector(TMP_A, -attraction * bWeight * inverseWeight);
      }
      if (waveTorn) return;
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

  /** True when exactly one of the pair belongs to a chunk crawling home. */
  private returningChunkIdForPair(a: MutableBlobParticle, b: MutableBlobParticle): number {
    const aReturning =
      a.componentId !== 0 &&
      this.detachedReturnAt[a.componentId] >= 0 &&
      this.simulationTime >= this.detachedReturnAt[a.componentId];
    const bReturning =
      b.componentId !== 0 &&
      this.detachedReturnAt[b.componentId] >= 0 &&
      this.simulationTime >= this.detachedReturnAt[b.componentId];
    if (aReturning && b.componentId === 0) return a.componentId;
    if (bReturning && a.componentId === 0) return b.componentId;
    return -1;
  }

  /** Weak plastic shape matching for the internal skeleton, never the flesh. */
  private applyStructureTether(): void {
    if (this.ballistic) return;
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

  /** Absorbs returning chunks whose gel touched the main mass this step. */
  private attachPendingComponents(): boolean {
    let changed = false;
    const nearMainSq = (this.bodyRadius * 0.85) ** 2;
    for (let id = 1; id < MAX_COMPONENTS; id++) {
      const component = this.mutableComponents[id];
      if (!component.active || this.detachedReturnAt[id] < 0) {
        this.pendingAttach[id] = false;
        continue;
      }
      const nearMain =
        component.center.distanceToSquared(this.mutableComponents[0].center) <= nearMainSq;
      if (!this.pendingAttach[id] && !nearMain) continue;
      for (const particleIndex of component.particleIndices) {
        this.mutableParticles[particleIndex].componentId = 0;
      }
      this.detachedReturnAt[id] = -1;
      this.detachedSince[id] = -1;
      this.pendingAttach[id] = false;
      changed = true;
    }
    return changed;
  }

  /**
   * Chunks stranded beyond recovery dissolve in place and re-grow hidden
   * inside the mass, exactly how npc_blob re-spawned elements over existing
   * ones. Reabsorbed skin also ramps its scale back here.
   */
  private advanceDetachedLifecycles(): void {
    for (let id = 1; id < MAX_COMPONENTS; id++) {
      const component = this.mutableComponents[id];
      if (!component.active || this.detachedSince[id] < 0) continue;
      if (this.simulationTime - this.detachedSince[id] < DETACH_REABSORB_SECONDS) continue;
      let remaining = 0;
      for (const particleIndex of component.particleIndices) {
        const particle = this.mutableParticles[particleIndex];
        particle.scale = Math.max(
          0,
          particle.scale - BLOB_FIXED_STEP_SECONDS / DETACH_DISSOLVE_SECONDS,
        );
        if (particle.scale > 0.02) {
          remaining++;
          continue;
        }
        particle.componentId = 0;
        TMP_A.copy(this.center).addScaledVector(this.normalOffsets[particleIndex], 0.45);
        particle.position.copy(TMP_A);
        particle.previousPosition.copy(TMP_A);
        particle.renderPosition.copy(TMP_A);
        particle.velocity.copy(this.velocity);
      }
      if (remaining === 0) {
        this.detachedReturnAt[id] = -1;
        this.detachedSince[id] = -1;
        this.pendingAttach[id] = false;
      }
    }
    for (let index = 1; index < this.activeCount; index++) {
      const particle = this.mutableParticles[index];
      if (!particle.active || particle.componentId !== 0) continue;
      if (this.dissolvingHome[index] === 1) {
        particle.scale = Math.max(
          0,
          particle.scale - BLOB_FIXED_STEP_SECONDS / DETACH_DISSOLVE_SECONDS,
        );
        if (particle.scale > 0.02) continue;
        this.dissolvingHome[index] = 0;
        TMP_A.copy(this.center).addScaledVector(this.normalOffsets[index], 0.45);
        particle.position.copy(TMP_A);
        particle.previousPosition.copy(TMP_A);
        particle.renderPosition.copy(TMP_A);
        particle.velocity.copy(this.velocity);
        continue;
      }
      if (particle.scale < 1) {
        particle.scale = Math.min(
          1,
          particle.scale + BLOB_FIXED_STEP_SECONDS / SCALE_REGROW_SECONDS,
        );
      }
    }
  }

  /**
   * A returning chunk whose crawl stops gaining ground (pinned against a
   * ledge, a crate, a fence) performs its own small ballistic hop toward the
   * main mass — hoppy-blob mobility applied to the severed goo instead of an
   * eternal shove against the obstacle. Requires real gravity: weightless
   * pure simulations keep the plain crawl.
   */
  private advanceChunkReturnHops(): void {
    if (this.lastGravity <= 0 || this.merging || this.isLocomotionPaused) return;
    const main = this.mutableComponents[0];
    for (let id = 1; id < MAX_COMPONENTS; id++) {
      const component = this.mutableComponents[id];
      if (
        !component.active ||
        this.detachedReturnAt[id] < 0 ||
        this.simulationTime < this.detachedReturnAt[id] ||
        this.simulationTime < this.chunkHopUntil[id]
      ) {
        this.chunkBlockedSeconds[id] = 0;
        this.chunkLastPlanarDistance[id] = Number.NaN;
        continue;
      }
      const dx = main.center.x - component.center.x;
      const dz = main.center.z - component.center.z;
      const planar = Math.hypot(dx, dz);
      const previous = this.chunkLastPlanarDistance[id];
      this.chunkLastPlanarDistance[id] = planar;
      if (planar <= this.bodyRadius || !Number.isFinite(this.componentGroundY[id])) {
        this.chunkBlockedSeconds[id] = 0;
        continue;
      }
      if (!Number.isFinite(previous)) continue;
      const progress = (previous - planar) / BLOB_FIXED_STEP_SECONDS;
      if (progress >= this.crawlReturnSpeed * CHUNK_HOP_MIN_PROGRESS_FRACTION) {
        this.chunkBlockedSeconds[id] = 0;
        continue;
      }
      this.chunkBlockedSeconds[id] += BLOB_FIXED_STEP_SECONDS;
      if (this.chunkBlockedSeconds[id] < this.chunkHopBlockedSeconds) continue;
      this.chunkBlockedSeconds[id] = 0;
      this.chunkLastPlanarDistance[id] = Number.NaN;
      const inversePlanar = 1 / Math.max(EPSILON, planar);
      const directionX = dx * inversePlanar;
      const directionZ = dz * inversePlanar;
      const forward = Math.min(this.chunkHopForwardSpeed, planar * 1.5);
      this.chunkHopUntil[id] =
        this.simulationTime +
        clamp(
          (2 * this.chunkHopUpSpeed) / Math.max(1, this.lastGravity),
          CHUNK_HOP_MIN_AIR_SECONDS,
          CHUNK_HOP_MAX_AIR_SECONDS,
        );
      for (const particleIndex of component.particleIndices) {
        const particle = this.mutableParticles[particleIndex];
        if (particle.frozen) continue;
        const planarJitter = 0.88 + 0.24 * indexRandom(particleIndex, 27, this.seed);
        particle.velocity.set(
          directionX * forward * planarJitter,
          this.chunkHopUpSpeed * (0.92 + 0.16 * indexRandom(particleIndex, 28, this.seed)),
          directionZ * forward * planarJitter,
        );
        this.clampParticleVelocity(particle);
        this.groundedUntil[particleIndex] = 0;
      }
    }
  }

  private finishBallisticIfLanded(): void {
    if (!this.ballistic) return;
    const airTime = this.simulationTime - this.ballisticLaunchedAt;
    // While the launch wave is still travelling down the mass, the grounded
    // fraction counts particles that simply have not lifted off yet.
    if (airTime >= BALLISTIC_MAX_SECONDS) this.clearPendingLaunches();
    if (airTime < BALLISTIC_MIN_AIR_SECONDS || this.pendingLaunchCount > 0) return;
    // Detached chunks never left the ground with the leap; counting their
    // support would let a big grounded chunk "land" the flight mid-air.
    if (
      this.lastMainGroundedFraction >= BALLISTIC_LANDED_FRACTION ||
      airTime >= BALLISTIC_MAX_SECONDS
    ) {
      this.ballistic = false;
      this.shapeRelaxUntil = Math.max(this.shapeRelaxUntil, this.simulationTime + 0.45);
    }
  }

  private resolveParticleMotions(resolver: BlobParticleMotionResolver | undefined): void {
    if (!resolver) return;
    let groundedCount = 0;
    let launchCandidates = 0;
    let launchGrounded = 0;
    for (let index = 0; index < this.activeCount; index++) {
      const particle = this.mutableParticles[index];
      const chunkParticle = this.isDetachedChunk(particle.componentId);
      if (!chunkParticle) launchCandidates++;
      TMP_A.subVectors(particle.position, particle.previousPosition);
      const maxStepSpeed = particle.role === BlobParticleRole.Brain
        ? (this.disturbedUntil[index] > this.simulationTime || this.ballistic
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
        if (resolved.grounded) {
          this.groundedUntil[index] = this.simulationTime + GROUNDED_GRACE_SECONDS;
          groundedCount++;
          if (!chunkParticle) launchGrounded++;
        }
      } else {
        particle.position.copy(resolved);
      }
      this.clampParticleVelocity(particle);
    }
    this.lastGroundedFraction = this.activeCount > 0 ? groundedCount / this.activeCount : 0;
    this.lastMainGroundedFraction =
      launchCandidates > 0 ? launchGrounded / launchCandidates : 0;
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
      this.componentGroundY[component.id] = Number.NaN;
    }
    for (let index = 0; index < this.activeCount; index++) {
      const particle = this.mutableParticles[index];
      const component = this.mutableComponents[particle.componentId];
      component.active = true;
      component.particleIndices.push(index);
      component.center.add(particle.position);
      component.velocity.add(particle.velocity);
      if (this.groundedUntil[index] > this.simulationTime) {
        const contactY = particle.position.y - particle.radius;
        const known = this.componentGroundY[particle.componentId];
        if (!Number.isFinite(known) || contactY < known) {
          this.componentGroundY[particle.componentId] = contactY;
        }
      }
    }
    for (const component of this.mutableComponents) {
      if (!component.active) {
        component.center.copy(this.center);
        component.detached = false;
        if (component.id !== 0) {
          this.detachedReturnAt[component.id] = -1;
          this.detachedSince[component.id] = -1;
          this.pendingAttach[component.id] = false;
          this.resetChunkHopState(component.id);
        }
        component.groundY = this.center.y - this.bodyRadius * 0.45;
        continue;
      }
      const inverseCount = 1 / component.particleIndices.length;
      component.center.multiplyScalar(inverseCount);
      component.velocity.multiplyScalar(inverseCount);
      component.detached = component.id !== 0 && this.detachedReturnAt[component.id] >= 0;
      component.groundY = Number.isFinite(this.componentGroundY[component.id])
        ? this.componentGroundY[component.id]
        : component.center.y - this.bodyRadius * 0.45;
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
  BlobEnvelopTarget,
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
