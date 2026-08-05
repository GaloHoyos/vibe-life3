import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { RaycastHit, RaycastSource } from '@engine/physics/Raycast';
import type { PhysicsMetadata } from '@engine/physics/PhysicsWorld';
import { VehiclePresets } from '@game/config/vehicles.config';
import { AirVehicleAiSystem } from '@game/gameplay/vehicles/ai/AirVehicleAiSystem';
import type { AirBrainContext } from '@game/gameplay/vehicles/ai/AirVehicleAiTypes';
import {
  AirVehicleNavigation,
  airNavProfileFromPreset,
} from '@game/gameplay/vehicles/ai/AirVehicleNavigation';

interface TestSurface {
  y: number;
  normalY?: number;
  dynamic?: boolean;
  surface?: PhysicsMetadata['surface'];
}

describe('AirVehicleNavigation landing probes', () => {
  it('acepta suelo y techos estáticos amplios', () => {
    const navigation = navigationWith((x, z) => ({
      y: Math.abs(x) < 12 && Math.abs(z) < 12 ? 10 : 0,
      surface: 'concrete',
    }));

    const roof = navigation.probeLandingSite(0, 0, 60);

    expect(roof?.position).toEqual([0, 10, 0]);
    expect(roof?.slopeDegrees).toBeCloseTo(0);
    expect(roof).toMatchObject({
      surfaceId: 'world',
      surfaceType: 'concrete',
    });
  });

  it('rechaza pendiente, plataforma dinámica y techo demasiado chico', () => {
    const slope = navigationWith(() => ({ y: 0, normalY: 0.94 }));
    const dynamic = navigationWith(() => ({ y: 3, dynamic: true }));
    const smallRoof = navigationWith((x, z) => ({
      y: Math.hypot(x, z) < 2 ? 10 : 0,
    }));

    expect(slope.probeLandingSite(0, 0, 60)).toBeNull();
    expect(dynamic.probeLandingSite(0, 0, 60)).toBeNull();
    expect(smallRoof.probeLandingSite(0, 0, 60)).toBeNull();
  });

  it('un techo bajo tapa la columna de descenso del suelo que cubre', () => {
    const shed = navigationWith((x, z) => ({
      y: Math.abs(x) < 20 && Math.abs(z) < 20 ? 5 : 0,
    }));

    // El suelo bajo el galpón es plano, pero no se llega en vertical.
    expect(shed.descentClear([0, 0, 0], 60)).toBe(false);
    expect(shed.descentClear([0, 5, 0], 60)).toBe(true);
  });
});

describe('AirVehicleAiSystem systemic landing', () => {
  it('resuelve una orden world-space y limita el radio a 35 m', () => {
    const system = systemWith((x, z) =>
      Math.hypot(x, z) < 1
        ? { y: 0, normalY: 0.9 }
        : { y: 0 },
    );
    register(system, 'heli');

    const order = system.orderLanding('heli', [0, 0, 0], {
      searchRadius: 500,
      orderId: 'overwatch-land',
    });
    system.update('heli', context(), 20);

    const report = system.getReport('heli');
    expect(order?.options.searchRadius).toBe(35);
    expect(report?.landingStatus).toBe('selected');
    expect(report?.landingDeviation).toBeGreaterThan(0);
    expect(report?.landingDeviation).toBeLessThanOrEqual(35);
    expect(system.drainLandingEvents()).toContainEqual(
      expect.objectContaining({
        type: 'selected',
        orderId: 'overwatch-land',
      }),
    );
  });

  it('usa landingZone como preferencia sin saltear su validación', () => {
    const system = systemWith(() => ({ y: 0 }));
    system.setLandingZones([
      { id: 'pad', kind: 'landingZone', position: [0, 0, 8] },
    ]);
    register(system, 'heli');
    system.orderLanding('heli', [0, 0, 0]);

    system.update('heli', context(), 20);

    expect(system.getReport('heli')?.landingSpot).toMatchObject({
      position: [0, 0, 8],
      source: 'authored',
      markerId: 'pad',
    });
  });

  it('una orden nueva durante el descenso ejecuta go-around', () => {
    const system = systemWith(() => ({ y: 0 }));
    register(system, 'heli');
    system.orderLanding('heli', [0, 0, 0]);

    const descending = system.update('heli', context(), 20);
    expect(descending?.state).toBe('landing');

    system.orderLanding('heli', [28, 0, 0]);
    const aborting = system.update('heli', context(), 20);
    expect(aborting?.state).toBe('goAround');
    expect(aborting?.intent.descend).toBe(false);

    const redirected = system.update('heli', context(), 20);
    expect(redirected?.state).toBe('approach');
    expect(redirected?.intent.target?.[0]).toBeCloseTo(28);
  });

  it('revalida el sitio durante la bajada y aborta si aparece un cuerpo', () => {
    let blocked = false;
    const system = systemWith((x, z) =>
      blocked && Math.hypot(x, z) < 1
        ? { y: 4, dynamic: true }
        : { y: 0 },
    );
    register(system, 'heli');
    system.orderLanding('heli', [0, 0, 0]);
    expect(system.update('heli', context(), 20)?.state).toBe('landing');

    blocked = true;
    system.advance('heli', 0.5);
    const decision = system.update('heli', context(), 20);

    expect(decision?.state).toBe('goAround');
    expect(system.getReport('heli')?.landingFailure).toBe('siteBlocked');
  });

  it('reporta fallo cuando no existe ningún sitio seguro', () => {
    const system = systemWith(() => ({ y: 0, normalY: 0.8 }));
    register(system, 'heli');
    system.orderLanding('heli', [0, 0, 0], { orderId: 'impossible' });

    for (let index = 0; index < 12; index += 1) {
      system.update('heli', context(), 20);
    }

    expect(system.getReport('heli')?.landingStatus).toBe('failed');
    expect(system.getReport('heli')?.landingFailure).toBe('noSafeSite');
    expect(system.drainLandingEvents()).toContainEqual(
      expect.objectContaining({
        type: 'failed',
        orderId: 'impossible',
        reason: 'noSafeSite',
      }),
    );
  });

  it('reserva claros distintos para dos helicópteros', () => {
    const system = systemWith(() => ({ y: 0 }));
    register(system, 'alpha');
    register(system, 'bravo');
    system.orderLanding('alpha', [0, 0, 0]);
    system.orderLanding('bravo', [0, 0, 0]);
    system.update('alpha', context(), 20);

    for (let index = 0; index < 10; index += 1) {
      system.update('bravo', context({ position: [20, 30, 0] }), 20);
      if (system.getReport('bravo')?.landingSpot) break;
    }

    const alpha = system.getReport('alpha')?.landingSpot?.position;
    const bravo = system.getReport('bravo')?.landingSpot?.position;
    expect(alpha).toBeDefined();
    expect(bravo).toBeDefined();
    expect(Math.hypot(
      (alpha?.[0] ?? 0) - (bravo?.[0] ?? 0),
      (alpha?.[2] ?? 0) - (bravo?.[2] ?? 0),
    )).toBeGreaterThan(14);
  });

  it('respeta exclusiones noLanding y emite landed una sola vez', () => {
    const system = systemWith(() => ({ y: 0 }));
    system.setNoLandingAreas([
      { id: 'water', center: [0, 0, 0], halfExtents: [10, 4, 10] },
    ]);
    register(system, 'heli');
    system.orderLanding('heli', [0, 0, 0]);

    for (let index = 0; index < 8; index += 1) {
      system.update('heli', context(), 20);
      if (system.getReport('heli')?.landingSpot) break;
    }
    const spot = system.getReport('heli')?.landingSpot?.position;
    expect(spot).toBeDefined();
    expect(Math.hypot(spot?.[0] ?? 0, spot?.[2] ?? 0)).toBeGreaterThan(15);

    system.drainLandingEvents();
    const landedContext = context({
      position: spot ?? [21, 0, 0],
      altitude: 0,
      grounded: true,
    });
    system.update('heli', landedContext, 20);
    system.update('heli', landedContext, 20);
    expect(system.drainLandingEvents().filter((event) => event.type === 'landed'))
      .toHaveLength(1);
  });

  it('cambia del pickup al destino outbound en vez de quedar suspendido', () => {
    const system = systemWith(() => ({ y: 0 }));
    register(system, 'transport', 'transport');

    system.update('transport', context({ pickupAt: [0, 0, 0] }), 20);
    expect(system.getReport('transport')?.landingRequested).toEqual([0, 0, 0]);

    system.update('transport', context({
      passengersOnboard: true,
      authoredGoal: [70, 0, 0],
    }), 20);

    expect(system.getReport('transport')?.landingRequested).toEqual([70, 0, 0]);
    expect(system.getState('transport')).toBe('goAround');
  });

  it('mantiene el suelo durante la descarga sin crear otro landing implícito', () => {
    const system = systemWith(() => ({ y: 0 }));
    register(system, 'transport', 'transport');

    const decision = system.update('transport', context({
      position: [20, 0, 10],
      altitude: 0,
      grounded: true,
      passengersOnboard: true,
      groundHold: true,
      authoredGoal: [20, 0, 10],
    }), 20);

    expect(decision?.state).toBe('grounded');
    expect(system.getReport('transport')?.landingRequested).toBeNull();
    expect(system.drainLandingEvents()).toHaveLength(0);
  });

  it('descarta un sitio sin salida y resuelve otro claro', () => {
    const system = systemWith(() => ({ y: 0 }));
    register(system, 'transport', 'transport');
    system.update('transport', context({
      passengersOnboard: true,
      authoredGoal: [0, 0, 0],
    }), 20);
    const first = system.getReport('transport')?.landingSpot?.position;
    expect(first).toBeDefined();
    expect(system.markLandingSiteUnavailable(
      'transport',
      first ?? [0, 0, 0],
    )).toBe(true);

    for (let index = 0; index < 8; index += 1) {
      system.update('transport', context({
        passengersOnboard: true,
        authoredGoal: [0, 0, 0],
      }), 20);
      const next = system.getReport('transport')?.landingSpot?.position;
      if (next && Math.hypot(
        next[0] - (first?.[0] ?? 0),
        next[2] - (first?.[2] ?? 0),
      ) > 1) break;
    }
    const second = system.getReport('transport')?.landingSpot?.position;
    expect(second).toBeDefined();
    expect(Math.hypot(
      (second?.[0] ?? 0) - (first?.[0] ?? 0),
      (second?.[2] ?? 0) - (first?.[2] ?? 0),
    )).toBeGreaterThan(1);
  });
});

function systemWith(surface: (x: number, z: number) => TestSurface | null) {
  return new AirVehicleAiSystem(raycastFor(surface));
}

function navigationWith(surface: (x: number, z: number) => TestSurface | null) {
  return new AirVehicleNavigation(
    raycastFor(surface),
    airNavProfileFromPreset(VehiclePresets.helicopterFree),
    'test-heli',
  );
}

function register(
  system: AirVehicleAiSystem,
  vehicleId: string,
  behavior: 'intercept' | 'transport' = 'intercept',
): void {
  expect(system.registerVehicle({
    vehicleId,
    preset: VehiclePresets.helicopterFree,
    ai: { enabled: true, behavior },
  })).toBe(true);
}

function context(overrides: Partial<AirBrainContext> = {}): AirBrainContext {
  return {
    position: [0, 30, 0],
    heading: 0,
    velocity: [0, 0, 0],
    altitude: 30,
    grounded: false,
    healthFraction: 1,
    pilotAvailable: true,
    gunnerAvailable: true,
    passengersOnboard: false,
    hasPlayerOccupant: false,
    crewPending: false,
    ...overrides,
  };
}

function raycastFor(
  surfaceAt: (x: number, z: number) => TestSurface | null,
): RaycastSource {
  return {
    cast: (origin, direction, maxDistance, _body, _id, filter) => {
      // Los sondeos de apoyo son verticales y largos. Los rayos cortos del A*
      // y los de clearance horizontal quedan libres en este mundo de prueba.
      if (direction.y > -0.9 || maxDistance < 40) return null;
      const surface = surfaceAt(origin.x, origin.z);
      if (!surface) return null;
      const distance = origin.y - surface.y;
      if (distance < 0 || distance > maxDistance) return null;
      const collider = fakeCollider(!surface.dynamic);
      const metadata: PhysicsMetadata = {
        id: surface.dynamic ? 'moving-platform' : 'world',
        kind: surface.dynamic ? 'dynamic' : 'static',
        ...(surface.surface ? { surface: surface.surface } : {}),
      };
      if (filter && !filter(metadata, collider)) return null;
      return {
        collider,
        metadata,
        point: new Vector3(origin.x, surface.y, origin.z),
        normal: new Vector3(0, surface.normalY ?? 1, 0),
        toi: distance,
      };
    },
  };
}

function fakeCollider(fixed: boolean): RaycastHit['collider'] {
  return {
    isSensor: () => false,
    parent: () => ({ isFixed: () => fixed }),
  } as unknown as RaycastHit['collider'];
}
