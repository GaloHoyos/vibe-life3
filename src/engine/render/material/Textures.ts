/// <reference types="vite/client" />
import { NoColorSpace, RepeatWrapping, SRGBColorSpace, Texture, TextureLoader } from 'three';

const textureUrls = import.meta.glob('../../assets/textures/**/*.{jpg,jpeg,png,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function resolveUrl(relative: string): string {
  const key = `../../assets/textures/${relative}`;
  const url = textureUrls[key];
  if (!url) {
    throw new Error(`Texture not found: ${relative} (looked up "${key}")`);
  }
  return url;
}

export interface TextureSetDefinition {
  /** Rutas relativas a `src/engine/assets/textures/`. Solo `albedo` es obligatorio. */
  maps: {
    albedo: string;
    normal?: string;
    roughness?: string;
    ao?: string;
    metallic?: string;
  };
  /** Repeticiones por eje (mismo valor U y V). */
  tiling: number;
  /** Tamaño físico de una repetición. Si se omite, conserva el UV histórico. */
  tileSize?: number;
  /** Intensidad del normal map. 1 = neutral, >1 acentúa, <1 suaviza. */
  normalScale?: number;
  /** Multiplicador de roughness combinado con el mapa. */
  roughness?: number;
  /** Multiplicador de metalness combinado con el mapa. */
  metalness?: number;
  /** 0-1, cuánto oscurece el ambient occlusion. */
  aoIntensity?: number;
}

export const TextureSets = {
  cityAsphalt: {
    maps: {
      albedo: 'environment/city_asphalt/albedo.png',
    },
    tiling: 12,
    tileSize: 2,
    roughness: 0.94,
    metalness: 0,
  },
  weatheredConcrete: {
    maps: {
      albedo: 'architecture/concrete_floor/albedo.png',
    },
    tiling: 4,
    tileSize: 2,
    roughness: 0.9,
    metalness: 0.02,
  },
  industrialWall: {
    maps: {
      albedo: 'architecture/industrial_wall/albedo.png',
    },
    tiling: 3,
    tileSize: 2,
    roughness: 0.86,
    metalness: 0.06,
  },
  agedPlaster: {
    maps: {
      albedo: 'architecture/aged_plaster/albedo.png',
    },
    tiling: 3,
    tileSize: 2,
    roughness: 0.94,
    metalness: 0.01,
  },
  paintedMetal: {
    maps: {
      albedo: 'architecture/metal_panel/albedo.png',
    },
    tiling: 3,
    tileSize: 2,
    roughness: 0.64,
    metalness: 0.08,
  },
  rustedMetal: {
    maps: {
      albedo: 'architecture/rusted_metal/albedo.png',
    },
    tiling: 3,
    tileSize: 2,
    roughness: 0.86,
    metalness: 0.06,
  },
  darkWoodPlanks: {
    maps: {
      albedo: 'architecture/wood_planks/albedo.png',
    },
    tiling: 2,
    tileSize: 2,
    roughness: 0.84,
    metalness: 0.01,
  },
  crateWood: {
    maps: {
      albedo: 'props/crate_wood/albedo.png',
    },
    tiling: 2,
    tileSize: 1,
    roughness: 0.86,
    metalness: 0.01,
  },
  controlPanel: {
    maps: {
      albedo: 'props/control_panel/albedo.png',
    },
    tiling: 1,
    tileSize: 1,
    roughness: 0.42,
    metalness: 0.1,
  },
  hazardStripes: {
    maps: {
      albedo: 'props/hazard_stripes/albedo.png',
    },
    tiling: 2,
    tileSize: 2,
    roughness: 0.66,
    metalness: 0.08,
  },
  snow: {
    maps: {
      albedo: 'environment/snow/albedo.jpg',
      normal: 'environment/snow/normal.jpg',
      roughness: 'environment/snow/roughness.jpg',
      ao: 'environment/snow/ao.jpg',
    },
    tiling: 32,
  },
  rock: {
    maps: {
      albedo: 'environment/rock/albedo.jpg',
      normal: 'environment/rock/normal.jpg',
      roughness: 'environment/rock/roughness.jpg',
      ao: 'environment/rock/ao.jpg',
    },
    tiling: 16,
  },
  grass: {
    maps: {
      albedo: 'environment/grass/albedo.jpg',
      normal: 'environment/grass/normal.jpg',
      roughness: 'environment/grass/roughness.jpg',
      ao: 'environment/grass/ao.jpg',
    },
    tiling: 24,
  },
  sand: {
    maps: {
      albedo: 'environment/sand/albedo.jpg',
      normal: 'environment/sand/normal.jpg',
      roughness: 'environment/sand/roughness.jpg',
      ao: 'environment/sand/ao.jpg',
    },
    tiling: 24,
  },
  brickFactory: {
    maps: {
      albedo: 'architecture/brick_factory/albedo.jpg',
      normal: 'architecture/brick_factory/normal.jpg',
      roughness: 'architecture/brick_factory/roughness.jpg',
      ao: 'architecture/brick_factory/ao.jpg',
    },
    tiling: 2,
  },
  roofClay: {
    maps: {
      albedo: 'architecture/roof_clay/albedo.jpg',
      normal: 'architecture/roof_clay/normal.jpg',
      roughness: 'architecture/roof_clay/roughness.jpg',
      ao: 'architecture/roof_clay/ao.jpg',
    },
    tiling: 2,
  },
} as const satisfies Record<string, TextureSetDefinition>;

export type TextureSetId = keyof typeof TextureSets;

export interface LoadedTextureSet {
  albedo: Texture;
  normal: Texture | null;
  roughness: Texture | null;
  ao: Texture | null;
  metallic: Texture | null;
  definition: TextureSetDefinition;
}

const loader = new TextureLoader();
const cache = new Map<TextureSetId, LoadedTextureSet>();

function loadMap(relative: string, isColor: boolean, tiling: number): Texture {
  const tex = loader.load(resolveUrl(relative));
  tex.colorSpace = isColor ? SRGBColorSpace : NoColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.anisotropy = 4;
  tex.repeat.set(tiling, tiling);
  return tex;
}

/**
 * Carga (o devuelve cacheado) un set PBR completo. Cada mapa se etiqueta
 * con el colorSpace correcto: sRGB para albedo, linear para el resto.
 * La carga es asíncrona pero las referencias se devuelven sincrónicamente.
 */
export function getTextureSet(id: TextureSetId): LoadedTextureSet {
  const cached = cache.get(id);
  if (cached) return cached;
  const def: TextureSetDefinition = TextureSets[id];
  const set: LoadedTextureSet = {
    albedo: loadMap(def.maps.albedo, true, def.tiling),
    normal: def.maps.normal ? loadMap(def.maps.normal, false, def.tiling) : null,
    roughness: def.maps.roughness ? loadMap(def.maps.roughness, false, def.tiling) : null,
    ao: def.maps.ao ? loadMap(def.maps.ao, false, def.tiling) : null,
    metallic: def.maps.metallic ? loadMap(def.maps.metallic, false, def.tiling) : null,
    definition: def,
  };
  cache.set(id, set);
  return set;
}
