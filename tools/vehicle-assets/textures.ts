import sharp from "sharp";

import type { GeneratedTextureSet, VehicleAssetSpec } from "./types.js";

const ATLAS_SIZE = 512;
const CHANNELS = 4;

function hash2d(x: number, y: number, seed: number): number {
  let value = Math.imul(x + 0x9e3779b9, 0x85ebca6b);
  value ^= Math.imul(y + 0xc2b2ae35, 0x27d4eb2f);
  value ^= seed;
  value = Math.imul(value ^ (value >>> 15), 0x2c1b3c6d);
  value = Math.imul(value ^ (value >>> 12), 0x297a2d39);
  return (value ^ (value >>> 15)) >>> 0;
}

function signedNoise(x: number, y: number, seed: number): number {
  return (hash2d(x, y, seed) / 0xffffffff) * 2 - 1;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function tileIndex(x: number, y: number): 0 | 1 | 2 | 3 {
  return ((x >= ATLAS_SIZE / 2 ? 1 : 0) + (y >= ATLAS_SIZE / 2 ? 2 : 0)) as
    | 0
    | 1
    | 2
    | 3;
}

function weatherHeight(x: number, y: number, seed: number): number {
  const coarse = signedNoise(x >> 3, y >> 3, seed);
  const fine = signedNoise(x, y, seed ^ 0x6a09e667);
  const diagonalScratch = (x * 3 + y * 5 + (seed & 127)) % 173;
  const verticalScratch = (x + (seed >>> 9)) % 211;
  const scratch =
    diagonalScratch <= 1 || (verticalScratch === 0 && (y + seed) % 7 < 4)
      ? -0.8
      : 0;
  return coarse * 0.38 + fine * 0.1 + scratch;
}

async function encodeWebp(data: Uint8Array): Promise<Uint8Array> {
  const result = await sharp(data, {
    raw: {
      width: ATLAS_SIZE,
      height: ATLAS_SIZE,
      channels: CHANNELS,
    },
  })
    .webp({
      lossless: true,
      effort: 6,
      smartSubsample: false,
    })
    .toBuffer();
  return new Uint8Array(result);
}

export async function createPbrAtlases(
  spec: VehicleAssetSpec,
): Promise<GeneratedTextureSet> {
  const albedo = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * CHANNELS);
  const normal = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * CHANNELS);
  const pbr = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * CHANNELS);

  for (let y = 0; y < ATLAS_SIZE; y += 1) {
    for (let x = 0; x < ATLAS_SIZE; x += 1) {
      const pixel = (y * ATLAS_SIZE + x) * CHANNELS;
      const tile = tileIndex(x, y);
      const base = spec.colors[tile];
      const height = weatherHeight(x, y, spec.seed + tile * 101);
      const edgeWear =
        Math.min(x % 256, y % 256, 255 - (x % 256), 255 - (y % 256)) < 4
          ? 0.3
          : 0;
      const rust =
        hash2d(x >> 2, y >> 2, spec.seed ^ 0xa54ff53a) % 97 === 0 ? 0.45 : 0;
      const light = 1 + height * 0.08 + edgeWear * 0.2;

      albedo[pixel] = clampByte(base[0] * light + rust * 38);
      albedo[pixel + 1] = clampByte(base[1] * light - rust * 14);
      albedo[pixel + 2] = clampByte(base[2] * light - rust * 18);
      albedo[pixel + 3] = 255;

      const dx =
        weatherHeight(x + 1, y, spec.seed + tile * 101) -
        weatherHeight(x - 1, y, spec.seed + tile * 101);
      const dy =
        weatherHeight(x, y + 1, spec.seed + tile * 101) -
        weatherHeight(x, y - 1, spec.seed + tile * 101);
      const invLength = 1 / Math.hypot(dx * 0.2, dy * 0.2, 1);
      normal[pixel] = clampByte((dx * -0.2 * invLength * 0.5 + 0.5) * 255);
      normal[pixel + 1] = clampByte((dy * -0.2 * invLength * 0.5 + 0.5) * 255);
      normal[pixel + 2] = clampByte(invLength * 255);
      normal[pixel + 3] = 255;

      const isDarkHardware = tile === 2 || tile === 3;
      const ambientOcclusion = 230 - Math.abs(height) * 18;
      const roughness =
        (isDarkHardware ? 0.72 : 0.84) + height * 0.08 + rust * 0.12;
      const metallic = tile === 2 ? 0.72 : tile === 3 ? 0.35 : 0.08;
      pbr[pixel] = clampByte(ambientOcclusion);
      pbr[pixel + 1] = clampByte(roughness * 255);
      pbr[pixel + 2] = clampByte(metallic * 255);
      pbr[pixel + 3] = 255;
    }
  }

  const [encodedAlbedo, encodedNormal, encodedPbr] = await Promise.all([
    encodeWebp(albedo),
    encodeWebp(normal),
    encodeWebp(pbr),
  ]);

  return {
    albedo: encodedAlbedo,
    normal: encodedNormal,
    pbr: encodedPbr,
  };
}
