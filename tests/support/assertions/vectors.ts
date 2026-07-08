import type { Vector3 } from "three";

export function vectorToArray(vector: Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z];
}
