import { Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { VEHICLE_CREW_DECISION } from '@game/config/vehicleAi.config';
import { compareTravelOptions } from '@game/gameplay/vehicles/ai/VehicleCrewUtility';
import {
  VehicleCrewDirector,
  type VehicleCrewGrantSource,
} from '@game/gameplay/vehicles/ai/VehicleCrewDirector';
import {
  VehicleOpportunityRegistry,
  type VehicleOpportunityActor,
  type VehicleSeatOffer,
} from '@game/gameplay/vehicles/ai/VehicleOpportunityRegistry';

describe('compareTravelOptions', () => {
  it('descarta el vehículo cuando el objetivo está a mano', () => {
    const comparison = compareTravelOptions({
      footDistance: 30,
      footSpeed: 5,
      approachDistance: 25,
      driveDistance: 30,
      driveSpeed: 16,
    });

    // 6 s a pie contra 5 + 2,5 + 1,9: caminar hasta el buggy ya perdió.
    expect(comparison.footSeconds).toBeCloseTo(6);
    expect(comparison.worthIt).toBe(false);
  });

  it('elige el vehículo cuando el objetivo está lejos y el vehículo cerca', () => {
    const comparison = compareTravelOptions({
      footDistance: 220,
      footSpeed: 5,
      approachDistance: 12,
      driveDistance: 240,
      driveSpeed: 16,
    });

    expect(comparison.footSeconds).toBeCloseTo(44);
    expect(comparison.vehicleSeconds).toBeLessThan(comparison.footSeconds);
    expect(comparison.worthIt).toBe(true);
  });

  it('exige el margen: ganar por poco no justifica el desvío', () => {
    const option = {
      footDistance: 100,
      footSpeed: 5,
      approachDistance: 10,
      driveDistance: 190,
      driveSpeed: 16,
    };

    expect(compareTravelOptions(option).vehicleSeconds).toBeLessThan(
      compareTravelOptions(option).footSeconds,
    );
    expect(compareTravelOptions(option).worthIt).toBe(false);
    expect(compareTravelOptions(option, 1).worthIt).toBe(true);
  });

  it('cuenta el rodeo real, no la línea recta', () => {
    const direct = compareTravelOptions({
      footDistance: 120,
      footSpeed: 5,
      approachDistance: 10,
      driveDistance: 130,
      driveSpeed: 16,
    });
    // Misma distancia a pie, pero la carretera da toda la vuelta al valle.
    const detour = compareTravelOptions({
      footDistance: 120,
      footSpeed: 5,
      approachDistance: 10,
      driveDistance: 400,
      driveSpeed: 16,
    });

    expect(direct.worthIt).toBe(true);
    expect(detour.worthIt).toBe(false);
  });
});

describe('VehicleOpportunityRegistry', () => {
  const combineSoldier: VehicleOpportunityActor = {
    id: 'combine-1',
    faction: 'combine',
    vehicleCapability: { canDrive: true },
  };

  it('sólo ofrece lo que la facción puede usar', () => {
    const registry = new VehicleOpportunityRegistry();
    registry.publish([
      offer({ vehicleId: 'combine-glider', access: { accessPolicy: 'combine' } }),
      offer({ vehicleId: 'rebel-buggy', access: { accessPolicy: 'resistance' } }),
    ]);

    expect(
      registry.offersFor(combineSoldier, new Vector3(), 50).map((entry) => entry.vehicleId),
    ).toEqual(['combine-glider']);
  });

  it('niega los mandos a quien no sabe conducir pero le deja el resto', () => {
    const registry = new VehicleOpportunityRegistry();
    registry.publish([
      offer({ vehicleId: 'glider', seatId: 'driver', role: 'driver', access: { accessPolicy: 'combine' } }),
      offer({ vehicleId: 'glider', seatId: 'gunner', role: 'gunner', access: { accessPolicy: 'combine' } }),
    ]);
    const passenger: VehicleOpportunityActor = {
      ...combineSoldier,
      vehicleCapability: { canDrive: false },
    };

    expect(registry.offersFor(passenger, new Vector3(), 50).map((entry) => entry.seatId))
      .toEqual(['gunner']);
  });

  it('ignora los vehículos que el nivel reservó para un setpiece', () => {
    const registry = new VehicleOpportunityRegistry();
    registry.publish([
      offer({ vehicleId: 'scripted', authored: true, access: { accessPolicy: 'combine' } }),
    ]);

    expect(registry.offersFor(combineSoldier, new Vector3(), 50)).toEqual([]);
  });

  it('pone los mandos primero: un vehículo sin conductor no le sirve a nadie', () => {
    const registry = new VehicleOpportunityRegistry();
    registry.publish([
      offer({
        vehicleId: 'near',
        seatId: 'gunner',
        role: 'gunner',
        position: new Vector3(4, 0, 0),
        access: { accessPolicy: 'combine' },
      }),
      offer({
        vehicleId: 'far',
        seatId: 'driver',
        role: 'driver',
        position: new Vector3(20, 0, 0),
        access: { accessPolicy: 'combine' },
      }),
    ]);

    expect(registry.offersFor(combineSoldier, new Vector3(), 50).map((entry) => entry.seatId))
      .toEqual(['driver', 'gunner']);
  });

  it('recorta por radio', () => {
    const registry = new VehicleOpportunityRegistry();
    registry.publish([
      offer({ vehicleId: 'lejos', position: new Vector3(80, 0, 0), access: { accessPolicy: 'combine' } }),
    ]);

    expect(registry.offersFor(combineSoldier, new Vector3(), 45)).toEqual([]);
  });
});

describe('VehicleCrewDirector', () => {
  const soldier = (id: string): VehicleOpportunityActor => ({
    id,
    faction: 'combine',
    vehicleCapability: { canDrive: true },
  });

  function directorWith(grantSeat = vi.fn(() => true)): {
    director: VehicleCrewDirector;
    grants: VehicleCrewGrantSource;
    grantSeat: typeof grantSeat;
  } {
    const grants: VehicleCrewGrantSource = { grantSeat, cancelSeat: vi.fn() };
    return { director: new VehicleCrewDirector(grants), grants, grantSeat };
  }

  it('deja subir a toda la escuadra al mismo vehículo', () => {
    const { director } = directorWith();

    expect(director.requestSeat(soldier('a'), offer({ vehicleId: 'buggy', seatId: 'driver' }))).toBe(true);
    expect(director.requestSeat(soldier('b'), offer({ vehicleId: 'buggy', seatId: 'gunner' }))).toBe(true);
    expect(director.requestSeat(soldier('c'), offer({ vehicleId: 'buggy', seatId: 'rear' }))).toBe(true);
    expect(director.activeVehicles('combine').size).toBe(1);
  });

  it('topea los vehículos simultáneos por facción', () => {
    const { director } = directorWith();
    for (let index = 0; index < VEHICLE_CREW_DECISION.maxActivePerFaction; index += 1) {
      expect(director.requestSeat(soldier(`a${index}`), offer({ vehicleId: `v${index}` }))).toBe(true);
    }

    expect(director.requestSeat(soldier('extra'), offer({ vehicleId: 'uno-mas' }))).toBe(false);
    expect(director.activeVehicles('combine').size).toBe(
      VEHICLE_CREW_DECISION.maxActivePerFaction,
    );
  });

  it('libera el cupo al soltar la reserva', () => {
    const { director, grants } = directorWith();
    for (let index = 0; index < VEHICLE_CREW_DECISION.maxActivePerFaction; index += 1) {
      director.requestSeat(soldier(`a${index}`), offer({ vehicleId: `v${index}` }));
    }
    director.releaseSeat('a0');

    expect(grants.cancelSeat).toHaveBeenCalledWith('a0');
    expect(director.requestSeat(soldier('nuevo'), offer({ vehicleId: 'otro' }))).toBe(true);
  });

  it('veda la facción un rato después de perder un vehículo', () => {
    const { director } = directorWith();
    director.update(10);
    director.notifyVehicleLost('combine');

    expect(director.requestSeat(soldier('a'), offer({ vehicleId: 'buggy' }))).toBe(false);
    // La otra facción no paga la veda ajena.
    expect(director.requestSeat(
      { id: 'rebel', faction: 'resistance', vehicleCapability: { canDrive: true } },
      offer({ vehicleId: 'crawler' }),
    )).toBe(true);

    director.update(10 + VEHICLE_CREW_DECISION.lossCooldownSeconds + 1);
    expect(director.requestSeat(soldier('a'), offer({ vehicleId: 'buggy' }))).toBe(true);
  });

  it('funde en un pedido a toda la escuadra que pide recogida', () => {
    const { director } = directorWith();
    director.update(5);
    director.requestExtraction(soldier('a'), new Vector3(10, 0, 10));
    director.requestExtraction(soldier('b'), new Vector3(12, 0, 11));

    const request = director.extraction('combine');
    expect(request?.actors.size).toBe(2);
    // La zona la fija el primero: un aparato baja una vez, no una por soldado.
    expect(request?.position.x).toBe(10);
    expect(request?.vehicleId).toBeNull();
    expect(request?.requestedAt).toBe(5);
  });

  it('asigna el aparato una sola vez', () => {
    const { director } = directorWith();
    director.requestExtraction(soldier('a'), new Vector3());

    expect(director.assignExtraction('combine', 'heli-1')).toBe(true);
    expect(director.assignExtraction('combine', 'heli-2')).toBe(false);
    expect(director.extraction('combine')?.vehicleId).toBe('heli-1');
  });

  it('restaura la antigüedad relativa de una extracción sin transporte', () => {
    const { director } = directorWith();
    director.update(30);

    director.restoreExtraction(
      'combine',
      new Vector3(4, 2, -6),
      ['a', 'b'],
      12,
    );

    const request = director.extraction('combine');
    expect(request?.requestedAt).toBe(18);
    expect(request?.position.toArray()).toEqual([4, 2, -6]);
    expect([...request?.actors ?? []]).toEqual(['a', 'b']);
    expect(request?.vehicleId).toBeNull();
  });

  it('mantiene separados los pedidos de cada facción', () => {
    const { director } = directorWith();
    director.requestExtraction(soldier('a'), new Vector3());
    director.requestExtraction(
      { id: 'rebel', faction: 'resistance', vehicleCapability: { canDrive: true } },
      new Vector3(50, 0, 50),
    );

    expect(director.pendingExtractions()).toHaveLength(2);
    director.clearExtraction('combine');
    expect(director.pendingExtractions().map((entry) => entry.faction)).toEqual([
      'resistance',
    ]);
  });

  it('no registra el claim si la concesión falla', () => {
    const { director } = directorWith(vi.fn(() => false));

    expect(director.requestSeat(soldier('a'), offer({ vehicleId: 'buggy' }))).toBe(false);
    expect(director.claimedVehicle('a')).toBeNull();
    expect(director.activeVehicles('combine').size).toBe(0);
  });
});

function offer(overrides: Partial<VehicleSeatOffer> = {}): VehicleSeatOffer {
  return {
    vehicleId: 'buggy',
    profileId: 'buggy',
    seatId: 'driver',
    role: 'driver',
    position: new Vector3(),
    boarding: new Vector3(),
    cruiseSpeed: 16,
    hasDriver: false,
    access: {},
    authored: false,
    ...overrides,
  };
}
