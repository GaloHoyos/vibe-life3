import { describe, expect, it } from 'vitest';
import {
  VehicleConvoyCoordinator,
  VehicleReservationManager,
} from '@game/gameplay/vehicles/ai/VehicleTrafficCoordinator';

describe('VehicleReservationManager', () => {
  it('mantiene exclusión, prioridad y promoción al liberar', () => {
    const reservations = new VehicleReservationManager();
    expect(reservations.request({
      resourceId: 'bridge',
      vehicleId: 'a',
      now: 0,
    }).granted).toBe(true);
    expect(reservations.request({
      resourceId: 'bridge',
      vehicleId: 'b',
      priority: 1,
      now: 0,
    }).granted).toBe(false);
    expect(reservations.request({
      resourceId: 'bridge',
      vehicleId: 'c',
      priority: 10,
      now: 0,
    }).queuePosition).toBe(1);
    reservations.release('bridge', 'a', 0.5);
    expect(reservations.owner('bridge', 0.5)).toBe('c');
    reservations.release('bridge', 'c', 0.6);
    expect(reservations.owner('bridge', 0.6)).toBe('b');
  });

  it('comparte la reserva dentro del mismo convoy y expira leases', () => {
    const reservations = new VehicleReservationManager();
    expect(reservations.request({
      resourceId: 'narrow',
      vehicleId: 'leader',
      convoyId: 'alpha',
      now: 0,
      leaseSeconds: 1,
    }).granted).toBe(true);
    expect(reservations.request({
      resourceId: 'narrow',
      vehicleId: 'follower',
      convoyId: 'alpha',
      now: 0.2,
      leaseSeconds: 1,
    }).granted).toBe(true);
    reservations.request({ resourceId: 'narrow', vehicleId: 'enemy', now: 0.2 });
    expect(reservations.owner('narrow', 0.9)).toBe('leader');
    expect(reservations.owner('narrow', 1.3)).toBe('enemy');
  });
});

describe('VehicleConvoyCoordinator', () => {
  it('genera un objetivo espaciado y adapta velocidad al predecesor', () => {
    const convoy = new VehicleConvoyCoordinator();
    convoy.setConvoy('alpha', ['leader', 'wing'], 8);
    convoy.updateMember({
      vehicleId: 'leader',
      pose: { position: [0, 0, 20], heading: 0 },
      speed: 10,
    });
    convoy.updateMember({
      vehicleId: 'wing',
      pose: { position: [0, 0, 5], heading: 0 },
      speed: 8,
    });
    const guidance = convoy.guidance('wing', 18);
    expect(guidance?.target).toEqual([0, 0, 12]);
    expect(guidance?.spacingError).toBe(7);
    expect(guidance?.targetSpeed).toBeGreaterThan(10);
    expect(guidance?.targetSpeed).toBeLessThanOrEqual(18);
  });
});
