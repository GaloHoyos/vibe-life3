import type { LevelDefinition, StaticBoxDefinition } from '@game/levels/LevelDefinition';
import { createMap } from '@game/levels/builders/MapCreator';
import { buildRamp } from '@game/levels/builders/RampBuilder';
import {
  cargoContainer,
  coverWall,
  crate,
  crateStack,
  sandbagLine,
  watchtower,
} from '@game/levels/builders/PropBuilder';

/**
 * Sandbox de validación del toolkit de mapas (`MapCreator` + `PropBuilder` +
 * `BuildingBuilder`/`RampBuilder`) y de la navegación interior de NPCs.
 *
 * Qué valida:
 *  - El NavSpace conecta pisos: escaleras internas con celdas propias, sin
 *    celdas dentro de paredes interiores ni bajo losas sin headroom.
 *  - NPCs entran/salen de edificios: las patrullas cruzan doorways y suben
 *    escaleras (combine de la torre baja 2 pisos en su ronda).
 *  - Props del PropBuilder funcionan como cover/obstáculo y la watchtower es
 *    navegable por la rampa.
 *  - Items dentro de habitaciones (pickups vía `pickupInRoom`).
 *
 * Layout (centrado en 0,0; -Z = norte):
 *
 *           ┌────────── EDIFICIO GRANDE ──────────┐
 *           │           (0, -31), 22×16            │
 *           └──────────────────────────────────────┘
 *      ┌──────────────┐         ┌──────────────┐
 *      │  CASA 2P     │         │  TORRE 3P    │
 *      │  (-22, -16)  │         │  (22, -16)   │
 *      └──────────────┘         └──────────────┘
 *               · spawn + props ·
 *      ┌──────────────┐   torre vigía   ┌────────┐
 *      │  CASA ROOMS  │    (0, 26)      │ RAMPA  │
 *      │  (-22, 16)   │                 │(22, 16)│
 *      └──────────────┘                 └────────┘
 */

const SLAB_T = 0.4;

// Rampa standalone: dos plataformas conectadas, cadena navegable independiente.
const RAMP_PAD_LOW_Y = 0.5;
const RAMP_PAD_HIGH_Y = 4.0;
const RAMP_DEMO: StaticBoxDefinition[] = [
  // Ojo con los ids: 'ramp'/'stair' en el id taguea la celda como escalera en
  // el NavSpace (inferSurface), y los pads deben ser superficie plana normal.
  {
    id: 'demo-pad-low',
    position: [22, RAMP_PAD_LOW_Y - SLAB_T / 2, 12],
    size: [5, SLAB_T, 5],
    material: 'trim',
  },
  {
    id: 'demo-pad-high',
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

const map = createMap({
  id: 'building-test',
  title: 'Sandbox Edificios',
  description:
    'Sandbox del toolkit de mapas: edificios multi-piso, props de cover, items en habitaciones y NPCs patrullando interiores (entran, suben escaleras y salen).',
  background: 0x141a22,
  sun: {
    direction: [0.4, 1.0, 0.3],
    color: 0xfff0d0,
    intensity: 1.5,
  },
  playerStart: [0, 1.5, 8],
  audio: {
    ambiences: ['background.wind', 'background.hl2.atmosphere.cityRumble'],
    footstepSounds: [
      'footsteps.hl2.concrete1',
      'footsteps.hl2.concrete2',
      'footsteps.hl2.concrete3',
      'footsteps.hl2.concrete4',
    ],
  },
})
  .ground({ size: [80, 80], boundary: { height: 3 } })
  // ── Casa 2 pisos: puerta oeste, escalera interna, balcón abierto al sur.
  .structure({
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
        // Descanso de 2.2 m contra la pared norte y 5 m de aproximación al sur.
        stair: {
          footprint: { x: [-1.1, 1.1], z: [-3.4, 0.6] },
          topAt: 'north',
          cutoutPadding: 0.65,
        },
      },
      {
        openSides: ['south'],
      },
    ],
  })
  // ── Torre 3 pisos: escaleras alternadas entre pisos.
  .structure({
    id: 'tower',
    center: [22, -16],
    groundY: 0,
    width: 10,
    depth: 10,
    storyHeight: 3,
    roof: 'walkable',
    palette: { base: 'concrete', upper: 'brick', trim: 'concrete' },
    stories: [
      {
        doors: [{ side: 'south', width: 2 }],
        stair: {
          footprint: { x: [1.2, 3.4], z: [-2.6, 1.4] },
          topAt: 'north',
          cutoutPadding: 0.6,
        },
      },
      {
        // Corre al sur del hueco del tramo de abajo (cutout hasta z=2.0) para
        // que los escalones apoyen sobre losa sólida. Sube hacia el este: la
        // base abre al oeste, donde el piso 1 conecta con la descarga del
        // tramo de PB — hacia el este la aproximación moría en un bolsillo
        // cercado por el hueco de PB y las paredes.
        stair: {
          footprint: { x: [-1.4, 2.6], z: [2.2, 4.4] },
          topAt: 'east',
          cutoutPadding: 0.6,
        },
      },
      {},
    ],
  })
  // ── Casa con habitaciones: partición central + closet cerrado en NE.
  .structure({
    id: 'rooms',
    center: [-22, 16],
    groundY: 0,
    width: 14,
    depth: 14,
    storyHeight: 3,
    roof: 'none',
    palette: { base: 'plaster', trim: 'woodDark' },
    stories: [
      {
        doors: [
          { side: 'south', width: 1.8 },
          { side: 'east', width: 1.6, offset: 3 },
        ],
        interiorWalls: [
          { id: 'wall-h-l', position: [-4, 1.5, 0], size: [6, 3, 0.3] },
          { id: 'wall-h-r', position: [4, 1.5, 0], size: [6, 3, 0.3] },
          { id: 'wall-closet-s', position: [5, 1.5, -3], size: [4, 3, 0.3] },
          // Vano del closet de 1.4 m (z -5.2..-3.8): con 1 m los NPCs rozaban.
          { id: 'wall-closet-w-up', position: [3, 1.5, -5.9], size: [0.3, 3, 1.4] },
          { id: 'wall-closet-w-low', position: [3, 1.5, -3.325], size: [0.3, 3, 0.95] },
        ],
      },
    ],
  })
  // ── Edificio grande 3 pisos: particiones por piso, escaleras opuestas.
  .structure({
    id: 'big',
    center: [0, -31],
    groundY: 0,
    width: 22,
    depth: 16,
    storyHeight: 3,
    roof: 'flat',
    // Núcleos de escalera en los extremos E (PB→1) y O (1→2), corriendo
    // pegados a la fachada con 4.6 m de descarga/aproximación. Las particiones
    // terminan 0.6 m antes de cada hueco y dejan un vano central de 4 m.
    stories: [
      {
        doors: [
          { side: 'south', width: 2.4 },
          { side: 'north', width: 2.2 },
        ],
        interiorWalls: [
          { id: 'wall0-h-l', position: [-6.3, 1.5, 0], size: [8.6, 3, 0.3] },
          { id: 'wall0-h-r', position: [4.7, 1.5, 0], size: [5.4, 3, 0.3] },
        ],
        stair: {
          footprint: { x: [8.0, 10.4], z: [-3, 3] },
          topAt: 'north',
          cutoutPadding: 0.6,
        },
      },
      {
        interiorWalls: [
          { id: 'wall1-h-l', position: [-4.7, 4.5, 0], size: [5.4, 3, 0.3] },
          { id: 'wall1-h-r', position: [4.7, 4.5, 0], size: [5.4, 3, 0.3] },
        ],
        stair: {
          footprint: { x: [-10.4, -8.0], z: [-3, 3] },
          topAt: 'south',
          cutoutPadding: 0.6,
        },
      },
      {
        interiorWalls: [
          { id: 'wall2-v-n', position: [0, 7.5, -4.8], size: [0.3, 3, 5.6] },
          { id: 'wall2-v-s', position: [0, 7.5, 4.8], size: [0.3, 3, 5.6] },
        ],
      },
    ],
  })
  .boxes(...RAMP_DEMO)
  // ── Props: cover y obstáculos del patio central.
  .prop(
    crateStack({ id: 'crates-spawn', at: [8, 4], rows: 3, cols: 2, layers: 2, seed: 7 }),
    crateStack({ id: 'crates-court', at: [-8, -4], rows: 2, cols: 2, layers: 1, seed: 11 }),
    sandbagLine({ id: 'sandbags-court', from: [-6, 10], to: [2, 10] }),
    coverWall({ id: 'cover-court-e', at: [12, -4], axis: 'z', length: 4 }),
    cargoContainer({ id: 'container-e', at: [32, 4], axis: 'z' }),
    watchtower({ id: 'vigia', at: [0, 26], platformHeight: 3.2, rampSide: 'north' }),
    crate({ id: 'dyn-crate-1', at: [4, 0, 2], dynamic: true }),
    crate({ id: 'dyn-crate-2', at: [5, 0, 3.2], dynamic: true }),
  );

// ── NPCs: rutas que obligan a navegar interiores y escaleras ─────────────────
map
  // Ronda exterior→interior: entra a la casa 2P por la puerta oeste y sale.
  .npc({
    id: 'combine-rounds',
    characterId: 'combine',
    position: [-10, 0.5, 0],
    patrol: [
      [-10, 0.3, 0],
      map.roomPoint('house2p', 0, [2.5, 2.5]),
      [-22, 0.3, -2],
      [-4, 0.3, 12],
    ],
  })
  // Centinela de la torre: arranca en el piso 2 y su ronda baja a la calle —
  // dos tramos de escalera por ciclo.
  // Ojo: el cuadrante SE del piso 2 es el hueco del stairwell — spawn al NO.
  .npcInRoom('tower', 2, [-2, -2], {
    id: 'combine-tower',
    characterId: 'combine',
    patrol: [
      map.roomPoint('tower', 2, [-2, -2]),
      map.roomPoint('tower', 0, [-2, 2]),
      [22, 0.3, -8],
    ],
  })
  .npc({
    id: 'combine-big',
    characterId: 'combine',
    position: map.roomPoint('big', 0, [-6, 3], 0.3),
    patrol: [
      map.roomPoint('big', 0, [-6, 3]),
      map.roomPoint('big', 0, [6, -4]),
      [0, 0.3, -18],
    ],
  })
  // Zombie en el piso de arriba de la casa 2P: al oír combate baja la escalera.
  .npcInRoom('house2p', 1, [3, 3], { id: 'zombie-upstairs', characterId: 'zombie' })
  // Zombie en la sala de la casa con habitaciones.
  .npcInRoom('rooms', 0, [-3.5, 3.5], { id: 'zombie-rooms', characterId: 'zombie' });

// ── Items dentro de habitaciones ────────────────────────────────────────────
map
  .pickupInRoom('rooms', 0, [4.8, -4.8], { id: 'pickup-pistol', weaponId: 'pistol' })
  .pickupInRoom('house2p', 1, [-3, 3], { id: 'pickup-smg', weaponId: 'smg' })
  .pickupInRoom('big', 2, [5, 5], { id: 'pickup-shotgun', weaponId: 'shotgun' })
  .pickup({ id: 'pickup-crowbar', weaponId: 'crowbar', position: [2, 0.6, 6] });

export const BuildingTestLevel: LevelDefinition = map.build();
