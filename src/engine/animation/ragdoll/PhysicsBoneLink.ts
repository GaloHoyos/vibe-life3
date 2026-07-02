import type RAPIER from '@dimforge/rapier3d-compat';
import { Bone, Matrix4, Quaternion, Vector3 } from 'three';

/**
 * Pairs a visual bone with its ragdoll rigid body. The body lives at the bone
 * origin using a canonical frame, so `qBoneWorld = qBodyWorld * restRel`.
 */
export class PhysicsBoneLink {
  readonly initialLocalPosition: Vector3;
  readonly initialLocalScale: Vector3;

  constructor(
    readonly bone: Bone,
    readonly body: RAPIER.RigidBody,
    readonly restRel: Quaternion,
  ) {
    this.initialLocalPosition = bone.position.clone();
    this.initialLocalScale = bone.scale.clone();
  }
}

export function getBoneWorldTransform(bone: Bone): { position: Vector3; rotation: Quaternion } {
  const matrix = new Matrix4();
  const position = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();

  bone.updateWorldMatrix(true, false);
  matrix.copy(bone.matrixWorld);
  matrix.decompose(position, rotation, scale);

  return { position, rotation };
}
