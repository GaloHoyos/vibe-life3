import type RAPIER from '@dimforge/rapier3d-compat';
import { Bone, Matrix4, Quaternion, Vector3 } from 'three';

export class PhysicsBoneLink {
  readonly initialLocalPosition: Vector3;
  readonly initialLocalRotation: Quaternion;
  readonly initialLocalScale: Vector3;

  private readonly worldPosition = new Vector3();
  private readonly worldRotation = new Quaternion();
  private readonly parentWorldRotation = new Quaternion();
  private readonly parentWorldRotationInverse = new Quaternion();

  constructor(
    readonly bone: Bone,
    readonly body: RAPIER.RigidBody,
    readonly localOffset: Vector3,
  ) {
    this.initialLocalPosition = bone.position.clone();
    this.initialLocalRotation = bone.quaternion.clone();
    this.initialLocalScale = bone.scale.clone();
  }

  syncBodyToBone(): void {
    if (!this.bone || !this.body) {
      return;
    }

    const translation = this.body.translation();
    const rotation = this.body.rotation();

    if (!isFiniteVector(translation) || !isFiniteRotation(rotation)) {
      return;
    }

    this.worldPosition.set(translation.x, translation.y, translation.z);
    this.worldRotation.set(rotation.x, rotation.y, rotation.z, rotation.w).normalize();
    this.worldPosition.sub(this.localOffset.clone().applyQuaternion(this.worldRotation));

    const parent = this.bone.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      parent.getWorldQuaternion(this.parentWorldRotation);
      this.parentWorldRotationInverse.copy(this.parentWorldRotation).invert();
      this.bone.position.copy(parent.worldToLocal(this.worldPosition.clone()));
      this.bone.quaternion.copy(this.parentWorldRotationInverse.multiply(this.worldRotation));
    } else {
      this.bone.position.copy(this.worldPosition);
      this.bone.quaternion.copy(this.worldRotation);
    }

    this.bone.scale.copy(this.initialLocalScale);
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

function isFiniteVector(vector: { x: number; y: number; z: number }): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

function isFiniteRotation(rotation: { x: number; y: number; z: number; w: number }): boolean {
  return (
    Number.isFinite(rotation.x) &&
    Number.isFinite(rotation.y) &&
    Number.isFinite(rotation.z) &&
    Number.isFinite(rotation.w)
  );
}
