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

/** Los 12 arquetipos se reparten en tres GLB para compartir atlas. */
export type PropPackId = "propsWood" | "propsMetal" | "propsSynthetic";

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

/** Un metal abollable comparte el mismo tacto; sólo cambia la escala. */
function metalDeform(radius: number, depth: number): PropDeformProfile {
  return { radius, depth, maxDepth: depth * 4, cooldown: 0.15 };
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
      health: 75,
      multipliers: { melee: 0.5, bullet: 1, explosive: 2.2 },
      impactDamageSpeed: 8,
      impactDamageScale: 2,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 4, maxChunks: 7, coreSurvives: false, burstSpeed: 3 },
    deform: metalDeform(0.22, 0.02),
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
      health: 120,
      multipliers: { melee: 0.4, bullet: 0.8, explosive: 2 },
      impactDamageSpeed: 9,
      impactDamageScale: 1.5,
    },
    breakReaction: SHATTER,
    // Los cajones salen disparados y el chasis queda de pie: es lo que hace que
    // una oficina reventada siga leyéndose como oficina.
    gibs: { minChunks: 3, maxChunks: 5, coreSurvives: true, burstSpeed: 2.6 },
    deform: metalDeform(0.26, 0.025),
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
      health: 85,
      multipliers: { melee: 0.5, explosive: 2 },
      impactDamageSpeed: 8,
      impactDamageScale: 2,
    },
    breakReaction: SHATTER,
    gibs: { minChunks: 4, maxChunks: 6, coreSurvives: false, burstSpeed: 2.8 },
    deform: metalDeform(0.18, 0.018),
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
    deform: metalDeform(0.14, 0.012),
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
};

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
