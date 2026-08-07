import sharp from "sharp";

import type { AtlasFinish, AtlasSpec, GeneratedTextureSet } from "./types.js";

/**
 * Atlas PBR procedural de cuatro casillas. La geometría elige casilla por pieza
 * (`AtlasTile`) y acá se resuelve el acabado completo: capa de mugre, manchas de
 * óxido, pintura saltada, rayones con metal expuesto y chorreado vertical.
 *
 * Todo sale de ruido con semilla fija, así que dos corridas escriben los mismos
 * bytes. El relieve se acumula en un campo de altura compartido y de ahí salen
 * tanto el normal map como la oclusión, que es lo que hace que las tres texturas
 * describan la misma superficie en vez de tres ruidos sin relación.
 */
const DEFAULT_ATLAS_SIZE = 1024;
const CHANNELS = 4;

/** Los tres colores a los que degrada cualquier acabado. */
const RUST_COLOR = [104, 52, 30] as const;
const BARE_METAL_COLOR = [150, 152, 154] as const;
const DUST_COLOR = [74, 68, 58] as const;

function hash2d(x: number, y: number, seed: number): number {
  let value = Math.imul(x + 0x9e3779b9, 0x85ebca6b);
  value ^= Math.imul(y + 0xc2b2ae35, 0x27d4eb2f);
  value ^= seed;
  value = Math.imul(value ^ (value >>> 15), 0x2c1b3c6d);
  value = Math.imul(value ^ (value >>> 12), 0x297a2d39);
  return (value ^ (value >>> 15)) >>> 0;
}

function unitHash(x: number, y: number, seed: number): number {
  return hash2d(x, y, seed) / 0xffffffff;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** Ruido de valor con interpolación suave: la base de todo el fBm. */
function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = unitHash(x0, y0, seed);
  const n10 = unitHash(x0 + 1, y0, seed);
  const n01 = unitHash(x0, y0 + 1, seed);
  const n11 = unitHash(x0 + 1, y0 + 1, seed);
  return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy);
}

function fbm(
  x: number,
  y: number,
  seed: number,
  octaves: number,
): number {
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let normalization = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += valueNoise(x * frequency, y * frequency, seed + octave * 131) * amplitude;
    normalization += amplitude;
    amplitude *= 0.52;
    frequency *= 2.07;
  }
  return total / normalization;
}

/**
 * Rayones como trazos rasterizados, no como ruido por píxel. Un rayón es una
 * línea continua que se afina en las puntas; el hash por píxel sólo produce
 * sal y pimienta, que a esta densidad de texel lee como suciedad digital.
 */
function createScratchMask(
  seed: number,
  count: number,
  tileSize: number,
): Float32Array {
  const mask = new Float32Array(tileSize * tileSize);
  for (let index = 0; index < count; index += 1) {
    const originX = unitHash(index, 11, seed) * tileSize;
    const originY = unitHash(index, 29, seed) * tileSize;
    // Sesgo horizontal: los rayones de uso siguen la marcha del vehículo.
    const angle = (unitHash(index, 47, seed) - 0.5) * 1.1;
    const length = 24 + unitHash(index, 71, seed) ** 2 * 210;
    const width = 0.7 + unitHash(index, 97, seed) * 1.9;
    const strength = 0.35 + unitHash(index, 113, seed) * 0.65;
    const stepX = Math.cos(angle);
    const stepY = Math.sin(angle);
    const steps = Math.ceil(length);
    for (let step = 0; step <= steps; step += 1) {
      const taper = Math.sin((step / steps) * Math.PI) ** 0.6;
      const centerX = originX + stepX * step;
      const centerY = originY + stepY * step;
      const radius = Math.ceil(width);
      for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          const px = Math.round(centerX) + offsetX;
          const py = Math.round(centerY) + offsetY;
          if (px < 0 || py < 0 || px >= tileSize || py >= tileSize) continue;
          const distance = Math.hypot(
            px - centerX,
            py - centerY,
          );
          const falloff = 1 - smoothstep(width * 0.35, width, distance);
          if (falloff <= 0) continue;
          const value = falloff * strength * taper;
          const target = py * tileSize + px;
          if (value > mask[target]!) mask[target] = value;
        }
      }
    }
  }
  return mask;
}

interface SurfaceSample {
  readonly height: number;
  readonly rust: number;
  readonly bare: number;
  readonly dust: number;
}

function sampleSurface(
  x: number,
  y: number,
  seed: number,
  finish: AtlasFinish,
  scratch: number,
): SurfaceSample {
  const grain = finish.grain;
  // Tres escalas: grano de chapa, manchas de humedad y chorreado vertical.
  const grime = fbm(x * 0.055 * grain, y * 0.055 * grain, seed, 4);
  const blotch = fbm(x * 0.013, y * 0.013, seed ^ 0x9e3779b9, 3);
  const streak = fbm(x * 0.075, y * 0.006, seed ^ 0x25455eeb, 3);

  const rust = clamp01((blotch * 0.85 + grime * 0.35 - 0.6) * 3.4) * finish.wear;
  // Pintura saltada: el borde del pico de ruido, no el pico entero.
  const chip = smoothstep(0.68, 0.82, grime) * finish.wear * 0.8;
  const bare = clamp01(Math.max(scratch, chip));
  const dust = clamp01(streak * 0.9 + blotch * 0.25 - 0.32) * 0.6;
  const height =
    grime * 0.55 +
    blotch * 0.3 +
    rust * 0.22 -
    chip * 0.5 -
    scratch * 0.85;
  return { height, rust, bare, dust };
}

async function encodeWebp(
  data: Uint8Array,
  quality: number,
  atlasSize: number,
): Promise<Uint8Array> {
  const result = await sharp(data, {
    raw: {
      width: atlasSize,
      height: atlasSize,
      channels: CHANNELS,
    },
  })
    .webp({
      quality,
      effort: 6,
      // Los tres mapas guardan datos por canal, no color: submuestrear croma
      // mezclaría rugosidad con metalicidad y torcería las normales.
      smartSubsample: false,
    })
    .toBuffer();
  return new Uint8Array(result);
}

export interface AtlasOptions {
  /**
   * Lado del atlas en píxeles. Los rayones se rasterizan en píxeles absolutos,
   * así que a 512 salen proporcionalmente el doble de gruesos: es el tamaño
   * adecuado para props chicos, no una versión reducida del de 1024.
   */
  readonly atlasSize?: number;
}

export async function createPbrAtlases(
  spec: AtlasSpec,
  options: AtlasOptions = {},
): Promise<GeneratedTextureSet> {
  const atlasSize = options.atlasSize ?? DEFAULT_ATLAS_SIZE;
  const tileSize = atlasSize / 2;
  const albedo = new Uint8Array(atlasSize * atlasSize * CHANNELS);
  const normal = new Uint8Array(atlasSize * atlasSize * CHANNELS);
  const pbr = new Uint8Array(atlasSize * atlasSize * CHANNELS);
  const height = new Float32Array(atlasSize * atlasSize);
  const grimeColor = spec.grimeColor ?? DUST_COLOR;

  for (let tile = 0; tile < 4; tile += 1) {
    const finish = spec.finishes[tile]!;
    const originX = (tile % 2) * tileSize;
    const originY = tile >= 2 ? tileSize : 0;
    const seed = spec.seed + tile * 7919;
    const scratchMask = createScratchMask(
      seed ^ 0x5bf03635,
      Math.round(8 + finish.wear * 44),
      tileSize,
    );

    for (let y = 0; y < tileSize; y += 1) {
      for (let x = 0; x < tileSize; x += 1) {
        const scratch = scratchMask[y * tileSize + x]!;
        const surface = sampleSurface(x, y, seed, finish, scratch);
        const atlasIndex = (originY + y) * atlasSize + originX + x;
        height[atlasIndex] = surface.height;

        // Luz de micro-relieve: lo alto agarra luz, lo hundido la pierde.
        const light = 0.82 + surface.height * 0.34;
        let red = finish.color[0] * light;
        let green = finish.color[1] * light;
        let blue = finish.color[2] * light;
        red = lerp(red, RUST_COLOR[0], surface.rust);
        green = lerp(green, RUST_COLOR[1], surface.rust);
        blue = lerp(blue, RUST_COLOR[2], surface.rust);
        red = lerp(red, BARE_METAL_COLOR[0], surface.bare * 0.82);
        green = lerp(green, BARE_METAL_COLOR[1], surface.bare * 0.82);
        blue = lerp(blue, BARE_METAL_COLOR[2], surface.bare * 0.82);
        red = lerp(red, grimeColor[0], surface.dust);
        green = lerp(green, grimeColor[1], surface.dust);
        blue = lerp(blue, grimeColor[2], surface.dust);

        const pixel = atlasIndex * CHANNELS;
        albedo[pixel] = clampByte(red);
        albedo[pixel + 1] = clampByte(green);
        albedo[pixel + 2] = clampByte(blue);
        albedo[pixel + 3] = 255;

        const occlusion =
          1 - surface.dust * 0.22 - clamp01(-surface.height * 0.9) * 0.3;
        const roughness =
          finish.roughness +
          surface.rust * 0.16 +
          surface.dust * 0.1 -
          surface.bare * 0.26;
        // El óxido no conduce; el rayón destapa metal aunque la pieza sea pintada.
        const metallic =
          finish.metallic * (1 - surface.rust * 0.65) +
          surface.bare * (1 - finish.metallic) * 0.7;
        pbr[pixel] = clampByte(occlusion * 255);
        pbr[pixel + 1] = clampByte(clamp01(roughness) * 255);
        pbr[pixel + 2] = clampByte(clamp01(metallic) * 255);
        pbr[pixel + 3] = 255;
      }
    }
  }

  // Normales por diferencias centrales, sin cruzar el borde de casilla: mezclar
  // dos acabados en el borde deja una costura visible al muestrear con mipmaps.
  for (let tile = 0; tile < 4; tile += 1) {
    const originX = (tile % 2) * tileSize;
    const originY = tile >= 2 ? tileSize : 0;
    const strength = 3.4 * spec.finishes[tile]!.grain;
    for (let y = 0; y < tileSize; y += 1) {
      for (let x = 0; x < tileSize; x += 1) {
        const left = Math.max(0, x - 1);
        const right = Math.min(tileSize - 1, x + 1);
        const up = Math.max(0, y - 1);
        const down = Math.min(tileSize - 1, y + 1);
        const row = (originY + y) * atlasSize + originX;
        const dx =
          height[row + right]! - height[row + left]!;
        const dy =
          height[(originY + down) * atlasSize + originX + x]! -
          height[(originY + up) * atlasSize + originX + x]!;
        const nx = -dx * strength;
        const ny = -dy * strength;
        const inverseLength = 1 / Math.hypot(nx, ny, 1);
        const pixel = ((originY + y) * atlasSize + originX + x) * CHANNELS;
        normal[pixel] = clampByte((nx * inverseLength * 0.5 + 0.5) * 255);
        normal[pixel + 1] = clampByte((ny * inverseLength * 0.5 + 0.5) * 255);
        normal[pixel + 2] = clampByte(inverseLength * 255);
        normal[pixel + 3] = 255;
      }
    }
  }

  const [encodedAlbedo, encodedNormal, encodedPbr] = await Promise.all([
    encodeWebp(albedo, 92, atlasSize),
    // El normal map guarda una dirección: sin pérdida pesa veinte veces más que
    // los otros dos juntos, y a 96 el error por canal queda por debajo de lo que
    // el `normalScale` del material alcanza a mostrar.
    encodeWebp(normal, 96, atlasSize),
    encodeWebp(pbr, 92, atlasSize),
  ]);

  return {
    albedo: encodedAlbedo,
    normal: encodedNormal,
    pbr: encodedPbr,
  };
}
