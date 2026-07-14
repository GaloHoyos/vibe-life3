import { CylinderGeometry, Euler, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@engine/render/material/Materials', async () => {
  const { MeshStandardMaterial: Material } = await import('three');
  return {
    getMaterial: () => new Material(),
    materialNeedsUv1: (material: string) => material === 'brick',
    materialUvPreScale: (material: string) => ['wall', 'floor', 'hazard'].includes(material) ? 0.25 : null,
  };
});

import {
  applyMaterialUvsToCylinder,
  createBoxMesh,
  createInstancedBoxMeshes,
} from '@engine/render/PrimitiveFactory';

describe('createInstancedBoxMeshes', () => {
  it('agrupa por material y conserva identidad, sombras y búsqueda inversa', () => {
    const batches = createInstancedBoxMeshes({
      id: 'district-static',
      castShadow: true,
      receiveShadow: true,
      boxes: [
        { id: 'floor-a', position: [0, 0, 0], size: [2, 1, 2], material: 'floor' },
        { id: 'wall-a', position: [2, 1, 0], size: [1, 2, 3], material: 'wall' },
        { id: 'floor-b', position: [4, 0, 0], size: [3, 1, 2], material: 'floor' },
      ],
    });

    expect(batches).toHaveLength(2);
    const floor = batches.find((batch) => batch.userData.boxBatch.material === 'floor');
    expect(floor).toBeDefined();
    expect(floor?.name).toBe('district-static-floor');
    expect(floor?.count).toBe(2);
    expect(floor?.castShadow).toBe(true);
    expect(floor?.receiveShadow).toBe(true);
    expect(floor?.userData.boxBatch.instanceIds).toEqual(['floor-a', 'floor-b']);
    expect(floor?.userData.boxBatch.instanceIndexById).toEqual({ 'floor-a': 0, 'floor-b': 1 });
    expect(floor?.material).toBeInstanceOf(MeshStandardMaterial);
  });

  it('compone posición, rotación y escala en la matriz de cada instancia', () => {
    const [batch] = createInstancedBoxMeshes({
      id: 'rotated',
      boxes: [{
        id: 'box',
        position: [3, 4, 5],
        size: [2, 6, 8],
        rotation: [0.2, Math.PI / 2, -0.35],
        material: 'wall',
      }],
    });
    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    batch.getMatrixAt(0, matrix);
    matrix.decompose(position, rotation, scale);

    expect(position.toArray()).toEqual([3, 4, 5]);
    expect(scale.x).toBeCloseTo(2, 6);
    expect(scale.y).toBeCloseTo(6, 6);
    expect(scale.z).toBeCloseTo(8, 6);
    const expectedRotation = new Quaternion().setFromEuler(new Euler(0.2, Math.PI / 2, -0.35));
    expect(rotation.angleTo(expectedRotation)).toBeCloseTo(0, 6);
    expect(batch.boundingBox).not.toBeNull();
    expect(batch.boundingSphere).not.toBeNull();
  });

  it('incluye uv1 únicamente cuando el material lo necesita', () => {
    const batches = createInstancedBoxMeshes({
      id: 'uvs',
      boxes: [
        { id: 'brick', position: [0, 0, 0], size: [1, 1, 1], material: 'brick' },
        { id: 'plain', position: [2, 0, 0], size: [1, 1, 1], material: 'wall' },
      ],
    });
    const brick = batches.find((batch) => batch.userData.boxBatch.material === 'brick');
    const plain = batches.find((batch) => batch.userData.boxBatch.material === 'wall');

    expect(brick?.geometry.attributes.uv1).toBeDefined();
    expect(plain?.geometry.attributes.uv1).toBeUndefined();
  });

  it('inyecta proyección métrica en cajas texturizadas y conserva sólidos sin parche', () => {
    const textured = createBoxMesh({
      id: 'metric-wall',
      position: [0, 0, 0],
      size: [8, 3, 0.4],
      material: 'wall',
    });
    const texturedMaterial = textured.material as MeshStandardMaterial;
    const shader = {
      vertexShader: '#include <common>\nvoid main() {\n#include <uv_vertex>\n}',
      fragmentShader: '',
      uniforms: {},
    };
    texturedMaterial.onBeforeCompile(shader as never, {} as never);

    expect(texturedMaterial.customProgramCacheKey()).toContain('metric-box-uv-v1');
    expect(shader.vertexShader).toContain('metricBoxPosition');
    expect(shader.vertexShader).toContain('vMapUv');
    expect(shader.vertexShader).toContain('vEmissiveMapUv');
    expect(shader.uniforms).toEqual({ uMaterialUvPreScale: { value: 0.25 } });

    const solid = createBoxMesh({
      id: 'solid-npc',
      position: [0, 0, 0],
      size: [1, 2, 1],
      material: 'npc',
    });
    expect((solid.material as MeshStandardMaterial).customProgramCacheKey()).not.toContain('metric-box-uv-v1');
  });

  it('mantiene distintas escalas de instancia dentro de un único batch métrico', () => {
    const [batch] = createInstancedBoxMeshes({
      id: 'metric-batch',
      boxes: [
        { id: 'wide', position: [0, 0, 0], size: [12, 2, 0.5], material: 'wall' },
        { id: 'tall', position: [4, 0, 0], size: [1, 9, 3], material: 'wall' },
      ],
    });

    expect(batch.count).toBe(2);
    expect(batch.userData.boxBatch.instanceIds).toEqual(['wide', 'tall']);
    expect((batch.material as MeshStandardMaterial).customProgramCacheKey()).toContain('metric-box-uv-v1');
  });

  it('da escala física al lateral y las tapas de cilindros procedurales', () => {
    const geometry = applyMaterialUvsToCylinder(
      new CylinderGeometry(0.5, 0.5, 2, 8),
      'hazard',
    );
    const uv = geometry.attributes.uv;
    const torsoVertexCount = 18;
    const torsoU = Array.from({ length: torsoVertexCount }, (_, index) => uv.getX(index));
    const torsoV = Array.from({ length: torsoVertexCount }, (_, index) => uv.getY(index));
    const capU = Array.from(
      { length: uv.count - torsoVertexCount },
      (_, index) => uv.getX(index + torsoVertexCount),
    );

    expect(Math.max(...torsoU) - Math.min(...torsoU)).toBeCloseTo(Math.PI * 0.25, 6);
    expect(Math.max(...torsoV) - Math.min(...torsoV)).toBeCloseTo(0.5, 6);
    expect(Math.max(...capU) - Math.min(...capU)).toBeCloseTo(0.25, 6);
  });
});
