import { BufferAttribute, BufferGeometry, MeshBasicMaterial, type Vector3 } from "three";
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes.js";
import {
  BLOB_FIELD_ISOLATION,
  BLOB_FIELD_SUBTRACT,
  BLOB_SUPPORT_FACTOR,
} from "./Blobulator";

export interface BlobSpec {
  position: Vector3;
  radius: number;
}

const MAX_RESOLUTION = 56;

/**
 * Hornea una isosuperficie de metaballs one-shot a un `BufferGeometry` en las
 * coordenadas de los blobs (sin chunks ni colliders). Mismo campo recíproco
 * que `Blobulator`, pero para masas que viajan con un objeto (p. ej. el
 * cascarón de una estatua congelada); el hielo estático del mundo sigue
 * siendo del `Blobulator`.
 */
export function bakeBlobGeometry(
  blobs: readonly BlobSpec[],
  cellSize: number,
  maxPolyCount = 20000,
): BufferGeometry | null {
  if (blobs.length === 0) {
    return null;
  }

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const blob of blobs) {
    const support = blob.radius * BLOB_SUPPORT_FACTOR;
    minX = Math.min(minX, blob.position.x - support);
    minY = Math.min(minY, blob.position.y - support);
    minZ = Math.min(minZ, blob.position.z - support);
    maxX = Math.max(maxX, blob.position.x + support);
    maxY = Math.max(maxY, blob.position.y + support);
    maxZ = Math.max(maxZ, blob.position.z + support);
  }
  // MarchingCubes ignora la capa exterior del campo: dejar margen de celdas.
  const margin = cellSize * 3;
  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ) + margin * 2;
  const resolution = Math.min(
    MAX_RESOLUTION,
    Math.max(8, Math.ceil(extent / cellSize)),
  );
  const domainSize = resolution * cellSize;
  const half = domainSize / 2;
  const originX = (minX + maxX) / 2 - half;
  const originY = (minY + maxY) / 2 - half;
  const originZ = (minZ + maxZ) / 2 - half;

  const material = new MeshBasicMaterial();
  const scratch = new MarchingCubes(resolution, material, false, false, maxPolyCount);
  scratch.isolation = BLOB_FIELD_ISOLATION;
  scratch.reset();
  for (const blob of blobs) {
    const normalizedRadius = blob.radius / domainSize;
    scratch.addBall(
      (blob.position.x - originX) / domainSize,
      (blob.position.y - originY) / domainSize,
      (blob.position.z - originZ) / domainSize,
      (BLOB_FIELD_SUBTRACT + BLOB_FIELD_ISOLATION) * normalizedRadius * normalizedRadius,
      BLOB_FIELD_SUBTRACT,
    );
  }
  scratch.update();

  const vertexCount = Math.min(scratch.count, maxPolyCount * 3);
  const src = scratch.positionArray;
  const srcNormals = scratch.normalArray;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  for (let v = 0; v < vertexCount; v += 1) {
    const o = v * 3;
    positions[o] = originX + (src[o] + 1) * half;
    positions[o + 1] = originY + (src[o + 1] + 1) * half;
    positions[o + 2] = originZ + (src[o + 2] + 1) * half;
    const nx = srcNormals[o];
    const ny = srcNormals[o + 1];
    const nz = srcNormals[o + 2];
    const length = Math.hypot(nx, ny, nz);
    if (length > 1e-6) {
      normals[o] = nx / length;
      normals[o + 1] = ny / length;
      normals[o + 2] = nz / length;
    } else {
      normals[o + 1] = 1;
    }
  }
  scratch.geometry.dispose();
  material.dispose();

  if (vertexCount === 0) {
    return null;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(normals, 3));
  geometry.computeBoundingSphere();
  return geometry;
}
