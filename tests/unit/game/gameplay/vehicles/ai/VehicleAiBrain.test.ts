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

  it('alterna el lado del reverse entre intentos de desatasco', () => {
    const brain = new VehicleAiBrain(
      'stuck',
      { enabled: true, behavior: 'patrol' },
      groundProfile,
    );
    const steerings: number[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let steering: number | null = null;
      for (let step = 0; step < 40; step += 1) {
        const decision = brain.update(0.1, context({ blocked: true, speed: 0 }));
        if (decision?.recovery === 'reverse') steering = decision.control.steering;
      }
      expect(steering).not.toBeNull();
      steerings.push(steering as number);
      // Se desatasca: el próximo intento tiene que probar del otro lado.
      for (let step = 0; step < 5; step += 1) {
        brain.update(0.1, context({ blocked: false, speed: 4 }));
      }
    }
    expect(Math.sign(steerings[0])).toBe(-Math.sign(steerings[1]));
  });

  it('rompe contacto con el casco bajo y una amenaza presente', () => {
    const brain = new VehicleAiBrain(
      'coward',
      { enabled: true, behavior: 'patrol' },
      groundProfile,
      { fleeThreshold: 0.4 },
    );
    const threat = { id: 'player', position: [0, 0, 10] as [number, number, number] };
    const healthy = brain.update(0.1, context({ healthFraction: 1, threat }));
    expect(healthy?.state).toBe('driving');
    brain.reset();
    const wounded = brain.update(0.1, context({ healthFraction: 0.2, threat }));
    expect(wounded?.state).toBe('evading');
    // Se aleja de la amenaza, no hacia ella.
    expect(wounded?.goal?.[2]).toBeLessThan(0);
  });

  it('mantiene distancia de combate en vez de embestir al blanco', () => {
    const brain = new VehicleAiBrain(
      'gunner',
      { enabled: true, behavior: 'intercept' },
      groundProfile,
      { engagementRangeFactor: 0.5 },
    );
    const decision = brain.update(0.1, context({
      weaponRange: 60,
      pose: { position: [0, 0, 0], heading: 0 },
      threat: {
        id: 'player',
        position: [0, 0, 40],
        visible: true,
        memoryAge: 0,
      },
    }));
    expect(decision?.state).toBe('engaging');
    const goal = decision?.goal as [number, number, number];
    const distanceToThreat = Math.hypot(goal[0] - 0, goal[2] - 40);
    expect(distanceToThreat).toBeCloseTo(30, 0);
  });

  it('un desvío de combate caduca y devuelve al vehículo a su misión', () => {
    const brain = new VehicleAiBrain(
      'patroller',
      { enabled: true, behavior: 'patrol' },
      groundProfile,
      { allowMissionDeviation: true, deviationBudgetSeconds: 2 },
    );
    const engaging = context({
      weaponRange: 60,
      patrolPoints: [[0, 0, 0], [10, 0, 0]],
      threat: {
        id: 'player',
        position: [0, 0, 30],
        visible: true,
        memoryAge: 0,
      },
    });
    expect(brain.update(0.1, engaging)?.state).toBe('engaging');
    let state: string | undefined;
    for (let step = 0; step < 60; step += 1) {
      state = brain.update(0.1, engaging)?.state ?? state;
    }
    expect(state).toBe('driving');
  });

  it('sin permiso de desvío la misión no se abandona nunca', () => {
    const brain = new VehicleAiBrain(
      'loyal',
      { enabled: true, behavior: 'transport' },
      groundProfile,
      { allowMissionDeviation: false },
    );
    const decision = brain.update(0.1, context({
      weaponRange: 60,
      passengersOnboard: true,
      threat: {
        id: 'player',
        position: [0, 0, 15],
        visible: true,
        memoryAge: 0,
      },
    }));
    expect(decision?.state).toBe('driving');
    expect(decision?.goal).toEqual([0, 0, 20]);
  });

  it('toca bocina cuando alguien le corta el paso, con enfriamiento', () => {
    const brain = new VehicleAiBrain(
      'honker',
      { enabled: true, behavior: 'patrol' },
      groundProfile,
    );
    const blockedContext = context({
      blocked: true,
      blockedBy: 'player',
      speed: 0,
      patrolPoints: [[0, 0, 20]],
    });
    let horns = 0;
    for (let step = 0; step < 30; step += 1) {
      if (brain.update(0.1, blockedContext)?.signals.horn) horns += 1;
    }
    expect(horns).toBeGreaterThan(0);
    // 3 s de enfriamiento sobre 3 s de simulación: no puede sonar dos veces.
    expect(horns).toBeLessThanOrEqual(2);
  });

  describe('decisiones de tripulación', () => {
    const nearbyThreat = { id: 'player', position: [0, 0, 12] as const, visible: true };

    function intercepting(): VehicleAiBrain {
      return new VehicleAiBrain(
        'hunter',
        { enabled: true, behavior: 'intercept' },
        groundProfile,
      );
    }

    it('baja infantería cuando el blanco quedó donde el vehículo no llega', () => {
      const decision = intercepting().update(0.2, context({
        threat: nearbyThreat,
        threatReachableByVehicle: false,
        passengersOnboard: true,
      }));

      expect(decision?.crewAction).toBe('dismountToPursue');
      // Nadie salta en marcha: la decisión frena el vehículo primero.
      expect(decision?.state).toBe('stopped');
    });

    it('sigue conduciendo mientras el blanco sea alcanzable', () => {
      const decision = intercepting().update(0.2, context({
        threat: nearbyThreat,
        threatReachableByVehicle: true,
        passengersOnboard: true,
      }));

      expect(decision?.crewAction).toBe('none');
    });

    it('no baja a nadie por un blanco inalcanzable pero lejano', () => {
      const decision = intercepting().update(0.2, context({
        threat: { id: 'player', position: [0, 0, 300], visible: true },
        threatReachableByVehicle: false,
        passengersOnboard: true,
      }));

      expect(decision?.crewAction).toBe('none');
    });

    it('no baja a nadie si no queda infantería que bajar', () => {
      const decision = intercepting().update(0.2, context({
        threat: nearbyThreat,
        threatReachableByVehicle: false,
        passengersOnboard: false,
      }));

      expect(decision?.crewAction).toBe('none');
    });

    it('nunca baja a la tripulación del vehículo del jugador', () => {
      const decision = intercepting().update(0.2, context({
        threat: nearbyThreat,
        threatReachableByVehicle: false,
        passengersOnboard: true,
        hasPlayerOccupant: true,
      }));

      expect(decision?.crewAction).toBe('none');
    });

    it('abandona el vehículo que agotó todas las maniobras de desatasco', () => {
      const brain = intercepting();
      // Volcado: el contador de atasco se dispara hasta el escalón terminal.
      let decision: VehicleBrainDecision | null = null;
      for (let step = 0; step < 40; step += 1) {
        decision = brain.update(0.5, context({ overturned: true, blocked: true })) ?? decision;
      }

      expect(decision?.recovery).toBe('waitForSafeRecovery');
      expect(decision?.crewAction).toBe('abandonVehicle');
    });

    it('un casco bajo hace huir, no abandonar', () => {
      const brain = new VehicleAiBrain(
        'wounded',
        { enabled: true, behavior: 'intercept' },
        groundProfile,
        { fleeThreshold: 0.35 },
      );
      const decision = brain.update(0.2, context({
        healthFraction: 0.1,
        threat: nearbyThreat,
      }));

      expect(decision?.crewAction).toBe('none');
      expect(decision?.state).toBe('evading');
    });
  });
});
