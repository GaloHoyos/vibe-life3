import { PROP_ARCHETYPE_IDS, PropArchetypes } from "@game/config/props.config";
import {
  crateStackStructure,
  scaffoldTowerStructure,
  shelfUnitStructure,
} from "@game/levels/builders/PropStructureBuilder";
import type { LevelDefinition, PropDefinition } from "@game/levels/LevelDefinition";

/**
 * Banco de pruebas del sistema de props: uno de cada arquetipo en fila sobre un
 * banco, más una pila suelta para empujar y un balcón desde el que tirarlos.
 * Lo que se verifica acá es lo que no se ve en un test: cómo pesan, cómo suenan
 * al chocar y cuánto aguantan antes de romperse.
 */
const BENCH_Z = -4;
const BENCH_TOP = 0.9;
const SPACING = 2.2;

/** Los 12 arquetipos en fila, centrados sobre el banco. */
const catalogRow: PropDefinition[] = PROP_ARCHETYPE_IDS.map((archetypeId, index) => ({
  id: `catalog-${archetypeId}`,
  archetypeId,
  position: [(index - (PROP_ARCHETYPE_IDS.length - 1) / 2) * SPACING, BENCH_TOP, BENCH_Z],
}));

/** Pila de cajones para empujar y gravity-gunear en el piso. */
const crateStack: PropDefinition[] = [
  { id: "stack-a", archetypeId: "woodenCrate", position: [-6, 0, 3] },
  { id: "stack-b", archetypeId: "woodenCrate", position: [-6, 0.9, 3] },
  { id: "stack-c", archetypeId: "woodenCrate", position: [-5.1, 0, 3] },
  { id: "pallet-base", archetypeId: "pallet", position: [-6, 0, 5] },
];

/**
 * Estructuras articuladas. La pila de la izquierda aguanta como una sola pieza
 * hasta que le vuelan la base; la estantería de la derecha va atornillada y
 * cede de a un estante.
 */
const jointedStack = crateStackStructure({
  id: "sandbox-stack",
  at: [-11, -2],
  perLayer: 2,
  layers: 3,
});

const jointedShelf = shelfUnitStructure({
  id: "sandbox-shelf",
  at: [11, -12],
  shelves: 4,
  spacing: 0.95,
  archetypeId: "metalBarrel",
  cascade: false,
});

const scaffold = scaffoldTowerStructure({
  id: "sandbox-scaffold",
  at: [17, 6],
  levels: 4,
});

/** Frágiles agrupados: es donde más se nota el material al romperse. */
const fragileShelf: PropDefinition[] = [
  { id: "bottle-1", archetypeId: "glassBottle", position: [5, 0.9, 3] },
  { id: "bottle-2", archetypeId: "glassBottle", position: [5.3, 0.9, 3.2], rotation: [0, 0.6, 0] },
  { id: "bottle-3", archetypeId: "glassBottle", position: [5.6, 0.9, 2.9] },
  { id: "tv-1", archetypeId: "crtTelevision", position: [6.6, 0.9, 3] },
];

/** Un bloque anclado: verifica el camino de `navBlockers` en el bake. */
const anchored: PropDefinition[] = [
  {
    id: "anchored-block",
    archetypeId: "concreteBlock",
    position: [0, 0, 7],
    physicsMode: "anchored",
    scale: 3,
  },
];

/** Escalados, para ver que la masa acompaña al tamaño. */
const scaled: PropDefinition[] = [
  { id: "barrel-small", archetypeId: "metalBarrel", position: [9, 0, 0], scale: 0.5 },
  { id: "barrel-big", archetypeId: "metalBarrel", position: [11, 0, 0], scale: 1.8 },
];

export const PropSandboxLevel: LevelDefinition = {
  id: "prop-sandbox",
  title: "Sandbox de props",
  description: `Uno de cada arquetipo (${PROP_ARCHETYPE_IDS.length}) para probar masa, sonido de impacto y rotura.`,
  objective: {
    text: "Probá masa, impacto y rotura de cada prop",
    marker: [0, 1, BENCH_Z],
  },
  background: 0x1c2228,
  sun: {
    direction: [0.4, 1, 0.3],
    color: 0xf2f6ff,
    intensity: 1.6,
  },
  playerStart: [0, 1.05, 12],
  audio: {
    ambiences: ["background.wind"],
    soundscape: "lab",
    footstepSounds: [
      "footsteps.hl2.concrete1",
      "footsteps.hl2.concrete2",
      "footsteps.hl2.concrete3",
      "footsteps.hl2.concrete4",
    ],
  },
  staticBoxes: [
    { id: "sandbox-floor", position: [0, -0.5, 0], size: [46, 1, 40], material: "floor" },
    { id: "sandbox-north", position: [0, 2.5, -20], size: [46, 5, 0.5], material: "wall" },
    { id: "sandbox-south", position: [0, 2.5, 20], size: [46, 5, 0.5], material: "wall" },
    { id: "sandbox-west", position: [-23, 2.5, 0], size: [0.5, 5, 40], material: "wall" },
    { id: "sandbox-east", position: [23, 2.5, 0], size: [0.5, 5, 40], material: "wall" },
    // Banco del catálogo.
    {
      id: "sandbox-bench",
      position: [0, BENCH_TOP / 2, BENCH_Z],
      size: [PROP_ARCHETYPE_IDS.length * SPACING + 1, BENCH_TOP, 1.6],
      material: "trim",
    },
    // Balcón para tirar props desde altura y oír la diferencia por material.
    { id: "sandbox-ledge", position: [-14, 3, -8], size: [8, 0.4, 6], material: "concrete" },
    { id: "sandbox-ledge-ramp-1", position: [-14, 0.5, -3.4], size: [3, 1, 1.2], material: "concrete" },
    { id: "sandbox-ledge-ramp-2", position: [-14, 1.4, -4.6], size: [3, 1, 1.2], material: "concrete" },
    { id: "sandbox-ledge-ramp-3", position: [-14, 2.3, -5.8], size: [3, 1, 1.2], material: "concrete" },
    // Yunque contra el que estrellar props lanzados.
    { id: "sandbox-anvil", position: [14, 1.5, -8], size: [4, 3, 1], material: "metalRusted" },
    { id: "sandbox-weapon-bench", position: [0, 0.4, 9], size: [12, 0.8, 1.2], material: "trim" },
  ],
  dynamicBoxes: [],
  props: [
    ...catalogRow,
    ...crateStack,
    ...fragileShelf,
    ...anchored,
    ...scaled,
    ...jointedStack.props,
    ...jointedShelf.props,
    ...scaffold.props,
  ],
  propStructures: [jointedStack.structure, jointedShelf.structure, scaffold.structure],
  navBlockers: [
    {
      id: "anchored-block-nav",
      position: [
        0,
        (PropArchetypes.concreteBlock.bounds[1] * 3) / 2,
        7,
      ],
      size: [
        PropArchetypes.concreteBlock.bounds[0] * 3,
        PropArchetypes.concreteBlock.bounds[1] * 3,
        PropArchetypes.concreteBlock.bounds[2] * 3,
      ],
      material: "trim",
    },
  ],
  doors: [],
  npcs: [],
  weaponPickups: [
    { id: "sandbox-crowbar", weaponId: "crowbar", position: [-4, 0.85, 9] },
    { id: "sandbox-pistol", weaponId: "pistol", position: [-2, 0.85, 9] },
    { id: "sandbox-shotgun", weaponId: "shotgun", position: [0, 0.85, 9] },
    { id: "sandbox-gravity", weaponId: "gravityGun", position: [2, 0.85, 9] },
    { id: "sandbox-rpg", weaponId: "rpg", position: [4, 0.85, 9] },
  ],
  triggers: [],
};
