/// <reference types="vite/client" />
import { DataTexture, EquirectangularReflectionMapping } from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

const hdriUrls = import.meta.glob('../../assets/hdri/**/*.hdr', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function resolveUrl(relative: string): string | null {
  const key = `../../assets/hdri/${relative}`;
  return hdriUrls[key] ?? null;
}

export interface SkyboxDefinition {
  /** Ruta relativa a `src/engine/assets/hdri/`. */
  file: string;
}

export const SkyboxManifest = {
  default: { file: 'default.hdr' },
} as const satisfies Record<string, SkyboxDefinition>;

export type SkyboxId = keyof typeof SkyboxManifest;

const loader = new RGBELoader();
const cache = new Map<SkyboxId, Promise<DataTexture>>();

/**
 * Carga (o devuelve cacheado) un HDRI equirectangular como `DataTexture`.
 * Retorna `null` si el archivo no existe en `src/engine/assets/hdri/` — el
 * caller decide el fallback. La textura ya viene con `EquirectangularReflectionMapping`
 * para que sirva tanto de background como de input al PMREM.
 */
export async function getSkyboxHdr(id: SkyboxId): Promise<DataTexture | null> {
  const cached = cache.get(id);
  if (cached) return cached;
  const def: SkyboxDefinition = SkyboxManifest[id];
  const url = resolveUrl(def.file);
  if (!url) {
    console.warn(`[Skybox] HDRI file missing: src/engine/assets/hdri/${def.file}`);
    return null;
  }
  const promise = new Promise<DataTexture>((resolve, reject) => {
    loader.load(url, (texture) => {
      texture.mapping = EquirectangularReflectionMapping;
      resolve(texture);
    }, undefined, reject);
  });
  cache.set(id, promise);
  return promise;
}
