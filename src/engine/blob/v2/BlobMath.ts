import type { BlobQuaternion, BlobVector3 } from "@engine/blob/v2/BlobV2Types";

export interface MutableBlobVector3 {
  x: number;
  y: number;
  z: number;
}

export function vector(x = 0, y = 0, z = 0): MutableBlobVector3 {
  return { x, y, z };
}

export function copyVector(value: BlobVector3): MutableBlobVector3 {
  return { x: value.x, y: value.y, z: value.z };
}

export function setVector(target: MutableBlobVector3, value: BlobVector3): void {
  target.x = value.x;
  target.y = value.y;
  target.z = value.z;
}

export function addScaled(
  target: MutableBlobVector3,
  value: BlobVector3,
  scale: number,
): void {
  target.x += value.x * scale;
  target.y += value.y * scale;
  target.z += value.z * scale;
}

export function subtract(a: BlobVector3, b: BlobVector3): MutableBlobVector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function distanceSquared(a: BlobVector3, b: BlobVector3): number {
  const x = a.x - b.x;
  const y = a.y - b.y;
  const z = a.z - b.z;
  return x * x + y * y + z * z;
}

export function lengthSquared(value: BlobVector3): number {
  return value.x * value.x + value.y * value.y + value.z * value.z;
}

export function dot(a: BlobVector3, b: BlobVector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function normalized(value: BlobVector3, fallback: BlobVector3 = { x: 0, y: 1, z: 0 }): MutableBlobVector3 {
  const lengthSq = lengthSquared(value);
  if (lengthSq <= 1e-12 || !Number.isFinite(lengthSq)) return copyVector(fallback);
  const inverseLength = 1 / Math.sqrt(lengthSq);
  return {
    x: value.x * inverseLength,
    y: value.y * inverseLength,
    z: value.z * inverseLength,
  };
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be finite and non-negative`);
  }
  return value;
}

export function normalizedQuaternion(value: BlobQuaternion): BlobQuaternion {
  const lengthSq = value.x * value.x + value.y * value.y + value.z * value.z + value.w * value.w;
  if (!Number.isFinite(lengthSq) || lengthSq <= 1e-12) {
    throw new RangeError("Blob island rotation must be a finite, non-zero quaternion");
  }
  const inverseLength = 1 / Math.sqrt(lengthSq);
  return {
    x: value.x * inverseLength,
    y: value.y * inverseLength,
    z: value.z * inverseLength,
    w: value.w * inverseLength,
  };
}

export function rotateVector(value: BlobVector3, rotation: BlobQuaternion): MutableBlobVector3 {
  const tx = 2 * (rotation.y * value.z - rotation.z * value.y);
  const ty = 2 * (rotation.z * value.x - rotation.x * value.z);
  const tz = 2 * (rotation.x * value.y - rotation.y * value.x);
  return {
    x: value.x + rotation.w * tx + rotation.y * tz - rotation.z * ty,
    y: value.y + rotation.w * ty + rotation.z * tx - rotation.x * tz,
    z: value.z + rotation.w * tz + rotation.x * ty - rotation.y * tx,
  };
}

export function rigidTransform(
  value: BlobVector3,
  rotation: BlobQuaternion,
  translation: BlobVector3,
): MutableBlobVector3 {
  const transformed = rotateVector(value, rotation);
  transformed.x += translation.x;
  transformed.y += translation.y;
  transformed.z += translation.z;
  return transformed;
}
