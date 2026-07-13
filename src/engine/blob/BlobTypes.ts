import type { Quaternion, Vector3 } from "three";
import type { Vec3 } from "@shared/math/Vec3";

/** Semantic jobs inside the organism. Roles never change after allocation. */
export enum BlobParticleRole {
  Brain = "brain",
  Structural = "structural",
  Support = "support",
  TendonEnd = "tendonEnd",
  Flesh = "flesh",
}

export type BlobConstraintKind = "structural" | "tendon";

export interface BlobParticle {
  readonly index: number;
  readonly role: BlobParticleRole;
  readonly position: Vector3;
  /** Position at the beginning of the latest fixed step. */
  readonly previousPosition: Vector3;
  /** Interpolated position for render/hitbox consumers. */
  readonly renderPosition: Vector3;
  readonly velocity: Vector3;
  readonly radius: number;
  componentId: number;
  active: boolean;
  scale: number;
  frozen: boolean;
}

export interface BlobConstraint {
  readonly index: number;
  readonly kind: BlobConstraintKind;
  readonly particleA: number;
  readonly particleB: number;
  readonly restLength: number;
  readonly stiffness: number;
  /** Preallocated constraints stay active; split components disconnect them. */
  active: boolean;
  /** 0 while severed by a split and 0..1 while reconnecting. */
  connection: number;
  /** Simulation time at which an impact-severed constraint may work again. */
  brokenUntil: number;
}

export interface BlobComponent {
  readonly id: number;
  readonly particleIndices: number[];
  readonly center: Vector3;
  readonly velocity: Vector3;
  active: boolean;
  /** World Y of the lowest supported particle; reference for climb budgets. */
  groundY: number;
  /** True for severed chunks (gunfire or stranding) crawling back home. */
  detached: boolean;
}

/** Victim capsule the flesh flows over while the organism smothers it. */
export interface BlobEnvelopTarget {
  position: Vec3;
  radius: number;
  height: number;
}

export const BLOB_POSE_KINDS = [
  "mound",
  "sphere",
  "hemisphere",
  "column",
  "tendril",
  "bridge",
  "wall",
] as const;

export type BlobPoseKind = (typeof BLOB_POSE_KINDS)[number];

/** Content-facing pose. Marker names are resolved by the game layer. */
export interface BlobPoseDefinition {
  id?: string;
  kind: BlobPoseKind;
  marker?: string;
  targetMarker?: string;
  center?: Vec3;
  target?: Vec3;
  direction?: Vec3;
  duration?: number;
  radius?: number;
  length?: number;
  width?: number;
  height?: number;
  depth?: number;
}

export interface NpcTeleportTransform {
  /** Absolute destination of the brain/organism center. */
  position: Vec3;
  /** Rotation applied to the complete pose around the brain. */
  rotation?: Quaternion | { readonly x: number; readonly y: number; readonly z: number; readonly w: number };
  /** New center velocity. Internal relative velocities are preserved. */
  velocity?: Vec3;
}

export interface BlobStepInput {
  /** Soft world-space anchor used by a motor. `center` is a compatibility alias. */
  anchor?: Vec3;
  center?: Vec3;
  /** World-space locomotion target. Ignored while a non-normal pose is held. */
  target?: Vec3 | null;
  desiredVelocity?: Vec3;
  frozen?: boolean;
  /**
   * Downward acceleration (m/s²) integrated on unsupported particles. Supplied
   * by the physics motor; pure simulations omit it and stay weightless.
   */
  gravity?: number;
  /** Optional per-step sphere sweep supplied by BlobMotor/Rapier. */
  motionResolver?: BlobParticleMotionResolver;
}

export interface BlobStepResult {
  /** Number of 30 Hz simulation steps executed by this render update. */
  steps: number;
  /** Previous/current interpolation factor in [0, 1). */
  alpha: number;
  /** Time discarded by the recovery cap, in seconds. */
  droppedTime: number;
}

export interface BlobOrganismOptions {
  center?: Vec3;
  /** Active at spawn. Values are clamped to the organism limits. */
  initialParticleCount?: number;
  /** Allocated once. Values are clamped to 192..250. */
  maxParticleCount?: number;
  particleRadius?: number;
  bodyRadius?: number;
  separationDistance?: number;
  locomotionSpeed?: number;
  seed?: number;
  /**
   * Sideways sine undulation while travelling (Valve's insect-like variance).
   * Amplitude is a velocity in m/s; 0 (default) disables the wobble.
   */
  waveAmplitude?: number;
  waveFrequency?: number;
  /**
   * Liquid weight on leaps: the lowest flesh lifts off up to this many
   * seconds after the brain instead of the whole mass jumping as one body.
   */
  launchStaggerSeconds?: number;
  /**
   * Scale on the neighbor-to-neighbor reach (gel cohesion range or ball
   * contact, whichever is larger) that keeps a particle connected to the
   * organism; goo beyond every link is stranded.
   */
  strandLinkScale?: number;
  /** Seconds a particle must stay beyond reach before it severs as a chunk. */
  strandSeconds?: number;
  /** Ground crawl speed of shot-off chunks returning to the main mass. */
  crawlReturnSpeed?: number;
  /** Ballistic grace before a detached chunk starts crawling back. */
  detachReturnDelaySeconds?: number;
  /** Upward speed of a returning chunk's hop once its crawl is blocked. */
  chunkHopUpSpeed?: number;
  /** Planar speed toward the main mass during a blocked chunk's hop. */
  chunkHopForwardSpeed?: number;
  /** Seconds without crawl progress before a returning chunk hops. */
  chunkHopBlockedSeconds?: number;
  /** Flow speed of flesh climbing over an envelop victim. */
  envelopFlowSpeed?: number;
  /** Fraction of eligible flesh allowed to leave the mound to envelop. */
  envelopFraction?: number;
  /** Angular drift of the envelop sheath (rad/s); keeps the skin alive. */
  envelopSwirlSpeed?: number;
  /** Default per-particle sweep/slide adapter. Pure simulations may omit it. */
  motionResolver?: BlobParticleMotionResolver;
}

export interface BlobResolvedMotion {
  /** Collision-corrected absolute particle position. */
  position: Vec3;
  /** Optional collision-corrected velocity (for example after sliding). */
  velocity?: Vec3;
  /** The sweep rested on a walkable surface; gates gravity accumulation. */
  grounded?: boolean;
}

/**
 * Bridge to the physics layer. The runtime combines locomotion, constraints,
 * separation, impacts and poses, then asks the resolver to sweep that single
 * desired displacement. Teleports intentionally bypass sweeps atomically.
 */
export type BlobParticleMotionResolver = (
  particle: BlobParticle,
  from: Vector3,
  desiredPosition: Vector3,
) => BlobResolvedMotion | Vec3 | void;

export type BlobControlEvent =
  | { type: "poseReached"; poseId?: string; pose: BlobPoseKind }
  | { type: "poseReset" }
  | { type: "split"; components: number }
  | { type: "merged" }
  | { type: "error"; command: string; reason: string };
