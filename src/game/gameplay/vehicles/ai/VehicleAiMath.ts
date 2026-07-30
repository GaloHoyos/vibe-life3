import type { VehicleNavPoint } from './VehicleAiTypes';

export const TAU = Math.PI * 2;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function normalizeAngle(angle: number): number {
  let normalized = (angle + Math.PI) % TAU;
  if (normalized < 0) normalized += TAU;
  return normalized - Math.PI;
}

export function planarDistance(a: VehicleNavPoint, b: VehicleNavPoint): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

export function distance3(a: VehicleNavPoint, b: VehicleNavPoint): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function lerpPoint(
  a: VehicleNavPoint,
  b: VehicleNavPoint,
  alpha: number,
): VehicleNavPoint {
  return [
    a[0] + (b[0] - a[0]) * alpha,
    a[1] + (b[1] - a[1]) * alpha,
    a[2] + (b[2] - a[2]) * alpha,
  ];
}

export function pointInPolygonXZ(
  point: VehicleNavPoint,
  polygon: readonly VehicleNavPoint[],
): boolean {
  let inside = false;
  for (let i = 0, previous = polygon.length - 1; i < polygon.length; previous = i, i += 1) {
    const currentPoint = polygon[i];
    const previousPoint = polygon[previous];
    const crosses = (currentPoint[2] > point[2]) !== (previousPoint[2] > point[2]);
    if (!crosses) continue;
    const denominator = previousPoint[2] - currentPoint[2];
    const intersectionX =
      ((previousPoint[0] - currentPoint[0]) * (point[2] - currentPoint[2])) /
        (Math.abs(denominator) < 1e-9 ? 1e-9 : denominator) +
      currentPoint[0];
    if (point[0] < intersectionX) inside = !inside;
  }
  return inside;
}

export function pointSegmentDistanceXZ(
  point: VehicleNavPoint,
  start: VehicleNavPoint,
  end: VehicleNavPoint,
): number {
  const dx = end[0] - start[0];
  const dz = end[2] - start[2];
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= 1e-9) return planarDistance(point, start);
  const alpha = clamp(
    ((point[0] - start[0]) * dx + (point[2] - start[2]) * dz) / lengthSquared,
    0,
    1,
  );
  return Math.hypot(
    point[0] - (start[0] + dx * alpha),
    point[2] - (start[2] + dz * alpha),
  );
}

export function headingToVector(heading: number): readonly [number, number] {
  return [Math.sin(heading), Math.cos(heading)];
}

export function headingBetween(from: VehicleNavPoint, to: VehicleNavPoint): number {
  return Math.atan2(to[0] - from[0], to[2] - from[2]);
}

export function finiteOr(value: number | undefined | null, fallback: number): number {
  return value === undefined || value === null || !Number.isFinite(value) ? fallback : value;
}

/**
 * Hash estable id+salt a 0..1. Sirve para darle a cada vehículo su propia
 * variación (velocidad, reacción, puntería) sin estado ni RNG: dos buggies del
 * mismo preset dejan de conducir idéntico y el resultado sobrevive a un save.
 */
export function stableUnitFromId(id: string, salt = 0): number {
  let hash = 0x811c9dc5 ^ Math.imul(salt + 1, 0x9e3779b1);
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 0x45d9f3b);
    hash ^= hash >>> 15;
  }
  return ((hash >>> 0) % 100_000) / 100_000;
}

/** Variación simétrica determinista: `1 ± spread`. */
export function stableJitter(id: string, salt: number, spread: number): number {
  return 1 + (stableUnitFromId(id, salt) * 2 - 1) * spread;
}

export function stableSide(id: string, salt = 0): 1 | -1 {
  return stableUnitFromId(id, salt) < 0.5 ? -1 : 1;
}
