import { BoxGeometry, Mesh } from 'three';
import type { VectorTuple } from '../engine/MathTypes';
import { tupleToVector3 } from '../engine/MathTypes';
import { getMaterial, type MaterialKey } from './Materials';

export interface BoxMeshOptions {
  id: string;
  position: VectorTuple;
  size: VectorTuple;
  material: MaterialKey;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export function createBoxMesh(options: BoxMeshOptions): Mesh {
  const size = tupleToVector3(options.size);
  const mesh = new Mesh(new BoxGeometry(size.x, size.y, size.z), getMaterial(options.material));
  mesh.name = options.id;
  mesh.position.copy(tupleToVector3(options.position));
  mesh.castShadow = options.castShadow ?? false;
  mesh.receiveShadow = options.receiveShadow ?? false;
  return mesh;
}
