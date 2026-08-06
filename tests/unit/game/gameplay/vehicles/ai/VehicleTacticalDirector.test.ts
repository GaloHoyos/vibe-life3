import { describe, expect, it } from 'vitest';
import {
  VEHICLE_TACTICAL_DOCTRINES,
  vehicleTacticalDoctrine,
} from '@game/config/vehicleTactics.config';
import { VEHICLE_TACTIC_CATALOG } from '@game/gameplay/vehicles/ai/VehicleTacticCatalog';
import {
  scopeForSituation,
  VehicleTacticalDirector,
} from '@game/gameplay/vehicles/ai/VehicleTacticalDirector';
import {
  VEHICLE_TACTIC_IDS,
  type VehicleCapabilitySet,
  type VehicleObjective,
  type VehicleTacticalSituation,
} from '@game/gameplay/vehicles/ai/VehicleTacticalTypes';

describe('VehicleTacticalDirector', () => {
  it('expone el catálogo táctico completo y estable', () => {
    expect(VEHICLE_TACTIC_CATALOG.map((entry) => entry.id)).toEqual(
      VEHICLE_TACTIC_IDS,
    );
  });

  it('despliega Combine contra infantería y hace cutoff contra vehículos', () => {
    const againstFoot = situation({ threat: footThreat() });
    const footDirector = new VehicleTacticalDirector(VEHICLE_TACTICAL_DOCTRINES.combine);
    expect(footDirector.decide(againstFoot)?.tactic).toBe('deploy');

    const againstVehicle = situation({ threat: vehicleThreat() });
    const vehicleDirector = new VehicleTacticalDirector(VEHICLE_TACTICAL_DOCTRINES.combine);
    expect(vehicleDirector.decide(againstVehicle)?.tactic).toBe('intercept');
  });

  it('ataca en pasada cuando la torreta llegó al tope y no puede quedarse quieto', () => {
    const director = new VehicleTacticalDirector(VEHICLE_TACTICAL_DOCTRINES.combine);
    const decision = director.decide(situation({
      objective: { ...objective(), kind: 'move' },
      threat: footThreat(),
      capabilities: capabilities({
        deployableActorIds: [],
        weapon: {
          operational: true,
          operatorAvailable: true,
          traverseAvailable: false,
          range: 120,
        },
      }),
    }));

    expect(decision?.tactic).toBe('attackRun');
    expect(decision?.candidates.map((candidate) => candidate.tactic))
      .not.toContain('suppress');
  });

  it('se repone a otra pose de tiro cuando pierde la línea con el blanco', () => {
    const director = new VehicleTacticalDirector(VEHICLE_TACTICAL_DOCTRINES.combine);
    const decision = director.decide(situation({
      objective: { ...objective(), kind: 'move', source: 'autonomous' },
      threat: {
        ...footThreat(),
        visible: false,
        lineOfSight: false,
        memoryAgeSeconds: 2,
      },
      capabilities: capabilities({ deployableActorIds: [] }),
    }));

    expect(decision?.tactic).toBe('reposition');
    expect(decision?.candidates.map((candidate) => candidate.tactic))
      .not.toContain('attackRun');
  });

  it('prioriza recovery real y reemplaza un conductor ausente', () => {
    const recovery = new VehicleTacticalDirector(VEHICLE_TACTICAL_DOCTRINES.combine);
    expect(recovery.decide(situation({ noProgressSeconds: 4 }))?.tactic).toBe('recover');

    const replacement = new VehicleTacticalDirector(VEHICLE_TACTICAL_DOCTRINES.combine);
    expect(replacement.decide(situation({
      capabilities: capabilities({
        driverAvailable: false,
        replacementDriverIds: ['gunner-1'],
      }),
    }))?.tactic).toBe('replaceDriver');
  });

  it('sostiene la táctica dos segundos y exige diez puntos para cambiar', () => {
    const director = new VehicleTacticalDirector(VEHICLE_TACTICAL_DOCTRINES.combine);
    const initial = director.decide(situation({ nowSeconds: 0, threat: footThreat() }));
    expect(initial?.tactic).toBe('deploy');

    const stillCommitted = director.decide(situation({
      nowSeconds: 1,
      threat: footThreat(),
      noProgressSeconds: 4,
    }));
    expect(stillCommitted?.candidates[0].tactic).toBe('recover');
    expect(stillCommitted?.tactic).toBe('deploy');

    const smallAdvantage = director.decide(situation({
      nowSeconds: 2.1,
      threat: footThreat(),
      noProgressSeconds: 2,
    }));
    expect(smallAdvantage?.candidates[0].tactic).toBe('recover');
    expect(smallAdvantage?.tactic).toBe('deploy');

    const committed = director.decide(situation({
      nowSeconds: 2.2,
      threat: footThreat(),
      noProgressSeconds: 4,
    }));
    expect(committed?.tactic).toBe('recover');
    expect(committed?.committedUntilSeconds).toBeCloseTo(4.2);
  });

  it('mantiene el anchor durante tres segundos aunque el blanco se mueva', () => {
    const director = new VehicleTacticalDirector(VEHICLE_TACTICAL_DOCTRINES.combine);
    const first = director.decide(situation({
      nowSeconds: 0,
      threat: footThreat(),
      preferredAnchor: { key: 'threat', position: [0, 0, 10] },
    }));
    const held = director.decide(situation({
      nowSeconds: 1,
      threat: footThreat(),
      preferredAnchor: { key: 'threat', position: [20, 0, 10] },
    }));
    const refreshed = director.decide(situation({
      nowSeconds: 3.1,
      threat: footThreat(),
      preferredAnchor: { key: 'threat', position: [20, 0, 10] },
    }));

    expect(first?.anchor?.position).toEqual([0, 0, 10]);
    expect(held?.anchor?.position).toEqual([0, 0, 10]);
    expect(refreshed?.anchor?.position).toEqual([20, 0, 10]);
  });

  it('penaliza una herramienta repetida y prueba otra disponible', () => {
    const director = new VehicleTacticalDirector(VEHICLE_TACTICAL_DOCTRINES.combine);
    const initial = situation({ nowSeconds: 0, threat: vehicleThreat() });
    expect(director.decide(initial)?.tactic).toBe('intercept');

    director.reportFailure(initial, 'intercept', 'blocked');
    director.reportFailure(
      situation({ nowSeconds: 0.1, threat: vehicleThreat() }),
      'intercept',
      'blocked',
    );
    const alternative = director.decide(
      situation({ nowSeconds: 0.2, threat: vehicleThreat() }),
    );

    expect(alternative?.tactic).toBe('suppress');
    expect(
      alternative?.candidates.find((entry) => entry.tactic === 'intercept'),
    ).toMatchObject({ coolingDown: true, failurePenalty: 84 });
  });

  it('limpia la memoria al progresar y separa una revisión nueva', () => {
    const director = new VehicleTacticalDirector(VEHICLE_TACTICAL_DOCTRINES.combine);
    const stalled = situation({ nowSeconds: 0, noProgressSeconds: 4 });
    director.decide(stalled);
    director.reportFailure(stalled, 'recover', 'noProgress');
    director.reportFailure(
      situation({ nowSeconds: 1, noProgressSeconds: 4 }),
      'recover',
      'noProgress',
    );

    expect(director.reportProgress(
      situation({ nowSeconds: 2, noProgressSeconds: 0 }),
      5,
    )).toBe(true);
    expect(director.memory.assess(
      scopeForSituation(stalled),
      'recover',
      2,
    ).failures).toBe(0);

    const revised = situation({
      nowSeconds: 3,
      objective: { ...objective(), revision: 2 },
      noProgressSeconds: 4,
    });
    expect(director.decide(revised)?.tactic).toBe('recover');
  });
});

describe('vehicleTacticalDoctrine', () => {
  it('elige defaults por facción y da prioridad al oficio de transporte', () => {
    expect(vehicleTacticalDoctrine('combine', false).id).toBe('combine');
    expect(vehicleTacticalDoctrine('resistance', false).id).toBe('resistance');
    expect(vehicleTacticalDoctrine('neutral', false).id).toBe('resistance');
    expect(vehicleTacticalDoctrine('combine', true)).toBe(
      VEHICLE_TACTICAL_DOCTRINES.transport,
    );
    expect(VEHICLE_TACTICAL_DOCTRINES.transport.preserveCargo).toBe(true);
    expect(VEHICLE_TACTICAL_DOCTRINES.combine.ramEnemyVehicles).toBe(true);
    expect(VEHICLE_TACTICAL_DOCTRINES.resistance.ramEnemyVehicles).toBe(false);
  });

  it('hace que un transporte con carga sostenga la misión antes que desplegar', () => {
    const director = new VehicleTacticalDirector(VEHICLE_TACTICAL_DOCTRINES.transport);
    const decision = director.decide(situation({
      threat: footThreat(),
      capabilities: capabilities({
        isTransport: true,
        cargoActorIds: ['passenger-1', 'passenger-2'],
      }),
    }));

    expect(decision?.tactic).toBe('follow');
    expect(decision?.candidates.find((candidate) => candidate.tactic === 'deploy'))
      .toMatchObject({ situationUtility: -63 });
  });
});

function capabilities(
  overrides: Partial<VehicleCapabilitySet> = {},
): VehicleCapabilitySet {
  return {
    canDrive: true,
    canReverse: true,
    canRecover: true,
    driverAvailable: true,
    replacementDriverIds: [],
    deployableActorIds: ['driver-1'],
    canContinueOnFoot: true,
    canAbandon: true,
    weapon: {
      operational: true,
      operatorAvailable: true,
      traverseAvailable: true,
      range: 120,
    },
    alternativeVehicleIds: [],
    extractionAvailable: false,
    isTransport: false,
    cargoActorIds: [],
    ...overrides,
  };
}

function objective(): VehicleObjective {
  return {
    id: 'hunt',
    revision: 1,
    source: 'overwatch',
    kind: 'intercept',
    target: { type: 'entity', entityId: 'player' },
    status: 'active',
    issuedAtSeconds: 0,
    updatedAtSeconds: 0,
  };
}

function situation(
  overrides: Partial<VehicleTacticalSituation> = {},
): VehicleTacticalSituation {
  return {
    nowSeconds: 0,
    objective: objective(),
    capabilities: capabilities(),
    objectiveDistance: 80,
    objectiveReachable: true,
    routeAvailable: true,
    blockedSeconds: 0,
    noProgressSeconds: 0,
    healthFraction: 1,
    overturned: false,
    visibleToPlayer: true,
    underFire: false,
    safeToDismount: true,
    deploymentPositionAvailable: true,
    extractionRequested: false,
    threat: null,
    memoryContext: 'street-a',
    ...overrides,
  };
}

function footThreat(): NonNullable<VehicleTacticalSituation['threat']> {
  return {
    id: 'player',
    mobility: 'foot',
    visible: true,
    memoryAgeSeconds: 0,
    distance: 28,
    reachableByVehicle: true,
    lineOfSight: true,
    withinWeaponRange: true,
    position: [25, 0, 10],
  };
}

function vehicleThreat(): NonNullable<VehicleTacticalSituation['threat']> {
  return {
    ...footThreat(),
    mobility: 'vehicle',
    distance: 55,
  };
}
