import { MeshStandardMaterial, Vector2, type MeshStandardMaterialParameters } from 'three';
import { getTextureSet, type TextureSetId } from './Textures';

export type MaterialKey =
  | 'floor'
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
  | 'woodDark';

interface CommonMaterialDef {
  /**
   * Renderiza el material levemente "al frente" (polygon offset) para ganar el
   * z-fight contra superficies coplanares. Para trim decorativo embebido en la
   * pared/techo (sills, bandas, cornisa, zócalo): caras exactamente coplanares
   * que ni el depth buffer logarítmico separa.
   */
  polygonOffset?: boolean;
}

interface ColorMaterialDef extends CommonMaterialDef {
  color: number;
  roughness?: number;
  metalness?: number;
  emissive?: number;
}

interface PbrMaterialDef extends CommonMaterialDef {
  textureSet: TextureSetId;
  /** Tint multiplicado sobre el albedo. Default 0xffffff (sin tint). */
  color?: number;
  /** Override de roughness. Si no, hereda del set. */
  roughness?: number;
  /** Override de metalness. Si no, hereda del set. */
  metalness?: number;
}

type MaterialDef = ColorMaterialDef | PbrMaterialDef;

function isPbr(def: MaterialDef): def is PbrMaterialDef {
  return 'textureSet' in def;
}

const definitions: Record<MaterialKey, MaterialDef> = {
  floor: { color: 0x28323a, roughness: 0.9, metalness: 0.15 },
  wall: { color: 0x33424a, roughness: 0.82, metalness: 0.2 },
  trim: { color: 0x668899, roughness: 0.55, metalness: 0.3, polygonOffset: true },
  crate: { color: 0x56616a, roughness: 0.8, metalness: 0.1 },
  dynamic: { color: 0x9bb7c2, roughness: 0.65, metalness: 0.15 },
  door: { color: 0x40525d, roughness: 0.55, metalness: 0.45 },
  button: { color: 0x25c6da, emissive: 0x07343a, roughness: 0.35 },
  npc: { color: 0xd76157, roughness: 0.75, metalness: 0.05 },
  npcDead: { color: 0x34383c, roughness: 0.95, metalness: 0.05 },
  hazard: { color: 0xf2b84b, roughness: 0.6, metalness: 0.05 },
  snow: { textureSet: 'snow' },
  rock: { textureSet: 'rock' },
  grass: { textureSet: 'grass' },
  sand: { textureSet: 'sand' },
  brick: { textureSet: 'brickFactory' },
  roof: { textureSet: 'roofClay' },
  plaster: { color: 0xc9c0ad, roughness: 0.92, metalness: 0.02 },
  concrete: { color: 0x8e9296, roughness: 0.88, metalness: 0.05 },
  woodDark: { color: 0x57422e, roughness: 0.8, metalness: 0.02 },
};

function buildMaterial(def: MaterialDef): MeshStandardMaterial {
  const material = isPbr(def) ? buildPbrMaterial(def) : new MeshStandardMaterial({
    color: def.color,
    roughness: def.roughness ?? 1,
    metalness: def.metalness ?? 0,
    emissive: def.emissive ?? 0x000000,
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
  };
  if (set.normal) {
    params.normalMap = set.normal;
    const ns = set.definition.normalScale ?? 1;
    params.normalScale = new Vector2(ns, ns);
  }
  if (set.roughness) params.roughnessMap = set.roughness;
  if (set.metallic) params.metalnessMap = set.metallic;
  if (set.ao) {
    params.aoMap = set.ao;
    params.aoMapIntensity = set.definition.aoIntensity ?? 1;
  }
  return new MeshStandardMaterial(params);
}

const materials: Record<MaterialKey, MeshStandardMaterial> = Object.fromEntries(
  (Object.keys(definitions) as MaterialKey[]).map((key) => [key, buildMaterial(definitions[key])]),
) as Record<MaterialKey, MeshStandardMaterial>;

export function getMaterial(key: MaterialKey): MeshStandardMaterial {
  return materials[key].clone();
}

/**
 * Indica si el material necesita el atributo `uv1` en la geometría
 * (Three.js usa el segundo canal de UV para `aoMap`). Los factories de
 * meshes lo usan para copiar `uv` → `uv1` antes de asignar el material.
 */
export function materialNeedsUv1(key: MaterialKey): boolean {
  const def = definitions[key];
  return isPbr(def) && getTextureSet(def.textureSet).ao !== null;
}
