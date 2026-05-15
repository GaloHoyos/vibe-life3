import { Bone, MathUtils, Object3D, Vector3 } from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { Damageable } from '../../shared/types/lifecycle';
import type { CharacterAnimationConfig } from '../characters/CharacterDefinition';
import { AnimationDebug } from './AnimationDebug';
import { BoneMapper } from './BoneMapper';
import { applyBoneRotationOffset } from './BoneRotation';
import { HumanoidRestPose } from './HumanoidRestPose';
import { PoseSnapshot } from './PoseSnapshot';
import { ProceduralBalance } from './ProceduralBalance';
import { DefaultWalkConfig, DefaultWalkOptions, ProceduralWalk, type ProceduralWalkConfig } from './ProceduralWalk';
import type { RagdollConfig } from './RagdollDefinition';
import { RagdollSystem } from './RagdollSystem';

export type ProceduralAnimationState = 'idle' | 'walk' | 'run' | 'attack' | 'hit' | 'dead';

export interface ProceduralAnimatorOptions {
  id: string;
  root: Object3D;
  physics: PhysicsWorld;
  walk?: Partial<ProceduralWalkConfig>;
  ragdoll?: Partial<RagdollConfig>;
  animation?: CharacterAnimationConfig;
  owner?: Damageable;
  debug?: boolean;
}

export interface ProceduralAnimatorUpdate {
  velocity: Vector3;
  desiredDirection: Vector3;
  isGrounded: boolean;
  state: ProceduralAnimationState;
  deltaTime: number;
  time: number;
  lookDirection?: Vector3;
}

export class ProceduralCharacterAnimator {
  readonly mapper: BoneMapper;

  private readonly pose: PoseSnapshot;
  private readonly restPose: HumanoidRestPose;
  private readonly walk: ProceduralWalk;
  private readonly balance = new ProceduralBalance();
  private readonly ragdoll: RagdollSystem;
  private readonly debug: AnimationDebug;
  private readonly hitDirection = new Vector3();
  private currentState: ProceduralAnimationState = 'idle';
  private hitTimer = 0;
  private attackTimer = 0;

  constructor(private readonly options: ProceduralAnimatorOptions) {
    this.mapper = new BoneMapper(options.root, { debug: options.debug });
    this.pose = new PoseSnapshot(options.root);
    this.restPose = new HumanoidRestPose(options.animation);
    this.walk = new ProceduralWalk({
      ...DefaultWalkConfig,
      ...options.walk,
      style: options.animation?.walkStyle ?? options.walk?.style ?? DefaultWalkConfig.style,
      maxHeadYaw: options.animation?.maxHeadYaw ?? DefaultWalkConfig.maxHeadYaw,
      maxHeadPitch: options.animation?.maxHeadPitch ?? DefaultWalkConfig.maxHeadPitch,
    }, {
      boneAxes: options.animation?.boneAxes ?? DefaultWalkOptions.boneAxes,
      armsMode: options.animation?.armsMode ?? DefaultWalkOptions.armsMode,
    });
    this.ragdoll = new RagdollSystem({
      id: options.id,
      root: options.root,
      physics: options.physics,
      mapper: this.mapper,
      config: options.ragdoll,
      owner: options.owner,
    });
    if ((options.ragdoll?.activeWhileAlive ?? true) && this.mapper.hasSkeleton()) {
      this.ragdoll.ensureLiveSensors();
    }
    this.debug = new AnimationDebug(options.debug);
    this.debug.logMapping(this.mapper);
  }

  update(update: ProceduralAnimatorUpdate): void {
    if (this.currentState === 'dead') {
      this.ragdoll.update(update.deltaTime);
      return;
    }

    if (update.state === 'dead') {
      this.die();
      this.ragdoll.update(update.deltaTime);
      return;
    }

    this.pose.restore();
    this.restPose.apply(this.mapper.bones);
    this.currentState = this.resolveState(update);
    this.applyState(update);
    this.applyLookAt(update.lookDirection);
    this.balance.applyVelocityLean(this.options.root, update.velocity, update.desiredDirection, 1);
    this.ragdoll.updateLiveSensors();
  }

  hit(direction?: Vector3): void {
    this.hitTimer = 0.22;
    if (direction && direction.lengthSq() > 0.001) {
      this.hitDirection.copy(direction).normalize();
    }
  }

  attack(): void {
    this.attackTimer = 0.35;
  }

  die(hitDirection?: Vector3, hitPartName?: string): void {
    if (this.currentState === 'dead') {
      return;
    }

    this.currentState = 'dead';
    this.ragdoll.activate(hitDirection ?? this.hitDirection, undefined, hitPartName);
  }

  dieWithVelocity(hitDirection: Vector3 | undefined, currentVelocity: Vector3, hitPartName?: string): void {
    if (this.currentState === 'dead') {
      return;
    }

    this.currentState = 'dead';
    this.ragdoll.activate(hitDirection ?? this.hitDirection, currentVelocity, hitPartName);
  }

  isRagdollActive(): boolean {
    return this.ragdoll.isActive();
  }

  getState(): ProceduralAnimationState {
    return this.currentState;
  }

  private resolveState(update: ProceduralAnimatorUpdate): ProceduralAnimationState {
    if (this.hitTimer > 0) {
      this.hitTimer = Math.max(0, this.hitTimer - update.deltaTime);
      return 'hit';
    }

    if (this.attackTimer > 0) {
      this.attackTimer = Math.max(0, this.attackTimer - update.deltaTime);
      return 'attack';
    }

    if (update.state === 'dead') {
      return 'dead';
    }

    if (update.velocity.length() > 4.7) {
      return 'run';
    }

    if (update.velocity.length() > 0.15) {
      return 'walk';
    }

    return 'idle';
  }

  private applyState(update: ProceduralAnimatorUpdate): void {
    if (!this.mapper.hasSkeleton()) {
      this.applyRootFallback(update);
      return;
    }

    if (this.currentState === 'idle') {
      this.balance.applyIdle(this.options.root, this.mapper.bones, update.time, 1);
      return;
    }

    if (this.currentState === 'walk') {
      const bob = this.walk.apply(this.mapper.bones, update.velocity, update.time, 1, 1);
      this.applySkeletonBob(bob);
      return;
    }

    if (this.currentState === 'run') {
      const bob = this.walk.apply(this.mapper.bones, update.velocity, update.time, 1.25, 1.35);
      this.applySkeletonBob(bob);
      return;
    }

    if (this.currentState === 'attack') {
      this.applyAttackPose();
      return;
    }

    if (this.currentState === 'hit') {
      this.applyHitReaction();
    }
  }

  private applyAttackPose(): void {
    const progress = 1 - this.attackTimer / 0.35;
    const punch = Math.sin(progress * Math.PI);

    rotateX(this.mapper.bones.chest, 0.18 * punch);
    rotateX(this.mapper.bones.rightUpperArm, -1.15 * punch);
    rotateX(this.mapper.bones.rightForearm, -0.55 * punch);
    rotateZ(this.mapper.bones.leftUpperArm, 0.22 * punch);
  }

  private applyHitReaction(): void {
    const progress = 1 - this.hitTimer / 0.22;
    const recoil = Math.sin(progress * Math.PI);

    rotateX(this.mapper.bones.spine, -0.28 * recoil);
    rotateX(this.mapper.bones.chest, -0.36 * recoil);
    rotateY(this.mapper.bones.head, this.hitDirection.x * 0.45 * recoil);
    rotateZ(this.mapper.bones.leftUpperArm, -0.45 * recoil);
    rotateZ(this.mapper.bones.rightUpperArm, 0.45 * recoil);
  }

  private applyLookAt(direction?: Vector3): void {
    if (!direction || direction.lengthSq() <= 0.001 || this.currentState === 'dead') {
      return;
    }

    const localDirection = direction.clone().normalize();
    const maxYaw = this.options.animation?.maxHeadYaw ?? DefaultWalkConfig.maxHeadYaw;
    const maxPitch = this.options.animation?.maxHeadPitch ?? DefaultWalkConfig.maxHeadPitch;
    const yaw = MathUtils.clamp(Math.atan2(localDirection.x, localDirection.z), -maxYaw, maxYaw);
    const pitch = MathUtils.clamp(Math.asin(MathUtils.clamp(localDirection.y, -1, 1)), -maxPitch, maxPitch);

    applyBoneRotationOffset(this.mapper.bones.head, this.options.animation?.boneAxes.headYawAxis ?? 'y', yaw);
    rotateX(this.mapper.bones.head, -pitch);
    applyBoneRotationOffset(this.mapper.bones.neck, this.options.animation?.boneAxes.headYawAxis ?? 'y', yaw * 0.35);
    applyBoneRotationOffset(this.mapper.bones.chest, this.options.animation?.boneAxes.headYawAxis ?? 'y', yaw * 0.18);
  }

  private applyRootFallback(update: ProceduralAnimatorUpdate): void {
    const speed = update.velocity.length();
    const walkAmount = MathUtils.clamp(speed / 4, 0, 1);
    const bob = Math.sin(update.time * 7 * Math.max(walkAmount, 0.25)) * 0.08 * walkAmount;
    const sway = Math.sin(update.time * 3.5) * 0.08 * Math.max(walkAmount, 0.25);

    this.options.root.position.y += bob;
    this.options.root.rotation.z += sway;
    this.options.root.rotation.x += walkAmount * 0.12;
  }

  private applySkeletonBob(amount: number): void {
    if (this.mapper.bones.hips) {
      this.mapper.bones.hips.position.y += amount;
      return;
    }

    this.options.root.position.y += amount;
  }
}

function rotateX(bone: Bone | undefined, radians: number): void {
  applyBoneRotationOffset(bone, 'x', radians);
}

function rotateY(bone: Bone | undefined, radians: number): void {
  applyBoneRotationOffset(bone, 'y', radians);
}

function rotateZ(bone: Bone | undefined, radians: number): void {
  applyBoneRotationOffset(bone, 'z', radians);
}
