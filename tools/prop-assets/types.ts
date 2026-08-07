import type { AtlasFinish, LodStats } from "../shared/gltf/types.js";

export type { AtlasFinish, AtlasTile, Euler, GeometryPart, Vec3 } from "../shared/gltf/types.js";

/**
 * Los props se agrupan en tres packs para compartir atlas. Cada pack es un GLB
 * con todos sus arquetipos colgando de la escena: tres fetches en vez de doce, y
 * un solo material por pack en vez de uno por prop.
 */
export type PropPackId = "propsWood" | "propsMetal" | "propsSynthetic";

export type PropAssetId =
  | "woodenCrate"
  | "metalBarrel"
  | "explosiveBarrel"
  | "plasticDrum"
  | "pallet"
  | "filingCabinet"
  | "radiator"
  | "chair"
  | "table"
  | "crtTelevision"
  | "glassBottle"
  | "trafficCone"
  | "concreteBlock";

export interface PropAssetSpec {
  readonly id: PropAssetId;
  readonly displayName: string;
  /**
   * Variantes de malla. Cambian qué piezas hay y dónde van por dentro, nunca el
   * envolvente: todas comparten un único casco de colisión y un único `bounds`.
   */
  readonly variants: number;
  /**
   * Extensiones completas. El validador las compara contra la malla real con
   * tolerancia de 1 cm, y un contract test las compara contra `props.config.ts`:
   * si estos tres números se separan, el prop flota o se hunde.
   */
  readonly bounds: readonly [number, number, number];
  /** Chunks del set de gibs. 0 = indestructible, sin nodo `chunks`. */
  readonly chunks: number;
  /** El vidrio va en su propio material translúcido. */
  readonly hasGlass?: boolean;
}

export interface PropPackSpec {
  readonly id: PropPackId;
  readonly displayName: string;
  readonly seed: number;
  /** Lado del atlas. 512 alcanza para props chicos y pesa un cuarto que 1024. */
  readonly atlasSize: number;
  readonly finishes: readonly [AtlasFinish, AtlasFinish, AtlasFinish, AtlasFinish];
  readonly grimeColor?: readonly [number, number, number];
  readonly maxGlbBytes: number;
  readonly maxTrianglesLod0: number;
  readonly maxDrawsPerLod: number;
  readonly props: readonly PropAssetSpec[];
}

export interface GeneratedPropStats {
  readonly id: PropAssetId;
  readonly pack: PropPackId;
  /** Extensiones reales de la malla, para que la config del juego las copie. */
  readonly bounds: readonly [number, number, number];
  readonly lods: readonly [LodStats, LodStats];
  readonly colliderNodes: number;
  readonly colliderVertices: number;
  readonly chunkNodes: number;
  readonly variants: number;
}

export interface GeneratedPackStats {
  readonly id: PropPackId;
  readonly glbBytes: number;
  readonly props: readonly GeneratedPropStats[];
  readonly nodeNames: readonly string[];
}

export interface PropAssetManifest {
  readonly schemaVersion: 1;
  readonly generator: "vibe-life3-procedural-props";
  readonly coordinateSystem: {
    readonly units: "meters";
    readonly up: "+Y";
    /** El origen del prop es el CENTRO de su AABB, no la base. */
    readonly origin: "aabb-center";
  };
  readonly generatedAt: "deterministic";
  readonly packs: readonly GeneratedPackStats[];
}

/** Tope de vértices por casco: un hull de 200 puntos lo mastica Rapier cada frame. */
export const MAX_COLLIDER_VERTICES = 48;

const WOOD_FINISHES: readonly [AtlasFinish, AtlasFinish, AtlasFinish, AtlasFinish] = [
  // 0 pino claro de cajón, 1 madera oscura de mueble, 2 herraje, 3 cartón/etiqueta.
  { color: [176, 142, 96], roughness: 0.86, metallic: 0.01, wear: 0.55, grain: 2.6 },
  { color: [112, 82, 56], roughness: 0.8, metallic: 0.02, wear: 0.4, grain: 2.2 },
  { color: [126, 124, 118], roughness: 0.62, metallic: 0.85, wear: 0.7, grain: 1.4 },
  { color: [166, 138, 100], roughness: 0.95, metallic: 0, wear: 0.35, grain: 3.4 },
];

const METAL_FINISHES: readonly [AtlasFinish, AtlasFinish, AtlasFinish, AtlasFinish] = [
  // 0 chapa pintada, 1 acero oxidado, 2 hormigón, 3 acero desnudo.
  { color: [92, 106, 112], roughness: 0.58, metallic: 0.75, wear: 0.62, grain: 1.5 },
  { color: [124, 78, 50], roughness: 0.88, metallic: 0.45, wear: 0.9, grain: 2.1 },
  { color: [158, 156, 150], roughness: 0.94, metallic: 0.02, wear: 0.5, grain: 3.2 },
  { color: [148, 150, 152], roughness: 0.44, metallic: 0.95, wear: 0.35, grain: 1.2 },
];

const SYNTHETIC_FINISHES: readonly [AtlasFinish, AtlasFinish, AtlasFinish, AtlasFinish] = [
  // 0 plástico naranja, 1 plástico gris sucio, 2 goma, 3 pantalla/carcasa oscura.
  { color: [196, 106, 42], roughness: 0.52, metallic: 0.02, wear: 0.45, grain: 2.8 },
  { color: [148, 148, 142], roughness: 0.6, metallic: 0.02, wear: 0.5, grain: 2.4 },
  { color: [46, 44, 44], roughness: 0.82, metallic: 0.01, wear: 0.3, grain: 3.6 },
  { color: [64, 66, 70], roughness: 0.46, metallic: 0.08, wear: 0.35, grain: 2 },
];

export const PROP_PACK_SPECS: readonly PropPackSpec[] = [
  {
    id: "propsWood",
    displayName: "Props de madera",
    seed: 20260807,
    atlasSize: 512,
    finishes: WOOD_FINISHES,
    grimeColor: [78, 66, 48],
    maxGlbBytes: 700 * 1024,
    maxTrianglesLod0: 3500,
    maxDrawsPerLod: 3,
    props: [
      { id: "woodenCrate", displayName: "Cajón de madera", variants: 3, bounds: [0.887, 0.86, 0.887], chunks: 8 },
      { id: "pallet", displayName: "Pallet", variants: 2, bounds: [1.2, 0.141, 0.8], chunks: 8 },
      { id: "chair", displayName: "Silla", variants: 2, bounds: [0.42, 0.92, 0.44], chunks: 7 },
      { id: "table", displayName: "Mesa", variants: 2, bounds: [1.4, 0.74, 0.8], chunks: 7 },
    ],
  },
  {
    id: "propsMetal",
    displayName: "Props de metal",
    seed: 20260808,
    atlasSize: 512,
    finishes: METAL_FINISHES,
    grimeColor: [70, 62, 54],
    maxGlbBytes: 700 * 1024,
    maxTrianglesLod0: 3500,
    maxDrawsPerLod: 3,
    props: [
      { id: "metalBarrel", displayName: "Barril metálico", variants: 2, bounds: [0.585, 0.962, 0.585], chunks: 7 },
      { id: "explosiveBarrel", displayName: "Barril explosivo", variants: 2, bounds: [0.588, 1.074, 0.588], chunks: 7 },
      { id: "filingCabinet", displayName: "Archivero", variants: 2, bounds: [0.5, 1.32, 0.655], chunks: 5 },
      { id: "radiator", displayName: "Radiador", variants: 1, bounds: [0.915, 0.597, 0.14], chunks: 6 },
      { id: "concreteBlock", displayName: "Bloque de hormigón", variants: 3, bounds: [0.4, 0.2, 0.2], chunks: 0 },
    ],
  },
  {
    id: "propsSynthetic",
    displayName: "Props sintéticos",
    seed: 20260809,
    atlasSize: 512,
    finishes: SYNTHETIC_FINISHES,
    grimeColor: [64, 60, 56],
    maxGlbBytes: 700 * 1024,
    maxTrianglesLod0: 3500,
    maxDrawsPerLod: 3,
    props: [
      { id: "plasticDrum", displayName: "Bidón plástico", variants: 2, bounds: [0.609, 0.89, 0.618], chunks: 7 },
      { id: "crtTelevision", displayName: "Televisor", variants: 2, bounds: [0.52, 0.44, 0.492], chunks: 8, hasGlass: true },
      { id: "glassBottle", displayName: "Botella", variants: 3, bounds: [0.075, 0.29, 0.075], chunks: 8, hasGlass: true },
      { id: "trafficCone", displayName: "Cono de tránsito", variants: 1, bounds: [0.36, 0.72, 0.36], chunks: 0 },
    ],
  },
];
