import { describe, expect, it } from 'vitest';
import {
  dubinsShortestPath,
  type DubinsPose,
} from '@game/gameplay/vehicles/ai/VehicleDubins';

const RADIUS = 2.5;
const STEP = 0.35;

function pathLength(samples: readonly { x: number; z: number }[], from: DubinsPose): number {
  let total = 0;
  let previousX = from.x;
  let previousZ = from.z;
  for (const sample of samples) {
    total += Math.hypot(sample.x - previousX, sample.z - previousZ);
    previousX = sample.x;
    previousZ = sample.z;
  }
  return total;
}

describe('dubinsShortestPath', () => {
  it('conecta una recta hacia adelante sin curvar', () => {
    const start: DubinsPose = { x: 0, z: 0, heading: 0 };
    const samples = dubinsShortestPath(start, { x: 0, z: 20, heading: 0 }, RADIUS, STEP);

    expect(samples).not.toBeNull();
    expect(pathLength(samples ?? [], start)).toBeCloseTo(20, 1);
    // Recto de verdad: nunca se aparta del eje.
    expect((samples ?? []).every((sample) => Math.abs(sample.x) < 1e-6)).toBe(true);
  });

  it('cierra la pose exacta pedida, no sólo la posición', () => {
    const start: DubinsPose = { x: 0, z: 0, heading: 0 };
    const goal: DubinsPose = { x: 12, z: 8, heading: Math.PI / 2 };
    const samples = dubinsShortestPath(start, goal, RADIUS, STEP);
    const end = samples?.at(-1);

    expect(end).toBeDefined();
    expect(end?.x).toBeCloseTo(goal.x, 1);
    expect(end?.z).toBeCloseTo(goal.z, 1);
    expect(end?.heading).toBeCloseTo(goal.heading, 1);
  });

  it('resuelve todo el barrido de poses razonables', () => {
    const start: DubinsPose = { x: 0, z: 0, heading: 0 };
    let attempts = 0;
    let solved = 0;
    for (let angle = 0; angle < 12; angle += 1) {
      for (let distance = 8; distance <= 40; distance += 8) {
        for (let goalHeading = 0; goalHeading < 8; goalHeading += 1) {
          const bearing = (angle / 12) * Math.PI * 2;
          const goal: DubinsPose = {
            x: Math.sin(bearing) * distance,
            z: Math.cos(bearing) * distance,
            heading: (goalHeading / 8) * Math.PI * 2 - Math.PI,
          };
          attempts += 1;
          const samples = dubinsShortestPath(start, goal, RADIUS, STEP);
          if (!samples) continue;
          const end = samples.at(-1);
          if (!end) continue;
          // La verificación interna ya lo garantiza; se reasegura acá porque es
          // justo lo que separa "no encontré atajo" de "encontré uno inválido".
          expect(Math.hypot(end.x - goal.x, end.z - goal.z)).toBeLessThan(0.15);
          expect(pathLength(samples, start)).toBeGreaterThanOrEqual(distance - 0.5);
          solved += 1;
        }
      }
    }

    expect(attempts).toBeGreaterThan(300);
    // Fuera del disco de dos radios de giro, Dubins siempre resuelve.
    expect(solved).toBe(attempts);
  });

  it('nunca devuelve un camino más corto que la línea recta', () => {
    const start: DubinsPose = { x: 0, z: 0, heading: Math.PI };
    const goal: DubinsPose = { x: 0, z: 15, heading: 0 };
    const samples = dubinsShortestPath(start, goal, RADIUS, STEP);

    expect(samples).not.toBeNull();
    // Arrancando de espaldas hay que dar la vuelta: bastante más de 15 m.
    expect(pathLength(samples ?? [], start)).toBeGreaterThan(15);
  });
});
