import { Bone, Quaternion, Vector3 } from 'three';
import type { PhysicsBoneLink } from './PhysicsBoneLink';

/**
 * Copies rigid body transforms back to the visual skeleton, undoing the
 * canonical frame (`qBoneWorld = qBodyWorld * restRel`). Direct copy — no
 * per-frame smoothing, so the mesh tracks the simulation exactly. Child bones
 * keep their local position (skinned mesh contract: bone lengths are fixed);
 * only root-level bones follow the body's world position.
 */
export class RagdollPoseDriver {
  private readonly worldPosition = new Vector3();
  private readonly worldRotation = new Quaternion();
  private readonly parentWorldRotation = new Quaternion();

  apply(link: PhysicsBoneLink): void {
    const translation = link.body.translation();
    const rotation = link.body.rotation();

    if (!isFiniteTransform(translation, rotation)) {
      return;
    }

    this.worldRotation.set(rotation.x, rotation.y, rotation.z, rotation.w).normalize().multiply(link.restRel);
    this.worldPosition.set(translation.x, translation.y, translation.z);

    const parent = link.bone.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      parent.getWorldQuaternion(this.parentWorldRotation);
      const localRotation = this.parentWorldRotation.invert().multiply(this.worldRotation);

      if (parent instanceof Bone) {
        link.bone.position.copy(link.initialLocalPosition);
      } else {
        link.bone.position.copy(parent.worldToLocal(this.worldPosition.clone()));
      }
      link.bone.quaternion.copy(localRotation);
    } else {
      link.bone.position.copy(this.worldPosition);
      link.bone.quaternion.copy(this.worldRotation);
    }

    link.bone.scale.copy(link.initialLocalScale);
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
