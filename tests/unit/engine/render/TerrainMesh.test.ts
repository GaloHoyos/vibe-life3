import { MeshStandardMaterial } from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@engine/render/material/Materials', () => ({
  getMaterial: () => new MeshStandardMaterial(),
  materialNeedsUv1: (material: string) => material === 'brick',
  materialUvPreScale: (material: string) => material === 'concrete' ? 1 / 8 : null,
}));

import { createTerrainMesh } from '@engine/render/TerrainMesh';

const flatField = {
  widthSamples: 2,
  depthSamples: 2,
  heights: new Float32Array(4),
};

describe('createTerrainMesh texture density', () => {
  it('escala los UV por las dimensiones físicas cuando el material declara tileSize', () => {
    const mesh = createTerrainMesh(flatField, {
      id: 'metric-terrain',
      position: [0, 0, 0],
      size: [8, 4],
      material: 'concrete',
    });

    expect(Array.from(mesh.geometry.attributes.uv.array)).toEqual([
      0, 0,
      1, 0,
      0, 0.5,
      1, 0.5,
    ]);
  });

  it('conserva UV normalizado y lo copia a uv1 para sets heredados con AO', () => {
    const mesh = createTerrainMesh(flatField, {
      id: 'legacy-terrain',
      position: [0, 0, 0],
      size: [8, 4],
      material: 'brick',
    });
    const uv = mesh.geometry.attributes.uv;

    expect(Array.from(uv.array)).toEqual([
      0, 0,
      1, 0,
      0, 1,
      1, 1,
    ]);
    expect(mesh.geometry.attributes.uv1).toBe(uv);
  });
});
