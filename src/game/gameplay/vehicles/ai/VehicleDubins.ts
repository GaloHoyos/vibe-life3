import { TAU } from './VehicleAiMath';

/**
 * Pose en planta. `heading` sigue la convención del proyecto: cero mira hacia
 * +Z, y el vector de avance es `(sin h, cos h)`.
 */
export interface DubinsPose {
  x: number;
  z: number;
  heading: number;
}

export interface DubinsSample {
  x: number;
  z: number;
  heading: number;
}

/** Curvatura de cada tramo: izquierda, derecha o recto. */
type Turn = 1 | -1 | 0;
type Word = readonly [Turn, Turn, Turn];

/** Los seis caminos de Dubins, en el orden clásico de Shkel y Lumelsky. */
const WORDS: readonly { readonly word: Word; readonly solve: Solver }[] = [
  { word: [1, 0, 1], solve: solveLSL },
  { word: [-1, 0, -1], solve: solveRSR },
  { word: [1, 0, -1], solve: solveLSR },
  { word: [-1, 0, 1], solve: solveRSL },
  { word: [-1, 1, -1], solve: solveRLR },
  { word: [1, -1, 1], solve: solveLRL },
];

/** Longitudes de los tres tramos, normalizadas por el radio de giro. */
type Segments = readonly [number, number, number];
type Solver = (alpha: number, beta: number, d: number) => Segments | null;

const POSITION_TOLERANCE = 0.1;
const HEADING_TOLERANCE = 0.05;

/**
 * Camino de Dubins más corto entre dos poses, muestreado cada `stepLength`.
 * Devuelve los puntos SIN el de partida y CON el de llegada, o `null` si ningún
 * word resuelve.
 *
 * Es la "expansión analítica" del Hybrid A*: cerca del objetivo, en vez de
 * seguir expandiendo estados a ciegas, se intenta cerrar el camino de una sola
 * vez con una curva exacta. Sólo hacia adelante: la marcha atrás la sigue
 * resolviendo la búsqueda normal.
 *
 * El resultado se verifica integrándolo: si el extremo no cae sobre la pose
 * pedida, se descarta. Así una fórmula equivocada degrada a "no encontré atajo"
 * en vez de producir un camino que el vehículo no puede seguir.
 */
export function dubinsShortestPath(
  start: DubinsPose,
  goal: DubinsPose,
  turnRadius: number,
  stepLength: number,
): DubinsSample[] | null {
  const radius = Math.max(0.01, turnRadius);
  // A marco estándar: X hacia +Z del mundo, Y hacia +X. El avance pasa a ser
  // `(cos θ, sin θ)` con θ = heading, que es lo que asumen las fórmulas.
  const deltaX = goal.z - start.z;
  const deltaY = goal.x - start.x;
  const distance = Math.hypot(deltaX, deltaY);
  const d = distance / radius;
  const theta = Math.atan2(deltaY, deltaX);
  const alpha = mod2pi(start.heading - theta);
  const beta = mod2pi(goal.heading - theta);

  let best: { word: Word; segments: Segments; length: number } | null = null;
  for (const candidate of WORDS) {
    const segments = candidate.solve(alpha, beta, d);
    if (!segments) continue;
    const length = segments[0] + segments[1] + segments[2];
    if (!Number.isFinite(length) || length < 0) continue;
    if (!best || length < best.length) {
      best = { word: candidate.word, segments, length };
    }
  }
  if (!best) return null;

  const samples = integrate(start, best.word, best.segments, radius, stepLength);
  const end = samples.at(-1);
  if (!end) return null;
  if (Math.hypot(end.x - goal.x, end.z - goal.z) > POSITION_TOLERANCE) return null;
  if (Math.abs(normalize(end.heading - goal.heading)) > HEADING_TOLERANCE) return null;
  return samples;
}

/**
 * Recorre los tres tramos a curvatura constante. Cada paso se integra exacto
 * —no por Euler— porque el error de un arco acumulado sobre decenas de pasos es
 * justo lo que haría fallar la verificación del extremo.
 */
function integrate(
  start: DubinsPose,
  word: Word,
  segments: Segments,
  radius: number,
  stepLength: number,
): DubinsSample[] {
  const samples: DubinsSample[] = [];
  // En marco estándar mientras dura la integración.
  let x = start.z;
  let y = start.x;
  let heading = start.heading;
  const step = Math.max(0.05, stepLength);

  for (let index = 0; index < 3; index += 1) {
    const turn = word[index] ?? 0;
    // Los tramos curvos vienen en radianes y los rectos en radios.
    const length = (segments[index] ?? 0) * radius;
    if (length <= 1e-9) continue;
    const steps = Math.max(1, Math.ceil(length / step));
    const ds = length / steps;
    for (let sub = 0; sub < steps; sub += 1) {
      if (turn === 0) {
        x += Math.cos(heading) * ds;
        y += Math.sin(heading) * ds;
      } else {
        const curvature = turn / radius;
        const next = heading + curvature * ds;
        x += (Math.sin(next) - Math.sin(heading)) / curvature;
        y += (Math.cos(heading) - Math.cos(next)) / curvature;
        heading = next;
      }
      samples.push({ x: y, z: x, heading: normalize(heading) });
    }
  }
  return samples;
}

function mod2pi(value: number): number {
  const wrapped = value % TAU;
  return wrapped < 0 ? wrapped + TAU : wrapped;
}

function normalize(angle: number): number {
  const wrapped = mod2pi(angle + Math.PI);
  return wrapped - Math.PI;
}

function solveLSL(alpha: number, beta: number, d: number): Segments | null {
  const tmp = d + Math.sin(alpha) - Math.sin(beta);
  const squared =
    2 + d * d - 2 * Math.cos(alpha - beta) + 2 * d * (Math.sin(alpha) - Math.sin(beta));
  if (squared < 0) return null;
  const angle = Math.atan2(Math.cos(beta) - Math.cos(alpha), tmp);
  return [mod2pi(angle - alpha), Math.sqrt(squared), mod2pi(beta - angle)];
}

function solveRSR(alpha: number, beta: number, d: number): Segments | null {
  const tmp = d - Math.sin(alpha) + Math.sin(beta);
  const squared =
    2 + d * d - 2 * Math.cos(alpha - beta) + 2 * d * (Math.sin(beta) - Math.sin(alpha));
  if (squared < 0) return null;
  const angle = Math.atan2(Math.cos(alpha) - Math.cos(beta), tmp);
  return [mod2pi(alpha - angle), Math.sqrt(squared), mod2pi(angle - beta)];
}

function solveLSR(alpha: number, beta: number, d: number): Segments | null {
  const squared =
    -2 + d * d + 2 * Math.cos(alpha - beta) + 2 * d * (Math.sin(alpha) + Math.sin(beta));
  if (squared < 0) return null;
  const p = Math.sqrt(squared);
  const angle =
    Math.atan2(-Math.cos(alpha) - Math.cos(beta), d + Math.sin(alpha) + Math.sin(beta)) -
    Math.atan2(-2, p);
  return [mod2pi(angle - alpha), p, mod2pi(angle - beta)];
}

function solveRSL(alpha: number, beta: number, d: number): Segments | null {
  const squared =
    d * d - 2 + 2 * Math.cos(alpha - beta) - 2 * d * (Math.sin(alpha) + Math.sin(beta));
  if (squared < 0) return null;
  const p = Math.sqrt(squared);
  const angle =
    Math.atan2(Math.cos(alpha) + Math.cos(beta), d - Math.sin(alpha) - Math.sin(beta)) -
    Math.atan2(2, p);
  return [mod2pi(alpha - angle), p, mod2pi(beta - angle)];
}

function solveRLR(alpha: number, beta: number, d: number): Segments | null {
  const tmp =
    (6 - d * d + 2 * Math.cos(alpha - beta) + 2 * d * (Math.sin(alpha) - Math.sin(beta))) / 8;
  if (Math.abs(tmp) > 1) return null;
  const p = mod2pi(TAU - Math.acos(tmp));
  const t = mod2pi(
    alpha - Math.atan2(Math.cos(alpha) - Math.cos(beta), d - Math.sin(alpha) + Math.sin(beta)) +
      p / 2,
  );
  return [t, p, mod2pi(alpha - beta - t + p)];
}

function solveLRL(alpha: number, beta: number, d: number): Segments | null {
  const tmp =
    (6 - d * d + 2 * Math.cos(alpha - beta) + 2 * d * (Math.sin(beta) - Math.sin(alpha))) / 8;
  if (Math.abs(tmp) > 1) return null;
  const p = mod2pi(TAU - Math.acos(tmp));
  const t = mod2pi(
    -alpha - Math.atan2(Math.cos(alpha) - Math.cos(beta), d + Math.sin(alpha) - Math.sin(beta)) +
      p / 2,
  );
  return [t, p, mod2pi(mod2pi(beta) - alpha - t + p)];
}
