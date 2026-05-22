import { buildBuilding } from '@game/levels/builders/BuildingBuilder';
import { buildRamp } from '@game/levels/builders/RampBuilder';
import type { LevelDefinition, StaticBoxDefinition } from '@game/levels/LevelDefinition';

/**
 * Sandbox de validación del `BuildingBuilder` y `RampBuilder`.
 *
 * Sin NPCs: la idea es entrar con el navgraph debug encendido y comprobar que:
 *  - Los nodos se generan sobre cada piso y sobre cada escalón.
 *  - Las cadenas de escalera unen el piso inferior con el superior.
 *  - El hueco de la escalera no genera nodos flotando bajo la losa.
 *  - Las paredes interiores cortan la grilla como corresponde.
 *
 * Layout (centrado en 0,0; -Z = norte):
 *
 *           ┌────────── EDIFICIO GRANDE ──────────┐
 *           │           (0, -31), 22×16            │
 *           │           3 pisos + techo flat       │
 *           └──────────────────────────────────────┘
 *      ┌──────────────┐         ┌──────────────┐
 *      │  CASA 2P     │         │  TORRE 3P    │
 *      │  (-22, -16)  │         │  (22, -16)   │
 *      └──────────────┘         └──────────────┘
 *               · spawn ·
 *      ┌──────────────┐         ┌──────────────┐
 *      │  CASA ROOMS  │         │  RAMPA       │
 *      │  (-22, 16)   │         │  (22, 16)    │
 *      └──────────────┘         └──────────────┘
 */

const SLAB_T = 0.4;

const FLOOR: StaticBoxDefinition[] = [
  {
    id: 'btest-floor',
    position: [0, -SLAB_T / 2, 0],
    size: [80, SLAB_T, 80],
    material: 'floor',
  },
  { id: 'btest-boundary-n', position: [0, 1.5, -40], size: [80, 3, 0.4], material: 'wall' },
  { id: 'btest-boundary-s', position: [0, 1.5, 40], size: [80, 3, 0.4], material: 'wall' },
  { id: 'btest-boundary-e', position: [40, 1.5, 0], size: [0.4, 3, 80], material: 'wall' },
  { id: 'btest-boundary-w', position: [-40, 1.5, 0], size: [0.4, 3, 80], material: 'wall' },
];

// ── Casa 2 pisos: el caso canónico. Puerta oeste, escalera interna al norte,
// balcón abierto al sur (lado removido del piso 2). Sin techo para poder ver
// el segundo piso desde arriba con la cámara debug.
//
// Footprint de la escalera: las coords son locales al centro del edificio.
// El ancho sale del eje perpendicular al avance; con topAt north, esta escalera
// mide 2.2m de ancho y deja landing antes del muro norte.
const HOUSE_2P = buildBuilding({
  id: 'house2p',
  center: [-22, -16],
  groundY: 0,
  width: 12,
  depth: 12,
  storyHeight: 3,
  roof: 'none',
  stories: [
    {
      doors: [{ side: 'west', width: 2 }],
      stair: {
        footprint: { x: [-1.1, 1.1], z: [-4.6, -0.6] },
        topAt: 'north',
        cutoutPadding: 0.65,
      },
    },
    {
      openSides: ['south'],
    },
  ],
});

// ── Torre 3 pisos: escaleras alternadas para verificar que el builder
// funciona con direcciones distintas en cada piso y que las cadenas de
// escalera se conectan entre sí a través de los nodos del piso intermedio.
// width=10, wallT=0.4 → interior llega a ±4.6.
const TOWER = buildBuilding({
  id: 'tower',
  center: [22, -16],
  groundY: 0,
  width: 10,
  depth: 10,
  storyHeight: 3,
  roof: 'walkable',
  stories: [
    {
      doors: [{ side: 'south', width: 2 }],
      stair: {
        footprint: { x: [1.2, 3.4], z: [-3.8, 0.2] },
        topAt: 'north',
        cutoutPadding: 0.6,
      },
    },
    {
      stair: {
        footprint: { x: [-3.8, 0.2], z: [1.2, 3.4] },
        topAt: 'west',
        cutoutPadding: 0.6,
      },
    },
    {
      doors: [{ side: 'south', width: 2 }],
    },
  ],
});

// ── Casa con habitaciones interiores. 1 piso, dividida por una pared interna
// con doorway central y un closet completamente cerrado en la esquina NE.
// Sin techo para ver el interior desde arriba. width=14, wallT=0.4 → interior
// cubre [-6.6, 6.6]. Las paredes internas se embeben 0.4 m completos (full
// wallThickness) en los muros exteriores: sin gap visible en las uniones.
const HOUSE_ROOMS = buildBuilding({
  id: 'rooms',
  center: [-22, 16],
  groundY: 0,
  width: 14,
  depth: 14,
  storyHeight: 3,
  roof: 'none',
  stories: [
    {
      doors: [
        { side: 'south', width: 1.8 },
        // Offset +3 → la puerta cae sobre el sala (z=[2.2, 3.8]), fuera del
        // eje z=0 donde corre la partición principal. Sin esto, la pared
        // interior `wall-h-r` (embebida 0.4 m en el muro este) asoma por la
        // abertura de la puerta y se ve como un "bloque flotante" en medio
        // del hueco.
        { side: 'east', width: 1.6, offset: 3 },
      ],
      interiorWalls: [
        // Partición principal en z=0 con doorway central de 2 m. Cada
        // segmento llega hasta la cara externa del muro exterior (x = ±7)
        // → embed completo de 0.4 m, sin gap visible.
        { id: 'wall-h-l', position: [-4, 1.5, 0], size: [6, 3, 0.3] },
        { id: 'wall-h-r', position: [4, 1.5, 0], size: [6, 3, 0.3] },
        // Closet cerrado en esquina NE (x=[3, 6.6], z=[-6.6, -3]).
        // - South wall corre de x=3 a x=7 (embed 0.4 m en muro este).
        // - West wall partido en dos para dejar doorway de 1 m en el medio
        //   (z=[-5.3, -4.3]), entrada al closet desde el dormitorio.
        { id: 'wall-closet-s', position: [5, 1.5, -3], size: [4, 3, 0.3] },
        { id: 'wall-closet-w-up', position: [3, 1.5, -6.15], size: [0.3, 3, 1.7] },
        { id: 'wall-closet-w-low', position: [3, 1.5, -3.575], size: [0.3, 3, 1.45] },
      ],
    },
  ],
});

// ── Edificio grande para probar los límites del builder: 22×16, 3 pisos
// (más techo flat), múltiples particiones por piso y escaleras en posiciones
// opuestas entre pisos. Centro al norte del spawn, separado del resto.
//
// Layout vertical:
//   Piso 0 — entrada sur. Partición E-W con doorway central de 6 m.
//            Escalera 2.5 m al SE, ascendiendo hacia el norte (top en z=1).
//   Piso 1 — misma partición + alcoba cerrada en NE (entrada al sur, 1 m).
//            Escalera 2.5 m al NW, ascendiendo hacia el sur (opuesta al p0).
//   Piso 2 — subdivisión N-S con doorway central de 2 m. Top floor, sin
//            escalera; el techo flat queda como tope visual.
const LARGE_BUILDING = buildBuilding({
  id: 'big',
  center: [0, -31],
  groundY: 0,
  width: 22,
  depth: 16,
  storyHeight: 3,
  roof: 'flat',
  stories: [
    // Piso 0
    {
      doors: [{ side: 'south', width: 2.4 }],
      interiorWalls: [
        { id: 'wall0-h-l', position: [-7, 1.5, 0], size: [8, 3, 0.3] },
        { id: 'wall0-h-r', position: [7, 1.5, 0], size: [8, 3, 0.3] },
      ],
      stair: {
        footprint: { x: [4, 6.5], z: [1, 7] },
        topAt: 'north',
        cutoutPadding: 0.6,
      },
    },
    // Piso 1 — alcoba NE entra por doorway 1 m al sur (z=[-4, -3]) en x=4.
    {
      interiorWalls: [
        { id: 'wall1-h-l', position: [-7, 4.5, 0], size: [8, 3, 0.3] },
        { id: 'wall1-h-r', position: [7, 4.5, 0], size: [8, 3, 0.3] },
        { id: 'wall1-alcove-s', position: [7.5, 4.5, -3], size: [7, 3, 0.3] },
        { id: 'wall1-alcove-w', position: [4, 4.5, -5.5], size: [0.3, 3, 3] },
      ],
      stair: {
        footprint: { x: [-7, -4.5], z: [-7, -1] },
        topAt: 'south',
        cutoutPadding: 0.6,
      },
    },
    // Piso 2 — top story sin escalera.
    {
      interiorWalls: [
        { id: 'wall2-v-n', position: [0, 7.5, -4.5], size: [0.3, 3, 7] },
        { id: 'wall2-v-s', position: [0, 7.5, 4.5], size: [0.3, 3, 7] },
      ],
    },
  ],
});

// ── Rampa standalone: dos plataformas separadas conectadas por una rampa,
// para confirmar que `buildRamp` produce escalones cuyos nodos forman una
// cadena navegable independiente.
const RAMP_PAD_LOW_Y = 0.5;
const RAMP_PAD_HIGH_Y = 4.0;
const RAMP_DEMO: StaticBoxDefinition[] = [
  {
    id: 'ramp-pad-low',
    position: [22, RAMP_PAD_LOW_Y - SLAB_T / 2, 12],
    size: [5, SLAB_T, 5],
    material: 'trim',
  },
  {
    id: 'ramp-pad-high',
    position: [22, RAMP_PAD_HIGH_Y - SLAB_T / 2, 22],
    size: [5, SLAB_T, 5],
    material: 'trim',
  },
  ...buildRamp({
    id: 'ramp-demo',
    start: [22, 14.7],
    end: [22, 19.3],
    startY: RAMP_PAD_LOW_Y,
    endY: RAMP_PAD_HIGH_Y,
    width: 2.5,
    steps: 12,
    material: 'floor',
  }),
];

export const BuildingTestLevel: LevelDefinition = {
  id: 'building-test',
  title: 'Sandbox Edificios',
  description:
    'Mapa de prueba sin NPCs. Casa 2P, torre 3P, casa con habitaciones, edificio grande de 3 pisos y rampa standalone. Para inspeccionar nodos del navgraph.',
  background: 0x141a22,
  sun: {
    direction: [0.4, 1.0, 0.3],
    color: 0xfff0d0,
    intensity: 1.5,
  },
  playerStart: [0, 1.5, 0],
  audio: {
    ambiences: ['background.wind'],
    footstepSounds: [
      'footsteps.snow1',
      'footsteps.snow2',
      'footsteps.snow3',
      'footsteps.snow4',
    ],
  },
  staticBoxes: [
    ...FLOOR,
    ...HOUSE_2P,
    ...TOWER,
    ...HOUSE_ROOMS,
    ...LARGE_BUILDING,
    ...RAMP_DEMO,
  ],
  dynamicBoxes: [],
  doors: [],
  npcs: [],
  weaponPickups: [],
  triggers: [],
};
