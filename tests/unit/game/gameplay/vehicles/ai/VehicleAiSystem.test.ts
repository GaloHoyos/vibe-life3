import { describe, expect, it, vi } from 'vitest';
import { VehiclePresets } from '@game/config/vehicles.config';
import { VehicleAiSystem } from '@game/gameplay/vehicles/ai/VehicleAiSystem';
import { MemoryVehicleNavigationCache } from '@game/gameplay/vehicles/ai/VehicleNavigationCache';
import type {
  VehicleNavigationPlanClientFactory,
  VehicleNavigationPlanService,
} from '@game/gameplay/vehicles/ai/VehicleNavigationPlanClient';
import type { VehiclePlannedRoute } from '@game/gameplay/vehicles/ai/VehicleNavigationPlanner';
import type {
  VehicleBrainContext,
  VehicleNavigationBakeInput,
} from '@game/gameplay/vehicles/ai/VehicleAiTypes';
import { navigationProfileFromPreset } from '@game/gameplay/vehicles/ai/VehicleAiTypes';

describe('VehicleAiSystem', () => {
  it('carga, registra, planifica, expone control y restaura snapshot', async () => {
    const system = new VehicleAiSystem(new MemoryVehicleNavigationCache());
    const input = navigationInput();
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
    const scheduled = system.update('buggy-ai', 0.1, brainContext());
    expect(scheduled?.pathChanged).toBe(false);
    expect(scheduled?.path).toBeNull();
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));

    const update = system.update('buggy-ai', 0.1, brainContext());
    expect(update?.pathChanged).toBe(true);
    expect(update?.path?.points.length).toBeGreaterThan(2);
    expect(update?.decision.control.targetPoint).not.toBeNull();
    expect(system.controlOutput('buggy-ai')).toEqual(update?.decision.control);

    const snapshot = system.snapshot('buggy-ai');
    expect(snapshot?.goal?.position).toEqual([18, 0, 18]);
    expect(snapshot?.path?.points.length).toBeGreaterThan(2);
    const reservationBeforeRestore = system.reservationKey(
      'buggy-ai',
      [3.5, 0, 3.5],
    );
    expect(reservationBeforeRestore).toBe('lane:test-lane');
    system.clearGoal('buggy-ai');
    expect(system.restoreSnapshot(snapshot!)).toBe(true);
    expect(system.snapshot('buggy-ai')?.goal).toEqual(snapshot?.goal);
    expect(system.reservationKey('buggy-ai', [3.5, 0, 3.5])).toBe(
      reservationBeforeRestore,
    );
    system.dispose();
    expect(system.snapshot('buggy-ai')).toBeNull();
  });

  it('mantiene un solo plan pendiente mientras se mueve el objetivo', async () => {
    const pending: Array<
      (route: VehiclePlannedRoute | null) => void
    > = [];
    const plan = vi.fn(
      () => new Promise<VehiclePlannedRoute | null>((resolve) => {
        pending.push(resolve);
      }),
    );
    const dispose = vi.fn();
    const planService: VehicleNavigationPlanService = { plan, dispose };
    const planClientFactory: VehicleNavigationPlanClientFactory =
      async () => planService;
    const system = new VehicleAiSystem(
      new MemoryVehicleNavigationCache(),
      planClientFactory,
    );
    await system.load(navigationInput());
    system.registerVehicle({
      vehicleId: 'interceptor',
      preset: VehiclePresets.buggy,
      ai: { enabled: true, behavior: 'intercept' },
    });

    const first = system.update(
      'interceptor',
      0.1,
      interceptContext([12, 0, 12]),
    );
    expect(first?.path).toBeNull();
    expect(plan).toHaveBeenCalledTimes(1);

    system.update(
      'interceptor',
      0.1,
      interceptContext([18, 0, 12]),
    );
    expect(plan).toHaveBeenCalledTimes(1);

    pending.shift()?.(null);
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    system.update(
      'interceptor',
      0.5,
      interceptContext([22, 0, 12]),
    );
    expect(plan).toHaveBeenCalledTimes(2);

    pending.shift()?.(null);
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    system.update(
      'interceptor',
      0.5,
      interceptContext([24, 0, 12]),
    );
    expect(plan).toHaveBeenCalledTimes(2);
    system.update(
      'interceptor',
      0.5,
      interceptContext([26, 0, 12]),
    );
    expect(plan).toHaveBeenCalledTimes(3);

    system.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('cambia el comportamiento en runtime para órdenes del pasajero', async () => {
    const system = new VehicleAiSystem(new MemoryVehicleNavigationCache());
    await system.load(navigationInput());
    system.registerVehicle({
      vehicleId: 'commanded',
      preset: VehiclePresets.buggy,
      ai: { enabled: true, behavior: 'patrol' },
    });

    expect(system.getBehavior('commanded')).toBe('patrol');
    expect(system.setBehavior('commanded', 'hold')).toBe(true);
    expect(system.update('commanded', 0.1, brainContext())?.decision)
      .toMatchObject({ behavior: 'hold', goal: null });
    expect(system.snapshot('commanded')?.behavior).toBe('hold');
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

function interceptContext(
  target: readonly [number, number, number],
): VehicleBrainContext {
  return {
    ...brainContext(),
    threat: { id: 'moving-target', position: target },
  };
}

function navigationInput(): VehicleNavigationBakeInput {
  return {
    geometry: { obstacles: [] },
    waterVolumes: [],
    areas: [{
      id: 'yard',
      polygon: [[0, 0, 0], [24, 0, 0], [24, 0, 24], [0, 0, 24]],
      surface: 'ground',
    }],
    lanes: [{
      id: 'test-lane',
      points: [[2, 0, 2], [12, 0, 12], [22, 0, 22]],
      width: 2.5,
      direction: 'both',
      tags: ['singleLane'],
    }],
    markers: [],
    profiles: [navigationProfileFromPreset(VehiclePresets.buggy)],
    options: { cellSize: 1 },
  };
}
