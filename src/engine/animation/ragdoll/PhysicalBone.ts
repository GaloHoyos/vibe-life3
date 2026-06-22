import type RAPIER from '@dimforge/rapier3d-compat';
import type { Bone, Vector3 } from 'three';
import type { NormalizedBoneName } from '@engine/animation/pose/BoneMapper';

export interface PhysicalBone {
  name: string;
  boneName: NormalizedBoneName;
  bone: Bone;
  rigidBody: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  parentName?: string;
  localAnchorToParent?: Vector3;
  localAnchorToChild?: Vector3;
  mass: number;
  damping: number;
  damageMultiplier: number;
}
