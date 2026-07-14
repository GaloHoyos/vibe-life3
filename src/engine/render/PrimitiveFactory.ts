import { BoxGeometry, Mesh } from 'three';
import type { VectorTuple } from '@shared/math/VectorTuple';
import {
  InstancedMesh,
  Object3D,
  StaticDrawUsage,
  type CylinderGeometry,
  type MeshStandardMaterial,
} from 'three';
import { tupleToVector3 } from '@shared/math/VectorTuple';
import {
  getMaterial,
  materialNeedsUv1,
  materialUvPreScale,
  type MaterialKey,
} from '@engine/render/material/Materials';

export interface BoxMeshOptions {
  id: string;
  position: VectorTuple;
  size: VectorTuple;
  material: MaterialKey;
  /** Rotacion Euler XYZ en radianes. Si se omite, queda alineado a los ejes. */
  rotation?: VectorTuple;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export type BoxInstanceOptions = Omit<BoxMeshOptions, 'castShadow' | 'receiveShadow'>;

export interface InstancedBoxMeshesOptions {
  /** Prefijo legible para identificar los lotes en el scene graph y en profiling. */
  id: string;
  boxes: readonly BoxInstanceOptions[];
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export interface InstancedBoxBatchMetadata {
  kind: 'instanced-box-batch';
  material: MaterialKey;
  /** `instanceIds[index]` conserva la identidad de la caja original. */
  instanceIds: string[];
  /** Búsqueda inversa para debug/picking sin recorrer todas las instancias. */
  instanceIndexById: Record<string, number>;
}

export function createBoxMesh(options: BoxMeshOptions): Mesh {
  const size = tupleToVector3(options.size);
  const geometry = createBoxGeometry(options.material, size.x, size.y, size.z);
  const mesh = new Mesh(geometry, getBoxMaterial(options.material));
  mesh.name = options.id;
  mesh.position.copy(tupleToVector3(options.position));
  if (options.rotation) mesh.rotation.set(options.rotation[0], options.rotation[1], options.rotation[2]);
  mesh.castShadow = options.castShadow ?? false;
  mesh.receiveShadow = options.receiveShadow ?? false;
  return mesh;
}

/**
 * Crea un `InstancedMesh` por material para geometría estática repetitiva.
 * Cada instancia mantiene la transformación e identidad de la caja fuente,
 * mientras comparte geometría y material con el resto del lote.
 */
export function createInstancedBoxMeshes(options: InstancedBoxMeshesOptions): InstancedMesh[] {
  const byMaterial = new Map<MaterialKey, BoxInstanceOptions[]>();
  for (const box of options.boxes) {
    const group = byMaterial.get(box.material);
    if (group) group.push(box);
    else byMaterial.set(box.material, [box]);
  }

  const batches: InstancedMesh[] = [];
  const transform = new Object3D();

  for (const [material, boxes] of byMaterial) {
    const geometry = createBoxGeometry(material, 1, 1, 1);
    const mesh = new InstancedMesh(geometry, getBoxMaterial(material), boxes.length);
    const instanceIds: string[] = [];
    const instanceIndexById: Record<string, number> = Object.create(null) as Record<string, number>;

    boxes.forEach((box, index) => {
      transform.position.copy(tupleToVector3(box.position));
      transform.scale.copy(tupleToVector3(box.size));
      if (box.rotation) {
        transform.rotation.set(box.rotation[0], box.rotation[1], box.rotation[2]);
      } else {
        transform.rotation.set(0, 0, 0);
      }
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
      instanceIds.push(box.id);
      instanceIndexById[box.id] = index;
    });

    mesh.name = `${options.id}-${material}`;
    mesh.castShadow = options.castShadow ?? false;
    mesh.receiveShadow = options.receiveShadow ?? false;
    mesh.instanceMatrix.setUsage(StaticDrawUsage);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    mesh.userData.boxBatch = {
      kind: 'instanced-box-batch',
      material,
      instanceIds,
      instanceIndexById,
    } satisfies InstancedBoxBatchMetadata;
    batches.push(mesh);
  }

  return batches;
}

/** Corrige lateral y tapas de un cilindro procedural con densidad métrica. */
export function applyMaterialUvsToCylinder(
  geometry: CylinderGeometry,
  material: MaterialKey,
): CylinderGeometry {
  const uvPreScale = materialUvPreScale(material);
  if (uvPreScale === null) return geometry;

  const { radiusTop, radiusBottom, height, radialSegments, heightSegments } = geometry.parameters;
  const torsoVertexCount = (Math.floor(heightSegments) + 1) * (Math.floor(radialSegments) + 1);
  const circumference = Math.PI * (radiusTop + radiusBottom);
  const uv = geometry.attributes.uv;
  const position = geometry.attributes.position;

  for (let index = 0; index < uv.count; index += 1) {
    if (index < torsoVertexCount) {
      uv.setXY(
        index,
        uv.getX(index) * circumference * uvPreScale,
        uv.getY(index) * height * uvPreScale,
      );
    } else {
      uv.setXY(
        index,
        position.getX(index) * uvPreScale,
        position.getZ(index) * uvPreScale,
      );
    }
  }
  uv.needsUpdate = true;
  if (materialNeedsUv1(material) && !geometry.attributes.uv1) {
    geometry.setAttribute('uv1', uv);
  }
  return geometry;
}

function createBoxGeometry(material: MaterialKey, width: number, height: number, depth: number): BoxGeometry {
  const geometry = new BoxGeometry(width, height, depth);
  if (materialNeedsUv1(material) && geometry.attributes.uv && !geometry.attributes.uv1) {
    geometry.setAttribute('uv1', geometry.attributes.uv);
  }
  return geometry;
}

function getBoxMaterial(key: MaterialKey): MeshStandardMaterial {
  const material = getMaterial(key);
  const uvPreScale = materialUvPreScale(key);
  if (uvPreScale !== null) applyMetricBoxUvs(material, uvPreScale);
  return material;
}

/**
 * Proyecta cada cara de la caja en metros locales. Para `InstancedMesh`, el
 * tamaño se recupera desde `instanceMatrix`, así se conserva un batch por
 * material aun cuando todas las cajas tengan dimensiones diferentes.
 */
function applyMetricBoxUvs(material: MeshStandardMaterial, uvPreScale: number): void {
  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey();

  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    shader.uniforms.uMaterialUvPreScale = { value: uvPreScale };
    shader.vertexShader = replaceShaderChunk(
      shader.vertexShader,
      '#include <common>',
      `#include <common>
uniform float uMaterialUvPreScale;`,
    );
    shader.vertexShader = replaceShaderChunk(
      shader.vertexShader,
      '#include <uv_vertex>',
      `#include <uv_vertex>

#ifdef USE_INSTANCING
mat3 boxLinearTransform = mat3( modelMatrix * instanceMatrix );
#else
mat3 boxLinearTransform = mat3( modelMatrix );
#endif
vec3 boxAxisScale = vec3(
  length( boxLinearTransform[ 0 ] ),
  length( boxLinearTransform[ 1 ] ),
  length( boxLinearTransform[ 2 ] )
);
vec3 metricBoxPosition = position * boxAxisScale;
vec3 boxFaceAxis = abs( normal );
vec2 metricBoxUv;
if ( boxFaceAxis.x > boxFaceAxis.y && boxFaceAxis.x > boxFaceAxis.z ) {
  metricBoxUv = vec2( -normal.x * metricBoxPosition.z, metricBoxPosition.y );
} else if ( boxFaceAxis.y > boxFaceAxis.z ) {
  metricBoxUv = vec2( metricBoxPosition.x, normal.y * metricBoxPosition.z );
} else {
  metricBoxUv = vec2( normal.z * metricBoxPosition.x, metricBoxPosition.y );
}
metricBoxUv *= uMaterialUvPreScale;

#ifdef USE_MAP
vMapUv = ( mapTransform * vec3( metricBoxUv, 1.0 ) ).xy;
#endif
#ifdef USE_NORMALMAP
vNormalMapUv = ( normalMapTransform * vec3( metricBoxUv, 1.0 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
vRoughnessMapUv = ( roughnessMapTransform * vec3( metricBoxUv, 1.0 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
vMetalnessMapUv = ( metalnessMapTransform * vec3( metricBoxUv, 1.0 ) ).xy;
#endif
#ifdef USE_AOMAP
vAoMapUv = ( aoMapTransform * vec3( metricBoxUv, 1.0 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
vEmissiveMapUv = ( emissiveMapTransform * vec3( metricBoxUv, 1.0 ) ).xy;
#endif`,
    );
  };
  material.customProgramCacheKey = () => `${previousCacheKey}|metric-box-uv-v1`;
  material.needsUpdate = true;
}

function replaceShaderChunk(source: string, marker: string, replacement: string): string {
  if (!source.includes(marker)) {
    throw new Error(`Metric box UV shader marker missing: ${marker}`);
  }
  return source.replace(marker, replacement);
}
