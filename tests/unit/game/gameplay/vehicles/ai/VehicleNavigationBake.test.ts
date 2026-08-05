import { describe, expect, it } from 'vitest';
import type {
  VehicleNavigationBakeInput,
  VehicleSurfaceSample,
} from '@game/gameplay/vehicles/ai/VehicleAiTypes';
import { bakeVehicleNavigation } from '@game/gameplay/vehicles/ai/VehicleNavigationBake';
import { vehicleNavCells } from '@game/gameplay/vehicles/ai/VehicleNavGridIndex';
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
    const cells = vehicleNavCells(bakeVehicleNavigation(source).grids[0]);
    expect(cells.length).toBeGreaterThan(30);
    expect(cells.some((cell) => cell.position[0] < 0.5)).toBe(false);
    expect(cells.some((cell) =>
      cell.position[0] >= 4.5 &&
      cell.position[0] <= 5.5 &&
      cell.position[2] >= 4.5 &&
      cell.position[2] <= 5.5
    )).toBe(false);
    expect(cells.some((cell) =>
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
    const cells = vehicleNavCells(bakeVehicleNavigation(source).grids[0]);
    expect(cells.length).toBeGreaterThan(20);
    expect(cells.every((cell) => cell.position[1] === 1)).toBe(true);
    expect(cells.every((cell) => cell.surface === 'water')).toBe(true);
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
    expect(vehicleNavCells(bakeVehicleNavigation(source).grids[0])).toEqual([]);
  });

  it('deriva el terreno manejable de la geometría aunque nadie autore áreas', () => {
    const cells = bakeCells({ areas: [] });

    expect(cells.length).toBeGreaterThan(50);
    expect(cells.every((cell) => cell.position[1] === 0)).toBe(true);
    expect(cells.every((cell) => cell.areaId === '')).toBe(true);
    expect(new Set(cells.map((cell) => cell.componentId)).size).toBe(1);
  });

  it('deja manejable una losa fina y bloquea el interior de un bloque', () => {
    const cells = bakeCells({
      obstacles: [
        { id: 'slab', min: [2, 0, 2], max: [8, 0.2, 8] },
        { id: 'block', min: [12, 0, 2], max: [18, 3, 8] },
      ],
      seeds: [[0.5, 0, 0.5]],
    });

    const onSlab = cells.find(
      (cell) => cell.position[0] === 5.5 && cell.position[2] === 5.5,
    );
    expect(onSlab?.position[1]).toBeCloseTo(0.2);
    // La cara superior del bloque pasa los tests de celda pero no alcanza la
    // semilla: sin la poda quedaría como plataforma manejable en el aire.
    expect(cells.some((cell) => cell.position[1] > 1)).toBe(false);
  });

  it('se sube al cordón en vez de rodearlo, y sin dejar foso alrededor', () => {
    const cells = bakeCells({
      obstacles: [{ id: 'slab', min: [6, 0, 6], max: [14, 0.2, 14] }],
    });

    // Encima de la losa se conduce a la cota de la losa, no a la del suelo que
    // tapa: si no, el vehículo la atravesaría en vez de pisarla.
    const onSlab = cells.find((cell) => cell.position[0] === 10.5 && cell.position[2] === 10.5);
    expect(onSlab?.position[1]).toBeCloseTo(0.2);

    // Y el canto no abre un anillo de celdas muertas: las que apoyan a caballo
    // del borde existen, o la losa quedaría desconectada del suelo.
    const onEdge = cells.find((cell) => cell.position[0] === 5.5 && cell.position[2] === 10.5);
    expect(onEdge).toBeDefined();
    expect(new Set(cells.map((cell) => cell.componentId)).size).toBe(1);
  });

  it('bloquea por gálibo lo que pasa por debajo de un tablero bajo', () => {
    const cells = bakeCells({
      obstacles: [{ id: 'deck', min: [4, 1.2, 4], max: [6, 1.5, 6] }],
    });

    expect(cells.some((cell) =>
      cell.position[0] > 4 && cell.position[0] < 6 &&
      cell.position[2] > 4 && cell.position[2] < 6
    )).toBe(false);
    expect(cells.some((cell) => cell.position[0] === 3.5 && cell.position[2] === 4.5)).toBe(true);
  });

  it('usa el área autorada como anotación, no como límite del grid', () => {
    const cells = bakeCells({
      areas: [{
        id: 'plaza',
        polygon: [[0, 0, 0], [8, 0, 0], [8, 0, 8], [0, 0, 8]],
        surface: 'ground',
        cost: 3,
        speedLimit: 5,
        flags: ['noCombat'],
      }],
    });

    const inside = cells.find((cell) => cell.position[0] === 4.5 && cell.position[2] === 4.5);
    expect(inside?.cost).toBe(3);
    expect(inside?.speedLimit).toBe(5);
    expect(inside?.flags).toEqual(['noCombat']);
    const outside = cells.find((cell) => cell.position[0] === 15.5 && cell.position[2] === 15.5);
    expect(outside?.cost).toBe(1);
    expect(outside?.areaId).toBe('');
    expect(outside?.flags).toEqual([]);
  });

  it('recorta el grid en las áreas marcadas como bloqueadas', () => {
    const cells = bakeCells({
      areas: [{
        id: 'minado',
        polygon: [[4, 0, 4], [10, 0, 4], [10, 0, 10], [4, 0, 10]],
        surface: 'ground',
        blocked: true,
      }],
    });

    expect(cells.some((cell) =>
      cell.position[0] > 4 && cell.position[0] < 10 &&
      cell.position[2] > 4 && cell.position[2] < 10
    )).toBe(false);
    expect(cells.some((cell) => cell.position[0] === 15.5)).toBe(true);
  });

  it('descarta las islas que ninguna semilla alcanza', () => {
    const plateau = { id: 'plateau', min: [24, 0, 2] as const, max: [34, 5, 12] as const };
    const withoutSeeds = bakeCells({ obstacles: [plateau] });
    const withSeeds = bakeCells({ obstacles: [plateau], seeds: [[0.5, 0, 0.5]] });

    expect(withoutSeeds.some((cell) => cell.position[1] === 5)).toBe(true);
    expect(withSeeds.some((cell) => cell.position[1] === 5)).toBe(false);
    expect(withSeeds.length).toBeGreaterThan(50);
  });
});

/**
 * Terreno llano de 20 x 20 muestreado cada metro, que es la situación normal de
 * un nivel: geometría real y ninguna área pintada a mano.
 */
function bakeCells(
  overrides: Partial<Pick<VehicleNavigationBakeInput, 'areas' | 'seeds'>> & {
    obstacles?: VehicleNavigationBakeInput['geometry']['obstacles'];
  },
): ReturnType<typeof vehicleNavCells> {
  const surfaceSamples: VehicleSurfaceSample[] = [];
  for (let x = 0; x <= 20; x += 1) {
    for (let z = 0; z <= 20; z += 1) {
      surfaceSamples.push({ position: [x, 0, z], normal: [0, 1, 0], surface: 'ground' });
    }
  }
  const source: VehicleNavigationBakeInput = {
    geometry: { obstacles: overrides.obstacles ?? [], surfaceSamples },
    waterVolumes: [],
    areas: overrides.areas ?? [],
    lanes: [],
    markers: [],
    profiles: [groundProfile],
    ...(overrides.seeds ? { seeds: overrides.seeds } : {}),
  };
  return vehicleNavCells(bakeVehicleNavigation(source).grids[0]);
}
