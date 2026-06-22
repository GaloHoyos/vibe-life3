import { fbm2D, type FractalNoiseOptions } from './Noise';

/**
 * Grid de alturas 2.5D. `widthSamples` corre sobre X, `depthSamples` sobre Z.
 * `heights[xi + zi * widthSamples]` da la altura en metros del vértice.
 * Layout compatible con `ColliderDesc.heightfield(widthSamples, depthSamples, ...)`
 * de Rapier (column-major con nrows = X, ncols = Z).
 */
export interface HeightField {
  widthSamples: number;
  depthSamples: number;
  heights: Float32Array;
}

export interface FlattenRegion {
  /** Centro en coordenadas locales del terreno [x, z] (origen = centro del terreno). */
  center: [number, number];
  /** Radio (m) de la zona 100% plana — dentro de esto la altura es exactamente `height`. */
  radius: number;
  /** Ancho (m) del anillo de transición desde `radius` hasta el ruido natural. */
  falloff: number;
  /** Altura objetivo del plateau en metros. */
  height: number;
}

export interface NoiseHeightSource extends FractalNoiseOptions {
  kind: 'noise';
  /** Amplitud total en metros (pico-a-valle). */
  amplitude: number;
  /** Offset constante en Y aplicado a todo el heightfield. */
  baseHeight?: number;
  /**
   * Regiones planas opcionales. Cada una crea un plateau circular a la altura
   * dada con un anillo de transición suave hacia el noise. Útil para asentar
   * edificios o estructuras a diferentes niveles. Cuando varias se solapan, gana
   * la de mayor peso (la más cercana a su centro).
   */
  flattenRegions?: FlattenRegion[];
}

export interface FlatHeightSource {
  kind: 'flat';
  height: number;
}

export type HeightSource = NoiseHeightSource | FlatHeightSource;

export interface HeightFieldOptions {
  /** Cantidad de muestras a lo largo de X. */
  widthSamples: number;
  /** Cantidad de muestras a lo largo de Z. */
  depthSamples: number;
  /** Tamaño total en metros [ancho X, profundidad Z]. */
  size: [number, number];
  source: HeightSource;
}

/**
 * Genera un `HeightField` a partir de una `HeightSource`. La fuente `noise`
 * usa `fbm2D` con seed, así dos llamadas con la misma config producen el
 * mismo terreno (importante para que el collider físico y el mesh visual
 * coincidan exactamente).
 */
export function generateHeightField(options: HeightFieldOptions): HeightField {
  const { widthSamples, depthSamples, size, source } = options;
  const heights = new Float32Array(widthSamples * depthSamples);
  const [sizeX, sizeZ] = size;

  for (let xi = 0; xi < widthSamples; xi++) {
    for (let zi = 0; zi < depthSamples; zi++) {
      const i = xi + zi * widthSamples;
      heights[i] = sampleHeight(xi, zi, widthSamples, depthSamples, sizeX, sizeZ, source);
    }
  }

  return { widthSamples, depthSamples, heights };
}

function sampleHeight(
  xi: number,
  zi: number,
  widthSamples: number,
  depthSamples: number,
  sizeX: number,
  sizeZ: number,
  source: HeightSource,
): number {
  if (source.kind === 'flat') {
    return source.height;
  }

  const u = xi / (widthSamples - 1);
  const v = zi / (depthSamples - 1);
  const x = (u - 0.5) * sizeX;
  const z = (v - 0.5) * sizeZ;
  const n = fbm2D(x, z, source);
  const noiseHeight = (source.baseHeight ?? 0) + (n - 0.5) * 2 * source.amplitude;
  return applyFlattenRegions(x, z, noiseHeight, source.flattenRegions);
}

function applyFlattenRegions(
  x: number,
  z: number,
  noiseHeight: number,
  regions: FlattenRegion[] | undefined,
): number {
  if (!regions || regions.length === 0) {
    return noiseHeight;
  }

  let bestWeight = 0;
  let bestHeight = 0;
  for (const region of regions) {
    const dx = x - region.center[0];
    const dz = z - region.center[1];
    const dist = Math.sqrt(dx * dx + dz * dz);
    const weight = flattenWeight(dist, region.radius, region.falloff);
    if (weight > bestWeight) {
      bestWeight = weight;
      bestHeight = region.height;
    }
  }

  if (bestWeight <= 0) {
    return noiseHeight;
  }
  return noiseHeight + (bestHeight - noiseHeight) * bestWeight;
}

function flattenWeight(dist: number, radius: number, falloff: number): number {
  if (dist <= radius) return 1;
  if (falloff <= 0 || dist >= radius + falloff) return 0;
  const t = (dist - radius) / falloff;
  return 1 - t * t * (3 - 2 * t);
}
