import type { AtlasFinish, LodStats } from "../shared/gltf/types.js";

export type { AtlasFinish, AtlasTile, Euler, GeometryPart, Vec3 } from "../shared/gltf/types.js";

/**
 * Los props se agrupan en tres packs para compartir atlas. Cada pack es un GLB
 * con todos sus arquetipos colgando de la escena: tres fetches en vez de doce, y
 * un solo material por pack en vez de uno por prop.
 */
export type PropPackId =
  | "propsWood"
  | "propsMetal"
  | "propsSynthetic"
  | "propsInterior"
  | "propsAppliance"
  | "propsDebris"
  | "propsTech"
  | "propsKit";

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
  | "concreteBlock"
  | "cardboardBox"
  | "milkCarton"
  | "woodPlank"
  | "metalBucket"
  | "paintCan"
  | "soupCan"
  | "trashBin"
  | "gasCan"
  | "propaneTank"
  | "concreteChunk"
  | "metalPipe"
  | "plasticBottle"
  | "glassJar"
  | "plasticCrate"
  | "tire"
  | "couch"
  | "armchair"
  | "mattress"
  | "bed"
  | "dresser"
  | "wardrobe"
  | "bookshelf"
  | "desk"
  | "nightstand"
  | "stool"
  | "bench"
  | "officeChair"
  | "fridge"
  | "washingMachine"
  | "stove"
  | "kitchenCounter"
  | "bathtub"
  | "toilet"
  | "sink"
  | "lockerBank"
  | "concreteSlab"
  | "brokenPillar"
  | "brickPile"
  | "rebarBundle"
  | "iBeam"
  | "metalPanel"
  | "scrapHeap"
  | "scaffoldPipe"
  | "plasterSlab"
  | "sandbag"
  | "barricadeWood"
  | "monitor"
  | "serverRack"
  | "harddrive"
  | "powerBox"
  | "keypad"
  | "radio"
  | "vendingMachine"
  | "waterCooler"
  | "labJar"
  | "partsBin"
  | "combineCrate"
  | "combineBarrier"
  | "combineEmitter"
  | "combineLamp"
  | "ladder"
  | "handrail"
  | "fenceSection"
  | "ammoCrate"
  | "medCrate"
  | "toolCart"
  | "wheelbarrow"
  | "shoppingCart"
  | "bicycle"
  | "streetSign"
  | "mailbox"
  | "flowerPot"
  | "crateLong"
  | "crateHuge";

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
  /** Color de las piezas que emiten. Un pack sin emisores no lo necesita. */
  readonly emissiveColor?: readonly [number, number, number];
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

const INTERIOR_FINISHES: readonly [AtlasFinish, AtlasFinish, AtlasFinish, AtlasFinish] = [
  // 0 tapizado gastado, 1 madera barnizada, 2 melamina clara, 3 herraje y patas.
  { color: [104, 96, 78], roughness: 0.95, metallic: 0, wear: 0.6, grain: 3.8 },
  { color: [96, 66, 42], roughness: 0.72, metallic: 0.02, wear: 0.45, grain: 2.4 },
  { color: [176, 166, 148], roughness: 0.78, metallic: 0.01, wear: 0.4, grain: 2.2 },
  { color: [118, 116, 112], roughness: 0.5, metallic: 0.88, wear: 0.55, grain: 1.3 },
];

const APPLIANCE_FINISHES: readonly [AtlasFinish, AtlasFinish, AtlasFinish, AtlasFinish] = [
  // 0 esmalte blanco sucio, 1 acero, 2 porcelana, 3 goma y plástico oscuro.
  { color: [198, 196, 186], roughness: 0.42, metallic: 0.12, wear: 0.55, grain: 1.8 },
  { color: [156, 158, 160], roughness: 0.38, metallic: 0.92, wear: 0.4, grain: 1.2 },
  { color: [212, 212, 206], roughness: 0.26, metallic: 0.02, wear: 0.3, grain: 1.4 },
  { color: [54, 54, 56], roughness: 0.74, metallic: 0.05, wear: 0.35, grain: 2.6 },
];

const DEBRIS_FINISHES: readonly [AtlasFinish, AtlasFinish, AtlasFinish, AtlasFinish] = [
  // 0 hormigón partido, 1 acero oxidado, 2 yeso, 3 madera astillada y arpillera.
  { color: [146, 142, 134], roughness: 0.96, metallic: 0.02, wear: 0.75, grain: 3.4 },
  { color: [132, 82, 52], roughness: 0.9, metallic: 0.4, wear: 0.95, grain: 2.2 },
  { color: [204, 200, 192], roughness: 0.92, metallic: 0, wear: 0.6, grain: 2.8 },
  { color: [148, 122, 84], roughness: 0.93, metallic: 0, wear: 0.7, grain: 3.2 },
];

const TECH_FINISHES: readonly [AtlasFinish, AtlasFinish, AtlasFinish, AtlasFinish] = [
  // 0 chapa gris de gabinete, 1 acero Combine oscuro, 2 plástico beige, 3 goma
  // y detalle negro.
  { color: [120, 126, 130], roughness: 0.5, metallic: 0.55, wear: 0.45, grain: 1.6 },
  { color: [58, 66, 72], roughness: 0.42, metallic: 0.8, wear: 0.4, grain: 1.4 },
  { color: [186, 178, 156], roughness: 0.68, metallic: 0.02, wear: 0.6, grain: 2.2 },
  { color: [42, 42, 44], roughness: 0.7, metallic: 0.1, wear: 0.3, grain: 2.4 },
];

const KIT_FINISHES: readonly [AtlasFinish, AtlasFinish, AtlasFinish, AtlasFinish] = [
  // 0 chapa pintada, 1 acero galvanizado, 2 madera y terracota, 3 goma y plastico.
  { color: [128, 118, 96], roughness: 0.6, metallic: 0.5, wear: 0.6, grain: 1.9 },
  { color: [164, 168, 170], roughness: 0.48, metallic: 0.9, wear: 0.5, grain: 1.3 },
  { color: [158, 118, 82], roughness: 0.88, metallic: 0.01, wear: 0.55, grain: 2.8 },
  { color: [52, 50, 50], roughness: 0.78, metallic: 0.05, wear: 0.35, grain: 2.6 },
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
      { id: "cardboardBox", displayName: "Caja de cartón", variants: 3, bounds: [0.45, 0.398, 0.35], chunks: 6 },
      { id: "milkCarton", displayName: "Cartón de leche", variants: 2, bounds: [0.091, 0.249, 0.091], chunks: 4 },
      { id: "woodPlank", displayName: "Tabla", variants: 2, bounds: [1.6, 0.072, 0.19], chunks: 4 },
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
      { id: "metalBucket", displayName: "Balde", variants: 2, bounds: [0.284, 0.386, 0.28], chunks: 0 },
      { id: "paintCan", displayName: "Lata de pintura", variants: 2, bounds: [0.191, 0.264, 0.196], chunks: 4 },
      { id: "soupCan", displayName: "Lata de conserva", variants: 3, bounds: [0.075, 0.11, 0.075], chunks: 0 },
      { id: "trashBin", displayName: "Tacho de basura", variants: 2, bounds: [0.445, 0.62, 0.445], chunks: 0 },
      { id: "gasCan", displayName: "Bidón de nafta", variants: 2, bounds: [0.188, 0.428, 0.32], chunks: 5 },
      { id: "propaneTank", displayName: "Garrafa de propano", variants: 2, bounds: [0.31, 0.58, 0.31], chunks: 5 },
      { id: "concreteChunk", displayName: "Trozo de losa", variants: 3, bounds: [0.45, 0.22, 0.421], chunks: 4 },
      { id: "metalPipe", displayName: "Caño", variants: 2, bounds: [1.4, 0.115, 0.115], chunks: 0 },
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
      { id: "plasticBottle", displayName: "Botella de plástico", variants: 3, bounds: [0.076, 0.24, 0.076], chunks: 4 },
      { id: "glassJar", displayName: "Frasco", variants: 2, bounds: [0.111, 0.16, 0.111], chunks: 4, hasGlass: true },
      { id: "plasticCrate", displayName: "Cajón plástico", variants: 2, bounds: [0.6, 0.333, 0.4], chunks: 6 },
      { id: "tire", displayName: "Neumático", variants: 1, bounds: [0.66, 0.2, 0.66], chunks: 0 },
    ],
  },
  {
    id: "propsInterior",
    displayName: "Mobiliario",
    seed: 20260810,
    atlasSize: 512,
    finishes: INTERIOR_FINISHES,
    grimeColor: [60, 52, 42],
    /**
     * Más holgado que los demás a propósito. Los 700 KB se fijaron para packs de
     * objetos chicos; un sillón de 2 m o una cama tienen diez veces el volumen
     * de una botella y no hay forma de meterlos en el mismo presupuesto sin
     * dejarlos en blockout. Bajar variantes ya se aplicó donde menos aportaban
     * (sillón, cama y biblioteca van con una sola).
     */
    maxGlbBytes: 768 * 1024,
    maxTrianglesLod0: 3500,
    maxDrawsPerLod: 3,
    props: [
      { id: "couch", displayName: "Sillón de tres cuerpos", variants: 1, bounds: [2, 0.833, 0.907], chunks: 6 },
      { id: "armchair", displayName: "Sillón", variants: 2, bounds: [0.95, 0.862, 0.911], chunks: 5 },
      { id: "mattress", displayName: "Colchón", variants: 2, bounds: [1.355, 0.22, 1.958], chunks: 0 },
      { id: "bed", displayName: "Cama", variants: 1, bounds: [1.45, 0.72, 2.05], chunks: 6 },
      { id: "dresser", displayName: "Cómoda", variants: 2, bounds: [1, 0.82, 0.577], chunks: 6 },
      { id: "wardrobe", displayName: "Ropero", variants: 2, bounds: [1, 1.9, 0.675], chunks: 6 },
      { id: "bookshelf", displayName: "Biblioteca", variants: 2, bounds: [0.9, 1.8, 0.32], chunks: 6 },
      { id: "desk", displayName: "Escritorio", variants: 2, bounds: [1.3, 0.75, 0.659], chunks: 6 },
      { id: "nightstand", displayName: "Mesa de luz", variants: 2, bounds: [0.45, 0.55, 0.428], chunks: 5 },
      { id: "stool", displayName: "Banqueta", variants: 2, bounds: [0.34, 0.72, 0.34], chunks: 4 },
      { id: "bench", displayName: "Banco", variants: 2, bounds: [1.6, 0.45, 0.39], chunks: 5 },
      { id: "officeChair", displayName: "Silla de oficina", variants: 2, bounds: [0.585, 0.952, 0.578], chunks: 5 },
    ],
  },
  {
    id: "propsAppliance",
    displayName: "Electrodomésticos e instalaciones",
    seed: 20260811,
    atlasSize: 512,
    finishes: APPLIANCE_FINISHES,
    grimeColor: [72, 70, 64],
    maxGlbBytes: 700 * 1024,
    maxTrianglesLod0: 3500,
    maxDrawsPerLod: 3,
    props: [
      { id: "fridge", displayName: "Heladera", variants: 2, bounds: [0.7, 1.75, 0.725], chunks: 0 },
      { id: "washingMachine", displayName: "Lavarropas", variants: 2, bounds: [0.6, 0.85, 0.631], chunks: 0 },
      { id: "stove", displayName: "Cocina", variants: 2, bounds: [0.6, 0.907, 0.646], chunks: 0 },
      { id: "kitchenCounter", displayName: "Mesada", variants: 2, bounds: [1.2, 0.9, 0.65], chunks: 6 },
      { id: "bathtub", displayName: "Bañera", variants: 1, bounds: [1.7, 0.67, 0.75], chunks: 5 },
      { id: "toilet", displayName: "Inodoro", variants: 1, bounds: [0.4, 0.78, 0.65], chunks: 4 },
      { id: "sink", displayName: "Lavatorio", variants: 2, bounds: [0.58, 0.935, 0.48], chunks: 4 },
      { id: "lockerBank", displayName: "Lockers", variants: 2, bounds: [0.92, 1.8, 0.543], chunks: 0 },
    ],
  },
  {
    id: "propsDebris",
    displayName: "Escombro",
    seed: 20260812,
    atlasSize: 512,
    finishes: DEBRIS_FINISHES,
    grimeColor: [82, 76, 66],
    maxGlbBytes: 700 * 1024,
    maxTrianglesLod0: 3500,
    maxDrawsPerLod: 3,
    props: [
      { id: "concreteSlab", displayName: "Losa", variants: 2, bounds: [1.25, 0.26, 1.001], chunks: 5 },
      { id: "brokenPillar", displayName: "Columna partida", variants: 2, bounds: [0.44, 1.407, 0.44], chunks: 5 },
      { id: "brickPile", displayName: "Pila de ladrillos", variants: 2, bounds: [0.78, 0.41, 0.6], chunks: 6 },
      { id: "rebarBundle", displayName: "Atado de hierros", variants: 2, bounds: [1.7, 0.111, 0.11], chunks: 0 },
      { id: "iBeam", displayName: "Viga doble T", variants: 2, bounds: [2.2, 0.24, 0.2], chunks: 0 },
      { id: "metalPanel", displayName: "Chapa doblada", variants: 2, bounds: [1.101, 0.85, 0.21], chunks: 0 },
      { id: "scrapHeap", displayName: "Chatarra", variants: 2, bounds: [0.95, 0.501, 0.8], chunks: 6 },
      { id: "scaffoldPipe", displayName: "Tubo de andamio", variants: 2, bounds: [1.9, 0.088, 0.104], chunks: 0 },
      { id: "plasterSlab", displayName: "Placa de yeso", variants: 2, bounds: [1.05, 0.135, 0.72], chunks: 4 },
      { id: "sandbag", displayName: "Bolsa de arena", variants: 2, bounds: [0.52, 0.2, 0.32], chunks: 0 },
      { id: "barricadeWood", displayName: "Barricada", variants: 2, bounds: [1.503, 1.052, 0.082], chunks: 6 },
    ],
  },
  {
    id: "propsTech",
    displayName: "Electrónica y Combine",
    seed: 20260813,
    atlasSize: 512,
    finishes: TECH_FINISHES,
    grimeColor: [58, 58, 60],
    /** Cian Combine: el mismo de los emisores de los vehículos. */
    emissiveColor: [0.12, 0.78, 1],
    /**
     * Como `propsInterior`: es el pack más cargado del catálogo. Catorce props
     * con TRES materiales (atlas, vidrio y emisivo), dos unidades de casi 1.9 m
     * y detalle fino en casi todos. Antes de subirlo se bajaron variantes en
     * rack y expendedora, y se cambiaron los botones sueltos del teclado y la
     * expendedora por tiras: cada `chamferBox` es un casco convexo entero.
     */
    maxGlbBytes: 768 * 1024,
    maxTrianglesLod0: 3500,
    maxDrawsPerLod: 3,
    props: [
      { id: "monitor", displayName: "Monitor", variants: 2, bounds: [0.42, 0.365, 0.429], chunks: 5 },
      { id: "serverRack", displayName: "Rack de servidores", variants: 1, bounds: [0.6, 1.85, 0.825], chunks: 6 },
      { id: "harddrive", displayName: "Disco rígido", variants: 2, bounds: [0.15, 0.033, 0.106], chunks: 0 },
      { id: "powerBox", displayName: "Caja de energía", variants: 2, bounds: [0.344, 0.46, 0.197], chunks: 5 },
      { id: "keypad", displayName: "Teclado de acceso", variants: 2, bounds: [0.128, 0.26, 0.19], chunks: 4 },
      { id: "radio", displayName: "Radio", variants: 2, bounds: [0.3, 0.253, 0.198], chunks: 4 },
      { id: "vendingMachine", displayName: "Expendedora", variants: 1, bounds: [0.82, 1.88, 0.783], chunks: 6, hasGlass: true },
      { id: "waterCooler", displayName: "Dispenser", variants: 2, bounds: [0.34, 1.112, 0.353], chunks: 5, hasGlass: true },
      { id: "labJar", displayName: "Frasco de laboratorio", variants: 2, bounds: [0.146, 0.26, 0.15], chunks: 4, hasGlass: true },
      { id: "partsBin", displayName: "Bandeja de repuestos", variants: 2, bounds: [0.42, 0.18, 0.3], chunks: 4 },
      { id: "combineCrate", displayName: "Cajón Combine", variants: 2, bounds: [0.768, 0.696, 0.776], chunks: 6 },
      { id: "combineBarrier", displayName: "Barricada Combine", variants: 2, bounds: [1.25, 1.063, 0.429], chunks: 0 },
      { id: "combineEmitter", displayName: "Emisor Combine", variants: 2, bounds: [0.36, 0.92, 0.36], chunks: 5 },
      { id: "combineLamp", displayName: "Lámpara Combine", variants: 2, bounds: [0.42, 0.24, 0.267], chunks: 4 },
    ],
  },
  {
    id: "propsKit",
    displayName: "Utilería de mapa",
    seed: 20260814,
    atlasSize: 512,
    finishes: KIT_FINISHES,
    grimeColor: [74, 68, 58],
    maxGlbBytes: 768 * 1024,
    maxTrianglesLod0: 3500,
    maxDrawsPerLod: 3,
    props: [
      { id: "ladder", displayName: "Escalera", variants: 2, bounds: [0.44, 2.6, 0.12], chunks: 0 },
      { id: "handrail", displayName: "Baranda", variants: 2, bounds: [2.02, 1.06, 0.14], chunks: 5 },
      { id: "fenceSection", displayName: "Tramo de cerco", variants: 2, bounds: [2.2, 1.9, 0.06], chunks: 5 },
      { id: "ammoCrate", displayName: "Cajón de munición", variants: 2, bounds: [0.796, 0.46, 0.521], chunks: 6 },
      { id: "medCrate", displayName: "Cajón médico", variants: 2, bounds: [0.796, 0.46, 0.521], chunks: 6 },
      { id: "toolCart", displayName: "Carro de herramientas", variants: 2, bounds: [0.707, 0.918, 0.491], chunks: 6 },
      { id: "wheelbarrow", displayName: "Carretilla", variants: 2, bounds: [0.66, 1.333, 1.231], chunks: 0 },
      { id: "shoppingCart", displayName: "Changuito", variants: 2, bounds: [0.592, 0.993, 0.87], chunks: 0 },
      { id: "bicycle", displayName: "Bicicleta", variants: 2, bounds: [1.72, 1.161, 0.13], chunks: 0 },
      { id: "streetSign", displayName: "Cartel de calle", variants: 2, bounds: [0.602, 2.35, 0.18], chunks: 0 },
      { id: "mailbox", displayName: "Buzón", variants: 2, bounds: [0.44, 1.24, 0.404], chunks: 0 },
      { id: "flowerPot", displayName: "Maceta", variants: 2, bounds: [0.393, 0.34, 0.403], chunks: 3 },
      { id: "crateLong", displayName: "Cajón largo", variants: 2, bounds: [1.55, 0.422, 0.462], chunks: 6 },
      { id: "crateHuge", displayName: "Cajón grande", variants: 2, bounds: [1.625, 1.6, 1.625], chunks: 8 },
    ],
  },
];
