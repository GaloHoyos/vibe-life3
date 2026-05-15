import type RAPIER from '@dimforge/rapier3d-compat';
import type { Bone } from 'three';
import type { NormalizedBoneName } from './BoneMapper';

export interface RagdollBodyPart {
  name: string;
  boneName: NormalizedBoneName;
  bone: Bone;
  rigidBody: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  parentPartName?: string;
  damageMultiplier: number;
}
