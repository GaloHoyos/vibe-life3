import type { DamageType } from "@shared/types/lifecycle";
import type { SurfaceType } from "@shared/types/Surface";

/**
 * Tabla de props, análoga a `prop_data.txt` de HL2: masa, vida, material y qué
 * pasa al romperse, todo como datos. Un prop nuevo es una entrada acá más una
 * rama en el generador de assets; no hace falta una clase.
 *
 * Las masas están calibradas contra los dos umbrales de agarre: por debajo de
 * `CarryConfig.maxMass` (35 kg) se levanta con las manos, y hasta
 * `GravityGunConfig.grabMaxMass` (250 kg) con la gravity gun. Un prop de 40 kg
 * es deliberadamente "necesitás el arma para esto".
 */
export const PROP_ARCHETYPE_IDS = [
  "woodenCrate",
  "metalBarrel",
  "explosiveBarrel",
  "plasticDrum",
  "pallet",
  "filingCabinet",
  "radiator",
  "chair",
  "table",
  "crtTelevision",
  "glassBottle",
  "trafficCone",
  "concreteBlock",
  "cardboardBox",
  "milkCarton",
  "woodPlank",
  "metalBucket",
  "paintCan",
  "soupCan",
  "trashBin",
  "gasCan",
  "propaneTank",
  "concreteChunk",
  "metalPipe",
  "plasticBottle",
  "glassJar",
  "plasticCrate",
  "tire",
  "couch",
  "armchair",
  "mattress",
  "bed",
  "dresser",
  "wardrobe",
  "bookshelf",
  "desk",
  "nightstand",
  "stool",
  "bench",
  "officeChair",
  "fridge",
  "washingMachine",
  "stove",
  "kitchenCounter",
  "bathtub",
  "toilet",
  "sink",
  "lockerBank",
  "concreteSlab",
  "brokenPillar",
  "brickPile",
  "rebarBundle",
  "iBeam",
  "metalPanel",
  "scrapHeap",
  "scaffoldPipe",
  "plasterSlab",
  "sandbag",
  "barricadeWood",
  "monitor",
  "serverRack",
  "harddrive",
  "powerBox",
  "keypad",
  "radio",
  "vendingMachine",
  "waterCooler",
  "labJar",
  "partsBin",
  "combineCrate",
  "combineBarrier",
  "combineEmitter",
  "combineLamp",
] as const;

export type PropArchetypeId = (typeof PROP_ARCHETYPE_IDS)[number];

/** Análogo de `physicsmode` en `prop_data.txt`. */
export type PropPhysicsMode =
  /** Cuerpo dinámico completo, agarrable y empujable. */
  | "dynamic"
  /** Fijo hasta romperse; si sobrevive un resto, cae a dinámico. */
  | "anchored"
  /** Choca contra el mundo pero nunca contra actores, y no daña. */
  | "debris";

export type PropBreakReaction =
  | { readonly kind: "none" }
  /** Se parte en los chunks autorados de su asset. */
  | { readonly kind: "shatter" }
  | {
      readonly kind: "explode";
      readonly damage: number;
      readonly radius: number;
      readonly impulse: number;
    }
  /** Suelta las juntas de su estructura y deja caer a los miembros. */
  | { readonly kind: "collapse" };

export interface PropDamageProfile {
  /** `false` = indestructible (cono de tránsito, bloque de hormigón). */
  readonly health: number | false;
  /** Una botella cede al fierrazo y aguanta la bala; un barril es al revés. */
  readonly multipliers?: Partial<Record<DamageType, number>>;
  /** Velocidad de impacto (m/s) por debajo de la cual el golpe no lo daña. */
  readonly impactDamageSpeed: number;
  /** Daño por cada m/s sobre el umbral. */
  readonly impactDamageScale: number;
}

export interface PropPhysicsProfile {
  readonly mass: number;
  readonly linearDamping: number;
  readonly angularDamping: number;
  readonly friction: number;
  readonly restitution: number;
  /** `false` lo excluye del agarre aunque su masa lo permita. */
  readonly grabbable: boolean;
  /** `false` lo saca del pase global de daño por impacto contra NPCs. */
  readonly impactDamage: boolean;
}

/**
 * Los fragmentos no se autoran aparte: salen de repartir las piezas con las que
 * el prop está construido (un cajón roto SON sus tablas). Por eso `maxChunks`
 * no puede superar lo que el asset trae — un contract test lo verifica contra
 * el manifiesto generado.
 */
export interface PropGibSet {
  readonly minChunks: number;
  readonly maxChunks: number;
  /** El chasis sobrevive como resto anclado (un archivero sí, una botella no). */
  readonly coreSurvives: boolean;
  /** Velocidad extra (m/s) que reciben los chunks alineados con el impacto. */
  readonly burstSpeed: number;
}

export interface PropDeformProfile {
  /** Radio del abollón, en metros. */
  readonly radius: number;
  /** Hundimiento por golpe, en metros. */
  readonly depth: number;
  /** Techo acumulado por vértice: más allá satura en vez de invertir la malla. */
  readonly maxDepth: number;
  /** Silencio (s) entre abollones del mismo prop. */
  readonly cooldown: number;
}

/**
 * Los arquetipos se reparten en packs GLB para compartir atlas: un fetch y un
 * material por pack en vez de uno por prop. El corte es por paleta, no por
 * tema — el tapizado y la madera barnizada no comparten atlas con el esmalte
 * blanco y el acero.
 */
export type PropPackId =
  | "propsWood"
  | "propsMetal"
  | "propsSynthetic"
  | "propsInterior"
  | "propsAppliance"
  | "propsDebris"
  | "propsTech";

export interface PropAssetRef {
  readonly pack: PropPackId;
  /** Nodo raíz dentro del pack. */
  readonly node: string;
  /** Variantes de malla por seed. 1 = sin variantes. */
  readonly variants: number;
}

export interface PropArchetype {
  readonly id: PropArchetypeId;
  /** Visible al jugador en el editor. */
  readonly displayName: string;
  readonly asset: PropAssetRef;
  readonly surface: SurfaceType;
  readonly physicsMode: PropPhysicsMode;
  readonly physics: PropPhysicsProfile;
  readonly damage: PropDamageProfile;
  readonly breakReaction: PropBreakReaction;
  readonly gibs?: PropGibSet;
  readonly deform?: PropDeformProfile;
  /**
   * Extensiones completas del prop. Es el collider de reserva cuando el GLB no
   * cargó, el placeholder del editor y el tamaño del obstáculo de navegación.
   */
  readonly bounds: readonly [number, number, number];
  /** Sólo si es `anchored`: emite una caja invisible para el bake de navegación. */
  readonly navBlocking?: boolean;
}

const SHATTER: PropBreakReaction = { kind: "shatter" };
const INDESTRUCTIBLE: PropBreakReaction = { kind: "none" };

/**
 * Un metal abollable comparte el mismo tacto; sólo cambia la escala.
 *
 * `maxDepth` se autora aparte y no como múltiplo fijo porque lo manda el grosor
 * del prop, no su perfil: un radiador tiene 14 cm de fondo y saturar más allá de
 * la mitad lo atravesaría, mientras que un barril de 29 cm de radio aguanta un
 * hundimiento mucho más dramático.
 */
function metalDeform(radius: number, depth: number, maxDepth: number): PropDeformProfile {
  return { radius, depth, maxDepth, cooldown: 0.15 };
}

export const PropArchetypes: Readonly<Record<PropArchetypeId, PropArchetype>> = {
  woodenCrate: {
    id: "woodenCrate",
    displayName: "Cajón de madera",
    asset: { pack: "propsWood", node: "prop_woodenCrate", variants: 3 },
    surface: "wood",
    physicsMode: "dynamic",
    physics: {
      mass: 25,
      linearDamping: 0.15,
      angularDamping: 0.4,
      friction: 0.7,
      restitution: 0.05,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 40,
      // La barreta parte un cajón en dos golpes; las balas lo perforan sin más.
      multipliers: { melee: 2.2, bullet: 0.7, explosive: 2 },
      impactDamageSpeed: 6,
      impactDamageScale: 3,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 5, maxChunks: 8, coreSurvives: false, burstSpeed: 3.4 },
    bounds: [0.887, 0.86, 0.887],
    // Los cajones son cobertura en todos los mapas: anclados tienen que cortar
    // el pathing igual que cuando eran cajas estaticas, o los NPCs los cruzan.
    navBlocking: true,
  },

  metalBarrel: {
    id: "metalBarrel",
    displayName: "Barril metálico",
    asset: { pack: "propsMetal", node: "prop_metalBarrel", variants: 2 },
    surface: "metal",
    physicsMode: "dynamic",
    physics: {
      mass: 45,
      linearDamping: 0.1,
      angularDamping: 0.25,
      friction: 0.45,
      restitution: 0.15,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      // Un barril de chapa aguanta MUCHO plomo antes de reventar, y esa vida es
      // justamente lo que deja abollarlo hasta deformarlo entero. Un metal que
      // muere en cinco tiros no llega a mostrar el trabajo de la deformación.
      health: 220,
      multipliers: { melee: 0.5, bullet: 1, explosive: 2.2 },
      impactDamageSpeed: 8,
      impactDamageScale: 2,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 4, maxChunks: 7, coreSurvives: false, burstSpeed: 3 },
    deform: metalDeform(0.26, 0.045, 0.16),
    bounds: [0.585, 0.962, 0.585],
  },

  /**
   * Los valores son los de `ExplosiveBarrelSystem` antes de migrarlo: vida 25,
   * daño 90, radio 4.5 e impulso 14. Cambiarlos acá cambia todos los barriles
   * de la campaña, que es el punto de tenerlos como datos.
   */
  explosiveBarrel: {
    id: "explosiveBarrel",
    displayName: "Barril explosivo",
    asset: { pack: "propsMetal", node: "prop_explosiveBarrel", variants: 2 },
    surface: "metal",
    physicsMode: "dynamic",
    physics: {
      mass: 30,
      linearDamping: 0.1,
      angularDamping: 0.25,
      friction: 0.45,
      restitution: 0.15,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 25,
      // Todo lo enciende: es un bidón de combustible, no un blindaje.
      multipliers: { melee: 1, bullet: 1, explosive: 2, energy: 2 },
      impactDamageSpeed: 9,
      impactDamageScale: 2,
    },
    breakReaction: { kind: "explode", damage: 90, radius: 4.5, impulse: 14 },
    gibs: { minChunks: 4, maxChunks: 7, coreSurvives: false, burstSpeed: 4.5 },
    bounds: [0.588, 1.074, 0.588],
  },

  plasticDrum: {
    id: "plasticDrum",
    displayName: "Bidón plástico",
    asset: { pack: "propsSynthetic", node: "prop_plasticDrum", variants: 2 },
    surface: "plastic",
    physicsMode: "dynamic",
    physics: {
      mass: 18,
      linearDamping: 0.12,
      angularDamping: 0.3,
      friction: 0.4,
      restitution: 0.25,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 30,
      multipliers: { melee: 1.6, explosive: 1.8 },
      impactDamageSpeed: 7,
      impactDamageScale: 2.5,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 4, maxChunks: 6, coreSurvives: false, burstSpeed: 3.2 },
    bounds: [0.609, 0.89, 0.618],
  },

  pallet: {
    id: "pallet",
    displayName: "Pallet",
    asset: { pack: "propsWood", node: "prop_pallet", variants: 2 },
    surface: "wood",
    physicsMode: "dynamic",
    physics: {
      mass: 16,
      linearDamping: 0.2,
      angularDamping: 0.5,
      friction: 0.75,
      restitution: 0.05,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 30,
      multipliers: { melee: 2.4, bullet: 0.6, explosive: 2.4 },
      impactDamageSpeed: 6,
      impactDamageScale: 3,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 5, maxChunks: 8, coreSurvives: false, burstSpeed: 3.8 },
    bounds: [1.2, 0.141, 0.8],
  },

  filingCabinet: {
    id: "filingCabinet",
    displayName: "Archivero",
    asset: { pack: "propsMetal", node: "prop_filingCabinet", variants: 2 },
    surface: "metal",
    physicsMode: "dynamic",
    physics: {
      mass: 80,
      linearDamping: 0.2,
      angularDamping: 0.5,
      friction: 0.6,
      restitution: 0.05,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 300,
      multipliers: { melee: 0.4, bullet: 0.8, explosive: 2 },
      impactDamageSpeed: 9,
      impactDamageScale: 1.5,
    },
    breakReaction: SHATTER,
    // Los cajones salen disparados y el chasis queda de pie: es lo que hace que
    // una oficina reventada siga leyéndose como oficina.
    gibs: { minChunks: 3, maxChunks: 5, coreSurvives: true, burstSpeed: 2.6 },
    deform: metalDeform(0.30, 0.05, 0.16),
    bounds: [0.5, 1.32, 0.655],
  },

  radiator: {
    id: "radiator",
    displayName: "Radiador",
    asset: { pack: "propsMetal", node: "prop_radiator", variants: 1 },
    surface: "metal",
    physicsMode: "dynamic",
    physics: {
      mass: 40,
      linearDamping: 0.15,
      angularDamping: 0.4,
      friction: 0.55,
      restitution: 0.1,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 200,
      multipliers: { melee: 0.5, explosive: 2 },
      impactDamageSpeed: 8,
      impactDamageScale: 2,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 4, maxChunks: 6, coreSurvives: false, burstSpeed: 2.8 },
    // Sólo 14 cm de fondo: el tope es la mitad o el abollón sale por atrás.
    deform: metalDeform(0.20, 0.022, 0.065),
    bounds: [0.915, 0.597, 0.14],
  },

  chair: {
    id: "chair",
    displayName: "Silla",
    asset: { pack: "propsWood", node: "prop_chair", variants: 2 },
    surface: "wood",
    physicsMode: "dynamic",
    physics: {
      mass: 9,
      linearDamping: 0.2,
      angularDamping: 0.55,
      friction: 0.6,
      restitution: 0.1,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 22,
      multipliers: { melee: 2.5, bullet: 0.6, explosive: 2.5 },
      impactDamageSpeed: 5,
      impactDamageScale: 3.5,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 4, maxChunks: 7, coreSurvives: false, burstSpeed: 4 },
    bounds: [0.42, 0.92, 0.44],
  },

  table: {
    id: "table",
    displayName: "Mesa",
    asset: { pack: "propsWood", node: "prop_table", variants: 2 },
    surface: "wood",
    physicsMode: "dynamic",
    physics: {
      mass: 30,
      linearDamping: 0.2,
      angularDamping: 0.5,
      friction: 0.65,
      restitution: 0.05,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 45,
      multipliers: { melee: 2.2, bullet: 0.6, explosive: 2.2 },
      impactDamageSpeed: 6,
      impactDamageScale: 2.8,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 4, maxChunks: 7, coreSurvives: false, burstSpeed: 3.4 },
    bounds: [1.4, 0.74, 0.8],
  },

  crtTelevision: {
    id: "crtTelevision",
    displayName: "Televisor",
    asset: { pack: "propsSynthetic", node: "prop_crtTelevision", variants: 2 },
    surface: "plastic",
    physicsMode: "dynamic",
    physics: {
      mass: 22,
      linearDamping: 0.15,
      angularDamping: 0.4,
      friction: 0.5,
      restitution: 0.08,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 28,
      // El tubo revienta con cualquier cosa; es todo vidrio bajo el gabinete.
      multipliers: { melee: 2.5, bullet: 1.8, explosive: 2.5 },
      impactDamageSpeed: 5,
      impactDamageScale: 4,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 3, maxChunks: 5, coreSurvives: false, burstSpeed: 3.6 },
    deform: metalDeform(0.18, 0.028, 0.09),
    bounds: [0.52, 0.44, 0.492],
  },

  glassBottle: {
    id: "glassBottle",
    displayName: "Botella",
    asset: { pack: "propsSynthetic", node: "prop_glassBottle", variants: 3 },
    surface: "glass",
    physicsMode: "dynamic",
    physics: {
      mass: 0.6,
      linearDamping: 0.05,
      angularDamping: 0.2,
      friction: 0.3,
      restitution: 0.1,
      grabbable: true,
      // Una botella a 20 m/s no debería matar a nadie: es el cristal el que cede.
      impactDamage: false,
    },
    damage: {
      health: 2,
      multipliers: { melee: 5, bullet: 5, explosive: 5 },
      impactDamageSpeed: 2.5,
      impactDamageScale: 8,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 3, maxChunks: 5, coreSurvives: false, burstSpeed: 2.2 },
    bounds: [0.075, 0.29, 0.075],
  },

  trafficCone: {
    id: "trafficCone",
    displayName: "Cono de tránsito",
    asset: { pack: "propsSynthetic", node: "prop_trafficCone", variants: 1 },
    surface: "rubber",
    physicsMode: "dynamic",
    physics: {
      mass: 3,
      linearDamping: 0.25,
      angularDamping: 0.6,
      friction: 0.8,
      restitution: 0.3,
      grabbable: true,
      impactDamage: false,
    },
    damage: {
      health: false,
      impactDamageSpeed: Infinity,
      impactDamageScale: 0,
    },
    breakReaction: INDESTRUCTIBLE,
    bounds: [0.36, 0.72, 0.36],
  },

  concreteBlock: {
    id: "concreteBlock",
    displayName: "Bloque de hormigón",
    asset: { pack: "propsMetal", node: "prop_concreteBlock", variants: 3 },
    surface: "concrete",
    physicsMode: "dynamic",
    physics: {
      mass: 22,
      linearDamping: 0.1,
      angularDamping: 0.3,
      friction: 0.9,
      restitution: 0.02,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: false,
      impactDamageSpeed: Infinity,
      impactDamageScale: 0,
    },
    breakReaction: INDESTRUCTIBLE,
    bounds: [0.4, 0.2, 0.2],
    navBlocking: true,
  },

  // -------------------------------------------------------------------------
  // Livianos y contenedores
  //
  // El grueso del catálogo físico de HL2 eran contenedores y basura chica, y no
  // por relleno: son los objetos que llenan un piso sin que el jugador los mire
  // y los que hacen divertida la gravity gun. Casi ninguno hace daño por
  // impacto — un tarro a 20 m/s asusta, no mata.
  // -------------------------------------------------------------------------

  cardboardBox: {
    id: "cardboardBox",
    displayName: "Caja de cartón",
    asset: { pack: "propsWood", node: "prop_cardboardBox", variants: 3 },
    surface: "cardboard",
    physicsMode: "dynamic",
    physics: {
      mass: 2,
      // Amortiguación alta: el cartón vacío no rueda, se frena solo.
      linearDamping: 0.4,
      angularDamping: 0.8,
      friction: 0.7,
      restitution: 0.02,
      grabbable: true,
      impactDamage: false,
    },
    damage: {
      health: 8,
      multipliers: { melee: 4, bullet: 2, explosive: 3 },
      impactDamageSpeed: Infinity,
      impactDamageScale: 0,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 4, maxChunks: 6, coreSurvives: false, burstSpeed: 1.8 },
    bounds: [0.45, 0.398, 0.35],
  },

  milkCarton: {
    id: "milkCarton",
    displayName: "Cartón de leche",
    asset: { pack: "propsWood", node: "prop_milkCarton", variants: 2 },
    surface: "cardboard",
    physicsMode: "dynamic",
    physics: {
      mass: 0.5,
      linearDamping: 0.35,
      angularDamping: 0.7,
      friction: 0.6,
      restitution: 0.05,
      grabbable: true,
      impactDamage: false,
    },
    damage: {
      health: 3,
      multipliers: { melee: 5, bullet: 4, explosive: 5 },
      impactDamageSpeed: Infinity,
      impactDamageScale: 0,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 3, maxChunks: 4, coreSurvives: false, burstSpeed: 1.5 },
    bounds: [0.091, 0.249, 0.091],
  },

  woodPlank: {
    id: "woodPlank",
    displayName: "Tabla",
    asset: { pack: "propsWood", node: "prop_woodPlank", variants: 2 },
    surface: "wood",
    physicsMode: "dynamic",
    physics: {
      mass: 5,
      linearDamping: 0.15,
      angularDamping: 0.35,
      friction: 0.6,
      restitution: 0.08,
      grabbable: true,
      // 1.6 m de tabla girando sí lastima: es el prop alargado del set.
      impactDamage: true,
    },
    damage: {
      health: 20,
      multipliers: { melee: 2.5, bullet: 0.8, explosive: 2 },
      impactDamageSpeed: 7,
      impactDamageScale: 2.5,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 3, maxChunks: 4, coreSurvives: false, burstSpeed: 3 },
    bounds: [1.6, 0.072, 0.19],
  },

  metalBucket: {
    id: "metalBucket",
    displayName: "Balde",
    asset: { pack: "propsMetal", node: "prop_metalBucket", variants: 2 },
    surface: "metal",
    physicsMode: "dynamic",
    physics: {
      mass: 3,
      linearDamping: 0.1,
      angularDamping: 0.25,
      friction: 0.4,
      restitution: 0.25,
      grabbable: true,
      impactDamage: false,
    },
    damage: {
      health: false,
      impactDamageSpeed: Infinity,
      impactDamageScale: 0,
    },
    // Un balde no se hace pedazos: se abolla y sigue siendo un balde.
    breakReaction: INDESTRUCTIBLE,
    deform: metalDeform(0.12, 0.02, 0.055),
    bounds: [0.284, 0.386, 0.28],
  },

  paintCan: {
    id: "paintCan",
    displayName: "Lata de pintura",
    asset: { pack: "propsMetal", node: "prop_paintCan", variants: 2 },
    surface: "metal",
    physicsMode: "dynamic",
    physics: {
      mass: 4,
      linearDamping: 0.12,
      angularDamping: 0.3,
      friction: 0.45,
      restitution: 0.15,
      grabbable: true,
      impactDamage: false,
    },
    damage: {
      health: 45,
      multipliers: { melee: 3, bullet: 2.5, explosive: 3 },
      impactDamageSpeed: Infinity,
      impactDamageScale: 0,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 3, maxChunks: 4, coreSurvives: false, burstSpeed: 2.4 },
    deform: metalDeform(0.09, 0.014, 0.042),
    bounds: [0.191, 0.264, 0.196],
  },

  soupCan: {
    id: "soupCan",
    displayName: "Lata de conserva",
    asset: { pack: "propsMetal", node: "prop_soupCan", variants: 3 },
    surface: "metal",
    physicsMode: "dynamic",
    physics: {
      mass: 0.4,
      linearDamping: 0.05,
      angularDamping: 0.15,
      friction: 0.35,
      restitution: 0.35,
      grabbable: true,
      impactDamage: false,
    },
    damage: {
      health: false,
      impactDamageSpeed: Infinity,
      impactDamageScale: 0,
    },
    // El objeto más liviano del set. Indestructible a propósito: la gracia es
    // que sobreviva para que la puedas volver a tirar, cada vez más abollada.
    breakReaction: INDESTRUCTIBLE,
    deform: metalDeform(0.045, 0.006, 0.017),
    bounds: [0.075, 0.11, 0.075],
  },

  trashBin: {
    id: "trashBin",
    displayName: "Tacho de basura",
    asset: { pack: "propsMetal", node: "prop_trashBin", variants: 2 },
    surface: "metal",
    physicsMode: "dynamic",
    physics: {
      mass: 12,
      linearDamping: 0.12,
      angularDamping: 0.3,
      friction: 0.5,
      restitution: 0.2,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: false,
      impactDamageSpeed: Infinity,
      impactDamageScale: 0,
    },
    breakReaction: INDESTRUCTIBLE,
    deform: metalDeform(0.18, 0.03, 0.09),
    bounds: [0.445, 0.62, 0.445],
  },

  gasCan: {
    id: "gasCan",
    displayName: "Bidón de nafta",
    asset: { pack: "propsMetal", node: "prop_gasCan", variants: 2 },
    surface: "metal",
    physicsMode: "dynamic",
    physics: {
      mass: 8,
      linearDamping: 0.12,
      angularDamping: 0.3,
      friction: 0.5,
      restitution: 0.1,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 18,
      multipliers: { melee: 1.5, bullet: 2.5, explosive: 3 },
      impactDamageSpeed: 8,
      impactDamageScale: 2,
    },
    // Explosión chica: el bidón es la carga de mano del set, no el barril.
    breakReaction: { kind: "explode", damage: 55, radius: 3, impulse: 9 },
    gibs: { minChunks: 3, maxChunks: 5, coreSurvives: false, burstSpeed: 4 },
    // Se abolla antes de reventar: la chapa hundida es el aviso. Sólo 18 cm de
    // ancho, así que el tope va bien por debajo de la mitad.
    deform: metalDeform(0.12, 0.02, 0.05),
    bounds: [0.188, 0.428, 0.32],
  },

  propaneTank: {
    id: "propaneTank",
    displayName: "Garrafa de propano",
    asset: { pack: "propsMetal", node: "prop_propaneTank", variants: 2 },
    surface: "metal",
    physicsMode: "dynamic",
    physics: {
      mass: 30,
      linearDamping: 0.1,
      angularDamping: 0.25,
      friction: 0.45,
      restitution: 0.12,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 35,
      // Aguanta el fuego cruzado y cede a lo que le apuntás: es un arma
      // colocada, no una trampa que revienta sola.
      multipliers: { melee: 0.8, bullet: 1.4, explosive: 2.5 },
      impactDamageSpeed: 8,
      impactDamageScale: 2,
    },
    breakReaction: { kind: "explode", damage: 100, radius: 5, impulse: 16 },
    gibs: { minChunks: 4, maxChunks: 5, coreSurvives: false, burstSpeed: 5.5 },
    deform: metalDeform(0.13, 0.02, 0.07),
    bounds: [0.31, 0.58, 0.31],
  },

  concreteChunk: {
    id: "concreteChunk",
    displayName: "Trozo de losa",
    asset: { pack: "propsMetal", node: "prop_concreteChunk", variants: 3 },
    surface: "concrete",
    physicsMode: "dynamic",
    physics: {
      mass: 45,
      linearDamping: 0.2,
      angularDamping: 0.5,
      friction: 0.95,
      restitution: 0.01,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 60,
      // El hormigón no se astilla a tiros; se parte con explosivos.
      multipliers: { melee: 0.3, bullet: 0.2, explosive: 3 },
      impactDamageSpeed: 6,
      impactDamageScale: 4,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 3, maxChunks: 4, coreSurvives: false, burstSpeed: 2.6 },
    bounds: [0.45, 0.22, 0.421],
  },

  metalPipe: {
    id: "metalPipe",
    displayName: "Caño",
    asset: { pack: "propsMetal", node: "prop_metalPipe", variants: 2 },
    surface: "metal",
    physicsMode: "dynamic",
    physics: {
      mass: 7,
      linearDamping: 0.1,
      angularDamping: 0.2,
      friction: 0.35,
      restitution: 0.2,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: false,
      impactDamageSpeed: 7,
      impactDamageScale: 3,
    },
    // No se rompe: 1.4 m de caño girando es de lo mejor que te da la gravity gun.
    breakReaction: INDESTRUCTIBLE,
    // Poco fondo: el caño se marca, no se aplasta.
    deform: metalDeform(0.07, 0.008, 0.025),
    bounds: [1.4, 0.115, 0.115],
  },

  plasticBottle: {
    id: "plasticBottle",
    displayName: "Botella de plástico",
    asset: { pack: "propsSynthetic", node: "prop_plasticBottle", variants: 3 },
    surface: "plastic",
    physicsMode: "dynamic",
    physics: {
      mass: 0.2,
      linearDamping: 0.08,
      angularDamping: 0.25,
      friction: 0.35,
      restitution: 0.4,
      grabbable: true,
      impactDamage: false,
    },
    damage: {
      health: 4,
      multipliers: { melee: 4, bullet: 4, explosive: 4 },
      impactDamageSpeed: Infinity,
      impactDamageScale: 0,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 3, maxChunks: 4, coreSurvives: false, burstSpeed: 1.6 },
    bounds: [0.076, 0.24, 0.076],
  },

  glassJar: {
    id: "glassJar",
    displayName: "Frasco",
    asset: { pack: "propsSynthetic", node: "prop_glassJar", variants: 2 },
    surface: "glass",
    physicsMode: "dynamic",
    physics: {
      mass: 0.8,
      linearDamping: 0.05,
      angularDamping: 0.2,
      friction: 0.3,
      restitution: 0.1,
      grabbable: true,
      impactDamage: false,
    },
    damage: {
      health: 2,
      multipliers: { melee: 5, bullet: 5, explosive: 5 },
      impactDamageSpeed: 2.5,
      impactDamageScale: 8,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 3, maxChunks: 4, coreSurvives: false, burstSpeed: 2 },
    bounds: [0.111, 0.16, 0.111],
  },

  plasticCrate: {
    id: "plasticCrate",
    displayName: "Cajón plástico",
    asset: { pack: "propsSynthetic", node: "prop_plasticCrate", variants: 2 },
    surface: "plastic",
    physicsMode: "dynamic",
    physics: {
      mass: 6,
      linearDamping: 0.15,
      angularDamping: 0.4,
      friction: 0.6,
      restitution: 0.15,
      grabbable: true,
      impactDamage: false,
    },
    damage: {
      health: 22,
      multipliers: { melee: 2.5, bullet: 1.2, explosive: 2.5 },
      impactDamageSpeed: 9,
      impactDamageScale: 1.5,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 4, maxChunks: 6, coreSurvives: false, burstSpeed: 2.8 },
    bounds: [0.6, 0.333, 0.4],
  },

  tire: {
    id: "tire",
    displayName: "Neumático",
    asset: { pack: "propsSynthetic", node: "prop_tire", variants: 1 },
    surface: "rubber",
    physicsMode: "dynamic",
    physics: {
      mass: 9,
      linearDamping: 0.1,
      angularDamping: 0.15,
      // Poca fricción y mucho rebote: una cubierta suelta rueda y pica.
      friction: 0.85,
      restitution: 0.55,
      grabbable: true,
      impactDamage: false,
    },
    damage: {
      health: false,
      impactDamageSpeed: Infinity,
      impactDamageScale: 0,
    },
    breakReaction: INDESTRUCTIBLE,
    bounds: [0.66, 0.2, 0.66],
  },

  // -------------------------------------------------------------------------
  // Mobiliario
  //
  // Es lo que convierte un cuarto vacío en un cuarto donde vivía alguien, y de
  // paso llena la banda de peso que faltaba: acá arrancan los props que no se
  // levantan con las manos y los que sólo se mueven con la gravity gun.
  // -------------------------------------------------------------------------

  couch: {
    id: "couch",
    displayName: "Sillón de tres cuerpos",
    asset: { pack: "propsInterior", node: "prop_couch", variants: 1 },
    surface: "fabric",
    physicsMode: "dynamic",
    physics: {
      mass: 90,
      // El tapizado no rebota ni patina: se frena donde cae.
      linearDamping: 0.35,
      angularDamping: 0.7,
      friction: 0.85,
      restitution: 0.01,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 90,
      multipliers: { melee: 2, bullet: 0.5, explosive: 2.2 },
      impactDamageSpeed: 6,
      impactDamageScale: 2.5,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 4, maxChunks: 6, coreSurvives: false, burstSpeed: 2.4 },
    bounds: [2, 0.833, 0.907],
    navBlocking: true,
  },

  armchair: {
    id: "armchair",
    displayName: "Sillón",
    asset: { pack: "propsInterior", node: "prop_armchair", variants: 2 },
    surface: "fabric",
    physicsMode: "dynamic",
    physics: {
      mass: 45,
      linearDamping: 0.32,
      angularDamping: 0.65,
      friction: 0.85,
      restitution: 0.01,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 60,
      multipliers: { melee: 2, bullet: 0.5, explosive: 2.2 },
      impactDamageSpeed: 6,
      impactDamageScale: 2.5,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 3, maxChunks: 5, coreSurvives: false, burstSpeed: 2.6 },
    bounds: [0.95, 0.862, 0.911],
    navBlocking: true,
  },

  mattress: {
    id: "mattress",
    displayName: "Colchón",
    asset: { pack: "propsInterior", node: "prop_mattress", variants: 2 },
    surface: "fabric",
    physicsMode: "dynamic",
    physics: {
      mass: 25,
      linearDamping: 0.5,
      angularDamping: 0.85,
      friction: 0.95,
      // El único prop que amortigua de verdad lo que le cae encima.
      restitution: 0,
      grabbable: true,
      impactDamage: false,
    },
    damage: {
      health: false,
      impactDamageSpeed: Infinity,
      impactDamageScale: 0,
    },
    breakReaction: INDESTRUCTIBLE,
    bounds: [1.355, 0.22, 1.958],
  },

  bed: {
    id: "bed",
    displayName: "Cama",
    asset: { pack: "propsInterior", node: "prop_bed", variants: 1 },
    surface: "wood",
    physicsMode: "dynamic",
    physics: {
      mass: 70,
      linearDamping: 0.25,
      angularDamping: 0.55,
      friction: 0.8,
      restitution: 0.02,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 110,
      multipliers: { melee: 1.8, bullet: 0.5, explosive: 2.2 },
      impactDamageSpeed: 6,
      impactDamageScale: 2.5,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 4, maxChunks: 6, coreSurvives: false, burstSpeed: 2.8 },
    bounds: [1.45, 0.72, 2.05],
    navBlocking: true,
  },

  dresser: {
    id: "dresser",
    displayName: "Cómoda",
    asset: { pack: "propsInterior", node: "prop_dresser", variants: 2 },
    surface: "wood",
    physicsMode: "dynamic",
    physics: {
      mass: 60,
      linearDamping: 0.2,
      angularDamping: 0.45,
      friction: 0.75,
      restitution: 0.03,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 80,
      multipliers: { melee: 2.2, bullet: 0.7, explosive: 2.2 },
      impactDamageSpeed: 6,
      impactDamageScale: 3,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 4, maxChunks: 6, coreSurvives: false, burstSpeed: 3 },
    bounds: [1, 0.82, 0.577],
    navBlocking: true,
  },

  wardrobe: {
    id: "wardrobe",
    displayName: "Ropero",
    asset: { pack: "propsInterior", node: "prop_wardrobe", variants: 2 },
    surface: "wood",
    physicsMode: "dynamic",
    physics: {
      mass: 85,
      linearDamping: 0.2,
      angularDamping: 0.45,
      friction: 0.75,
      restitution: 0.03,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 95,
      multipliers: { melee: 2.2, bullet: 0.7, explosive: 2.2 },
      impactDamageSpeed: 6,
      impactDamageScale: 3,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 4, maxChunks: 6, coreSurvives: false, burstSpeed: 3.2 },
    bounds: [1, 1.9, 0.675],
    navBlocking: true,
  },

  bookshelf: {
    id: "bookshelf",
    displayName: "Biblioteca",
    asset: { pack: "propsInterior", node: "prop_bookshelf", variants: 2 },
    surface: "wood",
    physicsMode: "dynamic",
    physics: {
      mass: 40,
      linearDamping: 0.2,
      angularDamping: 0.45,
      friction: 0.75,
      restitution: 0.03,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 70,
      multipliers: { melee: 2.4, bullet: 0.8, explosive: 2.4 },
      impactDamageSpeed: 6,
      impactDamageScale: 3,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 4, maxChunks: 6, coreSurvives: false, burstSpeed: 3.2 },
    bounds: [0.9, 1.8, 0.32],
    navBlocking: true,
  },

  desk: {
    id: "desk",
    displayName: "Escritorio",
    asset: { pack: "propsInterior", node: "prop_desk", variants: 2 },
    surface: "wood",
    physicsMode: "dynamic",
    physics: {
      mass: 55,
      linearDamping: 0.2,
      angularDamping: 0.45,
      friction: 0.75,
      restitution: 0.03,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 85,
      multipliers: { melee: 2.2, bullet: 0.7, explosive: 2.2 },
      impactDamageSpeed: 6,
      impactDamageScale: 3,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 4, maxChunks: 6, coreSurvives: false, burstSpeed: 3 },
    bounds: [1.3, 0.75, 0.659],
    navBlocking: true,
  },

  nightstand: {
    id: "nightstand",
    displayName: "Mesa de luz",
    asset: { pack: "propsInterior", node: "prop_nightstand", variants: 2 },
    surface: "wood",
    physicsMode: "dynamic",
    physics: {
      mass: 18,
      linearDamping: 0.18,
      angularDamping: 0.42,
      friction: 0.72,
      restitution: 0.04,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 45,
      multipliers: { melee: 2.4, bullet: 0.8, explosive: 2.4 },
      impactDamageSpeed: 6.5,
      impactDamageScale: 3,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 3, maxChunks: 5, coreSurvives: false, burstSpeed: 3.2 },
    bounds: [0.45, 0.55, 0.428],
  },

  stool: {
    id: "stool",
    displayName: "Banqueta",
    asset: { pack: "propsInterior", node: "prop_stool", variants: 2 },
    surface: "wood",
    physicsMode: "dynamic",
    physics: {
      mass: 6,
      linearDamping: 0.16,
      angularDamping: 0.4,
      friction: 0.7,
      restitution: 0.06,
      grabbable: true,
      impactDamage: false,
    },
    damage: {
      health: 30,
      multipliers: { melee: 3, bullet: 0.9, explosive: 2.6 },
      impactDamageSpeed: 7,
      impactDamageScale: 3,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 3, maxChunks: 4, coreSurvives: false, burstSpeed: 3.6 },
    bounds: [0.34, 0.72, 0.34],
  },

  bench: {
    id: "bench",
    displayName: "Banco",
    asset: { pack: "propsInterior", node: "prop_bench", variants: 2 },
    surface: "wood",
    physicsMode: "dynamic",
    physics: {
      mass: 30,
      linearDamping: 0.18,
      angularDamping: 0.42,
      friction: 0.78,
      restitution: 0.04,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 60,
      multipliers: { melee: 2.2, bullet: 0.7, explosive: 2.2 },
      impactDamageSpeed: 6.5,
      impactDamageScale: 3,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 3, maxChunks: 5, coreSurvives: false, burstSpeed: 3.2 },
    bounds: [1.6, 0.45, 0.39],
    navBlocking: true,
  },

  officeChair: {
    id: "officeChair",
    displayName: "Silla de oficina",
    asset: { pack: "propsInterior", node: "prop_officeChair", variants: 2 },
    surface: "plastic",
    physicsMode: "dynamic",
    physics: {
      mass: 14,
      // Rueda: poca fricción y poco freno angular, a diferencia del resto.
      linearDamping: 0.08,
      angularDamping: 0.3,
      friction: 0.35,
      restitution: 0.1,
      grabbable: true,
      impactDamage: false,
    },
    damage: {
      health: 45,
      multipliers: { melee: 2.4, bullet: 1.2, explosive: 2.4 },
      impactDamageSpeed: 7,
      impactDamageScale: 2.5,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 3, maxChunks: 5, coreSurvives: false, burstSpeed: 3.4 },
    bounds: [0.585, 0.952, 0.578],
  },

  // -------------------------------------------------------------------------
  // Electrodomésticos e instalaciones
  //
  // Los pesos pesados del catálogo: por encima de los 35 kg de `CarryConfig` no
  // se levantan con las manos, y los de más de 150 kg sólo se mueven con la
  // gravity gun, un vehículo o una explosión. Los de chapa se abollan y no se
  // rompen: una heladera baleada queda hecha un colador, no astillas.
  // -------------------------------------------------------------------------

  fridge: {
    id: "fridge",
    displayName: "Heladera",
    asset: { pack: "propsAppliance", node: "prop_fridge", variants: 2 },
    surface: "metal",
    physicsMode: "dynamic",
    physics: {
      mass: 160,
      linearDamping: 0.2,
      angularDamping: 0.45,
      friction: 0.7,
      restitution: 0.02,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: false,
      impactDamageSpeed: Infinity,
      impactDamageScale: 0,
    },
    breakReaction: INDESTRUCTIBLE,
    deform: metalDeform(0.24, 0.035, 0.12),
    bounds: [0.7, 1.75, 0.725],
    navBlocking: true,
  },

  washingMachine: {
    id: "washingMachine",
    displayName: "Lavarropas",
    asset: { pack: "propsAppliance", node: "prop_washingMachine", variants: 2 },
    surface: "metal",
    physicsMode: "dynamic",
    physics: {
      mass: 180,
      linearDamping: 0.22,
      angularDamping: 0.5,
      friction: 0.72,
      restitution: 0.02,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: false,
      impactDamageSpeed: Infinity,
      impactDamageScale: 0,
    },
    breakReaction: INDESTRUCTIBLE,
    deform: metalDeform(0.2, 0.03, 0.1),
    bounds: [0.6, 0.85, 0.631],
    navBlocking: true,
  },

  stove: {
    id: "stove",
    displayName: "Cocina",
    asset: { pack: "propsAppliance", node: "prop_stove", variants: 2 },
    surface: "metal",
    physicsMode: "dynamic",
    physics: {
      mass: 75,
      linearDamping: 0.2,
      angularDamping: 0.45,
      friction: 0.7,
      restitution: 0.02,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: false,
      impactDamageSpeed: Infinity,
      impactDamageScale: 0,
    },
    breakReaction: INDESTRUCTIBLE,
    deform: metalDeform(0.2, 0.03, 0.1),
    bounds: [0.6, 0.907, 0.646],
    navBlocking: true,
  },

  kitchenCounter: {
    id: "kitchenCounter",
    displayName: "Mesada",
    asset: { pack: "propsAppliance", node: "prop_kitchenCounter", variants: 2 },
    surface: "wood",
    physicsMode: "dynamic",
    physics: {
      mass: 120,
      linearDamping: 0.2,
      angularDamping: 0.45,
      friction: 0.8,
      restitution: 0.02,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 130,
      multipliers: { melee: 1.8, bullet: 0.6, explosive: 2.2 },
      impactDamageSpeed: 6,
      impactDamageScale: 3,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 4, maxChunks: 6, coreSurvives: false, burstSpeed: 2.8 },
    bounds: [1.2, 0.9, 0.65],
    navBlocking: true,
  },

  bathtub: {
    id: "bathtub",
    displayName: "Bañera",
    asset: { pack: "propsAppliance", node: "prop_bathtub", variants: 1 },
    surface: "tile",
    physicsMode: "dynamic",
    physics: {
      // Lo más pesado del catálogo: hierro fundido esmaltado. Ni con la gravity
      // gun se levanta cómodo, que es exactamente lo que tiene que sentirse.
      mass: 210,
      linearDamping: 0.25,
      angularDamping: 0.5,
      friction: 0.75,
      restitution: 0.02,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 140,
      // La porcelana estalla con el impacto y se ríe de las balas.
      multipliers: { melee: 2.5, bullet: 0.4, explosive: 3 },
      impactDamageSpeed: 5,
      impactDamageScale: 4,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 4, maxChunks: 5, coreSurvives: false, burstSpeed: 3 },
    bounds: [1.7, 0.67, 0.75],
    navBlocking: true,
  },

  toilet: {
    id: "toilet",
    displayName: "Inodoro",
    asset: { pack: "propsAppliance", node: "prop_toilet", variants: 1 },
    surface: "tile",
    physicsMode: "dynamic",
    physics: {
      mass: 55,
      linearDamping: 0.2,
      angularDamping: 0.45,
      friction: 0.7,
      restitution: 0.02,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 40,
      multipliers: { melee: 3, bullet: 0.6, explosive: 3 },
      impactDamageSpeed: 5,
      impactDamageScale: 4,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 3, maxChunks: 4, coreSurvives: false, burstSpeed: 3.4 },
    bounds: [0.4, 0.78, 0.65],
  },

  sink: {
    id: "sink",
    displayName: "Lavatorio",
    asset: { pack: "propsAppliance", node: "prop_sink", variants: 2 },
    surface: "tile",
    physicsMode: "dynamic",
    physics: {
      mass: 40,
      linearDamping: 0.2,
      angularDamping: 0.45,
      friction: 0.7,
      restitution: 0.02,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 35,
      multipliers: { melee: 3, bullet: 0.6, explosive: 3 },
      impactDamageSpeed: 5,
      impactDamageScale: 4,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 3, maxChunks: 4, coreSurvives: false, burstSpeed: 3.4 },
    bounds: [0.58, 0.935, 0.48],
  },

  lockerBank: {
    id: "lockerBank",
    displayName: "Lockers",
    asset: { pack: "propsAppliance", node: "prop_lockerBank", variants: 2 },
    surface: "metal",
    physicsMode: "dynamic",
    physics: {
      mass: 110,
      linearDamping: 0.2,
      angularDamping: 0.45,
      friction: 0.7,
      restitution: 0.04,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: false,
      impactDamageSpeed: Infinity,
      impactDamageScale: 0,
    },
    breakReaction: INDESTRUCTIBLE,
    deform: metalDeform(0.22, 0.035, 0.11),
    bounds: [0.92, 1.8, 0.543],
    navBlocking: true,
  },

  // -------------------------------------------------------------------------
  // Escombro
  //
  // Es lo que convierte un pasillo en un pasillo derrumbado. Dos reglas de la
  // familia: el hormigón se ríe de las balas y sólo cede a explosivos, y el
  // acero estructural no se rompe — se dobla, y sirve de miembro de estructura.
  // -------------------------------------------------------------------------

  concreteSlab: {
    id: "concreteSlab",
    displayName: "Losa",
    asset: { pack: "propsDebris", node: "prop_concreteSlab", variants: 2 },
    surface: "concrete",
    physicsMode: "dynamic",
    physics: {
      mass: 190,
      linearDamping: 0.25,
      angularDamping: 0.55,
      friction: 0.98,
      restitution: 0.01,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 150,
      multipliers: { melee: 0.3, bullet: 0.15, explosive: 3 },
      impactDamageSpeed: 5,
      impactDamageScale: 4,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 3, maxChunks: 5, coreSurvives: false, burstSpeed: 2.4 },
    bounds: [1.25, 0.26, 1.001],
    navBlocking: true,
  },

  brokenPillar: {
    id: "brokenPillar",
    displayName: "Columna partida",
    asset: { pack: "propsDebris", node: "prop_brokenPillar", variants: 2 },
    surface: "concrete",
    physicsMode: "dynamic",
    physics: {
      mass: 170,
      linearDamping: 0.25,
      angularDamping: 0.55,
      friction: 0.95,
      restitution: 0.01,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 160,
      multipliers: { melee: 0.3, bullet: 0.15, explosive: 3 },
      impactDamageSpeed: 5,
      impactDamageScale: 4,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 3, maxChunks: 5, coreSurvives: false, burstSpeed: 2.6 },
    bounds: [0.44, 1.407, 0.44],
    navBlocking: true,
  },

  brickPile: {
    id: "brickPile",
    displayName: "Pila de ladrillos",
    asset: { pack: "propsDebris", node: "prop_brickPile", variants: 2 },
    surface: "concrete",
    physicsMode: "dynamic",
    physics: {
      mass: 65,
      linearDamping: 0.3,
      angularDamping: 0.6,
      friction: 0.95,
      restitution: 0.01,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 55,
      // Una pila apenas se sostiene: el fierrazo la desarma de una.
      multipliers: { melee: 2.5, bullet: 0.5, explosive: 3 },
      impactDamageSpeed: 5,
      impactDamageScale: 4,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 4, maxChunks: 6, coreSurvives: false, burstSpeed: 3.2 },
    bounds: [0.78, 0.41, 0.6],
  },

  rebarBundle: {
    id: "rebarBundle",
    displayName: "Atado de hierros",
    asset: { pack: "propsDebris", node: "prop_rebarBundle", variants: 2 },
    surface: "metal",
    physicsMode: "dynamic",
    physics: {
      mass: 48,
      linearDamping: 0.15,
      angularDamping: 0.3,
      friction: 0.6,
      restitution: 0.05,
      grabbable: true,
      // 1.7 m de hierro girando: de lo más letal que se puede tirar.
      impactDamage: true,
    },
    damage: {
      health: false,
      impactDamageSpeed: 6,
      impactDamageScale: 4,
    },
    breakReaction: INDESTRUCTIBLE,
    deform: metalDeform(0.09, 0.008, 0.03),
    bounds: [1.7, 0.111, 0.11],
  },

  iBeam: {
    id: "iBeam",
    displayName: "Viga doble T",
    asset: { pack: "propsDebris", node: "prop_iBeam", variants: 2 },
    surface: "metal",
    physicsMode: "dynamic",
    physics: {
      mass: 230,
      linearDamping: 0.2,
      angularDamping: 0.4,
      friction: 0.65,
      restitution: 0.03,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: false,
      impactDamageSpeed: 5,
      impactDamageScale: 6,
    },
    // El acero estructural no se rompe: se dobla. Es además el miembro natural
    // de una estructura articulada.
    breakReaction: INDESTRUCTIBLE,
    deform: metalDeform(0.16, 0.014, 0.055),
    bounds: [2.2, 0.24, 0.2],
    navBlocking: true,
  },

  metalPanel: {
    id: "metalPanel",
    displayName: "Chapa doblada",
    asset: { pack: "propsDebris", node: "prop_metalPanel", variants: 2 },
    surface: "metal",
    physicsMode: "dynamic",
    physics: {
      mass: 22,
      // Grande y liviana: se va al aire con cualquier explosión.
      linearDamping: 0.28,
      angularDamping: 0.5,
      friction: 0.5,
      restitution: 0.15,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: false,
      impactDamageSpeed: 8,
      impactDamageScale: 2,
    },
    breakReaction: INDESTRUCTIBLE,
    deform: metalDeform(0.22, 0.03, 0.09),
    bounds: [1.101, 0.85, 0.21],
  },

  scrapHeap: {
    id: "scrapHeap",
    displayName: "Chatarra",
    asset: { pack: "propsDebris", node: "prop_scrapHeap", variants: 2 },
    surface: "metal",
    physicsMode: "dynamic",
    physics: {
      mass: 70,
      linearDamping: 0.3,
      angularDamping: 0.6,
      friction: 0.85,
      restitution: 0.05,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 70,
      multipliers: { melee: 1.5, bullet: 0.6, explosive: 2.5 },
      impactDamageSpeed: 6,
      impactDamageScale: 3,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 4, maxChunks: 6, coreSurvives: false, burstSpeed: 3.4 },
    deform: metalDeform(0.18, 0.02, 0.08),
    bounds: [0.95, 0.501, 0.8],
  },

  scaffoldPipe: {
    id: "scaffoldPipe",
    displayName: "Tubo de andamio",
    asset: { pack: "propsDebris", node: "prop_scaffoldPipe", variants: 2 },
    surface: "metal",
    physicsMode: "dynamic",
    physics: {
      mass: 11,
      linearDamping: 0.12,
      angularDamping: 0.22,
      friction: 0.4,
      restitution: 0.2,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: false,
      impactDamageSpeed: 7,
      impactDamageScale: 3,
    },
    breakReaction: INDESTRUCTIBLE,
    deform: metalDeform(0.07, 0.006, 0.02),
    bounds: [1.9, 0.088, 0.104],
  },

  plasterSlab: {
    id: "plasterSlab",
    displayName: "Placa de yeso",
    asset: { pack: "propsDebris", node: "prop_plasterSlab", variants: 2 },
    surface: "tile",
    physicsMode: "dynamic",
    physics: {
      mass: 14,
      linearDamping: 0.3,
      angularDamping: 0.55,
      friction: 0.8,
      restitution: 0.02,
      grabbable: true,
      impactDamage: false,
    },
    damage: {
      // Lo más frágil que no es vidrio: se deshace con mirarlo.
      health: 10,
      multipliers: { melee: 4, bullet: 2.5, explosive: 4 },
      impactDamageSpeed: 3.5,
      impactDamageScale: 6,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 3, maxChunks: 4, coreSurvives: false, burstSpeed: 2.2 },
    bounds: [1.05, 0.135, 0.72],
  },

  sandbag: {
    id: "sandbag",
    displayName: "Bolsa de arena",
    asset: { pack: "propsDebris", node: "prop_sandbag", variants: 2 },
    surface: "sand",
    physicsMode: "dynamic",
    physics: {
      mass: 22,
      // No rueda ni rebota: cae y se queda. Es lo que la hace apilable.
      linearDamping: 0.45,
      angularDamping: 0.85,
      friction: 0.98,
      restitution: 0,
      grabbable: true,
      impactDamage: false,
    },
    damage: {
      health: false,
      impactDamageSpeed: Infinity,
      impactDamageScale: 0,
    },
    breakReaction: INDESTRUCTIBLE,
    bounds: [0.52, 0.2, 0.32],
  },

  barricadeWood: {
    id: "barricadeWood",
    displayName: "Barricada",
    asset: { pack: "propsDebris", node: "prop_barricadeWood", variants: 2 },
    surface: "wood",
    physicsMode: "dynamic",
    physics: {
      mass: 26,
      linearDamping: 0.2,
      angularDamping: 0.45,
      friction: 0.8,
      restitution: 0.04,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 55,
      multipliers: { melee: 2.5, bullet: 0.8, explosive: 2.5 },
      impactDamageSpeed: 6,
      impactDamageScale: 3,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 4, maxChunks: 6, coreSurvives: false, burstSpeed: 3.6 },
    bounds: [1.503, 1.052, 0.082],
    navBlocking: true,
  },

  // -------------------------------------------------------------------------
  // Electrónica y Combine
  //
  // La familia frágil: casi todo cede a un par de tiros porque son carcasas de
  // chapa fina y plástico alrededor de tubos y vidrio. Lo Combine es la
  // excepción — chapa de verdad, que se abolla en vez de romperse.
  // -------------------------------------------------------------------------

  monitor: {
    id: "monitor",
    displayName: "Monitor",
    asset: { pack: "propsTech", node: "prop_monitor", variants: 2 },
    surface: "plastic",
    physicsMode: "dynamic",
    physics: {
      mass: 12,
      linearDamping: 0.18,
      angularDamping: 0.42,
      friction: 0.6,
      restitution: 0.05,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 24,
      multipliers: { melee: 3, bullet: 2.5, explosive: 3 },
      impactDamageSpeed: 5,
      impactDamageScale: 4,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 3, maxChunks: 5, coreSurvives: false, burstSpeed: 3.6 },
    bounds: [0.42, 0.365, 0.429],
  },

  serverRack: {
    id: "serverRack",
    displayName: "Rack de servidores",
    asset: { pack: "propsTech", node: "prop_serverRack", variants: 1 },
    surface: "metal",
    physicsMode: "dynamic",
    physics: {
      mass: 145,
      linearDamping: 0.22,
      angularDamping: 0.5,
      friction: 0.7,
      restitution: 0.02,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 200,
      multipliers: { melee: 0.8, bullet: 1.2, explosive: 2.2 },
      impactDamageSpeed: 7,
      impactDamageScale: 3,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 4, maxChunks: 6, coreSurvives: true, burstSpeed: 3 },
    deform: metalDeform(0.2, 0.03, 0.11),
    bounds: [0.6, 1.85, 0.825],
    navBlocking: true,
  },

  harddrive: {
    id: "harddrive",
    displayName: "Disco rígido",
    asset: { pack: "propsTech", node: "prop_harddrive", variants: 2 },
    surface: "metal",
    physicsMode: "dynamic",
    physics: {
      // Denso para su tamaño, como uno de verdad: pesa más de lo que aparenta.
      mass: 0.7,
      linearDamping: 0.08,
      angularDamping: 0.2,
      friction: 0.4,
      restitution: 0.15,
      grabbable: true,
      impactDamage: false,
    },
    damage: {
      health: false,
      impactDamageSpeed: Infinity,
      impactDamageScale: 0,
    },
    breakReaction: INDESTRUCTIBLE,
    deform: metalDeform(0.04, 0.003, 0.008),
    bounds: [0.15, 0.033, 0.106],
  },

  powerBox: {
    id: "powerBox",
    displayName: "Caja de energía",
    asset: { pack: "propsTech", node: "prop_powerBox", variants: 2 },
    surface: "metal",
    physicsMode: "dynamic",
    physics: {
      mass: 16,
      linearDamping: 0.16,
      angularDamping: 0.38,
      friction: 0.55,
      restitution: 0.06,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 45,
      multipliers: { melee: 2, bullet: 1.5, explosive: 2.5 },
      impactDamageSpeed: 7,
      impactDamageScale: 2.5,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 3, maxChunks: 5, coreSurvives: false, burstSpeed: 3.4 },
    deform: metalDeform(0.1, 0.012, 0.04),
    bounds: [0.344, 0.46, 0.197],
  },

  keypad: {
    id: "keypad",
    displayName: "Teclado de acceso",
    asset: { pack: "propsTech", node: "prop_keypad", variants: 2 },
    surface: "metal",
    physicsMode: "dynamic",
    physics: {
      mass: 2.5,
      linearDamping: 0.15,
      angularDamping: 0.4,
      friction: 0.55,
      restitution: 0.08,
      grabbable: true,
      impactDamage: false,
    },
    damage: {
      // Es un dispositivo de seguridad: aguanta unos tiros antes de ceder, y
      // esa vida es la que deja ver el abollón de la chapa.
      health: 45,
      multipliers: { melee: 3, bullet: 2.5, explosive: 3 },
      impactDamageSpeed: Infinity,
      impactDamageScale: 0,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 3, maxChunks: 4, coreSurvives: false, burstSpeed: 3 },
    deform: metalDeform(0.05, 0.005, 0.015),
    bounds: [0.128, 0.26, 0.19],
  },

  radio: {
    id: "radio",
    displayName: "Radio",
    asset: { pack: "propsTech", node: "prop_radio", variants: 2 },
    surface: "plastic",
    physicsMode: "dynamic",
    physics: {
      mass: 3.5,
      linearDamping: 0.15,
      angularDamping: 0.4,
      friction: 0.55,
      restitution: 0.1,
      grabbable: true,
      impactDamage: false,
    },
    damage: {
      health: 16,
      multipliers: { melee: 3, bullet: 3, explosive: 3 },
      impactDamageSpeed: 6,
      impactDamageScale: 3,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 3, maxChunks: 4, coreSurvives: false, burstSpeed: 3.2 },
    bounds: [0.3, 0.253, 0.198],
  },

  vendingMachine: {
    id: "vendingMachine",
    displayName: "Expendedora",
    asset: { pack: "propsTech", node: "prop_vendingMachine", variants: 1 },
    surface: "metal",
    physicsMode: "dynamic",
    physics: {
      mass: 195,
      linearDamping: 0.22,
      angularDamping: 0.5,
      friction: 0.72,
      restitution: 0.02,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      // Aguanta un montón: la vidriera se raja mucho antes que el gabinete.
      health: 240,
      multipliers: { melee: 0.9, bullet: 1, explosive: 2.2 },
      impactDamageSpeed: 7,
      impactDamageScale: 3,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 4, maxChunks: 6, coreSurvives: true, burstSpeed: 3.2 },
    deform: metalDeform(0.26, 0.035, 0.13),
    bounds: [0.82, 1.88, 0.783],
    navBlocking: true,
  },

  waterCooler: {
    id: "waterCooler",
    displayName: "Dispenser",
    asset: { pack: "propsTech", node: "prop_waterCooler", variants: 2 },
    surface: "plastic",
    physicsMode: "dynamic",
    physics: {
      mass: 28,
      linearDamping: 0.2,
      angularDamping: 0.45,
      friction: 0.6,
      restitution: 0.04,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 40,
      // El bidón revienta primero: mucho vidrio arriba y poco peso abajo.
      multipliers: { melee: 2.5, bullet: 3, explosive: 3 },
      impactDamageSpeed: 6,
      impactDamageScale: 3,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 3, maxChunks: 5, coreSurvives: false, burstSpeed: 3.4 },
    bounds: [0.34, 1.112, 0.353],
  },

  labJar: {
    id: "labJar",
    displayName: "Frasco de laboratorio",
    asset: { pack: "propsTech", node: "prop_labJar", variants: 2 },
    surface: "glass",
    physicsMode: "dynamic",
    physics: {
      mass: 1.4,
      linearDamping: 0.06,
      angularDamping: 0.2,
      friction: 0.3,
      restitution: 0.1,
      grabbable: true,
      impactDamage: false,
    },
    damage: {
      health: 3,
      multipliers: { melee: 5, bullet: 5, explosive: 5 },
      impactDamageSpeed: 2.5,
      impactDamageScale: 8,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 3, maxChunks: 4, coreSurvives: false, burstSpeed: 2.4 },
    bounds: [0.146, 0.26, 0.15],
  },

  partsBin: {
    id: "partsBin",
    displayName: "Bandeja de repuestos",
    asset: { pack: "propsTech", node: "prop_partsBin", variants: 2 },
    surface: "metal",
    physicsMode: "dynamic",
    physics: {
      mass: 5,
      linearDamping: 0.14,
      angularDamping: 0.35,
      friction: 0.5,
      restitution: 0.12,
      grabbable: true,
      impactDamage: false,
    },
    damage: {
      // Chapa doblada: se abolla mucho antes de reventar, y por eso necesita
      // vida suficiente como para que el abollón llegue a verse.
      health: 55,
      multipliers: { melee: 2.5, bullet: 1.5, explosive: 2.5 },
      impactDamageSpeed: 8,
      impactDamageScale: 2,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 3, maxChunks: 4, coreSurvives: false, burstSpeed: 3 },
    deform: metalDeform(0.07, 0.008, 0.03),
    bounds: [0.42, 0.18, 0.3],
  },

  combineCrate: {
    id: "combineCrate",
    displayName: "Cajón Combine",
    asset: { pack: "propsTech", node: "prop_combineCrate", variants: 2 },
    surface: "metal",
    physicsMode: "dynamic",
    physics: {
      mass: 55,
      linearDamping: 0.15,
      angularDamping: 0.4,
      friction: 0.65,
      restitution: 0.04,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      // Cuesta el doble que un cajón de madera: es acero, no pino.
      health: 180,
      multipliers: { melee: 0.6, bullet: 0.9, explosive: 2.2 },
      impactDamageSpeed: 7,
      impactDamageScale: 2.5,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 4, maxChunks: 6, coreSurvives: false, burstSpeed: 3.4 },
    deform: metalDeform(0.22, 0.03, 0.12),
    bounds: [0.768, 0.696, 0.776],
    navBlocking: true,
  },

  combineBarrier: {
    id: "combineBarrier",
    displayName: "Barricada Combine",
    asset: { pack: "propsTech", node: "prop_combineBarrier", variants: 2 },
    surface: "metal",
    physicsMode: "dynamic",
    physics: {
      mass: 95,
      linearDamping: 0.2,
      angularDamping: 0.45,
      friction: 0.8,
      restitution: 0.02,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: false,
      impactDamageSpeed: 7,
      impactDamageScale: 3,
    },
    // Es un parapeto: se abolla a tiros y no se rompe. Con `anchored` corta el
    // pathing igual que las cajas de cobertura.
    breakReaction: INDESTRUCTIBLE,
    deform: metalDeform(0.24, 0.03, 0.11),
    bounds: [1.25, 1.063, 0.429],
    navBlocking: true,
  },

  combineEmitter: {
    id: "combineEmitter",
    displayName: "Emisor Combine",
    asset: { pack: "propsTech", node: "prop_combineEmitter", variants: 2 },
    surface: "metal",
    physicsMode: "dynamic",
    physics: {
      mass: 42,
      linearDamping: 0.18,
      angularDamping: 0.42,
      friction: 0.6,
      restitution: 0.04,
      grabbable: true,
      impactDamage: true,
    },
    damage: {
      health: 90,
      multipliers: { melee: 1, bullet: 1.4, explosive: 2.5 },
      impactDamageSpeed: 7,
      impactDamageScale: 2.5,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 3, maxChunks: 5, coreSurvives: false, burstSpeed: 4 },
    deform: metalDeform(0.12, 0.015, 0.055),
    bounds: [0.36, 0.92, 0.36],
  },

  combineLamp: {
    id: "combineLamp",
    displayName: "Lámpara Combine",
    asset: { pack: "propsTech", node: "prop_combineLamp", variants: 2 },
    surface: "metal",
    physicsMode: "dynamic",
    physics: {
      mass: 9,
      linearDamping: 0.16,
      angularDamping: 0.4,
      friction: 0.55,
      restitution: 0.06,
      grabbable: true,
      impactDamage: false,
    },
    damage: {
      // Carcasa de chapa con reja: hay que insistir para bajarla, y mientras
      // tanto se va abollando.
      health: 50,
      multipliers: { melee: 2.5, bullet: 2, explosive: 2.5 },
      impactDamageSpeed: 8,
      impactDamageScale: 2,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 3, maxChunks: 4, coreSurvives: false, burstSpeed: 3.2 },
    deform: metalDeform(0.08, 0.008, 0.03),
    bounds: [0.42, 0.24, 0.267],
  },
};

/**
 * Abollar exige clonar la geometría del prop (la del GLB es compartida por
 * todas sus instancias), así que el techo es duro: son 12 mallas vivas, no 12
 * "aproximadamente". Sin él, cada barril que el jugador balea en una partida
 * larga deja una geometría en memoria para siempre.
 */
export const PropDeformConfig = {
  maxDeformedProps: 12,
  /** Daño mínimo para que un golpe deje marca. Un rasguño no abolla. */
  minDamage: 4,
  /** Daño que produce el hundimiento nominal del perfil. */
  referenceDamage: 25,
  /**
   * Techo del multiplicador por daño. Un cañonazo abolla mucho más que un
   * balazo, pero no arbitrariamente: pasado esto manda `maxDepth`.
   */
  maxDamageScale: 3,
} as const;

export const PropTuning = {
  /**
   * Huella mínima para que un prop anclado entre al bake de navegación.
   *
   * Es deliberadamente chica. Un cajón estático mide 0.89 m y hoy vive en
   * `staticBoxes`, o sea DENTRO del navmesh horneado: si al migrarlo quedara
   * fuera, los NPCs lo atravesarían. Quién puede rodear qué ya lo decide Recast
   * con el radio de agente y el tamaño de celda, que es mucho mejor filtro que
   * un umbral inventado acá; esto sólo saca del bake lo que el navmesh no
   * podría representar igual (una botella, un cono).
   */
  navBlockerMinFootprint: 0.3,
  /** Escala mínima admitida en una instancia, para que la masa no se anule. */
  minScale: 0.25,
  maxScale: 4,
} as const;
