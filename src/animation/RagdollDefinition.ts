import type { Vector3 } from 'three';
import { Vector3 as ThreeVector3 } from 'three';
import type { NormalizedBoneName } from './BoneMapper';

export type RagdollColliderShape = 'box' | 'capsule' | 'sphere';

export interface RagdollPartDefinition {
  id: string;
  bone: NormalizedBoneName;
  parentPartName?: string;
  size: Vector3;
  localOffset: Vector3;
  shape: RagdollColliderShape;
  mass: number;
  damageMultiplier: number;
}

export interface RagdollConfig {
  enabled: boolean;
  activeWhileAlive: boolean;
  passiveOnDeath: boolean;
  bodyPartCollisions: boolean;
  preserveOriginalSkinnedMesh: boolean;
  useDebugMeshes: boolean;
  density: number;
  angularDamping: number;
  linearDamping: number;
  impulseScale: number;
  colliderScale: number;
  enableJoints: boolean;
  debug: boolean;
  maxDeathLinearVelocity: number;
  maxDeathAngularVelocity: number;
  initialDampingDuration: number;
  jointStrength: number;
  jointDamping: number;
  bodyPartDamping: number;
  maxPartLinearVelocity: number;
  maxPartAngularVelocity: number;
  stiffness: number;
  damping: number;
  balanceStrength: number;
  uprightStrength: number;
  limbFollowStrength: number;
  maxCorrectionForce: number;
  stumbleThreshold: number;
  fallThreshold: number;
  recoverDelay: number;
}

export const DefaultRagdollConfig: RagdollConfig = {
  enabled: true,
  activeWhileAlive: true,
  passiveOnDeath: true,
  bodyPartCollisions: true,
  preserveOriginalSkinnedMesh: true,
  useDebugMeshes: false,
  density: 1,
  angularDamping: 2.8,
  linearDamping: 0.45,
  impulseScale: 0.35,
  colliderScale: 1,
  enableJoints: true,
  debug: false,
  maxDeathLinearVelocity: 3,
  maxDeathAngularVelocity: 4,
  initialDampingDuration: 0.5,
  jointStrength: 0.8,
  jointDamping: 0.7,
  bodyPartDamping: 2,
  maxPartLinearVelocity: 4,
  maxPartAngularVelocity: 5,
  stiffness: 0.55,
  damping: 0.75,
  balanceStrength: 0.8,
  uprightStrength: 0.9,
  limbFollowStrength: 0.45,
  maxCorrectionForce: 40,
  stumbleThreshold: 0.65,
  fallThreshold: 1.1,
  recoverDelay: 1.2,
};

export const DefaultRagdollDefinition: RagdollPartDefinition[] = [
  {
    id: 'hips',
    bone: 'hips',
    size: new ThreeVector3(0.5, 0.35, 0.35),
    localOffset: new ThreeVector3(0, 0, 0),
    shape: 'box',
    mass: 2,
    damageMultiplier: 1,
  },
  {
    id: 'chest',
    bone: 'chest',
    parentPartName: 'hips',
    size: new ThreeVector3(0.65, 0.7, 0.38),
    localOffset: new ThreeVector3(0, 0, 0),
    shape: 'box',
    mass: 3,
    damageMultiplier: 1,
  },
  {
    id: 'head',
    bone: 'head',
    parentPartName: 'chest',
    size: new ThreeVector3(0.28, 0.28, 0.28),
    localOffset: new ThreeVector3(0, 0, 0),
    shape: 'sphere',
    mass: 0.8,
    damageMultiplier: 2,
  },
  {
    id: 'leftUpperArm',
    bone: 'leftUpperArm',
    parentPartName: 'chest',
    size: new ThreeVector3(0.18, 0.42, 0.18),
    localOffset: new ThreeVector3(0, -0.18, 0),
    shape: 'capsule',
    mass: 0.8,
    damageMultiplier: 0.7,
  },
  {
    id: 'leftForearm',
    bone: 'leftForearm',
    parentPartName: 'leftUpperArm',
    size: new ThreeVector3(0.16, 0.38, 0.16),
    localOffset: new ThreeVector3(0, -0.18, 0),
    shape: 'capsule',
    mass: 0.65,
    damageMultiplier: 0.7,
  },
  {
    id: 'rightUpperArm',
    bone: 'rightUpperArm',
    parentPartName: 'chest',
    size: new ThreeVector3(0.18, 0.42, 0.18),
    localOffset: new ThreeVector3(0, -0.18, 0),
    shape: 'capsule',
    mass: 0.8,
    damageMultiplier: 0.7,
  },
  {
    id: 'rightForearm',
    bone: 'rightForearm',
    parentPartName: 'rightUpperArm',
    size: new ThreeVector3(0.16, 0.38, 0.16),
    localOffset: new ThreeVector3(0, -0.18, 0),
    shape: 'capsule',
    mass: 0.65,
    damageMultiplier: 0.7,
  },
  {
    id: 'leftThigh',
    bone: 'leftThigh',
    parentPartName: 'hips',
    size: new ThreeVector3(0.22, 0.52, 0.22),
    localOffset: new ThreeVector3(0, -0.24, 0),
    shape: 'capsule',
    mass: 1.2,
    damageMultiplier: 0.8,
  },
  {
    id: 'leftShin',
    bone: 'leftShin',
    parentPartName: 'leftThigh',
    size: new ThreeVector3(0.18, 0.48, 0.18),
    localOffset: new ThreeVector3(0, -0.22, 0),
    shape: 'capsule',
    mass: 1,
    damageMultiplier: 0.8,
  },
  {
    id: 'leftFoot',
    bone: 'leftFoot',
    parentPartName: 'leftShin',
    size: new ThreeVector3(0.22, 0.1, 0.34),
    localOffset: new ThreeVector3(0, -0.02, 0.08),
    shape: 'box',
    mass: 0.45,
    damageMultiplier: 0.75,
  },
  {
    id: 'rightThigh',
    bone: 'rightThigh',
    parentPartName: 'hips',
    size: new ThreeVector3(0.22, 0.52, 0.22),
    localOffset: new ThreeVector3(0, -0.24, 0),
    shape: 'capsule',
    mass: 1.2,
    damageMultiplier: 0.8,
  },
  {
    id: 'rightShin',
    bone: 'rightShin',
    parentPartName: 'rightThigh',
    size: new ThreeVector3(0.18, 0.48, 0.18),
    localOffset: new ThreeVector3(0, -0.22, 0),
    shape: 'capsule',
    mass: 1,
    damageMultiplier: 0.8,
  },
  {
    id: 'rightFoot',
    bone: 'rightFoot',
    parentPartName: 'rightShin',
    size: new ThreeVector3(0.22, 0.1, 0.34),
    localOffset: new ThreeVector3(0, -0.02, 0.08),
    shape: 'box',
    mass: 0.45,
    damageMultiplier: 0.75,
  },
];
