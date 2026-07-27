import { describe, expect, it } from 'vitest';
import { VehiclePresets } from '@game/config/vehicles.config';
import type { LevelDefinition } from '@game/levels/LevelDefinition';
import { vehicleNavigationInputFromLevel } from '@game/gameplay/vehicles/ai/VehicleNavigationLevelAdapter';

describe('vehicleNavigationInputFromLevel', () => {
  it('convierte cajas rotadas y el heightfield físico sin depender de Three', () => {
    const level = baseLevel();
    level.staticBoxes.push({
      id: 'rotated-wall',
      position: [0, 1, 0],
      size: [2, 2, 6],
      rotation: [0, Math.PI / 2, 0],
      material: 'concrete',
    });
    level.terrain = {
      id: 'terrain',
      position: [10, 2, 10],
      size: [4, 4],
      widthSamples: 3,
      depthSamples: 3,
      source: { kind: 'flat', height: 3 },
      material: 'concrete',
    };
    const input = vehicleNavigationInputFromLevel(level, {
      presets: [VehiclePresets.buggy],
    });
    const obstacle = input.geometry.obstacles[0];
    expect(obstacle.min[0]).toBeCloseTo(-3);
    expect(obstacle.max[0]).toBeCloseTo(3);
    expect(obstacle.min[2]).toBeCloseTo(-1);
    expect(obstacle.max[2]).toBeCloseTo(1);
    expect(input.geometry.surfaceSamples).toContainEqual({
      position: [10, 5, 10],
      normal: [0, 1, 0],
      surface: 'ground',
    });
    expect(input.profiles.map((profile) => profile.id)).toEqual(['buggy']);
  });
});

function baseLevel(): LevelDefinition {
  return {
    id: 'vehicle-adapter-test',
    title: 'Test',
    background: 0,
    playerStart: [0, 1, 0],
    audio: { ambiences: [], footstepSounds: [] },
    staticBoxes: [],
    dynamicBoxes: [],
    doors: [],
    npcs: [],
    weaponPickups: [],
    triggers: [],
  };
}
