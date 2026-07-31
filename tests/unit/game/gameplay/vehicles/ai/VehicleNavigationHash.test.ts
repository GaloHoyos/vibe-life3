import { describe, expect, it, vi } from 'vitest';
import type { VehicleNavigationBakeInput } from '@game/gameplay/vehicles/ai/VehicleAiTypes';
import { vehicleNavigationHash } from '@game/gameplay/vehicles/ai/VehicleNavigationHash';
import {
  loadOrBakeVehicleNavigation,
  MemoryVehicleNavigationCache,
} from '@game/gameplay/vehicles/ai/VehicleNavigationCache';
import { bakeVehicleNavigation } from '@game/gameplay/vehicles/ai/VehicleNavigationBake';
import { groundProfile } from './fixtures';

function input(): VehicleNavigationBakeInput {
  return {
    geometry: {
      revision: 'geometry-a',
      obstacles: [
        { id: 'wall-b', min: [4, 0, 4], max: [5, 2, 5] },
        { id: 'wall-a', min: [1, 0, 1], max: [2, 2, 2] },
      ],
    },
    waterVolumes: [
      { id: 'water', position: [0, -0.5, 0], size: [10, 1, 10] },
    ],
    areas: [
      {
        id: 'area',
        polygon: [[0, 0, 0], [10, 0, 0], [10, 0, 10], [0, 0, 10]],
        surface: 'ground',
      },
    ],
    lanes: [
      {
        id: 'lane',
        points: [[0, 0, 0], [10, 0, 0]],
        width: 3,
        direction: 'both',
      },
    ],
    markers: [
      { id: 'bay', position: [5, 0, 5], kind: 'passingBay' },
    ],
    profiles: [groundProfile],
  };
}

describe('vehicleNavigationHash', () => {
  it('es determinista ante reordenamientos no semánticos', () => {
    const source = input();
    const reordered: VehicleNavigationBakeInput = {
      ...source,
      geometry: {
        ...source.geometry,
        obstacles: [...source.geometry.obstacles].reverse(),
      },
    };
    expect(vehicleNavigationHash(reordered)).toBe(vehicleNavigationHash(source));
  });

  it('invalida por geometría, agua y perfil', () => {
    const source = input();
    const base = vehicleNavigationHash(source);
    expect(vehicleNavigationHash({
      ...source,
      geometry: { ...source.geometry, revision: 'geometry-b' },
    })).not.toBe(base);
    expect(vehicleNavigationHash({
      ...source,
      waterVolumes: [{ ...source.waterVolumes[0], size: [11, 1, 10] }],
    })).not.toBe(base);
    expect(vehicleNavigationHash({
      ...source,
      profiles: [{ ...groundProfile, minTurnRadius: 8 }],
    })).not.toBe(base);
  });

  it('reutiliza un bake válido por hash', async () => {
    const source = input();
    const cache = new MemoryVehicleNavigationCache();
    const bake = vi.fn(bakeVehicleNavigation);
    const first = await loadOrBakeVehicleNavigation(source, cache, bake);
    const second = await loadOrBakeVehicleNavigation(source, cache, bake);
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(second.navigation).toBe(first.navigation);
    expect(bake).toHaveBeenCalledTimes(1);
  });
});
