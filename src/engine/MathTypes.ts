import { Vector3 } from 'three';

export type VectorTuple = [number, number, number];

export function tupleToVector3(tuple: VectorTuple): Vector3 {
  return new Vector3(tuple[0], tuple[1], tuple[2]);
}
