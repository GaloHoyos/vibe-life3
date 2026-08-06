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
    for (let step = 0; step < 130; step += 1) {
      hiddenDecision = hidden.update(0.1, context({
        blocked: true,
        recoveryMarker,
        distanceToPlayer: 50,
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
    let positionZ = 0;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let steering: number | null = null;
      for (let step = 0; step < 40; step += 1) {
        const decision = brain.update(0.1, context({
          blocked: true,
          speed: 0,
          pose: { position: [0, 0, positionZ], heading: 0 },
        }));
        if (decision?.recovery === 'reverse') steering = decision.control.steering;
      }
      expect(steering).not.toBeNull();
      steerings.push(steering as number);
      // El éxito exige cinco metros reales, no ruedas girando en el lugar.
      for (let step = 0; step < 15; step += 1) {
        positionZ += 0.45;
        brain.update(0.1, context({
          blocked: false,
          speed: 4,
          pose: { position: [0, 0, positionZ], heading: 0 },
        }));
      }
    }
    expect(Math.sign(steerings[0])).toBe(-Math.sign(steerings[1]));
  });

  it('no intenta reversa contra una pared detectada detrás', () => {
    const brain = new VehicleAiBrain(
      'boxed-rear',
      { enabled: true, behavior: 'patrol' },
      groundProfile,
    );
    const recoveries: string[] = [];
    for (let step = 0; step < 45; step += 1) {
      const decision = brain.update(0.1, context({
        blocked: true,
        recoveryClearance: { front: 4, rear: 0.3, left: 2, right: 4 },
      }));
      if (decision) recoveries.push(decision.recovery);
    }
    expect(recoveries).not.toContain('reverse');
    expect(recoveries).toContain('forwardCounter');
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

  it('ya adentro de la distancia de combate orbita en vez de retroceder', () => {
    const brain = new VehicleAiBrain(
      'brawler',
      { enabled: true, behavior: 'intercept' },
      groundProfile,
      { engagementRangeFactor: 0.5 },
    );
    const decision = brain.update(0.1, context({
      weaponRange: 120,
      pose: { position: [0, 0, 0], heading: 0 },
      threat: {
        id: 'player',
        position: [0, 0, 9],
        visible: true,
        memoryAge: 0,
      },
    }));
    expect(decision?.state).toBe('engaging');
    const goal = decision?.goal as [number, number, number];
    const distanceToThreat = Math.hypot(goal[0], goal[2] - 9);
    // Se queda a los 9 m que ya tenía, no se va a los 60 del rango preferido.
    expect(distanceToThreat).toBeCloseTo(9, 0);
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

  it('el ataque en pasada apunta más allá del blanco en vez de frenar encima', () => {
    const brain = new VehicleAiBrain(
      'runner',
      { enabled: true, behavior: 'intercept' },
      groundProfile,
    );
    const decision = brain.update(0.2, context({
      tactic: 'attackRun',
      weaponRange: 60,
      threat: { id: 'player', position: [0, 0, 30], visible: true, mobility: 'foot' },
      threatReachableByVehicle: true,
    }));

    expect(decision?.state).toBe('engaging');
    expect(decision?.goal?.[2]).toBeCloseTo(44);
  });

  it('la reposición orbita hasta una pose de tiro en vez de quedarse en la mala', () => {
    const brain = new VehicleAiBrain(
      'flanker',
      { enabled: true, behavior: 'intercept' },
      groundProfile,
    );
    const decision = brain.update(0.2, context({
      tactic: 'reposition',
      weaponRange: 60,
      threat: { id: 'player', position: [0, 0, 30], visible: true, mobility: 'foot' },
      threatReachableByVehicle: true,
    }));

    expect(decision?.state).toBe('engaging');
    expect(Math.abs(decision?.goal?.[0] ?? 0)).toBeCloseTo(27);
    expect(decision?.goal?.[2]).toBeCloseTo(30);
  });

  it('la reposición sigue valiendo con el blanco perdido de vista', () => {
    const brain = new VehicleAiBrain(
      'flanker',
      { enabled: true, behavior: 'intercept' },
      groundProfile,
    );
    const decision = brain.update(0.2, context({
      tactic: 'reposition',
      weaponRange: 60,
      tacticalAnchor: [6, 0, 9],
      threat: {
        id: 'player',
        position: [0, 0, 40],
        visible: false,
        memoryAge: 2,
        mobility: 'foot',
      },
      threatReachableByVehicle: true,
    }));

    expect(decision?.state).toBe('pursuing');
    expect(decision?.goal).toEqual([6, 0, 9]);
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

    it('un conductor solo también se baja: el vehículo ya no sirve', () => {
      const decision = intercepting().update(0.2, context({
        threat: nearbyThreat,
        threatReachableByVehicle: false,
        passengersOnboard: false,
      }));

      expect(decision?.crewAction).toBe('dismountToPursue');
    });

    it('baja infantería cuando deja de acercarse al blanco que perdió', () => {
      const brain = intercepting();
      const stalled = context({
        threat: { id: 'player', position: [0, 0, 12], visible: false, memoryAge: 2 },
        threatReachableByVehicle: true,
        passengersOnboard: true,
      });
      const actions: string[] = [];
      for (let step = 0; step < 40; step += 1) {
        const decision = brain.update(0.2, stalled);
        if (decision) actions.push(decision.crewAction);
      }

      expect(actions).toContain('dismountToPursue');
    });

    it('despliega contra un blanco a pie visible cuando alcanza una pose cercana', () => {
      const brain = intercepting();
      const holdingRange = context({
        weaponRange: 60,
        threat: {
          id: 'player',
          position: [0, 0, 12],
          visible: true,
          memoryAge: 0,
          mobility: 'foot',
        },
        threatReachableByVehicle: true,
        passengersOnboard: true,
      });
      const actions: string[] = [];
      for (let step = 0; step < 40; step += 1) {
        const decision = brain.update(0.2, holdingRange);
        if (decision) actions.push(decision.crewAction);
      }

      expect(actions).toContain('dismountToPursue');
      expect(actions.filter((action) => action === 'dismountToPursue')).toHaveLength(1);
    });

    it('una táctica deploy no recrea la orden de desembarco por tick', () => {
      const brain = intercepting();
      const deploying = context({
        tactic: 'deploy',
        safeToDismount: true,
        threat: {
          ...nearbyThreat,
          mobility: 'foot',
        },
        threatReachableByVehicle: true,
        passengersOnboard: true,
      });
      const actions: string[] = [];

      for (let step = 0; step < 20; step += 1) {
        const decision = brain.update(0.2, deploying);
        if (decision) actions.push(decision.crewAction);
      }

      expect(actions.filter((action) => action === 'dismountToPursue')).toHaveLength(1);
    });

    it('mantiene la persecución si el blanco visible va en otro vehículo', () => {
      const brain = intercepting();
      const actions: string[] = [];
      for (let step = 0; step < 40; step += 1) {
        const decision = brain.update(0.2, context({
          weaponRange: 60,
          threat: {
            id: 'player',
            position: [0, 0, 12],
            visible: true,
            memoryAge: 0,
            mobility: 'vehicle',
          },
          threatReachableByVehicle: true,
          passengersOnboard: true,
        }));
        if (decision) actions.push(decision.crewAction);
      }

      expect(actions).not.toContain('dismountToPursue');
    });

    it('no baja a nadie por un blanco perdido que todavía está lejos', () => {
      const brain = intercepting();
      const distant = context({
        threat: { id: 'player', position: [0, 0, 300], visible: false, memoryAge: 2 },
        threatReachableByVehicle: true,
        passengersOnboard: true,
      });
      const actions: string[] = [];
      for (let step = 0; step < 40; step += 1) {
        const decision = brain.update(0.2, distant);
        if (decision) actions.push(decision.crewAction);
      }

      expect(actions).not.toContain('dismountToPursue');
    });

    it('no vacía el vehículo: pide la bajada una sola vez por contacto', () => {
      const brain = intercepting();
      const arrived = context({
        threat: nearbyThreat,
        threatReachableByVehicle: false,
        passengersOnboard: true,
      });
      const actions: string[] = [];
      for (let step = 0; step < 20; step += 1) {
        const decision = brain.update(0.2, arrived);
        if (decision) actions.push(decision.crewAction);
      }

      expect(actions.filter((action) => action === 'dismountToPursue')).toHaveLength(1);
    });

    it('un contacto nuevo devuelve el derecho a bajar tropa', () => {
      const brain = intercepting();
      const unreachable = context({
        threat: nearbyThreat,
        threatReachableByVehicle: false,
        passengersOnboard: true,
      });
      expect(brain.update(0.2, unreachable)?.crewAction).toBe('dismountToPursue');
      expect(brain.update(0.2, unreachable)?.crewAction).toBe('none');
      const newContact = context({
        threat: { ...nearbyThreat, id: 'rebel-2' },
        threatReachableByVehicle: false,
        passengersOnboard: true,
      });

      expect(brain.update(0.2, newContact)?.crewAction).toBe('dismountToPursue');
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
