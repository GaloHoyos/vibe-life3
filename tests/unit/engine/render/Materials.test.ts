import { MeshStandardMaterial, Texture } from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getTextureSet = vi.fn((id: string) => ({
  albedo: new Texture(),
  normal: null,
  roughness: null,
  ao: id === 'brickFactory' ? new Texture() : null,
  metallic: null,
  definition: {
    maps: { albedo: `${id}.png`, ...(id === 'brickFactory' ? { ao: `${id}-ao.png` } : {}) },
    tiling: 1,
    roughness: 0.8,
    metalness: 0.1,
  },
}));

vi.mock('@engine/render/material/Textures', () => ({
  getTextureSet,
  TextureSets: new Proxy({}, {
    get: (_target, key) => {
      const id = String(key);
      return {
        maps: id === 'brickFactory'
          ? { albedo: 'brick.png', ao: 'brick-ao.png' }
          : { albedo: `${id}.png` },
        tiling: id === 'weatheredConcrete' ? 4 : 1,
        ...(id === 'weatheredConcrete' ? { tileSize: 2 } : {}),
      };
    },
  }),
}));

describe('Materials texture families', () => {
  beforeEach(() => {
    getTextureSet.mockClear();
  });

  it('carga cada familia PBR de forma lazy y reutiliza su material base', async () => {
    const { getMaterial } = await import('@engine/render/material/Materials');
    expect(getTextureSet).not.toHaveBeenCalled();

    const first = getMaterial('concrete');
    const second = getMaterial('concrete');

    expect(getTextureSet).toHaveBeenCalledTimes(1);
    expect(getTextureSet).toHaveBeenCalledWith('weatheredConcrete');
    expect(first).toBeInstanceOf(MeshStandardMaterial);
    expect(second).not.toBe(first);
    expect(first.map).toBe(second.map);
  });

  it('combina el albedo de controles con la emisión funcional', async () => {
    const { getMaterial } = await import('@engine/render/material/Materials');
    const button = getMaterial('button');

    expect(button.map).toBeInstanceOf(Texture);
    expect(button.emissiveMap).toBe(button.map);
    expect(button.emissive.getHex()).toBe(0x07343a);
    expect(button.metalness).toBeCloseTo(0.1);
  });

  it('expone una densidad métrica sin forzarla sobre sets heredados o sólidos', async () => {
    const { materialUvPreScale } = await import('@engine/render/material/Materials');

    expect(materialUvPreScale('concrete')).toBeCloseTo(1 / 8);
    expect(materialUvPreScale('brick')).toBeNull();
    expect(materialUvPreScale('npc')).toBeNull();
  });

  it('detecta uv1 desde la definición sin cargar texturas', async () => {
    const { materialNeedsUv1 } = await import('@engine/render/material/Materials');
    getTextureSet.mockClear();

    expect(materialNeedsUv1('brick')).toBe(true);
    expect(materialNeedsUv1('concrete')).toBe(false);
    expect(getTextureSet).not.toHaveBeenCalled();
  });

  it('texturiza las superficies físicas y conserva sólidas las señales/fallbacks', async () => {
    const { getMaterial } = await import('@engine/render/material/Materials');
    const textured = [
      'floor', 'asphalt', 'wall', 'trim', 'crate', 'dynamic', 'door', 'button', 'hazard',
      'plaster', 'concrete', 'woodDark', 'metalRusted',
    ] as const;
    const solid = ['npc', 'npcDead', 'lightWarm', 'signalBlue', 'signalRed'] as const;

    textured.forEach((key) => expect(getMaterial(key).map, key).toBeInstanceOf(Texture));
    solid.forEach((key) => expect(getMaterial(key).map, key).toBeNull());
  });
});
