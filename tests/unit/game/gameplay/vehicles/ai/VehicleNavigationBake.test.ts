import { describe, expect, it } from 'vitest';
import type { VehicleNavigationBakeInput } from '@game/gameplay/vehicles/ai/VehicleAiTypes';
import { bakeVehicleNavigation } from '@game/gameplay/vehicles/ai/VehicleNavigationBake';
import { groundProfile, waterProfile } from './fixtures';

describe('bakeVehicleNavigation', () => {
  it('recorta huella, colisión y clearance dentro de áreas autoradas', () => {
    const source: VehicleNavigationBakeInput = {
      geometry: {
        obstacles: [{ id: 'wall', min: [4, 0, 4], max: [6, 3, 6] }],
        surfaceSamples: [
          {
            position: [2.5, 0, 2.5],
            normal: [0, 1, 0],
            surface: 'ground',
            clearance: 1,
          },
        ],
      },
      waterVolumes: [],
      areas: [{
        id: 'yard',
        polygon: [[0, 0, 0], [10, 0, 0], [10, 0, 10], [0, 0, 10]],
        surface: 'ground',
      }],
      lanes: [],
      markers: [],
      profiles: [groundProfile],
      options: { maxSampleDistance: 0.6 },
    };
    const grid = bakeVehicleNavigation(source).grids[0];
    expect(grid.cells.length).toBeGreaterThan(30);
    expect(grid.cells.some((cell) => cell.position[0] < 0.5)).toBe(false);
    expect(grid.cells.some((cell) =>
      cell.position[0] >= 4.5 &&
      cell.position[0] <= 5.5 &&
      cell.position[2] >= 4.5 &&
      cell.position[2] <= 5.5
    )).toBe(false);
    expect(grid.cells.some((cell) =>
      Math.abs(cell.position[0] - 2.5) < 0.1 &&
      Math.abs(cell.position[2] - 2.5) < 0.1
    )).toBe(false);
  });

  it('deriva la altura navegable del volumen de agua', () => {
    const source: VehicleNavigationBakeInput = {
      geometry: { obstacles: [] },
      waterVolumes: [{
        id: 'canal',
        position: [5, -1, 5],
        size: [10, 4, 10],
        surface: 'canal',
      }],
      areas: [{
        id: 'water-area',
        polygon: [[0, 0, 0], [10, 0, 0], [10, 0, 10], [0, 0, 10]],
        surface: 'water',
      }],
      lanes: [],
      markers: [],
      profiles: [waterProfile],
    };
    const grid = bakeVehicleNavigation(source).grids[0];
    expect(grid.cells.length).toBeGreaterThan(20);
    expect(grid.cells.every((cell) => cell.position[1] === 1)).toBe(true);
    expect(grid.cells.every((cell) => cell.surface === 'water')).toBe(true);
  });

  it('no genera navegación libre para perfiles on-rails', () => {
    const source: VehicleNavigationBakeInput = {
      geometry: { obstacles: [] },
      waterVolumes: [],
      areas: [{
        id: 'all',
        polygon: [[0, 0, 0], [10, 0, 0], [10, 0, 10], [0, 0, 10]],
        surface: 'both',
      }],
      lanes: [],
      markers: [],
      profiles: [{ ...groundProfile, id: 'helicopter', surface: 'rail' }],
    };
    expect(bakeVehicleNavigation(source).grids[0].cells).toEqual([]);
  });
});
