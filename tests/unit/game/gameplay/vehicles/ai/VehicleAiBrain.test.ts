import { describe, expect, it } from 'vitest';
import type {
  VehicleBrainContext,
  VehicleBrainDecision,
} from '@game/gameplay/vehicles/ai/VehicleAiTypes';
import { VehicleAiBrain } from '@game/gameplay/vehicles/ai/VehicleAiBrain';
import { groundProfile } from './fixtures';

function context(
  overrides: Partial<VehicleBrainContext> = {},
): VehicleBrainContext {
  return {
    pose: { position: [0, 0, 0], heading: 0 },
    speed: 0,
    distanceToPlayer: 10,
    visibleToPlayer: false,
    hasPlayerOccupant: false,
    healthFraction: 1,
    driverAvailable: true,
    blocked: false,
    overturned: false,
    authoredGoal: [0, 0, 20],
    route: { points: [{ position: [0, 0, 20], speedLimit: 10 }] },
    ...overrides,
  };
}

describe('VehicleAiBrain', () => {
  it('actualiza a 10 Hz cerca y 5 Hz a media distancia', () => {
    const near = new VehicleAiBrain(
      'near',
      { enabled: true, behavior: 'patrol' },
      groundProfile,
    );
    const mid = new VehicleAiBrain(
      'mid',
      { enabled: true, behavior: 'patrol' },
      groundProfile,
    );
    let nearTicks = 0;
    let midTicks = 0;
    for (let frame = 0; frame < 100; frame += 1) {
      if (near.update(0.01, context({ distanceToPlayer: 20 }))) nearTicks += 1;
      if (mid.update(0.01, context({ distanceToPlayer: 100 }))) midTicks += 1;
    }
    expect(nearTicks).toBeGreaterThanOrEqual(9);
    expect(nearTicks).toBeLessThanOrEqual(11);
    expect(midTicks).toBeGreaterThanOrEqual(5);
    expect(midTicks).toBeLessThanOrEqual(6);
  });

  it('resuelve patrulla, interceptación, flanqueo y retirada', () => {
    const patrol = new VehicleAiBrain(
      'patrol',
      { enabled: true, behavior: 'patrol' },
      groundProfile,
    );
    expect(patrol.update(0.1, context({
      patrolPoints: [[0, 0, 0], [10, 0, 0]],
    }))?.goal).toEqual([10, 0, 0]);

    const target = {
      id: 'target',
      position: [10, 0, 10] as const,
      velocity: [2, 0, 0] as const,
    };
    const intercept = new VehicleAiBrain(
      'intercept',
      { enabled: true, behavior: 'intercept' },
      groundProfile,
    ).update(0.1, context({ threat: target }));
    expect(intercept?.goal?.[0]).toBeGreaterThan(10);

    const flank = new VehicleAiBrain(
      'flank',
      { enabled: true, behavior: 'flank' },
      groundProfile,
    ).update(0.1, context({ threat: target }));
    expect(flank?.goal).not.toEqual(target.position);

    const retreat = new VehicleAiBrain(
      'retreat',
      { enabled: true, behavior: 'retreat' },
      groundProfile,
    ).update(0.1, context({
      pose: { position: [0, 0, 0], heading: 0 },
      threat: { ...target, position: [0, 0, 5] },
    }));
    expect(retreat?.goal?.[2]).toBeLessThan(0);
  });

  it('coordina boarding, desembarco y reemplazo de conductor', () => {
    const transport = new VehicleAiBrain(
      'transport',
      { enabled: true, behavior: 'transport' },
      groundProfile,
    );
    expect(transport.update(0.1, context({
      passengersOnboard: false,
    }))?.crewAction).toBe('requestBoarding');
    transport.reset();
    expect(transport.update(0.1, context({
      passengersOnboard: true,
      pose: { position: [0, 0, 19], heading: 0 },
    }))?.crewAction).toBe('requestDisembark');
    transport.reset();
    expect(transport.update(0.1, context({
      driverAvailable: false,
      replacementDriverAvailable: true,
    }))?.crewAction).toBe('replaceDriver');
  });

  it('escala recovery y nunca solicita self-right visible o con el jugador', () => {
    const hidden = new VehicleAiBrain(
      'hidden',
      {
        enabled: true,
        behavior: 'patrol',
        allowRecoverySnap: true,
      },
      groundProfile,
    );
    const visible = new VehicleAiBrain(
      'visible',
      {
        enabled: true,
        behavior: 'patrol',
        allowRecoverySnap: true,
      },
      groundProfile,
    );
    const recoveryMarker = {
      id: 'recover',
      position: [0, 0, 0] as [number, number, number],
      kind: 'recovery' as const,
      allowRecoverySnap: true,
    };
    let hiddenDecision: VehicleBrainDecision | null = null;
    let visibleDecision: VehicleBrainDecision | null = null;
    for (let step = 0; step < 115; step += 1) {
      hiddenDecision = hidden.update(0.1, context({
        blocked: true,
        recoveryMarker,
      })) ?? hiddenDecision;
      visibleDecision = visible.update(0.1, context({
        blocked: true,
        recoveryMarker,
        visibleToPlayer: true,
        hasPlayerOccupant: true,
      })) ?? visibleDecision;
    }
    expect(hiddenDecision?.recovery).toBe('selfRight');
    expect(visibleDecision?.recovery).toBe('waitForSafeRecovery');
    expect(visibleDecision?.control.throttle).toBe(0);
  });
});
