import type { Vector3 } from 'three';
import { Vector3 as ThreeVector3 } from 'three';
import type { NormalizedBoneName } from './BoneMapper';

export type RagdollColliderShape = 'box' | 'capsule' | 'sphere';

export interface RagdollPartDefinition {
  id: string;
  bone: NormalizedBoneName;
  size: Vector3;
  localOffset: Vector3;
  shape: RagdollColliderShape;
  mass: number;
}

export interface RagdollConfig {
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
}

export const DefaultRagdollConfig: RagdollConfig = {
  density: 1,
  angularDamping: 2.8,
  linearDamping: 0.45,
  impulseScale: 6,
  colliderScale: 1,
  enableJoints: false,
  debug: false,
  maxDeathLinearVelocity: 3,
  maxDeathAngularVelocity: 4,
  initialDampingDuration: 0.5,
};

export const DefaultRagdollDefinition: RagdollPartDefinition[] = [
  {
    id: 'hips',
    bone: 'hips',
    size: new ThreeVector3(0.5, 0.35, 0.35),
    localOffset: new ThreeVector3(0, 0, 0),
    shape: 'box',
    mass: 2,
  },
  {
    id: 'chest',
    bone: 'chest',
    size: new ThreeVector3(0.65, 0.7, 0.38),
    localOffset: new ThreeVector3(0, 0, 0),
    shape: 'box',
    mass: 3,
  },
  {
    id: 'head',
    bone: 'head',
    size: new ThreeVector3(0.28, 0.28, 0.28),
    localOffset: new ThreeVector3(0, 0, 0),
    shape: 'sphere',
    mass: 0.8,
  },
  {
    id: 'leftUpperArm',
    bone: 'leftUpperArm',
    size: new ThreeVector3(0.18, 0.42, 0.18),
    localOffset: new ThreeVector3(0, -0.18, 0),
    shape: 'capsule',
    mass: 0.8,
  },
  {
    id: 'leftForearm',
    bone: 'leftForearm',
    size: new ThreeVector3(0.16, 0.38, 0.16),
    localOffset: new ThreeVector3(0, -0.18, 0),
    shape: 'capsule',
    mass: 0.65,
  },
  {
    id: 'rightUpperArm',
    bone: 'rightUpperArm',
    size: new ThreeVector3(0.18, 0.42, 0.18),
    localOffset: new ThreeVector3(0, -0.18, 0),
    shape: 'capsule',
    mass: 0.8,
  },
  {
    id: 'rightForearm',
    bone: 'rightForearm',
    size: new ThreeVector3(0.16, 0.38, 0.16),
    localOffset: new ThreeVector3(0, -0.18, 0),
    shape: 'capsule',
    mass: 0.65,
  },
  {
    id: 'leftThigh',
    bone: 'leftThigh',
    size: new ThreeVector3(0.22, 0.52, 0.22),
    localOffset: new ThreeVector3(0, -0.24, 0),
    shape: 'capsule',
    mass: 1.2,
  },
  {
    id: 'leftShin',
    bone: 'leftShin',
    size: new ThreeVector3(0.18, 0.48, 0.18),
    localOffset: new ThreeVector3(0, -0.22, 0),
    shape: 'capsule',
    mass: 1,
  },
  {
    id: 'rightThigh',
    bone: 'rightThigh',
    size: new ThreeVector3(0.22, 0.52, 0.22),
    localOffset: new ThreeVector3(0, -0.24, 0),
    shape: 'capsule',
    mass: 1.2,
  },
  {
    id: 'rightShin',
    bone: 'rightShin',
    size: new ThreeVector3(0.18, 0.48, 0.18),
    localOffset: new ThreeVector3(0, -0.22, 0),
    shape: 'capsule',
    mass: 1,
  },
];
