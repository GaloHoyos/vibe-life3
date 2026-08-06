import { describe, expect, it } from 'vitest';
import type { VehicleDrivingPathPoint } from '@game/gameplay/vehicles/ai/VehicleAiTypes';
import { smoothVehiclePath } from '@game/gameplay/vehicles/ai/VehiclePathSmoother';

const CLEAR = { isClear: () => true, maxSpacing: 100 };

function point(
  x: number,
  z: number,
  overrides: Partial<VehicleDrivingPathPoint> = {},
): VehicleDrivingPathPoint {
  return { position: [x, 0, z], direction: 'forward', ...overrides };
}

function positions(points: readonly VehicleDrivingPathPoint[]): string[] {
  return points.map((entry) => `${entry.position[0]},${entry.position[2]}`);
}

describe('smoothVehiclePath', () => {
  it('colapsa la escalera de un tramo recto', () => {
    const staircase = [
      point(0, 0), point(0, 1), point(1, 2), point(1, 3),
      point(2, 4), point(2, 5), point(3, 6),
    ];

    const smoothed = smoothVehiclePath(staircase, CLEAR);

    expect(positions(smoothed)).toEqual(['0,0', '3,6']);
  });

  it('no atajea por donde no se puede pasar', () => {
    const points = [point(0, 0), point(0, 5), point(5, 5), point(5, 0)];
    // Sólo el tramo entre vecinos inmediatos está despejado.
    const smoothed = smoothVehiclePath(points, {
      isClear: (from, to) => Math.hypot(to[0] - from[0], to[2] - from[2]) <= 5,
      maxSpacing: 100,
    });

    expect(positions(smoothed)).toEqual(['0,0', '0,5', '5,5', '5,0']);
  });

  it('respeta el espaciado máximo', () => {
    const points = [point(0, 0), point(0, 4), point(0, 8), point(0, 12)];

    const smoothed = smoothVehiclePath(points, { isClear: () => true, maxSpacing: 5 });

    expect(positions(smoothed)).toEqual(['0,0', '0,4', '0,8', '0,12']);
  });

  it('conserva una curva coherente en vez de convertirla en una cuerda', () => {
    const radius = 10;
    const arc = Array.from({ length: 7 }, (_, index) => {
      const angle = (index / 6) * Math.PI / 2;
      return point(Math.sin(angle) * radius, Math.cos(angle) * radius);
    });

    const smoothed = smoothVehiclePath(arc, {
      isClear: () => true,
      maxSpacing: 100,
      minimumTurnRadius: 8,
    });

    expect(smoothed.length).toBeGreaterThan(2);
    expect(smoothed[0]).toEqual(arc[0]);
    expect(smoothed.at(-1)).toEqual(arc.at(-1));
  });

  it('nunca cruza una cúspide: ahí el vehículo frena y cambia de sentido', () => {
    const points = [
      point(0, 0), point(0, 2), point(0, 4),
      point(0, 3, { direction: 'reverse' }),
      point(0, 2, { direction: 'reverse' }),
    ];

    const smoothed = smoothVehiclePath(points, CLEAR);

    // El tramo de ida se colapsa entero, pero la cúspide (0,4) sobrevive y la
    // marcha atrás arranca en su propio punto: ningún tramo cambia de sentido
    // por el camino.
    expect(positions(smoothed)).toEqual(['0,0', '0,4', '0,3', '0,2']);
    expect(smoothed.map((entry) => entry.direction)).toEqual([
      'forward',
      'forward',
      'reverse',
      'reverse',
    ]);
  });

  it('no funde puntos con distinto límite de velocidad', () => {
    const points = [
      point(0, 0, { speedLimit: 10 }),
      point(0, 2, { speedLimit: 10 }),
      point(0, 4, { speedLimit: 4 }),
      point(0, 6, { speedLimit: 4 }),
    ];

    const smoothed = smoothVehiclePath(points, CLEAR);

    // El borde se conserva de los dos lados: `0,2` cierra el tramo rápido y
    // `0,4` abre el lento, así que ningún punto cambia de límite por el camino.
    expect(positions(smoothed)).toEqual(['0,0', '0,2', '0,4', '0,6']);
  });

  it('conserva los extremos y no toca caminos triviales', () => {
    expect(smoothVehiclePath([], CLEAR)).toEqual([]);
    const pair = [point(0, 0), point(0, 9)];
    expect(smoothVehiclePath(pair, CLEAR)).toEqual(pair);

    const long = [point(0, 0), point(0, 3), point(0, 6)];
    const smoothed = smoothVehiclePath(long, CLEAR);
    expect(smoothed[0]).toEqual(long[0]);
    expect(smoothed.at(-1)).toEqual(long.at(-1));
  });
});
