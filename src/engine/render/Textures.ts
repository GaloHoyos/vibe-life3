import { RepeatWrapping, SRGBColorSpace, Texture, TextureLoader } from 'three';

const snowMedUrl = new URL('../assets/textures/environment/snow-med.jpg', import.meta.url).href;

export type TextureId = keyof typeof TextureManifest;

export const TextureManifest = {
  snowMed: { url: snowMedUrl, tiling: 32 },
} as const satisfies Record<string, { url: string; tiling: number }>;

const loader = new TextureLoader();
const cache = new Map<TextureId, Texture>();

/**
 * Devuelve un `Texture` para el id dado. La carga es asíncrona pero la
 * referencia se devuelve sincrónicamente — Three.js completa la imagen
 * en background y la próxima vez que renderee aparece. Configura colorSpace
 * sRGB, repeat-wrapping y anisotropy 4 por default. Cachea por id.
 */
export function getTexture(id: TextureId): Texture {
  const cached = cache.get(id);
  if (cached) return cached;
  const entry = TextureManifest[id];
  const texture = loader.load(entry.url);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 4;
  texture.repeat.set(entry.tiling, entry.tiling);
  cache.set(id, texture);
  return texture;
}
