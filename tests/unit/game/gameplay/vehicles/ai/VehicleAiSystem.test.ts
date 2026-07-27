import { describe, expect, it } from 'vitest';
import { VehiclePresets } from '@game/config/vehicles.config';
import { VehicleAiSystem } from '@game/gameplay/vehicles/ai/VehicleAiSystem';
import { MemoryVehicleNavigationCache } from '@game/gameplay/vehicles/ai/VehicleNavigationCache';
import type {
  VehicleBrainContext,
  VehicleNavigationBakeInput,
} from '@game/gameplay/vehicles/ai/VehicleAiTypes';
import { navigationProfileFromPreset } from '@game/gameplay/vehicles/ai/VehicleAiTypes';

describe('VehicleAiSystem', () => {
  it('carga, registra, planifica, expone control y restaura snapshot', async () => {
    const system = new VehicleAiSystem(new MemoryVehicleNavigationCache());
    const profile = navigationProfileFromPreset(VehiclePresets.buggy);
    const input: VehicleNavigationBakeInput = {
      geometry: { obstacles: [] },
      waterVolumes: [],
      areas: [{
        id: 'yard',
        polygon: [[0, 0, 0], [24, 0, 0], [24, 0, 24], [0, 0, 24]],
        surface: 'ground',
      }],
      lanes: [],
      markers: [],
      profiles: [profile],
      options: { cellSize: 1 },
    };
    const firstLoad = await system.load(input);
    expect(firstLoad.cacheHit).toBe(false);
    expect(await system.load(input)).toMatchObject({
      hash: firstLoad.hash,
      cacheHit: true,
    });
    expect(system.registerVehicle({
      vehicleId: 'buggy-ai',
      preset: VehiclePresets.buggy,
      ai: { enabled: true, behavior: 'patrol' },
    })).toBe(true);
    expect(system.setGoal('buggy-ai', [18, 0, 18])).toBe(true);
    const update = system.update('buggy-ai', 0.1, brainContext());
    expect(update?.pathChanged).toBe(true);
    expect(update?.path?.points.length).toBeGreaterThan(2);

    const next = system.update('buggy-ai', 0.1, brainContext());
    expect(next?.decision.control.targetPoint).not.toBeNull();
    expect(system.controlOutput('buggy-ai')).toEqual(next?.decision.control);

    const snapshot = system.snapshot('buggy-ai');
    expect(snapshot?.goal?.position).toEqual([18, 0, 18]);
    expect(snapshot?.path?.points.length).toBeGreaterThan(2);
    system.clearGoal('buggy-ai');
    expect(system.restoreSnapshot(snapshot!)).toBe(true);
    expect(system.snapshot('buggy-ai')?.goal).toEqual(snapshot?.goal);
    system.dispose();
    expect(system.snapshot('buggy-ai')).toBeNull();
  });
});

function brainContext(): VehicleBrainContext {
  return {
    pose: { position: [3.5, 0, 3.5], heading: Math.PI / 4 },
    speed: 0,
    distanceToPlayer: 10,
    visibleToPlayer: true,
    hasPlayerOccupant: false,
    healthFraction: 1,
    driverAvailable: true,
    blocked: false,
    overturned: false,
  };
}
