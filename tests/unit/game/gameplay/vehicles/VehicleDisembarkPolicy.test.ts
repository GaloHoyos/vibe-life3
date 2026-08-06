import { describe, expect, it } from 'vitest';
import {
  crewRetentionCap,
  selectDisembarkingCrew,
  type VehicleDisembarkCandidate,
} from '@game/gameplay/vehicles/VehicleDisembarkPolicy';

const driver: VehicleDisembarkCandidate = { actor: 'driver', role: 'driver' };
const gunner: VehicleDisembarkCandidate = { actor: 'gunner', role: 'gunner' };
const rear: VehicleDisembarkCandidate = { actor: 'rear', role: 'passenger' };
const flank: VehicleDisembarkCandidate = { actor: 'flank', role: 'passenger' };

function leaving(crew: readonly VehicleDisembarkCandidate[], seats: number): string[] {
  return selectDisembarkingCrew(crew, seats).map((entry) => entry.actor);
}

describe('crewRetentionCap', () => {
  it('conserva sólo al conductor en un vehículo de dos plazas', () => {
    expect(crewRetentionCap(2)).toBe(1);
    expect(crewRetentionCap(1)).toBe(1);
  });

  it('conserva conductor y artillero de tres plazas en adelante', () => {
    expect(crewRetentionCap(3)).toBe(2);
    expect(crewRetentionCap(4)).toBe(2);
  });
});

describe('selectDisembarkingCrew', () => {
  it('de cuatro plazas con cuatro a bordo bajan dos y quedan conductor y artillero', () => {
    expect(leaving([driver, gunner, rear, flank], 4)).toEqual(['rear', 'flank']);
  });

  it('de cuatro plazas con dos a bordo baja el artillero', () => {
    expect(leaving([driver, gunner], 4)).toEqual(['gunner']);
  });

  it('de dos plazas con dos a bordo queda sólo el conductor', () => {
    expect(leaving([driver, gunner], 2)).toEqual(['gunner']);
    expect(leaving([driver, rear], 2)).toEqual(['rear']);
  });

  it('en un buggy armado baja el conductor y el artillero queda cubriendo', () => {
    expect(
      selectDisembarkingCrew([driver, gunner], 2, true).map(
        (entry) => entry.actor,
      ),
    ).toEqual(['driver']);
  });

  it('en un transporte armado conserva conductor y artillero', () => {
    expect(
      selectDisembarkingCrew([driver, gunner, rear, flank], 4, true).map(
        (entry) => entry.actor,
      ),
    ).toEqual(['rear', 'flank']);
    expect(selectDisembarkingCrew([driver, gunner], 4, true)).toEqual([]);
  });

  it('con un solo tripulante baja el conductor', () => {
    expect(leaving([driver], 4)).toEqual(['driver']);
    expect(leaving([driver], 2)).toEqual(['driver']);
  });

  it('siempre baja al menos uno', () => {
    for (const seats of [2, 3, 4, 6]) {
      for (const crew of [[driver], [driver, gunner], [driver, gunner, rear]]) {
        expect(selectDisembarkingCrew(crew, seats).length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('nunca baja más gente de la que hay a bordo', () => {
    expect(leaving([driver, gunner, rear, flank], 2)).toHaveLength(3);
    expect(leaving([driver], 2)).toHaveLength(1);
  });

  it('suelta primero a los pasajeros, después al artillero y último al conductor', () => {
    expect(leaving([driver, gunner, rear, flank], 2)).toEqual(['rear', 'flank', 'gunner']);
  });

  it('trata al piloto como al conductor', () => {
    const pilot: VehicleDisembarkCandidate = { actor: 'pilot', role: 'pilot' };
    expect(leaving([pilot, rear], 4)).toEqual(['rear']);
    expect(leaving([pilot], 4)).toEqual(['pilot']);
  });

  it('no inventa nada con el vehículo vacío', () => {
    expect(selectDisembarkingCrew([], 4)).toEqual([]);
  });
});
