import type RAPIER from '@dimforge/rapier3d-compat';
import type { Bone } from 'three';
import type { NormalizedBoneName } from '@engine/animation/pose/BoneMapper';
import type { RagdollPartId } from './RagdollDefinition';

export interface PhysicalBone {
  name: RagdollPartId;
  boneName: NormalizedBoneName;
  bone: Bone;
  rigidBody: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  parentName?: RagdollPartId;
  damageMultiplier: number;
}
