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
  /** Radio físico mínimo para no introducir un empalme que el volante no alcanza. */
  minimumTurnRadius?: number;
  /** Giro coherente máximo que puede reemplazarse por una cuerda recta. */
  maximumShortcutTurnRadians?: number;
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
      if (!preservesKinematics(points, result, anchor, candidate, options)) continue;
      furthest = candidate;
    }
    const next = points[furthest];
    if (!next) break;
    result.push(next);
    anchor = furthest;
  }
  return result;
}

function preservesKinematics(
  points: readonly VehicleDrivingPathPoint[],
  result: readonly VehicleDrivingPathPoint[],
  from: number,
  to: number,
  options: VehiclePathSmootherOptions,
): boolean {
  const coherentTurn = coherentTurnBetween(points, from, to);
  if (
    coherentTurn >
    (options.maximumShortcutTurnRadians ?? Math.PI / 8)
  ) {
    return false;
  }
  const minimumRadius = options.minimumTurnRadius;
  if (minimumRadius === undefined || minimumRadius <= 0) return true;
  const start = points[from];
  const end = points[to];
  if (!start || !end) return false;
  const previous = result.length > 1 ? result[result.length - 2] : undefined;
  if (
    previous &&
    estimatedJunctionRadius(previous.position, start.position, end.position) < minimumRadius
  ) {
    return false;
  }
  const next = points[to + 1];
  if (
    next &&
    estimatedJunctionRadius(start.position, end.position, next.position) < minimumRadius
  ) {
    return false;
  }
  return true;
}

/**
 * Un serrucho de grilla alterna el signo del giro y puede colapsarse. Una curva
 * real acumula giro hacia un solo lado: convertirla en cuerda perdería su radio.
 */
function coherentTurnBetween(
  points: readonly VehicleDrivingPathPoint[],
  from: number,
  to: number,
): number {
  let positive = 0;
  let negative = 0;
  for (let index = from + 1; index < to; index += 1) {
    const before = points[index - 1];
    const current = points[index];
    const after = points[index + 1];
    if (!before || !current || !after) continue;
    const incoming = Math.atan2(
      current.position[0] - before.position[0],
      current.position[2] - before.position[2],
    );
    const outgoing = Math.atan2(
      after.position[0] - current.position[0],
      after.position[2] - current.position[2],
    );
    const turn = normalize(outgoing - incoming);
    if (turn > 1e-3) positive += turn;
    else if (turn < -1e-3) negative -= turn;
  }
  if (positive > 1e-3 && negative > 1e-3) return 0;
  return positive + negative;
}

function estimatedJunctionRadius(
  before: VehicleNavPoint,
  at: VehicleNavPoint,
  after: VehicleNavPoint,
): number {
  const incomingLength = planar(before, at);
  const outgoingLength = planar(at, after);
  if (incomingLength <= 1e-5 || outgoingLength <= 1e-5) return 0;
  const incoming = Math.atan2(at[0] - before[0], at[2] - before[2]);
  const outgoing = Math.atan2(after[0] - at[0], after[2] - at[2]);
  const turn = Math.abs(normalize(outgoing - incoming));
  if (turn <= 1e-3) return Infinity;
  return Math.min(incomingLength, outgoingLength) /
    Math.max(1e-5, 2 * Math.sin(turn * 0.5));
}

function normalize(angle: number): number {
  const wrapped = (angle + Math.PI) % (Math.PI * 2);
  return (wrapped < 0 ? wrapped + Math.PI * 2 : wrapped) - Math.PI;
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
