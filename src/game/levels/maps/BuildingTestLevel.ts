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
 * Layout (centrado en 0,0):
 *
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
// Footprint del stairwell: las coords son locales al centro del edificio.
// Con width=12 y wallThickness=0.4 las paredes interiores caen en ±5.6 — el
// cutout llega hasta ahí para que el top step quede flush con el muro norte y
// no penetre la pared.
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
        footprint: { x: [-2, 1], z: [-5.6, -1.6] },
        topAt: 'north',
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
        footprint: { x: [-1.5, 1.5], z: [-4.6, -1] },
        topAt: 'north',
      },
    },
    {
      stair: {
        footprint: { x: [-4.6, -1], z: [-1.5, 1.5] },
        topAt: 'west',
      },
    },
    {
      doors: [{ side: 'south', width: 2 }],
    },
  ],
});

// ── Casa con habitaciones interiores. 1 piso, dividida por una pared interna
// con doorway central y un closet pequeño en la esquina NE. Sin techo para ver
// el interior desde arriba. width=14, wallT=0.4 → interior cubre [-6.6, 6.6].
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
        { side: 'east', width: 1.6 },
      ],
      interiorWalls: [
        // Pared horizontal con apertura central de 2m.
        { id: 'wall-h-l', position: [-3.8, 1.4, 0], size: [5.6, 2.8, 0.3] },
        { id: 'wall-h-r', position: [3.8, 1.4, 0], size: [5.6, 2.8, 0.3] },
        // Closet en esquina NE (x=3.5..6.6, z=-6.6..-3).
        // Sólo la pared sur del closet — la oeste se omite para dejar entrada.
        { id: 'wall-closet-s', position: [5.05, 1.4, -3], size: [3.1, 2.8, 0.3] },
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
    'Mapa de prueba sin NPCs. Casa 2P, torre 3P con escaleras alternadas, casa con habitaciones y rampa standalone. Para inspeccionar nodos del navgraph.',
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
    ...RAMP_DEMO,
  ],
  dynamicBoxes: [],
  doors: [],
  npcs: [],
  weaponPickups: [],
  triggers: [],
};
