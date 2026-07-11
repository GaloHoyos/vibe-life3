import { BoxGeometry, Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { HeightField } from "@shared/math/HeightField";

/** Caja de colisión fuente, estructural para no acoplar engine al formato de niveles del juego. */
export interface NavigationBoxSource {
  position: readonly [number, number, number];
  size: readonly [number, number, number];
  rotation?: readonly [number, number, number];
}

export interface NavigationGeometryData {
  positions: Float32Array;
  indices: Uint32Array;
  bounds: { min: Vector3; max: Vector3 };
}

/**
 * Triangula la geometría autoritativa de colisión del nivel. No lee meshes
 * renderizables: evita incluir decoración sin collider en el navmesh.
 */
export function buildNavigationGeometry(
  boxes: readonly NavigationBoxSource[],
  terrain?: { field: HeightField; position: Vector3; size: [number, number] },
): NavigationGeometryData {
  const positions: number[] = [];
  const indices: number[] = [];
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  const vertex = new Vector3();
  const matrix = new Matrix4();
  const quaternion = new Quaternion();

  for (const box of boxes) {
    const geometry = new BoxGeometry(box.size[0], box.size[1], box.size[2]);
    quaternion.setFromEuler(
      new Euler(
        box.rotation?.[0] ?? 0,
        box.rotation?.[1] ?? 0,
        box.rotation?.[2] ?? 0,
      ),
    );
    matrix.compose(
      new Vector3(box.position[0], box.position[1], box.position[2]),
      quaternion,
      new Vector3(1, 1, 1),
    );
    const attr = geometry.getAttribute("position");
    const offset = positions.length / 3;
    for (let i = 0; i < attr.count; i += 1) {
      vertex.fromBufferAttribute(attr, i).applyMatrix4(matrix);
      positions.push(vertex.x, vertex.y, vertex.z);
      min.min(vertex);
      max.max(vertex);
    }
    const sourceIndices = geometry.getIndex();
    if (sourceIndices) {
      for (let i = 0; i < sourceIndices.count; i += 1) {
        indices.push(offset + sourceIndices.getX(i));
      }
    } else {
      for (let i = 0; i < attr.count; i += 1) indices.push(offset + i);
    }
    geometry.dispose();
  }

  if (terrain) {
    appendTerrain(terrain.field, terrain.position, terrain.size, positions, indices, min, max);
  }

  if (positions.length === 0) {
    min.set(0, 0, 0);
    max.set(0, 0, 0);
  }
  return {
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
    bounds: { min, max },
  };
}

function appendTerrain(
  field: HeightField,
  position: Vector3,
  size: [number, number],
  positions: number[],
  indices: number[],
  min: Vector3,
  max: Vector3,
): void {
  const offset = positions.length / 3;
  for (let z = 0; z < field.depthSamples; z += 1) {
    for (let x = 0; x < field.widthSamples; x += 1) {
      const i = x + z * field.widthSamples;
      const px = position.x + (x / (field.widthSamples - 1) - 0.5) * size[0];
      const py = position.y + field.heights[i];
      const pz = position.z + (z / (field.depthSamples - 1) - 0.5) * size[1];
      positions.push(px, py, pz);
      min.min(new Vector3(px, py, pz));
      max.max(new Vector3(px, py, pz));
    }
  }
  for (let z = 0; z < field.depthSamples - 1; z += 1) {
    for (let x = 0; x < field.widthSamples - 1; x += 1) {
      const a = offset + x + z * field.widthSamples;
      const b = a + 1;
      const c = a + field.widthSamples;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
}

