import { MeshStandardMaterial, Vector2, type MeshStandardMaterialParameters } from 'three';
import {
  getTextureSet,
  TextureSets,
  type TextureSetDefinition,
  type TextureSetId,
} from './Textures';

export type MaterialKey =
  | 'floor'
  | 'asphalt'
  | 'wall'
  | 'trim'
  | 'crate'
  | 'dynamic'
  | 'door'
  | 'button'
  | 'npc'
  | 'npcDead'
  | 'hazard'
  | 'snow'
  | 'rock'
  | 'grass'
  | 'sand'
  | 'brick'
  | 'roof'
  | 'plaster'
  | 'concrete'
  | 'woodDark'
  | 'metalRusted'
  | 'lightWarm'
  | 'signalBlue'
  | 'signalRed';

interface CommonMaterialDef {
  /**
   * Renderiza el material levemente "al frente" (polygon offset) para ganar el
   * z-fight contra superficies coplanares. Para trim decorativo embebido en la
   * pared/techo (sills, bandas, cornisa, zócalo): caras exactamente coplanares
   * que ni el depth buffer logarítmico separa.
   */
  polygonOffset?: boolean;
  /** Emisión uniforme que se conserva incluso cuando el material usa albedo. */
  emissive?: number;
  emissiveIntensity?: number;
}

interface ColorMaterialDef extends CommonMaterialDef {
  color: number;
  roughness?: number;
  metalness?: number;
}

interface PbrMaterialDef extends CommonMaterialDef {
  textureSet: TextureSetId;
  /** Tint multiplicado sobre el albedo. Default 0xffffff (sin tint). */
  color?: number;
  /** Override de roughness. Si no, hereda del set. */
  roughness?: number;
  /** Override de metalness. Si no, hereda del set. */
  metalness?: number;
  /** Usa el mismo albedo para conservar detalle dentro de la emisión. */
  emissiveFromAlbedo?: boolean;
}

type MaterialDef = ColorMaterialDef | PbrMaterialDef;

function isPbr(def: MaterialDef): def is PbrMaterialDef {
  return 'textureSet' in def;
}

const definitions: Record<MaterialKey, MaterialDef> = {
  floor: { textureSet: 'weatheredConcrete', color: 0x66727a, roughness: 0.9, metalness: 0.02 },
  asphalt: { textureSet: 'cityAsphalt', color: 0x9aa0a2, roughness: 0.94, metalness: 0 },
  wall: { textureSet: 'industrialWall', color: 0x87969c, roughness: 0.86, metalness: 0.06 },
  trim: { textureSet: 'paintedMetal', color: 0x8fa6b0, roughness: 0.6, polygonOffset: true },
  crate: { textureSet: 'crateWood', color: 0xe0d7c9, roughness: 0.86, metalness: 0.01 },
  dynamic: { textureSet: 'paintedMetal', color: 0xb2c0c5, roughness: 0.68 },
  door: { textureSet: 'paintedMetal', color: 0x75868e, roughness: 0.62 },
  button: {
    textureSet: 'controlPanel',
    color: 0x54d4df,
    emissive: 0x07343a,
    emissiveFromAlbedo: true,
    roughness: 0.4,
  },
  npc: { color: 0xd76157, roughness: 0.75, metalness: 0.05 },
  npcDead: { color: 0x34383c, roughness: 0.95, metalness: 0.05 },
  hazard: { textureSet: 'hazardStripes', color: 0xffffff, roughness: 0.66 },
  snow: { textureSet: 'snow' },
  rock: { textureSet: 'rock' },
  grass: { textureSet: 'grass' },
  sand: { textureSet: 'sand' },
  brick: { textureSet: 'brickFactory' },
  roof: { textureSet: 'roofClay' },
  plaster: { textureSet: 'agedPlaster', color: 0xf0eadf, roughness: 0.94, metalness: 0.01 },
  concrete: { textureSet: 'weatheredConcrete', color: 0xb5b6b3, roughness: 0.9, metalness: 0.02 },
  woodDark: { textureSet: 'darkWoodPlanks', color: 0x806a56, roughness: 0.84, metalness: 0.01 },
  metalRusted: { textureSet: 'rustedMetal', color: 0xd2c7bc, roughness: 0.86 },
  lightWarm: { color: 0xffd7a1, emissive: 0x8a4b18, roughness: 0.32, polygonOffset: true },
  signalBlue: { color: 0x3f8fa8, emissive: 0x0d3440, roughness: 0.4, metalness: 0.18, polygonOffset: true },
  signalRed: { color: 0xc64b3c, emissive: 0x46100c, roughness: 0.42, metalness: 0.12, polygonOffset: true },
};

function buildMaterial(def: MaterialDef): MeshStandardMaterial {
  const material = isPbr(def) ? buildPbrMaterial(def) : new MeshStandardMaterial({
    color: def.color,
    roughness: def.roughness ?? 1,
    metalness: def.metalness ?? 0,
    emissive: def.emissive ?? 0x000000,
    emissiveIntensity: def.emissiveIntensity ?? 1,
  });
  if (def.polygonOffset) {
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -1;
  }
  return material;
}

function buildPbrMaterial(def: PbrMaterialDef): MeshStandardMaterial {
  const set = getTextureSet(def.textureSet);
  const params: MeshStandardMaterialParameters = {
    map: set.albedo,
    color: def.color ?? 0xffffff,
    roughness: def.roughness ?? set.definition.roughness ?? 1,
    metalness: def.metalness ?? set.definition.metalness ?? 0,
    emissive: def.emissive ?? 0x000000,
    emissiveIntensity: def.emissiveIntensity ?? 1,
  };
  if (set.normal) {
    params.normalMap = set.normal;
    const ns = set.definition.normalScale ?? 1;
    params.normalScale = new Vector2(ns, ns);
  }
  if (set.roughness) params.roughnessMap = set.roughness;
  if (set.metallic) params.metalnessMap = set.metallic;
  if (def.emissiveFromAlbedo) params.emissiveMap = set.albedo;
  if (set.ao) {
    params.aoMap = set.ao;
    params.aoMapIntensity = set.definition.aoIntensity ?? 1;
  }
  return new MeshStandardMaterial(params);
}

// Lazy: evita decodificar todos los albedos/PBR al importar el módulo. En mapas
// grandes sólo se cargan las familias de material realmente usadas.
const materials = new Map<MaterialKey, MeshStandardMaterial>();

export function getMaterial(key: MaterialKey): MeshStandardMaterial {
  let material = materials.get(key);
  if (!material) {
    material = buildMaterial(definitions[key]);
    materials.set(key, material);
  }
  return material.clone();
}

/**
 * Indica si el material necesita el atributo `uv1` en la geometría
 * (Three.js usa el segundo canal de UV para `aoMap`). Los factories de
 * meshes lo usan para copiar `uv` → `uv1` antes de asignar el material.
 */
export function materialNeedsUv1(key: MaterialKey): boolean {
  const def = definitions[key];
  if (!isPbr(def)) return false;
  const textureDef: TextureSetDefinition = TextureSets[def.textureSet];
  return Boolean(textureDef.maps.ao);
}

/**
 * Preescala UV por metro. El `Texture.repeat` del set aplica después `tiling`,
 * por eso se compensa aquí para que el tamaño final sea exactamente `tileSize`.
 */
export function materialUvPreScale(key: MaterialKey): number | null {
  const def = definitions[key];
  if (!isPbr(def)) return null;
  const textureDef: TextureSetDefinition = TextureSets[def.textureSet];
  return textureDef.tileSize && textureDef.tileSize > 0
    ? 1 / (textureDef.tileSize * textureDef.tiling)
    : null;
}
