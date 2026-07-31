import { Quaternion, Vector3 } from "three";

export type Vector3SaveState = [number, number, number];
export type QuaternionSaveState = [number, number, number, number];

export function captureVector3(value: Vector3): Vector3SaveState {
  return [value.x, value.y, value.z];
}

export function restoreVector3(
  value: Vector3SaveState,
  label: string,
): Vector3 {
  assertFiniteTuple(value, 3, label);
  return new Vector3(value[0], value[1], value[2]);
}

export function captureQuaternion(value: Quaternion): QuaternionSaveState {
  return [value.x, value.y, value.z, value.w];
}

export function restoreQuaternion(
  value: QuaternionSaveState,
  label: string,
): Quaternion {
  assertFiniteTuple(value, 4, label);
  const quaternion = new Quaternion(value[0], value[1], value[2], value[3]);
  if (quaternion.lengthSq() < 1e-8) {
    throw new Error(`${label} contiene una orientación nula.`);
  }
  return quaternion.normalize();
}

export function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} debe ser un número finito.`);
  }
}

export function assertNonNegativeNumber(value: number, label: string): void {
  assertFiniteNumber(value, label);
  if (value < 0) {
    throw new Error(`${label} no puede ser negativo.`);
  }
}

export function assertSnapshotVersion(
  actual: number,
  expected: number,
  label: string,
): void {
  if (actual !== expected) {
    throw new Error(
      `${label} usa la versión ${actual}; se esperaba la versión ${expected}.`,
    );
  }
}

function assertFiniteTuple(
  value: readonly number[],
  length: number,
  label: string,
): void {
  if (
    value.length !== length ||
    value.some((component) => !Number.isFinite(component))
  ) {
    throw new Error(`${label} contiene componentes inválidos.`);
  }
}
