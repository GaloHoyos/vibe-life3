import { BufferAttribute, BufferGeometry, Mesh } from 'three';
import type { VectorTuple } from '../../shared/math/VectorTuple';
import { tupleToVector3 } from '../../shared/math/VectorTuple';
import type { HeightField } from '../../shared/math/HeightField';
import { getMaterial, type MaterialKey } from './Materials';

export interface TerrainMeshOptions {
  id: string;
  /** Centro del terreno en world space. Debe coincidir con el collider físico. */
  position: VectorTuple;
  /** Tamaño total en metros [ancho X, profundidad Z]. */
  size: [number, number];
  material: MaterialKey;
}

/**
 * Construye una malla de terreno a partir de un `HeightField`. La grilla
 * de vértices se layoutea en el plano XZ centrada en el origen local; cada
 * vértice queda elevado por su altura correspondiente. Las normales se
 * recalculan al final para que la iluminación reaccione bien a la pendiente.
 *
 * El layout es idéntico al que espera `PhysicsWorld.createHeightfield()`, así
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

  for (let xi = 0; xi < widthSamples; xi++) {
    for (let zi = 0; zi < depthSamples; zi++) {
      const i = xi + zi * widthSamples;
      const u = widthSamples > 1 ? xi / (widthSamples - 1) : 0;
      const v = depthSamples > 1 ? zi / (depthSamples - 1) : 0;
      positions[i * 3 + 0] = (u - 0.5) * sizeX;
      positions[i * 3 + 1] = heights[i];
      positions[i * 3 + 2] = (v - 0.5) * sizeZ;
      uvs[i * 2 + 0] = u;
      uvs[i * 2 + 1] = v;
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

  const mesh = new Mesh(geometry, getMaterial(options.material));
  mesh.name = options.id;
  mesh.position.copy(tupleToVector3(options.position));
  mesh.receiveShadow = true;
  return mesh;
}
