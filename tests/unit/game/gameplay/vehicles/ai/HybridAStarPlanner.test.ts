import { describe, expect, it } from 'vitest';
import {
  HybridAStarPlanner,
  VEHICLE_HYBRID_HEADING_COUNT,
} from '@game/gameplay/vehicles/ai/HybridAStarPlanner';
import { normalizeAngle, planarDistance } from '@game/gameplay/vehicles/ai/VehicleAiMath';
import type { VehicleNavCell } from '@game/gameplay/vehicles/ai/VehicleAiTypes';
import { buildVehicleNavGrid } from '@game/gameplay/vehicles/ai/VehicleNavGridIndex';
import { groundProfile, rectangularGrid } from './fixtures';

/** Dos placas separadas, cada una con su isla de conectividad. */
function twoIslandGrid(): ReturnType<typeof buildVehicleNavGrid> {
  const cells: VehicleNavCell[] = [];
  for (const [offset, componentId] of [[0, 0], [20, 1]] as const) {
    for (let ix = 0; ix < 6; ix += 1) {
      for (let iz = 0; iz < 6; iz += 1) {
        cells.push({
          ix: ix + offset,
          iz,
          position: [ix + offset + 0.5, 0, iz + 0.5],
          areaId: 'test',
          surface: 'ground',
          cost: 1,
          speedLimit: null,
          flags: [],
          tags: [],
          componentId,
        });
      }
    }
  }
  return buildVehicleNavGrid(groundProfile.id, 1, [0, 0], 'ground', cells);
}

describe('HybridAStarPlanner', () => {
  it('encuentra un camino forward alrededor de un obstáculo', () => {
    const blocked = new Set<string>();
    for (let iz = 1; iz < 8; iz += 1) blocked.add(`4:${iz}`);
    blocked.delete('4:4');
    const planner = new HybridAStarPlanner(rectangularGrid(10, 10, blocked), groundProfile);
    const path = planner.plan(
      { position: [1.5, 0, 1.5], heading: Math.PI / 2 },
      { position: [8.5, 0, 8.5], heading: 0 },
    );
    expect(path?.reachedGoal).toBe(true);
    expect(path?.points.length).toBeGreaterThan(4);
    expect(path?.points.some((point) => point.position[0] === 4.5 && point.position[2] !== 4.5))
      .toBe(false);
  });

  it('usa reverse en un corredor donde el radio de giro no entra', () => {
    const blocked = new Set<string>();
    for (let ix = 0; ix < 3; ix += 1) {
      for (let iz = 0; iz < 10; iz += 1) {
        if (ix !== 1) blocked.add(`${ix}:${iz}`);
      }
    }
    const grid = rectangularGrid(3, 10, blocked);
    const path = new HybridAStarPlanner(grid, groundProfile).plan(
      { position: [1.5, 0, 7.5], heading: 0 },
      { position: [1.5, 0, 1.5], heading: 0 },
    );
    expect(path?.reachedGoal).toBe(true);
    expect(path?.points.some((point) => point.direction === 'reverse')).toBe(true);

    const forwardOnly = new HybridAStarPlanner(
      grid,
      { ...groundProfile, reverseAllowed: false },
    ).plan(
      { position: [1.5, 0, 7.5], heading: 0 },
      { position: [1.5, 0, 1.5], heading: 0 },
    );
    expect(forwardOnly?.reachedGoal ?? false).toBe(false);
  });

  it('cuantiza 16 headings y respeta la longitud mínima del arco de giro', () => {
    const profile = { ...groundProfile, minTurnRadius: 6 };
    // Sin el atajo de Dubins: su tramo final es una curva continua, y esta
    // prueba fija la discretización de la búsqueda, no la del atajo.
    const path = new HybridAStarPlanner(rectangularGrid(20, 20), profile).plan(
      { position: [2.5, 0, 2.5], heading: 0 },
      { position: [14.5, 0, 14.5], heading: Math.PI / 2 },
      { analyticExpansion: false },
    );
    expect(path?.reachedGoal).toBe(true);
    const headingStep = (Math.PI * 2) / VEHICLE_HYBRID_HEADING_COUNT;
    for (let index = 1; index < (path?.points.length ?? 0); index += 1) {
      const previous = path!.points[index - 1];
      const current = path!.points[index];
      const turn = Math.abs(normalizeAngle(current.heading - previous.heading));
      const buckets = turn / headingStep;
      expect(Math.abs(buckets - Math.round(buckets))).toBeLessThan(1e-6);
      if (turn > 0.01) {
        expect(planarDistance(previous.position, current.position))
          .toBeGreaterThan(profile.minTurnRadius * headingStep - 0.8);
      }
    }
  });

  it('rodea un muro largo dentro de un presupuesto corto de estados', () => {
    // La línea recta apunta directo al muro: con la heurística euclídea la
    // búsqueda se come el presupuesto empujando contra él antes de aceptar que
    // hay que alejarse del goal para rodearlo.
    const blocked = new Set<string>();
    for (let iz = 0; iz < 18; iz += 1) blocked.add(`10:${iz}`);
    const planner = new HybridAStarPlanner(rectangularGrid(20, 20, blocked), groundProfile);

    const path = planner.plan(
      { position: [1.5, 0, 1.5], heading: 0 },
      { position: [18.5, 0, 1.5], heading: Math.PI },
      { maxExpandedStates: 1200 },
    );

    expect(path?.reachedGoal).toBe(true);
    expect(path?.points.some((point) => point.position[2] > 17)).toBe(true);
    expect(path?.expandedStates).toBeLessThan(1200);
  });

  it('cierra el rumbo exacto con el atajo analítico', () => {
    const grid = rectangularGrid(30, 30);
    const start = { position: [4.5, 0, 4.5] as const, heading: 0 };
    // Un rumbo que no cae en ninguno de los 16 buckets de la búsqueda.
    const goal = { position: [20.5, 0, 20.5] as const, heading: 0.31 };

    const withShortcut = new HybridAStarPlanner(grid, groundProfile).plan(start, goal);
    const withoutShortcut = new HybridAStarPlanner(grid, groundProfile).plan(start, goal, {
      analyticExpansion: false,
    });

    expect(withShortcut?.reachedGoal).toBe(true);
    expect(withShortcut?.points.at(-1)?.heading).toBeCloseTo(goal.heading, 1);
    // La búsqueda sola sólo puede aterrizar en un múltiplo del paso de rumbo.
    expect(withoutShortcut?.points.at(-1)?.heading).not.toBeCloseTo(goal.heading, 2);
    expect(withShortcut?.expandedStates ?? 0).toBeLessThanOrEqual(
      withoutShortcut?.expandedStates ?? 0,
    );
  });

  it('el atajo respeta los obstáculos, no los atraviesa', () => {
    // Muro de una celda de espesor: es justo el caso que una curva libre puede
    // saltarse si la validación tolera que el punto caiga "cerca" de una celda.
    const blocked = new Set<string>();
    for (let iz = 0; iz < 18; iz += 1) blocked.add(`10:${iz}`);
    const path = new HybridAStarPlanner(rectangularGrid(20, 20, blocked), groundProfile).plan(
      { position: [1.5, 0, 1.5], heading: 0 },
      { position: [18.5, 0, 1.5], heading: Math.PI },
    );

    expect(path?.reachedGoal).toBe(true);
    const crossesWall = path?.points.some(
      (point) =>
        point.position[0] > 10 && point.position[0] < 11 && point.position[2] < 18,
    );
    expect(crossesWall).toBe(false);
  });

  it('descarta sin buscar un destino en otra isla', () => {
    const planner = new HybridAStarPlanner(twoIslandGrid(), groundProfile);

    expect(planner.isReachable([1.5, 0, 1.5], [3.5, 0, 3.5])).toBe(true);
    expect(planner.isReachable([1.5, 0, 1.5], [21.5, 0, 1.5])).toBe(false);
    expect(planner.plan(
      { position: [1.5, 0, 1.5], heading: 0 },
      { position: [21.5, 0, 1.5], heading: 0 },
    )).toBeNull();
  });

  it('veta el corredor cuando un estorbo de runtime lo tapa', () => {
    const blocked = new Set<string>();
    for (let ix = 0; ix < 5; ix += 1) {
      for (let iz = 0; iz < 12; iz += 1) if (ix !== 2) blocked.add(`${ix}:${iz}`);
    }
    const planner = new HybridAStarPlanner(rectangularGrid(5, 12, blocked), groundProfile);
    const start = { position: [2.5, 0, 1.5] as const, heading: 0 };
    const goal = { position: [2.5, 0, 10.5] as const, heading: 0 };

    expect(planner.plan(start, goal)?.reachedGoal).toBe(true);
    expect(planner.plan(start, goal, {
      blockers: [{ position: [2.5, 0, 5.5], radius: 1 }],
    })).toBeNull();
  });

  it('mantiene resultados deterministas cuando hay alternativas con el mismo costo', () => {
    const grid = rectangularGrid(12, 12, new Set<string>(['5:5']));
    const start = { position: [1.5, 0, 5.5] as const, heading: Math.PI / 2 };
    const goal = { position: [10.5, 0, 5.5] as const, heading: Math.PI / 2 };
    const expected = new HybridAStarPlanner(grid, groundProfile).plan(start, goal);

    expect(expected?.reachedGoal).toBe(true);
    for (let run = 0; run < 5; run += 1) {
      const actual = new HybridAStarPlanner(grid, groundProfile).plan(start, goal);
      expect(actual).toEqual(expected);
    }
  });
});
