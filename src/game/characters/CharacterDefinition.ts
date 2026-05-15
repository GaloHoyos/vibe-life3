import type { Object3D, Vector3 } from "three";
import type { ModelAssetId } from "../../engine/assets/AssetManifest";
import type {
  ProceduralWalkConfig,
  WalkStyle,
} from "../../engine/animation/ProceduralWalk";
import type { RagdollConfig } from "../../engine/animation/RagdollDefinition";

export type CharacterType = "humanoid" | "creature" | "robot" | "prop";
export type CharacterId = string;

export interface CharacterMovementConfig {
  maxSpeed: number;
  acceleration: number;
  turnSpeed: number;
  rotationSmoothing: number;
  faceTargetDeadzone: number;
  turnBeforeMoveAngle: number;
  minMoveFacingDot: number;
  gravity: number;
  linearDamping: number;
  angularDamping: number;
}

export interface CharacterColliderConfig {
  height: number;
  radius: number;
  mass: number;
  stepOffset: number;
  snapToGround: number;
}

export interface CharacterHealthConfig {
  maxHealth: number;
}

export type BoneAxis = "x" | "y" | "z";
export type RestPoseType = "none" | "tpose_to_relaxed" | "zombie";
export type ArmsMode = "relaxed" | "zombieForward" | "weaponAim";

export interface BoneRotationOffset {
  x?: number;
  y?: number;
  z?: number;
}

export interface HumanoidRestPoseConfig {
  type: RestPoseType;
  leftUpperArm?: BoneRotationOffset;
  rightUpperArm?: BoneRotationOffset;
  leftForearm?: BoneRotationOffset;
  rightForearm?: BoneRotationOffset;
  spine?: BoneRotationOffset;
  chest?: BoneRotationOffset;
  head?: BoneRotationOffset;
}

export interface HumanoidBoneAxesConfig {
  legSwingAxis: BoneAxis;
  armSwingAxis: BoneAxis;
  kneeBendAxis: BoneAxis;
  elbowBendAxis: BoneAxis;
  spineLeanAxis: BoneAxis;
  headYawAxis: BoneAxis;
}

export interface CharacterAnimationConfig {
  mode: "procedural";
  ignoreBakedAnimations: boolean;
  restPose: HumanoidRestPoseConfig;
  armsMode: ArmsMode;
  boneAxes: HumanoidBoneAxesConfig;
  walkStyle: WalkStyle;
  useLookAt: boolean;
  useStumble: boolean;
  walk: Partial<ProceduralWalkConfig>;
  maxHeadYaw: number;
  maxHeadPitch: number;
}

export interface CharacterRagdollConfig extends Partial<RagdollConfig> {
  enabled: boolean;
  mode: "passiveOnDeath";
  maxDeathLinearVelocity: number;
  maxDeathAngularVelocity: number;
  initialDampingDuration: number;
}

export interface CharacterAIConfig {
  detectionRange: number;
}

export type CharacterAttackType = "melee" | "ranged";

export interface CharacterAttackConfig {
  enabled: boolean;
  type: CharacterAttackType;
  damage: number;
  range: number;
  cooldown: number;
  windup: number;
  hitWindow: number;
  knockback: number;
  requireLineOfSight: boolean;
  facingDotThreshold: number;
}

export interface CharacterStumbleConfig {
  stumbleImpulseThreshold: number;
  stumbleDuration: number;
  fallAngleThreshold: number;
  getUpDelay: number;
  recoverDuration: number;
}

export interface CharacterDefinition {
  id: CharacterId;
  modelId?: ModelAssetId;
  type: CharacterType;
  height: number;
  radius: number;
  mass: number;
  visualScale: number;
  visualRotationY: number;
  visualOffset: Vector3;
  movement: CharacterMovementConfig;
  health: CharacterHealthConfig;
  animation: CharacterAnimationConfig;
  ragdoll: CharacterRagdollConfig;
  collider: CharacterColliderConfig;
  ai: CharacterAIConfig;
  attack: CharacterAttackConfig;
  stumble: CharacterStumbleConfig;
  debug: boolean;
}

export interface CharacterBuildResult {
  id: string;
  definition: CharacterDefinition;
  visualRoot: Object3D;
}
