import RAPIER from "@dimforge/rapier3d-compat";
import { MathUtils, Quaternion, Vector3 } from "three";
import type { NavAgentProfile, NavigationActionLink, BlobFlowOpening, NavigationPath } from "@engine/ai/navigation/NavigationTypes";
import type { NavigationRequestQueue } from "@engine/ai/navigation/NavigationRequestQueue";
import {
  BLOB_V2_FIXED_STEP_SECONDS,
  BLOB_V2_INITIAL_BIOMASS,
  type BlobFragmentObservation,
  type BlobIslandId,
  type BlobOrganismSnapshot,
  type BlobParticleContactResult,
  type BlobStepInput,
  type BlobVector3,
} from "@engine/blob/v2/BlobV2Types";
import type { BlobOrganismController } from "@engine/blob/v2/BlobOrganismController";
import {
  portalDeltaQuaternion,
  portalNormal,
  segmentCrossesPortal,
  transformDirectionThroughPortal,
  transformPointThroughPortal,
} from "@engine/portals/PortalMath";
import type { PortalFrame, PortalPairState, PortalSlot } from "@engine/portals/PortalFrame";
import type { PhysicsMetadata, PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { CharacterMotorSnapshot, NpcMotor, SliceHit } from "@engine/physics/character/NpcMotor";

export interface BlobV2ParticleTargetInput {
  readonly particleTargets?: Readonly<Record<number, BlobVector3>>;
  readonly particleTargetStrength?: number;
}

export type BlobV2ParticleTargetProvider = (deltaSeconds: number) => BlobV2ParticleTargetInput;

export interface BlobV2MotorConfig {
  readonly id: string;
  readonly maxSpeed: number;
  readonly acceleration: number;
  readonly turnSpeed: number;
  readonly metadata: PhysicsMetadata;
  readonly gravity?: number;
  /** Normal terrain traversal is hard-capped at 0.32 m. */
  readonly stepUpHeight?: number;
  readonly climbSpeed?: number;
  readonly flowSpeed?: number;
  readonly fragmentReturnSpeed?: number;
  /** Maximum prop acceleration supplied by the whole organism, in m/s per second. */
  readonly propPushMaxDeltaV?: number;
  readonly portals?: PortalPairState;
  readonly navigationRequests?: NavigationRequestQueue;
  readonly navigationProfile?: NavAgentProfile;
  /** Optional pose/script data. Physics-owned fields are always overwritten. */
  readonly stepInputProvider?: () => Partial<BlobStepInput>;
  readonly particleTargetProvider?: BlobV2ParticleTargetProvider;
  /** World-facing adapters (props/telemetry) observe only committed snapshots. */
  readonly onAfterStep?: (deltaSeconds: number, snapshot: BlobOrganismSnapshot) => void;
}

export interface BlobV2TraversalDebugSnapshot {
  readonly kind: "none" | "climb" | "flow";
  readonly linkId: string | null;
  readonly crossedFraction: number;
  readonly requiredFraction: number;
  readonly coreReleased: boolean;
  readonly rejectedReason: string | null;
  readonly channelAssignments: Readonly<Record<number, number>>;
}

interface CellInfo {
  readonly id: number;
  islandId: BlobIslandId;
  isCore: boolean;
  position: BlobVector3;
}

interface ActiveTraversal {
  readonly link: NavigationActionLink;
  readonly kind: "climb" | "flow";
  readonly direction: Vector3;
  readonly side: Vector3;
  readonly midpoint: Vector3;
  readonly openings: readonly BlobFlowOpening[];
  readonly channelAssignments: Map<number, number>;
  readonly requiredFraction: number;
  elapsed: number;
  crossedFraction: number;
  coreReleased: boolean;
}

interface FragmentPathState {
  readonly points: Vector3[];
  readonly actions: NavigationPath["actions"];
  index: number;
  activeActionPointIndex: number | null;
}

interface ScriptedIslandMotion {
  readonly target: Vector3;
  readonly merging: boolean;
}

interface PropPush {
  readonly body: RAPIER.RigidBody;
  readonly impulse: Vector3;
  readonly point: Vector3;
}

interface FlatGroundContact {
  readonly collider: RAPIER.Collider;
  readonly anchorX: number;
  readonly anchorZ: number;
  readonly centerY: number;
  readonly radius: number;
}

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 } as const;
const Y_AXIS = new Vector3(0, 1, 0);
const ZERO = new Vector3();
const MOTION_EPSILON_SQ = 1e-9;
const SKIN = 0.012;
const MAX_SWEEPS = 3;
const MAX_DEPENETRATION_PASSES = 2;
const GROUND_NORMAL_Y = 0.55;
const WALL_NORMAL_Y = 0.35;
const NORMAL_STEP_MAX = 0.32;
const CLIMB_MIN = 0.33;
const CLIMB_MAX = 1.25;
const DEFAULT_GRAVITY = 18;
const FRAGMENT_PATH_STALL_OWNER_PREFIX = "blob-v2-fragment";
const PORTAL_COOLDOWN_SECONDS = 0.25;
const PORTAL_EXIT_PAD = 0.06;
const DEFAULT_PROP_PUSH_MAX_DELTAV = 14;
const PROP_PUSH_SPEED_TRANSFER = 0.34;

/**
 * Particle-swept NpcMotor adapter for Blob V2. Its Rapier body is only a tiny
 * sensor; authoritative movement remains in BlobOrganismController.
 */
export class BlobV2Motor implements NpcMotor {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;

  private readonly desiredVelocity = new Vector3();
  private readonly actualVelocity = new Vector3();
  private readonly forward = new Vector3(0, 0, 1);
  private readonly rotation = new Quaternion();
  private readonly position = new Vector3();
  private readonly previousCore = new Vector3();
  private readonly targetDelta = new Vector3();
  private readonly targetVelocity = new Vector3();
  private readonly resolvedPosition = new Vector3();
  private readonly resolvedVelocity = new Vector3();
  private readonly remaining = new Vector3();
  private readonly normal = new Vector3();
  private readonly stepProbe = new Vector3();
  private readonly guidedDesired = new Vector3();
  private readonly actionTarget = new Vector3();
  private readonly portalQuaternion = new Quaternion();
  private readonly portalTranslation = new Vector3();
  private readonly portalPoint = new Vector3();
  private readonly portalVelocity = new Vector3();
  private readonly portalExitNormal = new Vector3();
  private readonly mainShape: RAPIER.Ball;
  private readonly motionResult: {
    position: Vector3;
    velocity: Vector3;
    grounded: boolean;
    normal: Vector3;
  };
  private readonly cellInfoById = new Map<number, CellInfo>();
  private readonly mainCellIds: number[] = [];
  private readonly mainCellOrdinal = new Map<number, number>();
  private readonly scriptedMotions = new Map<BlobIslandId, ScriptedIslandMotion>();
  private readonly fragmentPaths = new Map<number, FragmentPathState>();
  private readonly pendingFragmentPaths = new Set<number>();
  private readonly fragmentPortalCooldown = new Map<BlobIslandId, number>();
  private readonly propPushes = new Map<number, PropPush>();
  private readonly flatGroundContacts = new Map<number, FlatGroundContact>();
  private readonly fragmentObservations: Record<number, BlobFragmentObservation> = {};
  private enabled = true;
  private frozen = false;
  private shattered = false;
  private speedMultiplier = 1;
  private yaw = 0;
  private targetYaw = 0;
  private distanceToTarget = Number.POSITIVE_INFINITY;
  private grounded = false;
  private groundedContacts = 0;
  private contactSamples = 0;
  private activeTraversal: ActiveTraversal | null = null;
  private lastRejectedTraversal: string | null = null;
  private portalExclusions: ReadonlySet<number> | null = null;
  private particleTargetProvider: BlobV2ParticleTargetProvider | null;
  private leapActive = false;
  private leapElapsed = 0;
  private leapStartY = 0;
  private readonly leapVelocity = new Vector3();
  private portalTraversalSeconds = 0;
  private sweepIsFragment = false;
  private lastStaticGroundCollider: RAPIER.Collider | null = null;
  private lastStaticGroundNormalY = 0;
  private deterministicEvidenceGroundCenterY: number | null = null;
  private deterministicEvidenceLock = false;
  private deterministicEvidenceStepping = false;
  private readonly gravity: number;
  private readonly stepUpHeight: number;
  private readonly climbSpeed: number;
  private readonly flowSpeed: number;
  private readonly fragmentReturnSpeed: number;
  private readonly propPushMaxDeltaV: number;
  private biomassForceScale = 1;

  readonly resolveParticleMotion = (
    cellId: number,
    from: BlobVector3,
    desired: BlobVector3,
    radius: number,
  ): BlobParticleContactResult => {
    this.guidedDesired.set(desired.x, desired.y, desired.z);
    const info = this.cellInfoById.get(cellId);
    if (info) {
      if (this.activeTraversal && info.islandId === this.controller.topology.mainIslandId) {
        this.guideTraversalCell(info, from, this.guidedDesired);
      } else {
        const scripted = this.scriptedMotions.get(info.islandId);
        if (scripted) this.moveToward(from, scripted.target, this.flowSpeed, this.guidedDesired);
      }
    }
    this.contactSamples++;
    const evidenceGround = this.resolveDeterministicEvidenceGround(
      from,
      this.guidedDesired,
    );
    if (evidenceGround) {
      if (evidenceGround.grounded) this.groundedContacts++;
      return evidenceGround;
    }
    const cached = this.reuseFlatGroundContact(
      cellId,
      from,
      this.guidedDesired,
      radius,
    );
    if (cached) {
      this.groundedContacts++;
      return cached;
    }
    const result = this.sweepSphere(from, this.guidedDesired, radius, false, true);
    if (result.grounded) this.groundedContacts++;
    if (
      result.grounded &&
      this.lastStaticGroundCollider &&
      this.lastStaticGroundNormalY >= 0.98
    ) {
      this.flatGroundContacts.set(cellId, {
        collider: this.lastStaticGroundCollider,
        anchorX: result.position.x,
        anchorZ: result.position.z,
        centerY: result.position.y,
        radius,
      });
    } else {
      this.flatGroundContacts.delete(cellId);
    }
    return result;
  };

  readonly resolveFragmentMotion = (
    fragmentId: number,
    islandId: BlobIslandId,
    from: BlobVector3,
    desired: BlobVector3,
    velocity: BlobVector3,
    radius: number,
  ): BlobParticleContactResult => {
    const portalResult = this.tryFragmentPortal(fragmentId, islandId, from, desired, velocity, radius);
    if (portalResult) return portalResult;
    return this.sweepSphere(from, desired, radius, true, false);
  };

  constructor(
    private readonly physics: PhysicsWorld,
    readonly controller: BlobOrganismController,
    private readonly config: BlobV2MotorConfig,
  ) {
    if (!(config.maxSpeed > 0) || !(config.acceleration > 0) || !(config.turnSpeed > 0)) {
      throw new RangeError("BlobV2Motor speed, acceleration and turnSpeed must be positive");
    }
    this.gravity = Math.max(0, config.gravity ?? DEFAULT_GRAVITY);
    this.stepUpHeight = Math.min(NORMAL_STEP_MAX, Math.max(0, config.stepUpHeight ?? NORMAL_STEP_MAX));
    this.climbSpeed = Math.max(0.1, config.climbSpeed ?? 2.4);
    this.flowSpeed = Math.max(0.1, config.flowSpeed ?? 2.2);
    this.fragmentReturnSpeed = Math.max(0.1, config.fragmentReturnSpeed ?? 1.8);
    this.propPushMaxDeltaV = Math.max(
      0,
      config.propPushMaxDeltaV ?? DEFAULT_PROP_PUSH_MAX_DELTAV,
    );
    this.particleTargetProvider = config.particleTargetProvider ?? null;
    this.mainShape = new RAPIER.Ball(controller.particles.particleRadius);
    const center = controller.snapshot().core.position;
    this.position.set(center.x, center.y, center.z);
    this.previousCore.copy(this.position);
    this.motionResult = {
      position: this.resolvedPosition,
      velocity: this.resolvedVelocity,
      grounded: false,
      normal: this.normal,
    };
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(center.x, center.y, center.z),
    );
    this.collider = physics.world.createCollider(RAPIER.ColliderDesc.ball(0.12).setSensor(true), this.body);
    physics.registerCollider(this.collider, {
      ...config.metadata,
      id: config.id,
      ownerId: config.metadata.ownerId ?? config.id,
      kind: "npc",
      selfPortalTraversal: true,
    });
    this.refreshCaches(controller.snapshot());
  }

  update(
    delta: number,
    targetPosition: Vector3 | null,
    wantsMove: boolean,
    facingTarget: Vector3 | null = null,
  ): void {
    if (!this.enabled || !Number.isFinite(delta) || delta < 0) return;
    if (this.deterministicEvidenceLock && !this.deterministicEvidenceStepping) {
      this.actualVelocity.set(0, 0, 0);
      this.syncBody();
      return;
    }
    if (this.frozen) {
      this.actualVelocity.set(0, 0, 0);
      this.syncBody();
      return;
    }

    this.previousCore.copy(this.position);
    const before = this.controller.snapshot();
    this.biomassForceScale = Math.cbrt(
      Math.max(1, before.biomass.total) / BLOB_V2_INITIAL_BIOMASS,
    );
    this.refreshCaches(before);
    this.tickPortalCooldowns(delta);
    this.updateFacingAndDesiredVelocity(delta, targetPosition, wantsMove, facingTarget);
    this.prepareFragmentObservations(before);
    this.groundedContacts = 0;
    this.contactSamples = 0;

    const provided = this.config.stepInputProvider?.() ?? {};
    const poseTargets = this.particleTargetProvider?.(delta) ?? {};
    const desired = this.leapActive ? this.leapVelocity : this.desiredVelocity;
    const stepInput: BlobStepInput = {
      ...provided,
      ...poseTargets,
      desiredVelocity: { x: desired.x, y: desired.y, z: desired.z },
      gravity: this.gravity,
      contactResolver: this.resolveParticleMotion,
      fragmentObservations: {
        ...(provided.fragmentObservations ?? {}),
        ...this.fragmentObservations,
      },
      fragmentMotionResolver: this.resolveFragmentMotion,
    };
    const stepResult = this.controller.step(delta, stepInput);
    const simulatedDelta = stepResult.steps * BLOB_V2_FIXED_STEP_SECONDS;
    this.applyPropPushes(simulatedDelta);
    if (this.activeTraversal) this.activeTraversal.elapsed += simulatedDelta;
    if (this.leapActive) this.advanceLeap(simulatedDelta);
    if (this.portalTraversalSeconds > 0) {
      this.portalTraversalSeconds = Math.max(0, this.portalTraversalSeconds - simulatedDelta);
      if (this.portalTraversalSeconds === 0 && !this.activeTraversal && !this.leapActive) {
        this.controller.setTraversalState("Ground");
      }
    }

    const after = this.controller.snapshot();
    this.refreshCaches(after);
    this.updateTraversalCompletion(after);
    this.completeScriptedMerges(after);
    this.requestNeededFragmentPaths(after);
    this.position.set(after.core.position.x, after.core.position.y, after.core.position.z);
    if (delta > 1e-8) this.actualVelocity.copy(this.position).sub(this.previousCore).divideScalar(delta);
    else this.actualVelocity.set(0, 0, 0);
    this.grounded = this.contactSamples > 0 && this.groundedContacts / this.contactSamples >= 0.3;
    this.syncBody();
    this.config.onAfterStep?.(delta, after);
  }

  beginNavigationAction(link: NavigationActionLink): void {
    this.lastRejectedTraversal = null;
    if (link.kind !== "climb" && link.kind !== "flow") {
      this.activeTraversal = null;
      return;
    }
    if (link.kind === "climb") {
      const height = link.climbHeight ?? link.end.y - link.start.y;
      if (height < CLIMB_MIN - 1e-6 || height > CLIMB_MAX + 1e-6) {
        this.activeTraversal = null;
        this.lastRejectedTraversal = `climb height ${height.toFixed(3)} outside [${CLIMB_MIN}, ${CLIMB_MAX}]`;
        this.controller.setTraversalState("Ground");
        return;
      }
    }
    const direction = link.end.clone().sub(link.start);
    direction.y = 0;
    if (direction.lengthSq() < 1e-8) direction.set(0, 0, 1);
    else direction.normalize();
    const side = new Vector3(-direction.z, 0, direction.x);
    const openings = link.kind === "flow" && link.flowOpenings && link.flowOpenings.length > 0
      ? link.flowOpenings.map((opening) => ({ ...opening }))
      : link.kind === "flow"
        ? [{ offset: 0, width: Math.max(0.2, link.width), bottom: 0, height: 2 }]
        : [];
    const traversal: ActiveTraversal = {
      link,
      kind: link.kind,
      direction,
      side,
      midpoint: link.start.clone().lerp(link.end, 0.5),
      openings,
      channelAssignments: new Map(),
      requiredFraction: link.kind === "flow"
        ? MathUtils.clamp(link.brainCrossFraction ?? 0.6, 0.5, 0.95)
        : 0.6,
      elapsed: 0,
      crossedFraction: 0,
      coreReleased: false,
    };
    this.activeTraversal = traversal;
    if (traversal.kind === "flow") this.assignFlowChannels(traversal);
    this.controller.setTraversalState(traversal.kind === "climb" ? "Climb" : "Squeeze");
  }

  getTraversalDebugSnapshot(): BlobV2TraversalDebugSnapshot {
    const traversal = this.activeTraversal;
    const assignments: Record<number, number> = {};
    if (traversal) {
      for (const [cellId, opening] of traversal.channelAssignments) assignments[cellId] = opening;
    }
    return Object.freeze({
      kind: traversal?.kind ?? "none",
      linkId: traversal?.link.id ?? null,
      crossedFraction: traversal?.crossedFraction ?? 0,
      requiredFraction: traversal?.requiredFraction ?? 0,
      coreReleased: traversal?.coreReleased ?? false,
      rejectedReason: this.lastRejectedTraversal,
      channelAssignments: Object.freeze(assignments),
    });
  }

  setParticleTargetProvider(provider: BlobV2ParticleTargetProvider | null): void {
    this.particleTargetProvider = provider;
  }

  getPosition(): Vector3 {
    return this.position;
  }

  getYaw(): number {
    return this.yaw;
  }

  getRotation(): Quaternion {
    return this.rotation.setFromAxisAngle(Y_AXIS, this.yaw);
  }

  getVelocity(): Vector3 {
    return this.actualVelocity.clone();
  }

  syncFromPhysics(): CharacterMotorSnapshot {
    return {
      position: this.position,
      velocity: this.actualVelocity.clone(),
      desiredVelocity: this.desiredVelocity.clone(),
      forward: this.forward.clone(),
      grounded: this.grounded,
      yaw: this.yaw,
      targetYaw: this.targetYaw,
      distanceToTarget: this.distanceToTarget,
    };
  }

  setSpeedMultiplier(multiplier: number): void {
    this.speedMultiplier = Math.max(0, Number.isFinite(multiplier) ? multiplier : 0);
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.desiredVelocity.set(0, 0, 0);
    this.actualVelocity.set(0, 0, 0);
    this.controller.setOverrideState("Dead");
    this.cancelAllFragmentPaths();
    this.propPushes.clear();
    this.flatGroundContacts.clear();
    this.collider.setEnabled(false);
    this.body.setEnabled(false);
  }

  freezeSolid(): boolean {
    if (!this.enabled || this.shattered || this.frozen) return false;
    this.frozen = true;
    this.desiredVelocity.set(0, 0, 0);
    this.actualVelocity.set(0, 0, 0);
    this.controller.setOverrideState("Frozen");
    this.propPushes.clear();
    // IceGun replaces the organism with one dynamic statue body. Leaving this
    // sensor alive would create a stale second physical hierarchy at the
    // pre-freeze pose while the visual statue falls away.
    this.collider.setEnabled(false);
    this.body.setEnabled(false);
    return true;
  }

  shatterFrozen(): boolean {
    if (this.shattered || !this.frozen) return false;
    this.shattered = true;
    this.controller.setOverrideState("Dead");
    this.disable();
    return true;
  }

  leapTo(target: Vector3, upSpeed: number, maxForwardSpeed: number): void {
    if (!this.enabled || this.frozen || this.leapActive) return;
    const planar = this.targetDelta.copy(target).sub(this.position).setY(0);
    const distance = planar.length();
    if (distance > 1e-5) planar.divideScalar(distance);
    else planar.copy(this.forward);
    const up = Math.max(2.8, upSpeed);
    const flightTime = (2 * up) / Math.max(1, this.gravity);
    const forwardSpeed = Math.min(Math.max(0, maxForwardSpeed), flightTime > 0 ? distance / flightTime : 0);
    this.leapVelocity.set(planar.x * forwardSpeed, up, planar.z * forwardSpeed);
    this.leapStartY = this.position.y;
    this.leapElapsed = 0;
    this.leapActive = true;
    this.flatGroundContacts.clear();
    this.controller.setTraversalState("Leap");
  }

  isLeaping(): boolean {
    return this.leapActive;
  }

  isIncapacitated(): boolean {
    return this.frozen || this.shattered;
  }

  consumeImpactDamage(): number {
    return 0;
  }

  reactToHit(): void {}

  consumeSliceHits(): SliceHit[] {
    return [];
  }

  teleport(position: Vector3, velocity: Vector3): void {
    this.teleportPose(position, velocity, this.yaw);
  }

  teleportPose(position: Vector3, velocity: Vector3, yaw: number): void {
    this.flatGroundContacts.clear();
    const deltaYaw = yaw - this.yaw;
    this.portalQuaternion.setFromAxisAngle(Y_AXIS, deltaYaw);
    this.portalPoint.copy(this.position).applyQuaternion(this.portalQuaternion);
    this.portalTranslation.copy(position).sub(this.portalPoint);
    const mainIslandId = this.controller.topology.mainIslandId;
    this.controller.transformIsland(mainIslandId, {
      rotation: this.portalQuaternion,
      translation: this.portalTranslation,
    });
    this.controller.setIslandVelocity(mainIslandId, velocity);
    this.yaw = yaw;
    this.targetYaw = yaw;
    this.desiredVelocity.copy(velocity);
    this.actualVelocity.copy(velocity);
    this.position.copy(position);
    this.portalTraversalSeconds = BLOB_V2_FIXED_STEP_SECONDS;
    this.controller.setTraversalState("PortalTraverse");
    this.syncBody();
  }

  /**
   * Applies a complete portal-frame rotation to the attached organism while
   * landing its core at the clearance-resolved destination. Detached islands
   * remain in place and traverse through their own fragment path.
   */
  teleportThroughPortal(
    entry: PortalFrame,
    exit: PortalFrame,
    position: Vector3,
    velocity: Vector3,
    yaw: number,
  ): boolean {
    this.flatGroundContacts.clear();
    portalDeltaQuaternion(entry, exit, this.portalQuaternion);
    this.portalPoint.copy(this.position).applyQuaternion(this.portalQuaternion);
    this.portalTranslation.copy(position).sub(this.portalPoint);
    const mainIslandId = this.controller.topology.mainIslandId;
    if (!this.controller.transformIsland(mainIslandId, {
      rotation: this.portalQuaternion,
      translation: this.portalTranslation,
    })) {
      return false;
    }
    this.controller.setIslandVelocity(mainIslandId, velocity);
    this.yaw = yaw;
    this.targetYaw = yaw;
    this.forward.set(Math.sin(yaw), 0, Math.cos(yaw));
    this.desiredVelocity.copy(velocity);
    this.actualVelocity.copy(velocity);
    this.position.copy(position);
    this.portalTraversalSeconds = BLOB_V2_FIXED_STEP_SECONDS;
    this.controller.setTraversalState("PortalTraverse");
    this.syncBody();
    return true;
  }

  snapYaw(yaw: number): void {
    this.teleportPose(this.position, this.actualVelocity, yaw);
  }

  setPortalExclusions(handles: ReadonlySet<number> | null): void {
    this.portalExclusions = handles;
    this.flatGroundContacts.clear();
  }

  /** Fresh-page deterministic lab reset; it cannot reset damaged topology. */
  resetForEvidence(center: Vector3): BlobOrganismSnapshot {
    const snapshot = this.controller.resetForEvidence(center);
    this.cancelAllFragmentPaths();
    this.flatGroundContacts.clear();
    this.propPushes.clear();
    this.scriptedMotions.clear();
    this.activeTraversal = null;
    this.lastRejectedTraversal = null;
    this.leapActive = false;
    this.leapElapsed = 0;
    this.leapStartY = 0;
    this.leapVelocity.set(0, 0, 0);
    this.portalTraversalSeconds = 0;
    this.deterministicEvidenceGroundCenterY = null;
    this.deterministicEvidenceLock = false;
    this.deterministicEvidenceStepping = false;
    this.fragmentPortalCooldown.clear();
    for (const key of Object.keys(this.fragmentObservations)) {
      delete this.fragmentObservations[Number(key)];
    }
    this.desiredVelocity.set(0, 0, 0);
    this.actualVelocity.set(0, 0, 0);
    this.targetVelocity.set(0, 0, 0);
    this.targetDelta.set(0, 0, 0);
    this.speedMultiplier = 1;
    this.biomassForceScale = 1;
    this.yaw = 0;
    this.targetYaw = 0;
    this.forward.set(0, 0, 1);
    this.distanceToTarget = Number.POSITIVE_INFINITY;
    this.grounded = false;
    this.groundedContacts = 0;
    this.contactSamples = 0;
    this.position.set(
      snapshot.core.position.x,
      snapshot.core.position.y,
      snapshot.core.position.z,
    );
    this.previousCore.copy(this.position);
    this.refreshCaches(snapshot);
    this.syncBody();
    return snapshot;
  }

  /**
   * Drops contact memoization before a deterministic evidence action. The
   * cache is an optimization only; preserving it across the settled baseline
   * would make the first moving step depend on which resting contacts Rapier
   * happened to service during startup.
   */
  prepareDeterministicEvidenceAction(): void {
    this.deterministicEvidenceLock = true;
    this.flatGroundContacts.clear();
    this.propPushes.clear();
    this.lastStaticGroundCollider = null;
    this.lastStaticGroundNormalY = 0;
    this.groundedContacts = 0;
    this.contactSamples = 0;
    this.desiredVelocity.set(0, 0, 0);
    this.actualVelocity.set(0, 0, 0);
    this.targetVelocity.set(0, 0, 0);
    this.targetDelta.set(0, 0, 0);
    this.speedMultiplier = 1;
    this.biomassForceScale = 1;
    this.yaw = 0;
    this.targetYaw = 0;
    this.forward.set(0, 0, 1);
    this.distanceToTarget = Number.POSITIVE_INFINITY;
    const snapshot = this.controller.snapshot();
    this.position.set(
      snapshot.core.position.x,
      snapshot.core.position.y,
      snapshot.core.position.z,
    );
    this.previousCore.copy(this.position);
    this.syncBody();
    const attached = snapshot.particles
      .filter((particle) => particle.islandId === this.controller.topology.mainIslandId);
    this.deterministicEvidenceGroundCenterY = attached.reduce(
      (minimum, particle) => Math.min(minimum, particle.position.y),
      Number.POSITIVE_INFINITY,
    );
    if (!Number.isFinite(this.deterministicEvidenceGroundCenterY)) {
      this.deterministicEvidenceGroundCenterY = null;
    }
  }

  setDeterministicEvidenceStepping(stepping: boolean): void {
    this.deterministicEvidenceStepping = stepping;
  }

  transformMainThroughPortal(entry: PortalFrame, exit: PortalFrame, clearance = 0.18): boolean {
    transformPointThroughPortal(this.position, entry, exit, this.portalPoint);
    portalNormal(exit, this.portalExitNormal);
    this.portalPoint.addScaledVector(this.portalExitNormal, Math.max(0, clearance));
    transformDirectionThroughPortal(this.actualVelocity, entry, exit, this.portalVelocity);
    transformDirectionThroughPortal(this.forward, entry, exit, this.targetVelocity);
    this.targetVelocity.y = 0;
    const yaw = this.targetVelocity.lengthSq() > 1e-6
      ? Math.atan2(this.targetVelocity.x, this.targetVelocity.z)
      : this.yaw;
    return this.teleportThroughPortal(
      entry,
      exit,
      this.portalPoint,
      this.portalVelocity,
      yaw,
    );
  }

  private updateFacingAndDesiredVelocity(
    delta: number,
    targetPosition: Vector3 | null,
    wantsMove: boolean,
    facingTarget: Vector3 | null,
  ): void {
    if (targetPosition) this.targetDelta.copy(targetPosition).sub(this.position).setY(0);
    else this.targetDelta.set(0, 0, 0);
    this.distanceToTarget = this.targetDelta.length();
    const facing = facingTarget
      ? this.targetVelocity.copy(facingTarget).sub(this.position).setY(0)
      : this.targetDelta;
    if (facing.lengthSq() > 0.0025) {
      this.targetYaw = Math.atan2(facing.x, facing.z);
      const angle = Math.atan2(Math.sin(this.targetYaw - this.yaw), Math.cos(this.targetYaw - this.yaw));
      this.yaw += angle * (1 - Math.exp(-this.config.turnSpeed * delta));
    }
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));

    if (
      wantsMove &&
      !this.activeTraversal &&
      !this.leapActive &&
      this.targetDelta.lengthSq() > 1e-5
    ) {
      this.targetVelocity.copy(this.targetDelta).normalize().multiplyScalar(
        this.config.maxSpeed * this.speedMultiplier,
      );
    } else {
      this.targetVelocity.set(0, 0, 0);
    }
    const maximumChange = this.config.acceleration * delta;
    this.targetVelocity.sub(this.desiredVelocity);
    if (this.targetVelocity.lengthSq() > maximumChange * maximumChange) {
      this.targetVelocity.setLength(maximumChange);
    }
    this.desiredVelocity.add(this.targetVelocity);
  }

  private refreshCaches(snapshot: BlobOrganismSnapshot): void {
    this.cellInfoById.clear();
    this.mainCellIds.length = 0;
    this.mainCellOrdinal.clear();
    const particleById = new Map(snapshot.particles.map((particle) => [particle.cellId, particle] as const));
    for (const cell of snapshot.cells) {
      const particle = particleById.get(cell.id);
      if (!particle) continue;
      this.cellInfoById.set(cell.id, {
        id: cell.id,
        islandId: cell.islandId,
        isCore: cell.isCore,
        position: particle.position,
      });
      if (cell.islandId === this.controller.topology.mainIslandId && !cell.isCore) {
        this.mainCellIds.push(cell.id);
      }
    }
    this.mainCellIds.sort((a, b) => a - b);
    for (let index = 0; index < this.mainCellIds.length; index++) {
      const id = this.mainCellIds[index];
      if (id !== undefined) this.mainCellOrdinal.set(id, index);
    }
    for (const cellId of this.flatGroundContacts.keys()) {
      if (!this.cellInfoById.has(cellId)) this.flatGroundContacts.delete(cellId);
    }
    if (this.activeTraversal?.kind === "flow") this.assignFlowChannels(this.activeTraversal);
    this.updateCrossedFraction(snapshot);
    this.prepareScriptedIslandMotions(snapshot);
  }

  private guideTraversalCell(info: CellInfo, from: BlobVector3, out: Vector3): void {
    const traversal = this.activeTraversal;
    if (!traversal) return;
    if (traversal.kind === "climb") this.guideClimbCell(traversal, info, from, out);
    else this.guideFlowCell(traversal, info, from, out);
  }

  private guideClimbCell(
    traversal: ActiveTraversal,
    info: CellInfo,
    from: BlobVector3,
    out: Vector3,
  ): void {
    if (info.isCore && !traversal.coreReleased) {
      this.actionTarget.copy(traversal.link.start);
      this.moveToward(from, this.actionTarget, this.climbSpeed, out);
      out.y = Math.min(out.y, traversal.link.end.y - 0.12);
      return;
    }
    if (info.isCore) {
      this.moveToward(from, traversal.link.end, this.climbSpeed, out);
      return;
    }
    const ordinal = this.mainCellOrdinal.get(info.id) ?? 0;
    const band = (ordinal % 5) / 4;
    const height = Math.max(CLIMB_MIN, traversal.link.end.y - traversal.link.start.y);
    const progress = MathUtils.clamp(
      ((traversal.elapsed + BLOB_V2_FIXED_STEP_SECONDS) * this.climbSpeed) / height - band * 0.28,
      0,
      1,
    );
    this.actionTarget.copy(traversal.link.start).lerp(traversal.link.end, progress);
    const widthOffset = ((((ordinal * 37) % 101) / 100) - 0.5) * traversal.link.width * 0.75;
    this.actionTarget.addScaledVector(traversal.side, widthOffset);
    this.moveToward(from, this.actionTarget, this.climbSpeed, out);
  }

  private guideFlowCell(
    traversal: ActiveTraversal,
    info: CellInfo,
    from: BlobVector3,
    out: Vector3,
  ): void {
    const assignment = info.isCore
      ? this.compatibleCoreOpeningIndex(traversal.openings)
      : traversal.channelAssignments.get(info.id) ?? 0;
    if (info.isCore && assignment < 0) {
      this.moveToward(from, traversal.link.start, this.flowSpeed, out);
      return;
    }
    const opening = traversal.openings[assignment] ?? traversal.openings[0];
    if (!opening) return;
    if (info.isCore && !traversal.coreReleased) {
      this.moveToward(from, traversal.link.start, this.flowSpeed, out);
      const signed = this.signedDistance(out, traversal.midpoint, traversal.direction);
      if (signed > -0.08) out.addScaledVector(traversal.direction, -signed - 0.08);
      return;
    }
    const signed = this.signedDistance(from, traversal.midpoint, traversal.direction);
    const destination = signed < 0.08 ? traversal.midpoint : traversal.link.end;
    this.actionTarget.copy(destination)
      .addScaledVector(traversal.side, opening.offset)
      .setY(traversal.link.start.y + opening.bottom + opening.height * 0.5);
    if (signed < 0.08) this.actionTarget.addScaledVector(traversal.direction, 0.18);
    this.moveToward(from, this.actionTarget, this.flowSpeed, out);
  }

  private moveToward(from: BlobVector3, target: BlobVector3, speed: number, out: Vector3): void {
    out.set(target.x - from.x, target.y - from.y, target.z - from.z);
    const distance = out.length();
    if (distance > speed * BLOB_V2_FIXED_STEP_SECONDS && distance > 1e-8) {
      out.multiplyScalar((speed * BLOB_V2_FIXED_STEP_SECONDS) / distance);
    }
    out.x += from.x;
    out.y += from.y;
    out.z += from.z;
  }

  private assignFlowChannels(traversal: ActiveTraversal): void {
    traversal.channelAssignments.clear();
    const totalArea = traversal.openings.reduce(
      (sum, opening) => sum + Math.max(1e-4, opening.width * opening.height),
      0,
    );
    for (let ordinal = 0; ordinal < this.mainCellIds.length; ordinal++) {
      const cellId = this.mainCellIds[ordinal];
      if (cellId === undefined) continue;
      const sample = ((ordinal + 0.5) / Math.max(1, this.mainCellIds.length)) * totalArea;
      let cumulative = 0;
      let selected = traversal.openings.length - 1;
      for (let openingIndex = 0; openingIndex < traversal.openings.length; openingIndex++) {
        const opening = traversal.openings[openingIndex];
        if (!opening) continue;
        cumulative += Math.max(1e-4, opening.width * opening.height);
        if (sample <= cumulative) {
          selected = openingIndex;
          break;
        }
      }
      traversal.channelAssignments.set(cellId, Math.max(0, selected));
    }
  }

  private updateCrossedFraction(snapshot: BlobOrganismSnapshot): void {
    const traversal = this.activeTraversal;
    if (!traversal) return;
    const particles = new Map(snapshot.particles.map((particle) => [particle.cellId, particle.position] as const));
    let crossed = 0;
    // The core is one unit of attached biomass and intentionally does not
    // count as crossed while deciding whether it may leave last.
    let total = 1;
    for (const cellId of this.mainCellIds) {
      const position = particles.get(cellId);
      if (!position) continue;
      total++;
      if (traversal.kind === "climb") {
        if (position.y >= traversal.link.end.y - this.controller.particles.particleRadius * 1.1) crossed++;
      } else if (this.signedDistance(position, traversal.midpoint, traversal.direction) > 0) {
        crossed++;
      }
    }
    traversal.crossedFraction = total > 0 ? crossed / total : 0;
    const coreHasChannel = traversal.kind !== "flow" || this.compatibleCoreOpeningIndex(traversal.openings) >= 0;
    if (coreHasChannel && traversal.crossedFraction + 1e-9 >= traversal.requiredFraction) {
      traversal.coreReleased = true;
    }
  }

  private updateTraversalCompletion(snapshot: BlobOrganismSnapshot): void {
    const traversal = this.activeTraversal;
    if (!traversal || !traversal.coreReleased) return;
    const core = snapshot.core.position;
    const complete = traversal.kind === "climb"
      // Reaching crest height is not enough: keep the guided action alive
      // until the brain has physically cleared the far edge of the wall.
      ? core.y >= traversal.link.end.y - 0.08 &&
        this.planarDistance(core, traversal.link.end) <= Math.max(0.18, this.controller.particles.particleRadius * 2)
      : this.signedDistance(core, traversal.link.end, traversal.direction) >= -0.08;
    if (!complete) return;
    this.activeTraversal = null;
    this.controller.setTraversalState("Ground");
  }

  private prepareScriptedIslandMotions(snapshot: BlobOrganismSnapshot): void {
    this.scriptedMotions.clear();
    const core = new Vector3(snapshot.core.position.x, snapshot.core.position.y, snapshot.core.position.z);
    for (const island of snapshot.islands) {
      if (island.kind !== "scripted") continue;
      if (island.mergeRequested) {
        this.scriptedMotions.set(island.id, { target: core.clone(), merging: true });
      } else {
        const angle = island.id * 2.399963229728653;
        this.scriptedMotions.set(island.id, {
          target: core.clone().add(new Vector3(Math.cos(angle), 0.08, Math.sin(angle)).multiplyScalar(1.25)),
          merging: false,
        });
      }
    }
  }

  private completeScriptedMerges(snapshot: BlobOrganismSnapshot): void {
    const sums = new Map<number, { center: Vector3; count: number }>();
    for (const particle of snapshot.particles) {
      const motion = this.scriptedMotions.get(particle.islandId);
      if (!motion?.merging) continue;
      let sum = sums.get(particle.islandId);
      if (!sum) {
        sum = { center: new Vector3(), count: 0 };
        sums.set(particle.islandId, sum);
      }
      sum.center.add(new Vector3(particle.position.x, particle.position.y, particle.position.z));
      sum.count++;
    }
    for (const [islandId, sum] of sums) {
      if (sum.count <= 0) continue;
      sum.center.multiplyScalar(1 / sum.count);
      if (sum.center.distanceTo(this.position) <= 0.48) this.controller.completeScriptedMerge(islandId);
    }
  }

  private prepareFragmentObservations(snapshot: BlobOrganismSnapshot): void {
    for (const key of Object.keys(this.fragmentObservations)) delete this.fragmentObservations[Number(key)];
    for (const fragment of snapshot.fragments) {
      if (fragment.state === "Attached" || fragment.state === "Dead" || fragment.state === "Withering") continue;
      const from = new Vector3(fragment.position.x, fragment.position.y, fragment.position.z);
      const to = this.position;
      const lineOfSight = this.fragmentHasLineOfSight(from, to, fragment.id);
      const pathVelocity = lineOfSight ? undefined : this.fragmentPathVelocity(fragment.id, from);
      this.fragmentObservations[fragment.id] = {
        grounded: this.fragmentGrounded(from, fragment.biomass),
        lineOfSightToOwner: lineOfSight,
        pathVelocity: pathVelocity
          ? { x: pathVelocity.x, y: pathVelocity.y, z: pathVelocity.z }
          : undefined,
      };
      if (lineOfSight) {
        this.fragmentPaths.delete(fragment.id);
        this.pendingFragmentPaths.delete(fragment.id);
        this.config.navigationRequests?.cancel(this.fragmentPathOwner(fragment.id));
      }
    }
  }

  private requestNeededFragmentPaths(snapshot: BlobOrganismSnapshot): void {
    const queue = this.config.navigationRequests;
    const profile = this.config.navigationProfile;
    if (!queue || !profile) return;
    const liveIds = new Set<number>();
    for (const fragment of snapshot.fragments) {
      if (fragment.state === "Attached" || fragment.state === "Dead" || fragment.state === "Withering") continue;
      liveIds.add(fragment.id);
      if (!fragment.needsPath || this.pendingFragmentPaths.has(fragment.id) || this.fragmentPaths.has(fragment.id)) continue;
      this.pendingFragmentPaths.add(fragment.id);
      queue.enqueue({
        ownerId: this.fragmentPathOwner(fragment.id),
        profile,
        from: new Vector3(fragment.position.x, fragment.position.y, fragment.position.z),
        to: this.position.clone(),
        priority: 1,
        onResolve: (path) => this.resolveFragmentPath(fragment.id, path),
      });
    }
    for (const fragmentId of [...this.fragmentPaths.keys(), ...this.pendingFragmentPaths]) {
      if (liveIds.has(fragmentId)) continue;
      this.fragmentPaths.delete(fragmentId);
      this.pendingFragmentPaths.delete(fragmentId);
      queue.cancel(this.fragmentPathOwner(fragmentId));
    }
  }

  private resolveFragmentPath(fragmentId: number, path: NavigationPath | null): void {
    this.pendingFragmentPaths.delete(fragmentId);
    if (!path || path.points.length === 0) return;
    this.fragmentPaths.set(fragmentId, {
      points: path.points.map((point) => point.clone()),
      actions: path.actions.map((action) => ({
        pointIndex: action.pointIndex,
        link: cloneNavigationActionLink(action.link),
      })),
      index: 0,
      activeActionPointIndex: null,
    });
  }

  private fragmentPathVelocity(fragmentId: number, position: Vector3): Vector3 | null {
    const path = this.fragmentPaths.get(fragmentId);
    if (!path) return null;
    while (path.index < path.points.length) {
      const point = path.points[path.index];
      if (!point) return null;
      const action = path.actions.find((candidate) => candidate.pointIndex === path.index);
      if (action?.link.kind === "portal") {
        if (position.distanceToSquared(action.link.end) <= 0.36) {
          this.advanceFragmentPathAction(path, action.pointIndex);
          continue;
        }
        return this.velocityToward(position, point);
      }
      if (action?.link.kind === "climb" || action?.link.kind === "flow") {
        const activationDistance = action.link.kind === "climb"
          ? this.planarDistance(position, point)
          : position.distanceTo(point);
        if (
          path.activeActionPointIndex !== action.pointIndex &&
          activationDistance > 0.42
        ) {
          return this.velocityToward(position, point);
        }
        path.activeActionPointIndex = action.pointIndex;
        if (position.distanceToSquared(action.link.end) <= 0.1225) {
          this.advanceFragmentPathAction(path, action.pointIndex);
          continue;
        }
        if (action.link.kind === "climb") {
          const upward = action.link.end.y >= action.link.start.y;
          const crestReached = upward
            ? position.y >= action.link.end.y - 0.12
            : position.y <= action.link.end.y + 0.12;
          if (!crestReached) {
            this.actionTarget.set(
              action.link.start.x,
              action.link.end.y,
              action.link.start.z,
            );
            return this.velocityToward(position, this.actionTarget);
          }
        }
        return this.velocityToward(position, action.link.end);
      }
      if (action && action.link.kind !== "crouch") {
        // Combat fragments never attack/open doors/jump. Unknown actions are
        // consumed as ordinary corridor points instead of stalling forever.
        if (position.distanceToSquared(point) >= 0.16) {
          return this.velocityToward(position, point);
        }
        this.advanceFragmentPathAction(path, action.pointIndex);
        continue;
      }
      if (path.index < path.points.length - 1 && position.distanceToSquared(point) < 0.16) {
        path.index++;
        continue;
      }
      return this.velocityToward(position, point);
    }
    return null;
  }

  private velocityToward(position: Vector3, target: Vector3): Vector3 {
    return this.portalVelocity
      .copy(target)
      .sub(position)
      .normalize()
      .multiplyScalar(this.fragmentReturnSpeed);
  }

  private advanceFragmentPathAction(path: FragmentPathState, pointIndex: number): void {
    path.index = Math.max(path.index, pointIndex + 1);
    path.activeActionPointIndex = null;
  }

  private completeFragmentPortalPathAction(fragmentId: number): void {
    const path = this.fragmentPaths.get(fragmentId);
    if (!path) return;
    const action = path.actions.find(
      (candidate) =>
        candidate.pointIndex === path.index && candidate.link.kind === "portal",
    );
    if (action) this.advanceFragmentPathAction(path, action.pointIndex);
  }

  private fragmentHasLineOfSight(from: Vector3, to: Vector3, _fragmentId: number): boolean {
    this.remaining.copy(to).sub(from);
    const distance = this.remaining.length();
    if (distance <= 0.01) return true;
    this.remaining.divideScalar(distance);
    this.sweepIsFragment = true;
    // A radius sweep that starts on the floor immediately reports that floor
    // as an obstruction. Grounded fragments would then wait for a nav path
    // forever even across an empty room. The center ray establishes direct
    // visibility; the authoritative sphere sweep below still detects actual
    // clearance problems and requests a path after the 0.55 s stall window.
    const hit = this.physics.world.castRay(
      new RAPIER.Ray(from, this.remaining),
      Math.max(0, distance - 0.08),
      true,
      undefined,
      undefined,
      undefined,
      this.body,
      this.collisionFilter,
    );
    return hit === null;
  }

  private fragmentGrounded(position: Vector3, biomass: number): boolean {
    const radius = Math.max(0.18, Math.cbrt(Math.max(1, biomass)) * 0.12);
    this.sweepIsFragment = true;
    return this.physics.world.castShape(
      position,
      IDENTITY,
      { x: 0, y: -1, z: 0 },
      new RAPIER.Ball(radius),
      0,
      0.08,
      true,
      undefined,
      undefined,
      undefined,
      this.body,
      this.collisionFilter,
    ) !== null;
  }

  private sweepSphere(
    from: BlobVector3,
    desired: BlobVector3,
    radius: number,
    fragment: boolean,
    allowStep: boolean,
  ): BlobParticleContactResult {
    this.resolvedPosition.set(from.x, from.y, from.z);
    this.remaining.set(desired.x - from.x, desired.y - from.y, desired.z - from.z);
    this.resolvedVelocity.set(0, 0, 0);
    this.motionResult.grounded = false;
    this.normal.set(0, 0, 0);
    this.lastStaticGroundCollider = null;
    this.lastStaticGroundNormalY = 0;
    if (this.remaining.lengthSq() < MOTION_EPSILON_SQ) return this.motionResult;
    const shape = fragment ? new RAPIER.Ball(Math.max(0.05, radius)) : this.mainShape;
    this.sweepIsFragment = fragment;
    let impacts = 0;
    let depenetrations = 0;
    let stepped = false;
    while (impacts < MAX_SWEEPS && this.remaining.lengthSq() >= MOTION_EPSILON_SQ) {
      const hit = this.physics.world.castShape(
        this.resolvedPosition,
        IDENTITY,
        this.remaining,
        shape,
        SKIN,
        1,
        true,
        undefined,
        undefined,
        undefined,
        this.body,
        this.collisionFilter,
      );
      if (!hit) {
        this.resolvedPosition.add(this.remaining);
        this.remaining.set(0, 0, 0);
        break;
      }
      const toi = MathUtils.clamp(hit.time_of_impact, 0, 1);
      if (toi <= 1e-5 && depenetrations < MAX_DEPENETRATION_PASSES && this.depenetrate(hit.collider, shape)) {
        depenetrations++;
        continue;
      }
      this.normal.set(hit.normal1.x, hit.normal1.y, hit.normal1.z).normalize();
      if (this.normal.dot(this.remaining) > 0) this.normal.negate();
      this.notePropContact(hit);
      if (this.normal.y > GROUND_NORMAL_Y) {
        this.motionResult.grounded = true;
        if (hit.collider.parent()?.isFixed()) {
          this.lastStaticGroundCollider = hit.collider;
          this.lastStaticGroundNormalY = Math.max(
            this.lastStaticGroundNormalY,
            this.normal.y,
          );
        }
      }
      const planar = Math.hypot(this.remaining.x, this.remaining.z);
      const wall = this.normal.y < WALL_NORMAL_Y && planar > 1e-5;
      if (wall && allowStep && !stepped && this.stepUpHeight > 0 && this.tryStepUp(shape)) {
        stepped = true;
        continue;
      }
      impacts++;
      this.resolvedPosition.addScaledVector(this.remaining, Math.max(0, toi - 0.002));
      this.remaining.multiplyScalar(1 - toi);
      const inward = this.remaining.dot(this.normal);
      if (inward < 0) this.remaining.addScaledVector(this.normal, -inward);
    }
    this.resolvedVelocity.set(
      (this.resolvedPosition.x - from.x) / BLOB_V2_FIXED_STEP_SECONDS,
      (this.resolvedPosition.y - from.y) / BLOB_V2_FIXED_STEP_SECONDS,
      (this.resolvedPosition.z - from.z) / BLOB_V2_FIXED_STEP_SECONDS,
    );
    return this.motionResult;
  }

  private tryStepUp(shape: RAPIER.Ball): boolean {
    // Clearance is query skin, not traversable height: the obstacle itself is
    // still capped at 0.32 m, while a sphere must finish slightly above it.
    const liftDistance = this.stepUpHeight + SKIN * 2;
    this.stepProbe.set(0, liftDistance, 0);
    const liftHit = this.physics.world.castShape(
      this.resolvedPosition,
      IDENTITY,
      this.stepProbe,
      shape,
      SKIN,
      1,
      true,
      undefined,
      undefined,
      undefined,
      this.body,
      this.collisionFilter,
    );
    if (liftHit && liftHit.time_of_impact < 0.98) return false;
    this.stepProbe.copy(this.resolvedPosition).add({ x: 0, y: liftDistance, z: 0 });
    const forwardHit = this.physics.world.castShape(
      this.stepProbe,
      IDENTITY,
      this.remaining,
      shape,
      SKIN,
      1,
      true,
      undefined,
      undefined,
      undefined,
      this.body,
      this.collisionFilter,
    );
    if (forwardHit && forwardHit.time_of_impact < 0.7) return false;
    this.resolvedPosition.y += liftDistance;
    return true;
  }

  private depenetrate(collider: RAPIER.Collider, shape: RAPIER.Ball): boolean {
    const clearance = SKIN + 0.002;
    const contact = collider.contactShape(shape, this.resolvedPosition, IDENTITY, clearance);
    if (!contact || contact.distance >= clearance) return false;
    this.normal.set(contact.normal1.x, contact.normal1.y, contact.normal1.z);
    if (this.normal.lengthSq() < 1e-10) return false;
    this.normal.normalize();
    if (this.normal.y > GROUND_NORMAL_Y) {
      this.motionResult.grounded = true;
      if (collider.parent()?.isFixed()) {
        this.lastStaticGroundCollider = collider;
        this.lastStaticGroundNormalY = Math.max(
          this.lastStaticGroundNormalY,
          this.normal.y,
        );
      }
    }
    this.resolvedPosition.addScaledVector(this.normal, clearance - contact.distance);
    return true;
  }

  /**
   * Reuses a recent flat, fixed floor contact inside a deliberately small
   * anchor radius. Resting liquid otherwise performs hundreds of identical
   * Rapier shape casts every 30 Hz step. Any meaningful translation, rise,
   * topology change, removed collider or non-flat surface falls back to the
   * authoritative sweep immediately.
   */
  private reuseFlatGroundContact(
    cellId: number,
    from: BlobVector3,
    desired: BlobVector3,
    radius: number,
  ): BlobParticleContactResult | null {
    if (
      this.activeTraversal ||
      this.leapActive ||
      this.portalTraversalSeconds > 0
    ) {
      return null;
    }
    const cached = this.flatGroundContacts.get(cellId);
    if (!cached) return null;
    if (
      !cached.collider.isValid() ||
      !cached.collider.parent()?.isFixed() ||
      Math.abs(cached.radius - radius) > 1e-6
    ) {
      this.flatGroundContacts.delete(cellId);
      return null;
    }
    const stepX = desired.x - from.x;
    const stepZ = desired.z - from.z;
    const anchorX = desired.x - cached.anchorX;
    const anchorZ = desired.z - cached.anchorZ;
    const maximumStep = radius * 0.4;
    const maximumAnchor = radius * 0.7;
    if (
      stepX * stepX + stepZ * stepZ > maximumStep * maximumStep ||
      anchorX * anchorX + anchorZ * anchorZ > maximumAnchor * maximumAnchor ||
      Math.abs(from.y - cached.centerY) > radius * 0.4 ||
      desired.y > cached.centerY + 0.02 ||
      desired.y < cached.centerY - radius * 0.75
    ) {
      return null;
    }

    this.resolvedPosition.set(desired.x, cached.centerY, desired.z);
    this.resolvedVelocity.set(
      (this.resolvedPosition.x - from.x) / BLOB_V2_FIXED_STEP_SECONDS,
      (this.resolvedPosition.y - from.y) / BLOB_V2_FIXED_STEP_SECONDS,
      (this.resolvedPosition.z - from.z) / BLOB_V2_FIXED_STEP_SECONDS,
    );
    this.normal.set(0, 1, 0);
    this.motionResult.grounded = true;
    return this.motionResult;
  }

  /**
   * Screenshot/video evidence runs from a fixed, flat turntable. Once its
   * settled height has been measured, use that analytical plane for the
   * evidence action so separate Chromium processes do not inherit Rapier
   * broad-phase ordering noise from unrelated lab actors. Production movement
   * and every browser integration test continue through the real shape casts.
   */
  private resolveDeterministicEvidenceGround(
    from: BlobVector3,
    desired: BlobVector3,
  ): BlobParticleContactResult | null {
    const centerY = this.deterministicEvidenceGroundCenterY;
    if (centerY === null) return null;
    const grounded = desired.y <= centerY;
    this.resolvedPosition.set(
      desired.x,
      grounded ? centerY : desired.y,
      desired.z,
    );
    this.resolvedVelocity.set(
      (this.resolvedPosition.x - from.x) / BLOB_V2_FIXED_STEP_SECONDS,
      (this.resolvedPosition.y - from.y) / BLOB_V2_FIXED_STEP_SECONDS,
      (this.resolvedPosition.z - from.z) / BLOB_V2_FIXED_STEP_SECONDS,
    );
    this.normal.set(0, grounded ? 1 : 0, 0);
    this.motionResult.grounded = grounded;
    return this.motionResult;
  }

  private readonly collisionFilter = (collider: RAPIER.Collider): boolean => {
    if (collider.isSensor() || this.portalExclusions?.has(collider.handle)) return false;
    const metadata = this.physics.getColliderMetadata(collider);
    if ((metadata?.ownerId ?? metadata?.id) === this.config.id) return false;
    if (metadata?.kind === "npc" || metadata?.kind === "player") return false;
    // Consumable props must be enveloped by attached flesh before their
    // residence timer can advance; treating them as walls makes that
    // impossible and also contradicts the legacy Blob contract.
    if (metadata?.blobConsumable) return false;
    if (metadata?.blobPermeable) {
      if (this.sweepIsFragment) return false;
      const flow = this.activeTraversal?.kind === "flow" ? this.activeTraversal : null;
      if (flow && (!flow.link.permeableId || flow.link.permeableId === metadata.id)) return false;
    }
    return true;
  };

  private tryFragmentPortal(
    fragmentId: number,
    islandId: BlobIslandId,
    from: BlobVector3,
    desired: BlobVector3,
    velocity: BlobVector3,
    radius: number,
  ): BlobParticleContactResult | null {
    const portals = this.config.portals;
    if (!portals?.linked || (this.fragmentPortalCooldown.get(islandId) ?? 0) > 0) return null;
    const fromVector = this.portalPoint.set(from.x, from.y, from.z);
    const desiredVector = this.guidedDesired.set(desired.x, desired.y, desired.z);
    let entrySlot: PortalSlot | null = null;
    for (const slot of ["a", "b"] as const) {
      const entry = portals.get(slot);
      if (entry && segmentCrossesPortal(fromVector, desiredVector, entry, 0.92)) {
        entrySlot = slot;
        break;
      }
    }
    if (!entrySlot) return null;
    const entry = portals.get(entrySlot);
    const exit = portals.exitFor(entrySlot);
    if (!entry || !exit) return null;
    portalDeltaQuaternion(entry, exit, this.portalQuaternion);
    transformPointThroughPortal(ZERO, entry, exit, this.portalTranslation);
    portalNormal(exit, this.portalExitNormal);
    this.portalTranslation.addScaledVector(this.portalExitNormal, radius + PORTAL_EXIT_PAD);
    const speedBefore = Math.hypot(velocity.x, velocity.y, velocity.z);
    if (!this.controller.transformIsland(islandId, {
      rotation: this.portalQuaternion,
      translation: this.portalTranslation,
    })) return null;
    const fragment = this.controller.fragments.get(fragmentId);
    if (!fragment) return null;
    const speedAfter = Math.hypot(fragment.velocity.x, fragment.velocity.y, fragment.velocity.z);
    if (speedBefore > 1e-5 && speedAfter < speedBefore * 0.9) {
      const scale = (speedBefore * 0.9) / Math.max(1e-5, speedAfter);
      this.controller.setIslandVelocity(islandId, {
        x: fragment.velocity.x * scale,
        y: fragment.velocity.y * scale,
        z: fragment.velocity.z * scale,
      });
    }
    this.fragmentPortalCooldown.set(islandId, PORTAL_COOLDOWN_SECONDS);
    const transformed = this.controller.fragments.get(fragmentId);
    if (!transformed) return null;
    this.completeFragmentPortalPathAction(fragmentId);
    this.resolvedPosition.set(transformed.position.x, transformed.position.y, transformed.position.z);
    this.resolvedVelocity.set(transformed.velocity.x, transformed.velocity.y, transformed.velocity.z);
    this.motionResult.grounded = false;
    return this.motionResult;
  }

  private notePropContact(
    hit: NonNullable<ReturnType<RAPIER.World["castShape"]>>,
  ): void {
    if (this.propPushMaxDeltaV <= 0) return;
    const body = hit.collider.parent();
    if (!body?.isDynamic()) return;
    const metadata = this.physics.getColliderMetadata(hit.collider);
    if (metadata?.kind !== "dynamic" || metadata.blobConsumable) return;
    const blockedSpeed =
      -Math.min(0, this.remaining.dot(this.normal)) / BLOB_V2_FIXED_STEP_SECONDS;
    if (blockedSpeed <= 0.05) return;
    let push = this.propPushes.get(body.handle);
    if (!push) {
      push = {
        body,
        impulse: new Vector3(),
        point: new Vector3(),
      };
      this.propPushes.set(body.handle, push);
    }
    push.impulse.addScaledVector(
      this.normal,
      -blockedSpeed * PROP_PUSH_SPEED_TRANSFER * this.biomassForceScale,
    );
    push.point.set(hit.witness1.x, hit.witness1.y, hit.witness1.z);
  }

  private applyPropPushes(simulatedDelta: number): void {
    if (simulatedDelta <= 0 || this.propPushes.size === 0) return;
    for (const push of this.propPushes.values()) {
      if (!push.body.isValid()) continue;
      const mass = Math.max(0.2, push.body.mass());
      const maximumImpulse =
        mass * this.propPushMaxDeltaV * this.biomassForceScale * simulatedDelta;
      if (push.impulse.lengthSq() > maximumImpulse * maximumImpulse) {
        push.impulse.setLength(maximumImpulse);
      }
      push.body.applyImpulseAtPoint(push.impulse, push.point, true);
    }
    this.propPushes.clear();
  }

  private tickPortalCooldowns(delta: number): void {
    for (const [islandId, remaining] of this.fragmentPortalCooldown) {
      const next = remaining - delta;
      if (next <= 0) this.fragmentPortalCooldown.delete(islandId);
      else this.fragmentPortalCooldown.set(islandId, next);
    }
  }

  private advanceLeap(delta: number): void {
    if (!this.leapActive || delta <= 0) return;
    this.leapElapsed += delta;
    this.leapVelocity.y -= this.gravity * delta;
    const landed = this.leapElapsed > 0.25 && this.leapVelocity.y <= 0 && this.grounded;
    if (!landed && this.leapElapsed < 3) return;
    this.leapActive = false;
    this.leapVelocity.set(0, 0, 0);
    if (!this.activeTraversal) this.controller.setTraversalState("Ground");
  }

  private syncBody(): void {
    this.body.setTranslation(this.position, true);
    this.body.setNextKinematicTranslation(this.position);
    const rotation = this.rotation.setFromAxisAngle(Y_AXIS, this.yaw);
    this.body.setRotation(rotation, true);
    this.body.setNextKinematicRotation(rotation);
  }

  private signedDistance(point: BlobVector3, origin: BlobVector3, direction: BlobVector3): number {
    return (point.x - origin.x) * direction.x +
      (point.y - origin.y) * direction.y +
      (point.z - origin.z) * direction.z;
  }

  private planarDistance(a: BlobVector3, b: BlobVector3): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  private compatibleCoreOpeningIndex(openings: readonly BlobFlowOpening[]): number {
    let selected = 0;
    let area = -1;
    let foundCompatible = false;
    const diameter = this.controller.core.radius * 2;
    for (let index = 0; index < openings.length; index++) {
      const opening = openings[index];
      if (!opening) continue;
      if (opening.width + 1e-9 < diameter || opening.height + 1e-9 < diameter) continue;
      foundCompatible = true;
      const candidate = opening.width * opening.height;
      if (candidate > area) {
        area = candidate;
        selected = index;
      }
    }
    return foundCompatible ? selected : -1;
  }

  private fragmentPathOwner(fragmentId: number): string {
    return `${FRAGMENT_PATH_STALL_OWNER_PREFIX}:${this.config.id}:${fragmentId}`;
  }

  private cancelAllFragmentPaths(): void {
    for (const fragmentId of [...this.fragmentPaths.keys(), ...this.pendingFragmentPaths]) {
      this.config.navigationRequests?.cancel(this.fragmentPathOwner(fragmentId));
    }
    this.fragmentPaths.clear();
    this.pendingFragmentPaths.clear();
  }
}

function cloneNavigationActionLink(link: NavigationActionLink): NavigationActionLink {
  return {
    ...link,
    start: link.start.clone(),
    end: link.end.clone(),
    ...(link.traverseStart ? { traverseStart: link.traverseStart.clone() } : {}),
    ...(link.profileIds ? { profileIds: [...link.profileIds] } : {}),
    ...(link.flowOpenings
      ? { flowOpenings: link.flowOpenings.map((opening) => ({ ...opening })) }
      : {}),
  };
}
