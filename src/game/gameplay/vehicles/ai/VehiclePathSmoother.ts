import type { VehicleDrivingPathPoint, VehicleNavPoint } from './VehicleAiTypes';

export interface VehiclePathSmootherOptions {
  /** Si el segmento recto entre dos puntos queda entero sobre terreno manejable. */
  isClear(from: VehicleNavPoint, to: VehicleNavPoint): boolean;
  /**
   * Largo máximo de un tramo suavizado. Sin tope, un recto largo se colapsa a
   * dos puntos y el seguidor pierde resolución para el límite de velocidad y
   * para saber por dónde va.
   */
  maxSpacing: number;
}

/**
 * Recorta la escalera que deja el Hybrid A*. La búsqueda avanza de centro de
 * celda a centro de celda con el rumbo cuantizado a 16 valores, así que una
 * diagonal sale como un serrucho de un metro por escalón: más larga que la recta
 * y con el volante moviéndose sin necesidad.
 *
 * Sólo une puntos que compartan sentido de marcha y límite de velocidad, de modo
 * que ni las cúspides —donde el vehículo frena y cambia a marcha atrás— ni los
 * cambios de límite se pierden en el atajo.
 */
export function smoothVehiclePath(
  points: readonly VehicleDrivingPathPoint[],
  options: VehiclePathSmootherOptions,
): VehicleDrivingPathPoint[] {
  if (points.length <= 2) return [...points];
  const result: VehicleDrivingPathPoint[] = [];
  let anchor = 0;
  result.push(points[anchor] as VehicleDrivingPathPoint);

  while (anchor < points.length - 1) {
    const from = points[anchor];
    if (!from) break;
    let furthest = anchor + 1;
    for (let candidate = anchor + 2; candidate < points.length; candidate += 1) {
      const to = points[candidate];
      if (!to) break;
      if (!sameSegment(from, to)) break;
      if (!homogeneous(points, anchor, candidate)) break;
      if (planar(from.position, to.position) > options.maxSpacing) break;
      if (!options.isClear(from.position, to.position)) break;
      furthest = candidate;
    }
    const next = points[furthest];
    if (!next) break;
    result.push(next);
    anchor = furthest;
  }
  return result;
}

/** Mismo sentido de marcha y mismo tope de velocidad. */
function sameSegment(
  from: VehicleDrivingPathPoint,
  to: VehicleDrivingPathPoint,
): boolean {
  return from.direction === to.direction && from.speedLimit === to.speedLimit;
}

/** Ningún punto intermedio rompe la homogeneidad del tramo. */
function homogeneous(
  points: readonly VehicleDrivingPathPoint[],
  from: number,
  to: number,
): boolean {
  const anchor = points[from];
  if (!anchor) return false;
  for (let index = from + 1; index < to; index += 1) {
    const point = points[index];
    if (!point || !sameSegment(anchor, point)) return false;
  }
  return true;
}

function planar(from: VehicleNavPoint, to: VehicleNavPoint): number {
  return Math.hypot(to[0] - from[0], to[2] - from[2]);
}
