import { Bone, Quaternion, Vector3 } from 'three';
import type { PhysicsBoneLink } from './PhysicsBoneLink';

export interface RagdollPoseDriverConfig {
  rotationSmoothing: number;
  preserveChildPositions: boolean;
}

const DefaultPoseDriverConfig: RagdollPoseDriverConfig = {
  rotationSmoothing: 0.35,
  preserveChildPositions: true,
};

/**
 * Copies physical rotations back to the visual skeleton without changing bone lengths.
 * Only root-level bones are allowed to follow world position.
 */
export class RagdollPoseDriver {
  private readonly config: RagdollPoseDriverConfig;
  private readonly worldPosition = new Vector3();
  private readonly worldRotation = new Quaternion();
  private readonly parentWorldRotation = new Quaternion();
  private readonly parentWorldRotationInverse = new Quaternion();

  constructor(config?: Partial<RagdollPoseDriverConfig>) {
    this.config = { ...DefaultPoseDriverConfig, ...config };
  }

  apply(link: PhysicsBoneLink): void {
    const translation = link.body.translation();
    const rotation = link.body.rotation();

    if (!isFiniteTransform(translation, rotation)) {
      return;
    }

    this.worldRotation.set(rotation.x, rotation.y, rotation.z, rotation.w).normalize();
    this.worldPosition
      .set(translation.x, translation.y, translation.z)
      .sub(link.localOffset.clone().applyQuaternion(this.worldRotation));

    const parent = link.bone.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      parent.getWorldQuaternion(this.parentWorldRotation);
      this.parentWorldRotationInverse.copy(this.parentWorldRotation).invert();
      const localRotation = this.parentWorldRotationInverse.multiply(this.worldRotation);

      if (this.isRootDrivenBone(link.bone)) {
        link.bone.position.copy(parent.worldToLocal(this.worldPosition.clone()));
      } else if (this.config.preserveChildPositions) {
        link.bone.position.copy(link.initialLocalPosition);
      }

      link.bone.quaternion.slerp(localRotation, this.config.rotationSmoothing);
    } else {
      link.bone.position.copy(this.worldPosition);
      link.bone.quaternion.slerp(this.worldRotation, this.config.rotationSmoothing);
    }

    link.bone.scale.copy(link.initialLocalScale);
  }

  private isRootDrivenBone(bone: Bone): boolean {
    return !(bone.parent instanceof Bone);
  }
}

function isFiniteTransform(
  position: { x: number; y: number; z: number },
  rotation: { x: number; y: number; z: number; w: number },
): boolean {
  return (
    Number.isFinite(position.x) &&
    Number.isFinite(position.y) &&
    Number.isFinite(position.z) &&
    Number.isFinite(rotation.x) &&
    Number.isFinite(rotation.y) &&
    Number.isFinite(rotation.z) &&
    Number.isFinite(rotation.w)
  );
}
