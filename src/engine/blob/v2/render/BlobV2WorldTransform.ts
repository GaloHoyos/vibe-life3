import { Matrix4, Object3D, Quaternion, Vector3 } from "three";

const WORLD_MATRIX = new Matrix4();
const LOCAL_MATRIX = new Matrix4();
const PARENT_INVERSE = new Matrix4();

/**
 * Places a child by decomposing a desired world transform into the parent's
 * local space. This deliberately leaves `matrixWorld` under Three's control.
 */
export function setBlobV2WorldTransform(
  object: Object3D,
  worldPosition: Vector3,
  worldQuaternion: Quaternion,
  worldScale: Vector3,
): void {
  const parent = object.parent;
  WORLD_MATRIX.compose(worldPosition, worldQuaternion, worldScale);
  if (parent) {
    parent.updateWorldMatrix(true, false);
    PARENT_INVERSE.copy(parent.matrixWorld).invert();
    LOCAL_MATRIX.multiplyMatrices(PARENT_INVERSE, WORLD_MATRIX);
  } else {
    LOCAL_MATRIX.copy(WORLD_MATRIX);
  }
  LOCAL_MATRIX.decompose(object.position, object.quaternion, object.scale);
  object.updateMatrix();
  object.matrixWorldNeedsUpdate = true;
}

/** Writes an instance-local matrix from a normal world transform. */
export function blobV2WorldToInstanceMatrix(
  parent: Object3D,
  worldPosition: Vector3,
  worldQuaternion: Quaternion,
  worldScale: Vector3,
  target: Matrix4,
): Matrix4 {
  blobV2WorldInverse(parent, PARENT_INVERSE);
  return blobV2WorldToLocalMatrix(
    PARENT_INVERSE,
    worldPosition,
    worldQuaternion,
    worldScale,
    target,
  );
}

/** Computes an inverse once for a whole instanced-mesh batch. */
export function blobV2WorldInverse(
  object: Object3D,
  target: Matrix4,
): Matrix4 {
  object.updateWorldMatrix(true, false);
  return target.copy(object.matrixWorld).invert();
}

export function blobV2WorldToLocalMatrix(
  parentWorldInverse: Matrix4,
  worldPosition: Vector3,
  worldQuaternion: Quaternion,
  worldScale: Vector3,
  target: Matrix4,
): Matrix4 {
  WORLD_MATRIX.compose(worldPosition, worldQuaternion, worldScale);
  return target.multiplyMatrices(parentWorldInverse, WORLD_MATRIX);
}
