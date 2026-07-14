import { BufferAttribute, BufferGeometry, Mesh } from 'three';
import type { VectorTuple } from '@shared/math/VectorTuple';
import { tupleToVector3 } from '@shared/math/VectorTuple';
import type { HeightField } from '@shared/math/HeightField';
import {
  getMaterial,
  materialNeedsUv1,
  materialUvPreScale,
  type MaterialKey,
} from '@engine/render/material/Materials';

export interface TerrainMeshOptions {
  id: string;
  /** Centro del terreno en world space. Debe coincidir con el collider fÃ­sico. */
  position: VectorTuple;
  /** TamaÃ±o total en metros [ancho X, profundidad Z]. */
  size: [number, number];
  material: MaterialKey;
}

/**
 * Construye una malla de terreno a partir de un `HeightField`. La grilla
 * de vÃ©rtices se layoutea en el plano XZ centrada en el origen local; cada
 * vÃ©rtice queda elevado por su altura correspondiente. Las normales se
 * recalculan al final para que la iluminaciÃ³n reaccione bien a la pendiente.
 *
 * El layout es idÃ©ntico al que espera `PhysicsWorld.createHeightfield()`, asÃ­
 * la malla visual y el collider quedan alineados al colocar ambos en la misma
 * `position`.
 */
export function createTerrainMesh(field: HeightField, options: TerrainMeshOptions): Mesh {
  const { widthSamples, depthSamples, heights } = field;
  const [sizeX, sizeZ] = options.size;

  const vertexCount = widthSamples * depthSamples;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array((widthSamples - 1) * (depthSamples - 1) * 6);
  const uvPreScale = materialUvPreScale(options.material);

  for (let xi = 0; xi < widthSamples; xi++) {
    for (let zi = 0; zi < depthSamples; zi++) {
      const i = xi + zi * widthSamples;
      const u = widthSamples > 1 ? xi / (widthSamples - 1) : 0;
      const v = depthSamples > 1 ? zi / (depthSamples - 1) : 0;
      positions[i * 3 + 0] = (u - 0.5) * sizeX;
      positions[i * 3 + 1] = heights[i];
      positions[i * 3 + 2] = (v - 0.5) * sizeZ;
      uvs[i * 2 + 0] = uvPreScale === null ? u : u * sizeX * uvPreScale;
      uvs[i * 2 + 1] = uvPreScale === null ? v : v * sizeZ * uvPreScale;
    }
  }

  let idx = 0;
  for (let zi = 0; zi < depthSamples - 1; zi++) {
    for (let xi = 0; xi < widthSamples - 1; xi++) {
      const a = xi + zi * widthSamples;
      const b = a + 1;
      const c = a + widthSamples;
      const d = c + 1;
      indices[idx++] = a;
      indices[idx++] = c;
      indices[idx++] = b;
      indices[idx++] = b;
      indices[idx++] = c;
      indices[idx++] = d;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  if (materialNeedsUv1(options.material)) {
    geometry.setAttribute('uv1', geometry.attributes.uv);
  }

  const mesh = new Mesh(geometry, getMaterial(options.material));
  mesh.name = options.id;
  mesh.position.copy(tupleToVector3(options.position));
  mesh.receiveShadow = true;
  return mesh;
}
