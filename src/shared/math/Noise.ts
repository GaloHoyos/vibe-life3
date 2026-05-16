/**
 * Value noise 2D fractal sin dependencias externas, determinista por seed.
 * Útil para generar heightfields de terreno (colinas, dunas) sin que el
 * resultado dependa de la sesión.
 */

function hash2D(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1597334677);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Value noise 2D en [0, 1]. */
export function valueNoise2D(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const a = hash2D(xi, yi, seed);
  const b = hash2D(xi + 1, yi, seed);
  const c = hash2D(xi, yi + 1, seed);
  const d = hash2D(xi + 1, yi + 1, seed);
  const u = smoothstep(xf);
  const v = smoothstep(yf);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

export interface FractalNoiseOptions {
  seed: number;
  octaves: number;
  frequency: number;
  persistence?: number;
  lacunarity?: number;
}

/**
 * Fractal Brownian Motion sobre value noise 2D. Retorna en [0, 1].
 * `frequency` controla la escala de las features (mayor = colinas más chicas).
 * `octaves` cuántas capas se suman; `persistence` el peso decreciente de cada una.
 */
export function fbm2D(x: number, y: number, options: FractalNoiseOptions): number {
  const persistence = options.persistence ?? 0.5;
  const lacunarity = options.lacunarity ?? 2.0;
  let total = 0;
  let amplitude = 1;
  let frequency = options.frequency;
  let maxAmplitude = 0;
  for (let i = 0; i < options.octaves; i++) {
    total += valueNoise2D(x * frequency, y * frequency, options.seed + i * 1013) * amplitude;
    maxAmplitude += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return total / maxAmplitude;
}
