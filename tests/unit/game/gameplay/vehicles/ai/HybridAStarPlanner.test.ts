import { describe, expect, it } from 'vitest';
import {
  HybridAStarPlanner,
  VEHICLE_HYBRID_HEADING_COUNT,
} from '@game/gameplay/vehicles/ai/HybridAStarPlanner';
import { normalizeAngle, planarDistance } from '@game/gameplay/vehicles/ai/VehicleAiMath';
import { groundProfile, rectangularGrid } from './fixtures';

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
    const path = new HybridAStarPlanner(rectangularGrid(20, 20), profile).plan(
      { position: [2.5, 0, 2.5], heading: 0 },
      { position: [14.5, 0, 14.5], heading: Math.PI / 2 },
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
