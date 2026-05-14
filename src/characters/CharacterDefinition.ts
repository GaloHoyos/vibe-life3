import type { Object3D, Vector3 } from 'three';
import type { ModelAssetId } from '../assets/AssetManifest';
import type { ProceduralWalkConfig, WalkStyle } from '../animation/ProceduralWalk';
import type { RagdollConfig } from '../animation/RagdollDefinition';

export type CharacterType = 'humanoid' | 'creature' | 'robot' | 'prop';
export type CharacterId = string;

export interface CharacterMovementConfig {
  maxSpeed: number;
  acceleration: number;
  turnSpeed: number;
  rotationSmoothing: number;
  faceTargetDeadzone: number;
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

export interface CharacterAnimationConfig {
  mode: 'procedural';
  ignoreBakedAnimations: boolean;
  walkStyle: WalkStyle;
  useLookAt: boolean;
  useStumble: boolean;
  walk: Partial<ProceduralWalkConfig>;
  maxHeadYaw: number;
  maxHeadPitch: number;
}

export interface CharacterRagdollConfig extends Partial<RagdollConfig> {
  enabled: boolean;
  mode: 'passiveOnDeath';
  maxDeathLinearVelocity: number;
  maxDeathAngularVelocity: number;
  initialDampingDuration: number;
}

export interface CharacterAIConfig {
  detectionRange: number;
  attackRange: number;
  attackCooldown: number;
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
  stumble: CharacterStumbleConfig;
  debug: boolean;
}

export interface CharacterBuildResult {
  id: string;
  definition: CharacterDefinition;
  visualRoot: Object3D;
}
