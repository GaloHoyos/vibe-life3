import { BoxGeometry, Mesh } from 'three';
import type { VectorTuple } from '@shared/math/VectorTuple';
import { tupleToVector3 } from '@shared/math/VectorTuple';
import { getMaterial, materialNeedsUv1, type MaterialKey } from '@engine/render/material/Materials';

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
  const geometry = new BoxGeometry(size.x, size.y, size.z);
  if (materialNeedsUv1(options.material) && geometry.attributes.uv && !geometry.attributes.uv1) {
    geometry.setAttribute('uv1', geometry.attributes.uv);
  }
  const mesh = new Mesh(geometry, getMaterial(options.material));
  mesh.name = options.id;
  mesh.position.copy(tupleToVector3(options.position));
  mesh.castShadow = options.castShadow ?? false;
  mesh.receiveShadow = options.receiveShadow ?? false;
  return mesh;
}
