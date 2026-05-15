import { Quaternion, Vector3, type Bone } from 'three';
import type { BoneAxis, BoneRotationOffset } from '../characters/CharacterDefinition';

const AxisVectors: Record<BoneAxis, Vector3> = {
  x: new Vector3(1, 0, 0),
  y: new Vector3(0, 1, 0),
  z: new Vector3(0, 0, 1),
};

export function applyBoneRotationOffset(bone: Bone | undefined, axis: BoneAxis, radians: number): void {
  if (!bone || !Number.isFinite(radians)) {
    return;
  }

  bone.quaternion.multiply(new Quaternion().setFromAxisAngle(AxisVectors[axis], radians));
}

export function applyBoneRotationOffsets(bone: Bone | undefined, offset?: BoneRotationOffset): void {
  if (!bone || !offset) {
    return;
  }

  bone.rotation.x += offset.x ?? 0;
  bone.rotation.y += offset.y ?? 0;
  bone.rotation.z += offset.z ?? 0;
}
