import type { Vector3 } from 'three';
import { Vector3 as ThreeVector3 } from 'three';
import type { NormalizedBoneName } from '@engine/animation/pose/BoneMapper';

export type RagdollPartId =
  | 'hips'
  | 'chest'
  | 'head'
  | 'leftUpperArm'
  | 'leftForearm'
  | 'rightUpperArm'
  | 'rightForearm'
  | 'leftThigh'
  | 'leftShin'
  | 'leftFoot'
  | 'rightThigh'
  | 'rightShin'
  | 'rightFoot';

export type RagdollShape = 'capsuleToBone' | 'box' | 'sphere';

export interface RagdollPartDefinition {
  id: RagdollPartId;
  bone: NormalizedBoneName;
  parentPartName?: RagdollPartId;
  shape: RagdollShape;
  /** capsuleToBone: child bone whose position defines segment length and direction. */
  lengthTarget?: NormalizedBoneName;
  /** Extends the capsule past the target bone (e.g. forearm covering the hand). Default 1. */
  lengthScale?: number;
  /** Capsule/sphere radius in meters. Multiplied by config.colliderScale. */
  radius?: number;
  /** Segment length in meters when lengthTarget is missing from the rig. */
  fallbackLength?: number;
  boxHalfExtents?: Vector3;
  /** Offset in canonical (character-root) space; body-local because bodies use canonical frames. */
  localOffset?: Vector3;
  /** Absolute mass in kg (ColliderDesc.setMass), not a density multiplier. */
  mass: number;
  damageMultiplier: number;
}

export interface RagdollConfig {
  enabled: boolean;
  activeWhileAlive: boolean;
  passiveOnDeath: boolean;
  bodyPartCollisions: boolean;
  linearDamping: number;
  angularDamping: number;
  /** Impulse magnitude in N*s applied to the hit part on death. */
  impulseScale: number;
  /** Multiplies capsule/sphere radii and box extents. */
  colliderScale: number;
  friction: number;
  enableJoints: boolean;
  /** Clamp for the velocity inherited from the character motor on death. */
  maxDeathLinearVelocity: number;
  maxDeathAngularVelocity: number;
  /** Safety clamp applied to the part that receives the death impulse. */
  maxPartLinearVelocity: number;
  maxPartAngularVelocity: number;
  /** Seconds asleep before removing bodies/joints (visual pose stays frozen). 0 = never. */
  corpseCleanupDelay: number;
  debug: boolean;
}

export const DefaultRagdollConfig: RagdollConfig = {
  enabled: true,
  activeWhileAlive: true,
  passiveOnDeath: true,
  bodyPartCollisions: true,
  linearDamping: 0.1,
  angularDamping: 0.9,
  impulseScale: 45,
  colliderScale: 1,
  friction: 0.9,
  enableJoints: true,
  maxDeathLinearVelocity: 8,
  maxDeathAngularVelocity: 12,
  maxPartLinearVelocity: 10,
  maxPartAngularVelocity: 25,
  corpseCleanupDelay: 0,
  debug: false,
};

export interface AngularLimit {
  min: number;
  max: number;
}

export interface RagdollJointDefinition {
  /** Connects this part to its parentPartName; anchor = child bone world position. */
  child: RagdollPartId;
  kind: 'hinge' | 'ball';
  /**
   * Hinge axis in canonical space. Valid for both bodies because canonical
   * frames make parent/child share the same local basis at rest.
   */
  axis?: Vector3;
  /**
   * Derive the hinge axis from the natural bend present in the bind pose
   * (cross of parent/child segment directions). Falls back to `axis` when
   * the bind chain is too straight to define a bend plane.
   */
  deriveAxisFromRestBend?: boolean;
  /** Hinge rotation range. With a derived axis, positive = deeper flexion. */
  limits?: AngularLimit;
  /** Ball joint limits per canonical axis (X lateral, Y up, Z forward). */
  ballLimits?: {
    angX?: AngularLimit;
    angY?: AngularLimit;
    angZ?: AngularLimit;
  };
}

export const DefaultRagdollDefinition: RagdollPartDefinition[] = [
  {
    id: 'hips',
    bone: 'hips',
    shape: 'box',
    boxHalfExtents: new ThreeVector3(0.16, 0.11, 0.11),
    mass: 10,
    damageMultiplier: 1,
  },
  {
    id: 'chest',
    bone: 'chest',
    parentPartName: 'hips',
    shape: 'box',
    boxHalfExtents: new ThreeVector3(0.17, 0.17, 0.12),
    localOffset: new ThreeVector3(0, 0.14, 0),
    mass: 17,
    damageMultiplier: 1,
  },
  {
    id: 'head',
    bone: 'head',
    parentPartName: 'chest',
    shape: 'sphere',
    radius: 0.11,
    localOffset: new ThreeVector3(0, 0.07, 0),
    mass: 5,
    damageMultiplier: 2,
  },
  {
    id: 'leftUpperArm',
    bone: 'leftUpperArm',
    parentPartName: 'chest',
    shape: 'capsuleToBone',
    lengthTarget: 'leftForearm',
    radius: 0.05,
    fallbackLength: 0.28,
    mass: 2.5,
    damageMultiplier: 0.7,
  },
  {
    id: 'leftForearm',
    bone: 'leftForearm',
    parentPartName: 'leftUpperArm',
    shape: 'capsuleToBone',
    lengthTarget: 'leftHand',
    lengthScale: 1.15,
    radius: 0.045,
    fallbackLength: 0.26,
    mass: 1.9,
    damageMultiplier: 0.7,
  },
  {
    id: 'rightUpperArm',
    bone: 'rightUpperArm',
    parentPartName: 'chest',
    shape: 'capsuleToBone',
    lengthTarget: 'rightForearm',
    radius: 0.05,
    fallbackLength: 0.28,
    mass: 2.5,
    damageMultiplier: 0.7,
  },
  {
    id: 'rightForearm',
    bone: 'rightForearm',
    parentPartName: 'rightUpperArm',
    shape: 'capsuleToBone',
    lengthTarget: 'rightHand',
    lengthScale: 1.15,
    radius: 0.045,
    fallbackLength: 0.26,
    mass: 1.9,
    damageMultiplier: 0.7,
  },
  {
    id: 'leftThigh',
    bone: 'leftThigh',
    parentPartName: 'hips',
    shape: 'capsuleToBone',
    lengthTarget: 'leftShin',
    radius: 0.075,
    fallbackLength: 0.45,
    mass: 8.5,
    damageMultiplier: 0.8,
  },
  {
    id: 'leftShin',
    bone: 'leftShin',
    parentPartName: 'leftThigh',
    shape: 'capsuleToBone',
    lengthTarget: 'leftFoot',
    radius: 0.055,
    fallbackLength: 0.42,
    mass: 4.2,
    damageMultiplier: 0.8,
  },
  {
    id: 'leftFoot',
    bone: 'leftFoot',
    parentPartName: 'leftShin',
    shape: 'box',
    boxHalfExtents: new ThreeVector3(0.045, 0.035, 0.1),
    localOffset: new ThreeVector3(0, -0.03, 0.05),
    mass: 1.2,
    damageMultiplier: 0.75,
  },
  {
    id: 'rightThigh',
    bone: 'rightThigh',
    parentPartName: 'hips',
    shape: 'capsuleToBone',
    lengthTarget: 'rightShin',
    radius: 0.075,
    fallbackLength: 0.45,
    mass: 8.5,
    damageMultiplier: 0.8,
  },
  {
    id: 'rightShin',
    bone: 'rightShin',
    parentPartName: 'rightThigh',
    shape: 'capsuleToBone',
    lengthTarget: 'rightFoot',
    radius: 0.055,
    fallbackLength: 0.42,
    mass: 4.2,
    damageMultiplier: 0.8,
  },
  {
    id: 'rightFoot',
    bone: 'rightFoot',
    parentPartName: 'rightShin',
    shape: 'box',
    boxHalfExtents: new ThreeVector3(0.045, 0.035, 0.1),
    localOffset: new ThreeVector3(0, -0.03, 0.05),
    mass: 1.2,
    damageMultiplier: 0.75,
  },
];

/**
 * Joint limits assume canonical frames: zero rotation = bind pose, axes in
 * character space (X lateral, Y up, Z forward, character facing +Z).
 * Left/right asymmetries in ball limits mirror the sign of the lateral axis.
 */
export const DefaultRagdollJoints: RagdollJointDefinition[] = [
  {
    child: 'chest',
    kind: 'ball',
    ballLimits: {
      angX: { min: -0.35, max: 0.45 },
      angY: { min: -0.35, max: 0.35 },
      angZ: { min: -0.3, max: 0.3 },
    },
  },
  {
    child: 'head',
    kind: 'ball',
    ballLimits: {
      angX: { min: -0.6, max: 0.7 },
      angY: { min: -1.1, max: 1.1 },
      angZ: { min: -0.5, max: 0.5 },
    },
  },
  {
    child: 'leftUpperArm',
    kind: 'ball',
    ballLimits: {
      angX: { min: -0.7, max: 0.7 },
      angY: { min: -1.4, max: 0.7 },
      angZ: { min: -1.5, max: 0.6 },
    },
  },
  {
    child: 'rightUpperArm',
    kind: 'ball',
    ballLimits: {
      angX: { min: -0.7, max: 0.7 },
      angY: { min: -0.7, max: 1.4 },
      angZ: { min: -0.6, max: 1.5 },
    },
  },
  {
    child: 'leftForearm',
    kind: 'hinge',
    deriveAxisFromRestBend: true,
    axis: new ThreeVector3(0, -1, 0),
    limits: { min: -0.05, max: 2.5 },
  },
  {
    child: 'rightForearm',
    kind: 'hinge',
    deriveAxisFromRestBend: true,
    axis: new ThreeVector3(0, 1, 0),
    limits: { min: -0.05, max: 2.5 },
  },
  {
    child: 'leftThigh',
    kind: 'ball',
    ballLimits: {
      angX: { min: -1.9, max: 0.4 },
      angY: { min: -0.5, max: 0.5 },
      angZ: { min: -0.2, max: 0.9 },
    },
  },
  {
    child: 'rightThigh',
    kind: 'ball',
    ballLimits: {
      angX: { min: -1.9, max: 0.4 },
      angY: { min: -0.5, max: 0.5 },
      angZ: { min: -0.9, max: 0.2 },
    },
  },
  {
    child: 'leftShin',
    kind: 'hinge',
    deriveAxisFromRestBend: true,
    axis: new ThreeVector3(1, 0, 0),
    limits: { min: -0.05, max: 2.3 },
  },
  {
    child: 'rightShin',
    kind: 'hinge',
    deriveAxisFromRestBend: true,
    axis: new ThreeVector3(1, 0, 0),
    limits: { min: -0.05, max: 2.3 },
  },
  {
    child: 'leftFoot',
    kind: 'hinge',
    axis: new ThreeVector3(1, 0, 0),
    limits: { min: -0.5, max: 0.7 },
  },
  {
    child: 'rightFoot',
    kind: 'hinge',
    axis: new ThreeVector3(1, 0, 0),
    limits: { min: -0.5, max: 0.7 },
  },
];
