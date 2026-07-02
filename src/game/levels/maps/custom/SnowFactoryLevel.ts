import type { LevelDefinition, StaticBoxDefinition } from '@game/levels/LevelDefinition';
import { createMap } from '@game/levels/builders/MapCreator';
import type { HouseSpec } from '@game/levels/builders/HouseBuilder';
import {
  cargoContainer,
  coverWall,
  crate,
  crateStack,
  pillar,
  sandbagLine,
  watchtower,
} from '@game/levels/builders/PropBuilder';

/**
 * Complejo Boreal — nivel demo construido íntegramente con el toolkit de
 * mapas (`createMap` + BuildingBuilder/HouseBuilder/PropBuilder).
 *
 * Arco de progresión (sur → norte → este):
 *  1. BASE (sur): refugio de inserción con consola, arsenal inicial y Alyx.
 *  2. CHECKPOINT: bloqueo combine con torre de vigilancia y sacos.
 *  3. CASERÍO OESTE: cabañas infestadas — las patrullas combine del camino
 *     se cruzan con los zombies (combate NPC vs NPC emergente).
 *  4. LA FÁBRICA (centro): nave industrial de 2 plantas con portón corredizo,
 *     oficinas arriba, dock de carga al este y zombies sueltos en la nave.
 *  5. BLOQUE ADMINISTRATIVO (noreste): 4 pisos con escaleras alternadas,
 *     guarniciones por piso y equipamiento pesado arriba.
 *  6. CASERÍO NORTE: pueblo abandonado, horda dispersa.
 *  7. DEPÓSITO (este): laberinto de contenedores con squad combine.
 *  8. ANTENA (colina este): torre de 3 pisos, objetivo final.
 *
 * Reglas de diseño aplicadas: descansos de escalera >= 2 m en ambas bocas,
 * bocas que abren a área conectada del piso, spawns/pickups fuera de los
 * huecos de stairwell, y alturas de flatten == groundY de cada estructura.
 */

// ── Alturas por zona (== FlattenRegion.height de cada plateau) ──────────────
const BASE_H = 0.5;
const CHECK_H = 0.5;
const FACTORY_H = 0.6;
const ADMIN_H = 0.9;
const WEST_H = 0.45;
const NORTH_H = 0.25;
const DEPOT_H = 0.7;
const COMMS_H = 1.8;
const FARM_H = 0.8;

// ── Caseríos ─────────────────────────────────────────────────────────────────
const WEST_HAMLET: HouseSpec[] = [
  { id: 'sfw-hamlet-a', center: [-132, 40], floorY: WEST_H, width: 10, depth: 8, height: 3.1, door: { side: 'east', width: 1.4 } },
  { id: 'sfw-hamlet-b', center: [-156, 48], floorY: WEST_H, width: 9, depth: 7, height: 3, door: { side: 'south', width: 1.3 } },
  { id: 'sfw-hamlet-c', center: [-144, 68], floorY: WEST_H, width: 12, depth: 9, height: 3.4, removeWall: 'east' },
  { id: 'sfw-hamlet-d', center: [-122, 76], floorY: WEST_H, width: 8, depth: 7, height: 3, door: { side: 'west', width: 1.2 } },
  { id: 'sfw-hamlet-e', center: [-166, 72], floorY: WEST_H, width: 9, depth: 7, height: 3, door: { side: 'north', width: 1.3 } },
];

const NORTH_VILLAGE: HouseSpec[] = [
  { id: 'sfw-village-a', center: [-36, -148], floorY: NORTH_H, width: 11, depth: 8, height: 3.2, door: { side: 'south', width: 1.4 } },
  { id: 'sfw-village-b', center: [-10, -160], floorY: NORTH_H, width: 9, depth: 7, height: 3, removeWall: 'east' },
  { id: 'sfw-village-c', center: [16, -148], floorY: NORTH_H, width: 10, depth: 8, height: 3.1, door: { side: 'south', width: 1.3 } },
  { id: 'sfw-village-d', center: [48, -158], floorY: NORTH_H, width: 12, depth: 9, height: 3.4, door: { side: 'east', width: 1.5 } },
  { id: 'sfw-village-e', center: [76, -144], floorY: NORTH_H, width: 9, depth: 7, height: 3, door: { side: 'west', width: 1.2 } },
];

const FARM: HouseSpec[] = [
  {
    id: 'sfw-farm-barn',
    center: [-46, 98],
    floorY: FARM_H,
    width: 13,
    depth: 10,
    height: 3.8,
    removeWall: 'east',
    palette: { base: 'woodDark', trim: 'concrete' },
  },
  { id: 'sfw-farm-cabin', center: [-58, 84], floorY: FARM_H, width: 8, depth: 7, height: 3, door: { side: 'east', width: 1.3 } },
];

const BASE_HOUSE: HouseSpec = {
  id: 'sfw-base',
  center: [0, 92],
  floorY: BASE_H,
  width: 14,
  depth: 10,
  height: 3.4,
  removeWall: 'north',
  palette: { base: 'concrete', trim: 'concrete' },
};

const ALL_HOUSES: HouseSpec[] = [BASE_HOUSE, ...FARM, ...WEST_HAMLET, ...NORTH_VILLAGE];

const VILLAGE_PALETTE = { base: 'woodDark', trim: 'concrete' } as const;
for (const house of NORTH_VILLAGE) {
  house.palette = house.palette ?? VILLAGE_PALETTE;
}
const HAMLET_PALETTE = { base: 'plaster', trim: 'woodDark' } as const;
for (const house of WEST_HAMLET) {
  house.palette = house.palette ?? HAMLET_PALETTE;
}

function houseFlattens(houses: HouseSpec[]) {
  return houses.map((house) => ({
    center: house.center,
    radius: Math.max(house.width, house.depth) * 0.75,
    falloff: 8,
    height: house.floorY,
  }));
}

// ── Decoración suelta (sin keywords stair/ramp/roof/floor en los ids) ───────
const RIDGES: StaticBoxDefinition[] = [
  { id: 'sfw-ridge-w', position: [-202, 2.2, 0], size: [6, 5, 404], material: 'rock' },
  { id: 'sfw-ridge-e', position: [202, 2.2, 0], size: [6, 5, 404], material: 'rock' },
  { id: 'sfw-ridge-n', position: [0, 2.2, -202], size: [404, 5, 6], material: 'rock' },
  { id: 'sfw-ridge-s', position: [0, 2.2, 202], size: [404, 5, 6], material: 'rock' },
];

const ROADS: StaticBoxDefinition[] = [
  { id: 'sfw-road-main-s', position: [0, 0.38, 66], size: [10, 0.3, 42], material: 'floor' },
  { id: 'sfw-road-main-n', position: [0, 0.43, 14], size: [10, 0.3, 58], material: 'floor' },
  { id: 'sfw-road-west', position: [-72, 0.36, 52], size: [120, 0.3, 6], material: 'floor' },
  { id: 'sfw-road-admin', position: [59, 0.62, -78], size: [82, 0.3, 6], material: 'floor' },
  { id: 'sfw-road-north', position: [0, 0.27, -104], size: [8, 0.3, 108], material: 'floor' },
  { id: 'sfw-road-depot', position: [49, 0.55, -6], size: [58, 0.3, 6], material: 'floor' },
  { id: 'sfw-road-comms', position: [114, 0.7, -2], size: [72, 0.3, 6], material: 'floor' },
];

const DECO: StaticBoxDefinition[] = [
  // Consola de la base (los action buttons viven encima).
  { id: 'sfw-console', position: [0, BASE_H + 0.55, 95.6], size: [4.2, 1.1, 0.8], material: 'trim' },
  { id: 'sfw-console-top', position: [0, BASE_H + 1.32, 95.4], size: [4.6, 0.25, 0.35], material: 'button' },
  { id: 'sfw-lightbar', position: [0, BASE_H + 2.1, 95.2], size: [5.2, 0.18, 0.18], material: 'hazard' },
  // Tapas de las chimeneas de la fábrica.
  { id: 'sfw-stack-cap-a', position: [-10, FACTORY_H + 22.3, -50], size: [3.4, 0.6, 3.4], material: 'trim' },
  { id: 'sfw-stack-cap-b', position: [-3, FACTORY_H + 25.3, -50], size: [3.4, 0.6, 3.4], material: 'trim' },
  { id: 'sfw-stack-cap-c', position: [9, FACTORY_H + 22.3, -50], size: [3.4, 0.6, 3.4], material: 'trim' },
  // Mástil de la antena junto a la torre de comms.
  { id: 'sfw-mast', position: [159, COMMS_H + 7, 56], size: [0.6, 14, 0.6], material: 'trim' },
  { id: 'sfw-mast-cross-a', position: [159, COMMS_H + 11.5, 56], size: [7, 0.3, 0.3], material: 'trim' },
  { id: 'sfw-mast-cross-b', position: [159, COMMS_H + 9, 56], size: [0.3, 0.3, 7], material: 'trim' },
];

const map = createMap({
  id: 'snow-factory',
  title: 'Complejo Boreal',
  description:
    'Demo del valle Boreal: inserción con Alyx, checkpoint combine, caseríos infestados, la fábrica de dos plantas, el bloque administrativo de cuatro pisos y el asalto final a la antena.',
  background: 0xb9c9d8,
  sun: {
    direction: [0.35, 1.0, 0.25],
    color: 0xe8eef6,
    intensity: 2.0,
  },
  playerStart: [0, BASE_H + 1.2, 90],
  audio: {
    ambiences: ['background.wind', 'background.hl2.wind.wasteland'],
    soundscape: 'factory',
    footstepSounds: [
      'footsteps.snow1',
      'footsteps.snow2',
      'footsteps.snow3',
      'footsteps.snow4',
    ],
  },
})
  .terrain({
    id: 'snow-factory-terrain',
    position: [0, 0, 0],
    size: [420, 420],
    widthSamples: 161,
    depthSamples: 161,
    source: {
      kind: 'noise',
      seed: 314,
      octaves: 5,
      frequency: 0.018,
      persistence: 0.52,
      lacunarity: 2.05,
      amplitude: 4.2,
      baseHeight: 0,
      flattenRegions: [
        // Zonas (plateau + camino entre plateaus).
        { center: [0, 90], radius: 24, falloff: 10, height: BASE_H },
        { center: [-48, 90], radius: 20, falloff: 8, height: FARM_H },
        { center: [0, 64], radius: 16, falloff: 8, height: 0.5 },
        { center: [0, 46], radius: 20, falloff: 8, height: CHECK_H },
        { center: [0, 16], radius: 20, falloff: 10, height: 0.55 },
        { center: [0, -30], radius: 36, falloff: 14, height: FACTORY_H },
        { center: [60, -78], radius: 20, falloff: 10, height: 0.75 },
        { center: [118, -90], radius: 26, falloff: 10, height: ADMIN_H },
        { center: [-70, 50], radius: 18, falloff: 10, height: 0.5 },
        { center: [-144, 58], radius: 42, falloff: 16, height: WEST_H },
        { center: [0, -100], radius: 18, falloff: 10, height: 0.4 },
        { center: [16, -152], radius: 52, falloff: 18, height: NORTH_H },
        { center: [50, -6], radius: 16, falloff: 8, height: 0.65 },
        { center: [78, -8], radius: 26, falloff: 10, height: DEPOT_H },
        // Subida en escalones hacia la colina de la antena.
        { center: [115, -2], radius: 14, falloff: 8, height: 0.85 },
        { center: [150, 16], radius: 14, falloff: 8, height: 1.2 },
        { center: [150, 40], radius: 14, falloff: 8, height: 1.5 },
        { center: [150, 64], radius: 22, falloff: 12, height: COMMS_H },
        ...houseFlattens(ALL_HOUSES),
      ],
    },
    material: 'snow',
  })
  .boxes(...RIDGES, ...ROADS, ...DECO)
  // ── La Fábrica: nave de 2 plantas, portón sur, dock este, oficinas arriba.
  .structure({
    id: 'sfw-factory',
    center: [0, -30],
    groundY: FACTORY_H,
    width: 36,
    depth: 26,
    storyHeight: 4.2,
    wallThickness: 0.5,
    groundSlab: true,
    roof: 'flat',
    palette: { base: 'brick', upper: 'plaster', trim: 'concrete', floor: 'concrete' },
    stories: [
      {
        doors: [
          { side: 'south', width: 5, height: 3.6 },
          { side: 'east', width: 6, height: 3.8, canopy: false },
          { side: 'north', width: 2.2 },
        ],
        // Escalera a las oficinas: sube por el muro oeste hacia el sur y
        // descarga en el corredor sur de la planta alta (lejos del tabique
        // norte, con 3.5 m de descanso contra la pared sur).
        stair: {
          footprint: { x: [-16, -13.5], z: [3, 9] },
          topAt: 'south',
          cutoutPadding: 0.6,
        },
      },
      {
        // Oficinas al norte (tras el tabique en z=-4) + corredor sur. Dos
        // despachos divididos por un muro central con paso al sur.
        interiorWalls: [
          { id: 'wall1-part-w', position: [-10, FACTORY_H + 6.1, -4], size: [14, 3.8, 0.3] },
          { id: 'wall1-part-e', position: [10, FACTORY_H + 6.1, -4], size: [14, 3.8, 0.3] },
          { id: 'wall1-cross', position: [0, FACTORY_H + 6.1, -9.5], size: [0.3, 3.8, 5] },
        ],
      },
    ],
  })
  // ── Bloque administrativo: 4 pisos, escaleras alternadas E/O.
  .structure({
    id: 'sfw-admin',
    center: [118, -90],
    groundY: ADMIN_H,
    width: 26,
    depth: 20,
    storyHeight: 3,
    // Sin groundSlab: la planta baja apoya en el terreno aplanado (flatten
    // [118,-90] height ADMIN_H), igual que las casas y la antena — así el
    // umbral de la puerta calza con el exterior y el portal conecta. Con losa
    // propia quedaba un escalón en la puerta angosta y el interior se aislaba.
    roof: 'flat',
    palette: { base: 'concrete', upper: 'plaster', trim: 'concrete' },
    stories: [
      {
        // Lobby abierto + puerta ancha: un suelo conexo de extremo a extremo
        // que une la puerta con la base de la escalera (los tabiques angostos
        // de planta baja fragmentaban el grafo en islas no conectadas).
        doors: [{ side: 'south', width: 4 }],
        stair: { footprint: { x: [9.8, 12.2], z: [-3, 3] }, topAt: 'north', cutoutPadding: 0.6 },
      },
      {
        interiorWalls: [{ id: 'wall1', position: [0.5, ADMIN_H + 4.5, 0], size: [13, 3, 0.3] }],
        stair: { footprint: { x: [-12.2, -9.8], z: [-3, 3] }, topAt: 'south', cutoutPadding: 0.6 },
      },
      {
        interiorWalls: [{ id: 'wall2', position: [-0.5, ADMIN_H + 7.5, 0], size: [13, 3, 0.3] }],
        stair: { footprint: { x: [9.8, 12.2], z: [-3, 3] }, topAt: 'north', cutoutPadding: 0.6 },
      },
      {
        interiorWalls: [
          { id: 'wall3-n', position: [0, ADMIN_H + 10.5, -5.8], size: [0.3, 3, 7.6] },
          { id: 'wall3-s', position: [0, ADMIN_H + 10.5, 5.8], size: [0.3, 3, 7.6] },
        ],
      },
    ],
  })
  // ── Torre de comunicaciones: objetivo final en la colina este.
  .structure({
    id: 'sfw-comms',
    center: [150, 64],
    groundY: COMMS_H,
    width: 10,
    depth: 10,
    storyHeight: 3,
    roof: 'walkable',
    palette: { base: 'concrete', upper: 'brick', trim: 'concrete' },
    stories: [
      {
        doors: [{ side: 'south', width: 2 }],
        stair: { footprint: { x: [1.2, 3.4], z: [-2.6, 1.4] }, topAt: 'north', cutoutPadding: 0.6 },
      },
      {
        stair: { footprint: { x: [-1.4, 2.6], z: [2.2, 4.4] }, topAt: 'east', cutoutPadding: 0.6 },
      },
      {},
    ],
  });

// Caseríos, granja y refugio base (HouseBuilder).
for (const house of ALL_HOUSES) {
  map.house(house);
}

// ── Chimeneas de la fábrica + props por zona ─────────────────────────────────
map.prop(
  pillar({ id: 'sfw-stack-a', at: [-10, -50], y: FACTORY_H, height: 22, side: 2.6, material: 'brick' }),
  pillar({ id: 'sfw-stack-b', at: [-3, -50], y: FACTORY_H, height: 25, side: 2.6, material: 'brick' }),
  pillar({ id: 'sfw-stack-c', at: [9, -50], y: FACTORY_H, height: 22, side: 2.6, material: 'brick' }),
  // Checkpoint.
  sandbagLine({ id: 'sfw-check-bags-w', from: [-9, 42], to: [-2, 42], y: CHECK_H }),
  sandbagLine({ id: 'sfw-check-bags-e', from: [2, 42], to: [9, 42], y: CHECK_H }),
  coverWall({ id: 'sfw-check-cover', at: [-7, 50], axis: 'x', length: 5, y: CHECK_H }),
  watchtower({ id: 'sfw-check-tower', at: [12, 50], baseY: CHECK_H, platformHeight: 3.2, rampSide: 'west' }),
  // Trinchera de la vieja línea (entre checkpoint y fábrica).
  sandbagLine({ id: 'sfw-trench-a', from: [-38, 14], to: [-22, 14], y: 0.55 }),
  sandbagLine({ id: 'sfw-trench-b', from: [-34, 22], to: [-20, 22], y: 0.55 }),
  // Interior de la fábrica: columnas + maquinaria.
  pillar({ id: 'sfw-fac-col-a', at: [-8, -36], y: FACTORY_H, height: 4.0, side: 0.7, material: 'concrete' }),
  pillar({ id: 'sfw-fac-col-b', at: [-8, -24], y: FACTORY_H, height: 4.0, side: 0.7, material: 'concrete' }),
  pillar({ id: 'sfw-fac-col-c', at: [8, -36], y: FACTORY_H, height: 4.0, side: 0.7, material: 'concrete' }),
  pillar({ id: 'sfw-fac-col-d', at: [8, -24], y: FACTORY_H, height: 4.0, side: 0.7, material: 'concrete' }),
  cargoContainer({ id: 'sfw-fac-machine', at: [-10, -39], axis: 'x', y: FACTORY_H }),
  crateStack({ id: 'sfw-fac-crates-a', at: [12, -40], baseY: FACTORY_H, rows: 3, cols: 2, layers: 2, seed: 21 }),
  crateStack({ id: 'sfw-fac-crates-b', at: [13, -22], baseY: FACTORY_H, rows: 2, cols: 2, layers: 1, seed: 22 }),
  coverWall({ id: 'sfw-fac-cover-a', at: [2, -26], axis: 'x', length: 5, y: FACTORY_H }),
  coverWall({ id: 'sfw-fac-cover-b', at: [-2, -36], axis: 'z', length: 4, y: FACTORY_H }),
  // Dock de carga (afuera, este).
  cargoContainer({ id: 'sfw-dock-cont-a', at: [26, -36], axis: 'z', y: FACTORY_H }),
  cargoContainer({ id: 'sfw-dock-cont-b', at: [31, -26], axis: 'z', y: FACTORY_H }),
  // Depósito este: laberinto de contenedores.
  cargoContainer({ id: 'sfw-depot-cont-a', at: [68, -16], axis: 'z', y: DEPOT_H }),
  cargoContainer({ id: 'sfw-depot-cont-b', at: [68, -2], axis: 'z', y: DEPOT_H }),
  cargoContainer({ id: 'sfw-depot-cont-c', at: [84, -16], axis: 'z', y: DEPOT_H }),
  cargoContainer({ id: 'sfw-depot-cont-d', at: [84, -2], axis: 'z', y: DEPOT_H }),
  cargoContainer({ id: 'sfw-depot-cont-e', at: [76, 8], axis: 'x', y: DEPOT_H }),
  crateStack({ id: 'sfw-depot-crates-a', at: [76, -9], baseY: DEPOT_H, rows: 2, cols: 2, layers: 2, seed: 31 }),
  crateStack({ id: 'sfw-depot-crates-b', at: [92, -6], baseY: DEPOT_H, rows: 2, cols: 2, layers: 1, seed: 32 }),
  sandbagLine({ id: 'sfw-depot-bags', from: [60, -12], to: [60, -2], y: DEPOT_H }),
  watchtower({ id: 'sfw-depot-tower', at: [94, -18], baseY: DEPOT_H, platformHeight: 3.6, rampSide: 'west' }),
  // Caserío oeste y pueblo norte.
  crateStack({ id: 'sfw-hamlet-crates', at: [-146, 56], baseY: WEST_H, rows: 2, cols: 2, layers: 1, seed: 41 }),
  sandbagLine({ id: 'sfw-hamlet-bags', from: [-136, 52], to: [-128, 52], y: WEST_H }),
  crateStack({ id: 'sfw-village-crates', at: [4, -154], baseY: NORTH_H, rows: 2, cols: 3, layers: 1, seed: 42 }),
  // Defensa de la antena.
  sandbagLine({ id: 'sfw-comms-bags-s', from: [144, 74], to: [156, 74], y: COMMS_H }),
  sandbagLine({ id: 'sfw-comms-bags-w', from: [142, 60], to: [142, 70], y: COMMS_H }),
  coverWall({ id: 'sfw-comms-cover', at: [150, 80], axis: 'x', length: 6, y: COMMS_H }),
  crateStack({ id: 'sfw-comms-crates', at: [158, 70], baseY: COMMS_H, rows: 2, cols: 2, layers: 1, seed: 43 }),
  // Yard del admin.
  coverWall({ id: 'sfw-adm-cover-a', at: [104, -78], axis: 'x', length: 6, y: ADMIN_H }),
  coverWall({ id: 'sfw-adm-cover-b', at: [130, -82], axis: 'z', length: 5, y: ADMIN_H }),
  crateStack({ id: 'sfw-adm-crates', at: [110, -76], baseY: ADMIN_H, rows: 2, cols: 2, layers: 1, seed: 44 }),
  // Cajas dinámicas para el gravity gun.
  crate({ id: 'sfw-dyn-base-a', at: [-4, BASE_H, 88], dynamic: true }),
  crate({ id: 'sfw-dyn-base-b', at: [-4.8, BASE_H, 89.1], dynamic: true }),
  crate({ id: 'sfw-dyn-fac-a', at: [14, FACTORY_H, -26], dynamic: true }),
  crate({ id: 'sfw-dyn-fac-b', at: [15.1, FACTORY_H, -27.2], dynamic: true }),
  crate({ id: 'sfw-dyn-fac-c', at: [13.2, FACTORY_H, -27.8], dynamic: true }),
  crate({ id: 'sfw-dyn-depot-a', at: [72, DEPOT_H, -9], dynamic: true }),
  crate({ id: 'sfw-dyn-depot-b', at: [73.2, DEPOT_H, -10.1], dynamic: true }),
  crate({ id: 'sfw-dyn-adm-a', at: [124, ADMIN_H, -77], dynamic: true }),
  crate({ id: 'sfw-dyn-adm-b', at: [125.1, ADMIN_H, -78.2], dynamic: true }),
);

// ── Portón corredizo de la fábrica (lado sur) ───────────────────────────────
map.door({
  id: 'sfw-factory-gate',
  position: [0, FACTORY_H + 1.85, -17],
  size: [5.4, 3.7, 0.5],
  openOffset: [0, 3.9, 0],
  speed: 3.2,
  material: 'door',
  button: {
    id: 'sfw-factory-gate-button',
    label: 'Alternar portón',
    position: [-3.4, FACTORY_H + 1.3, -16.55],
    size: [0.45, 0.45, 0.16],
  },
});

// ── Consola de la base ───────────────────────────────────────────────────────
map
  .actionButton({
    id: 'sfw-respawn-button',
    label: 'Respawnear entidades',
    action: 'respawnEncounters',
    position: [-1.1, BASE_H + 1.15, 95.1],
    size: [0.5, 0.5, 0.16],
  })
  .actionButton({
    id: 'sfw-arsenal-button',
    label: 'Desplegar arsenal',
    action: 'spawnAllWeapons',
    position: [1.1, BASE_H + 1.15, 95.1],
    size: [0.5, 0.5, 0.16],
  });

// ── NPCs ─────────────────────────────────────────────────────────────────────
map
  // Base y granja.
  .npc({ id: 'sfw-alyx', characterId: 'alyx', position: [2, BASE_H + 1.5, 90] })
  .npcInRoom('sfw-farm-barn', 0, [2, 1], { id: 'sfw-zombie-barn', characterId: 'zombie' })
  .npc({ id: 'sfw-zombie-farm-1', characterId: 'zombie', position: [-54, FARM_H + 1.5, 90] })
  .npc({ id: 'sfw-zombie-farm-2', characterId: 'zombie', position: [-40, FARM_H + 1.5, 104] })
  // Checkpoint.
  .npc({
    id: 'sfw-check-guard-1',
    characterId: 'combine',
    position: [-4, CHECK_H + 1.5, 44],
    patrol: [
      [-6, CHECK_H + 0.5, 44],
      [6, CHECK_H + 0.5, 44],
      [0, CHECK_H + 0.5, 54],
    ],
  })
  .npc({ id: 'sfw-check-guard-2', characterId: 'combine', position: [4, CHECK_H + 1.5, 44] })
  .npc({ id: 'sfw-check-sniper', characterId: 'combine', position: [12, CHECK_H + 4.4, 50] })
  // Trinchera: la vieja línea quedó infestada.
  .npc({ id: 'sfw-zombie-trench-1', characterId: 'zombie', position: [-30, 1.8, 12] })
  .npc({ id: 'sfw-zombie-trench-2', characterId: 'zombie', position: [-24, 1.8, 17] })
  .npc({ id: 'sfw-zombie-trench-3', characterId: 'zombie', position: [-36, 1.8, 19] })
  .npc({ id: 'sfw-zombie-trench-4', characterId: 'zombie', position: [-27, 1.8, 24] })
  // Caserío oeste: infestado + patrulla combine que cruza el camino.
  .npcInRoom('sfw-hamlet-a', 0, [2, 1], { id: 'sfw-zombie-hamlet-a', characterId: 'zombie' })
  .npcInRoom('sfw-hamlet-c', 0, [-2, 1], { id: 'sfw-zombie-hamlet-c', characterId: 'zombie' })
  .npcInRoom('sfw-hamlet-d', 0, [1, -1], { id: 'sfw-zombie-hamlet-d', characterId: 'zombie' })
  .npcInRoom('sfw-hamlet-e', 0, [0, 1], { id: 'sfw-zombie-hamlet-e', characterId: 'zombie' })
  .npc({ id: 'sfw-zombie-hamlet-1', characterId: 'zombie', position: [-138, WEST_H + 1.5, 50] })
  .npc({ id: 'sfw-zombie-hamlet-2', characterId: 'zombie', position: [-150, WEST_H + 1.5, 62] })
  .npc({ id: 'sfw-zombie-hamlet-3', characterId: 'zombie', position: [-128, WEST_H + 1.5, 70] })
  .npc({
    id: 'sfw-patrol-west-1',
    characterId: 'combine',
    position: [-24, 1.8, 50],
    patrol: [
      [-20, 1, 50],
      [-90, 1, 52],
      [-138, 1, 56],
    ],
  })
  .npc({
    id: 'sfw-patrol-west-2',
    characterId: 'combine',
    position: [-32, 1.8, 53],
    patrol: [
      [-138, 1, 56],
      [-90, 1, 52],
      [-20, 1, 50],
    ],
  })
  // Fábrica: guarnición + infestados sueltos en la nave (pelea emergente).
  .npc({ id: 'sfw-fac-dock-1', characterId: 'combine', position: [22, FACTORY_H + 1.5, -24] })
  .npc({ id: 'sfw-fac-dock-2', characterId: 'combine', position: [26, FACTORY_H + 1.5, -34] })
  .npc({ id: 'sfw-fac-hall-1', characterId: 'combine', position: [-6, FACTORY_H + 1.5, -26] })
  .npc({ id: 'sfw-fac-hall-2', characterId: 'combine', position: [6, FACTORY_H + 1.5, -30] })
  .npcInRoom('sfw-factory', 1, [10, -8], {
    id: 'sfw-fac-overseer',
    characterId: 'combine',
    patrol: [
      map.roomPoint('sfw-factory', 1, [10, -8]),
      map.roomPoint('sfw-factory', 1, [-10, -8]),
      map.roomPoint('sfw-factory', 1, [0, 9]),
    ],
  })
  .npc({ id: 'sfw-zombie-fac-1', characterId: 'zombie', position: [-8, FACTORY_H + 1.5, -40] })
  .npc({ id: 'sfw-zombie-fac-2', characterId: 'zombie', position: [0, FACTORY_H + 1.5, -41] })
  .npc({ id: 'sfw-zombie-fac-3', characterId: 'zombie', position: [8, FACTORY_H + 1.5, -40] })
  // Bloque administrativo: guarnición por pisos + corredor exterior.
  .npcInRoom('sfw-admin', 0, [-5, 4], { id: 'sfw-adm-lobby', characterId: 'combine' })
  .npcInRoom('sfw-admin', 0, [5, 5], {
    id: 'sfw-adm-runner',
    characterId: 'combine',
    patrol: [
      map.roomPoint('sfw-admin', 0, [5, 5]),
      [118, ADMIN_H + 0.5, -72],
      [80, 1.2, -78],
      [50, 1.2, -78],
    ],
  })
  .npcInRoom('sfw-admin', 1, [-5, -4], { id: 'sfw-adm-f1', characterId: 'combine' })
  .npcInRoom('sfw-admin', 2, [4, -4], { id: 'sfw-adm-f2', characterId: 'combine' })
  .npcInRoom('sfw-admin', 3, [-4, 5], { id: 'sfw-adm-top-1', characterId: 'combine' })
  .npcInRoom('sfw-admin', 3, [4, -5], { id: 'sfw-adm-top-2', characterId: 'combine' })
  // Caserío norte: horda dispersa.
  .npcInRoom('sfw-village-a', 0, [2, 1], { id: 'sfw-zombie-vil-a', characterId: 'zombie' })
  .npcInRoom('sfw-village-c', 0, [-2, 1], { id: 'sfw-zombie-vil-c', characterId: 'zombie' })
  .npcInRoom('sfw-village-d', 0, [3, -1], { id: 'sfw-zombie-vil-d', characterId: 'zombie' })
  .npcInRoom('sfw-village-e', 0, [0, 1], { id: 'sfw-zombie-vil-e', characterId: 'zombie' })
  .npc({ id: 'sfw-zombie-vil-1', characterId: 'zombie', position: [-26, NORTH_H + 1.5, -150] })
  .npc({ id: 'sfw-zombie-vil-2', characterId: 'zombie', position: [0, NORTH_H + 1.5, -156] })
  .npc({ id: 'sfw-zombie-vil-3', characterId: 'zombie', position: [30, NORTH_H + 1.5, -148] })
  .npc({ id: 'sfw-zombie-vil-4', characterId: 'zombie', position: [60, NORTH_H + 1.5, -152] })
  // Depósito este.
  .npc({ id: 'sfw-depot-1', characterId: 'combine', position: [70, DEPOT_H + 1.5, -12] })
  .npc({ id: 'sfw-depot-2', characterId: 'combine', position: [84, DEPOT_H + 1.5, -4] })
  .npc({ id: 'sfw-depot-3', characterId: 'combine', position: [78, DEPOT_H + 1.5, 2] })
  .npc({ id: 'sfw-depot-tower-guard', characterId: 'combine', position: [94, DEPOT_H + 4.8, -18] })
  // Antena: defensa final + centinela que baja dos pisos en su ronda.
  .npc({ id: 'sfw-comms-yard-1', characterId: 'combine', position: [145, COMMS_H + 1.5, 71] })
  .npc({ id: 'sfw-comms-yard-2', characterId: 'combine', position: [156, COMMS_H + 1.5, 72] })
  .npcInRoom('sfw-comms', 1, [-2.5, -2], { id: 'sfw-comms-f1', characterId: 'combine' })
  // Vigía del piso superior de la antena: puesto fijo (la escalera switchback
  // de esta torre chica es muy angosta para una ronda fluida; defiende el techo).
  .npcInRoom('sfw-comms', 2, [-2, -2], { id: 'sfw-comms-sentinel', characterId: 'combine' });

// ── Pickups (progresión de arsenal) ─────────────────────────────────────────
map
  .pickupInRoom('sfw-base', 0, [-2.5, 1.5], { id: 'sfw-pickup-crowbar', weaponId: 'crowbar' })
  .pickupInRoom('sfw-base', 0, [0, 1.5], { id: 'sfw-pickup-pistol', weaponId: 'pistol' })
  .pickupInRoom('sfw-base', 0, [2.5, 1.5], { id: 'sfw-pickup-grenade-base', weaponId: 'grenade' })
  .pickup({ id: 'sfw-pickup-smg', weaponId: 'smg', position: [0, CHECK_H + 0.8, 41] })
  .pickupInRoom('sfw-hamlet-c', 0, [2, 0], { id: 'sfw-pickup-grenade-hamlet', weaponId: 'grenade' })
  .pickup({ id: 'sfw-pickup-shotgun-fac', weaponId: 'shotgun', position: [14, FACTORY_H + 0.8, -22] })
  .pickupInRoom('sfw-factory', 1, [-10, -8], { id: 'sfw-pickup-ar3-fac', weaponId: 'ar3' })
  .pickupInRoom('sfw-admin', 0, [-6, 4], { id: 'sfw-pickup-shotgun-adm', weaponId: 'shotgun' })
  .pickupInRoom('sfw-admin', 3, [-5, -5], { id: 'sfw-pickup-ar3-adm', weaponId: 'ar3' })
  .pickupInRoom('sfw-village-d', 0, [2, 1], { id: 'sfw-pickup-grenade-vil', weaponId: 'grenade' })
  .pickup({ id: 'sfw-pickup-smg-depot', weaponId: 'smg', position: [80, DEPOT_H + 0.8, -10] })
  .pickupInRoom('sfw-comms', 1, [2, -2], { id: 'sfw-pickup-grenade-comms', weaponId: 'grenade' })
  .pickupInRoom('sfw-comms', 2, [2, -2], { id: 'sfw-pickup-gravity-gun', weaponId: 'gravityGun' });

// ── Vitals (botiquines + baterías HEV, sembrados en los focos de combate) ────
map
  .itemInRoom('sfw-base', 0, [-2.5, -1.5], { id: 'sfw-item-medkit-base', itemId: 'medkit' })
  .itemInRoom('sfw-base', 0, [2.5, -1.5], { id: 'sfw-item-battery-base', itemId: 'hevBattery' })
  .item({ id: 'sfw-item-medkit-check', itemId: 'medkit', position: [4, CHECK_H, 44] })
  .item({ id: 'sfw-item-medkit-fac', itemId: 'medkit', position: [10, FACTORY_H, -18] })
  .item({ id: 'sfw-item-battery-fac', itemId: 'hevBattery', position: [16, FACTORY_H, -30] })
  .itemInRoom('sfw-admin', 0, [6, 4], { id: 'sfw-item-battery-adm', itemId: 'hevBattery' })
  .itemInRoom('sfw-admin', 2, [-5, 5], { id: 'sfw-item-medkit-adm', itemId: 'medkit' })
  .item({ id: 'sfw-item-medkit-depot', itemId: 'medkit', position: [84, DEPOT_H, -10] })
  .itemInRoom('sfw-village-d', 0, [-2, 1], { id: 'sfw-item-battery-vil', itemId: 'hevBattery' })
  .itemInRoom('sfw-comms', 1, [-2, 2], { id: 'sfw-item-battery-comms', itemId: 'hevBattery' });

// ── Cargadores de pared (vida / HEV) estilo HL2 ──────────────────────────────
map
  .chargerInRoom('sfw-base', 0, [-3, 2.5], { id: 'sfw-charger-health-base', kind: 'health' })
  .chargerInRoom('sfw-base', 0, [3, 2.5], { id: 'sfw-charger-hev-base', kind: 'armor' })
  .chargerInRoom('sfw-admin', 0, [-7, -5], { id: 'sfw-charger-health-adm', kind: 'health' })
  .chargerInRoom('sfw-factory', 1, [9, 7], { id: 'sfw-charger-hev-fac', kind: 'armor' });

// ── Narrativa por radio ──────────────────────────────────────────────────────
map
  .trigger({
    id: 'sfw-intro',
    position: [0, BASE_H + 2, 89],
    size: [13, 4, 8],
    once: true,
    dialogue: {
      speaker: 'Radio',
      text: 'Punto de inserción Boreal activo. Equipate en la consola: Alyx te cubre hasta el checkpoint.',
      duration: 5,
    },
  })
  .trigger({
    id: 'sfw-checkpoint-entry',
    position: [0, CHECK_H + 2, 54],
    size: [20, 4, 6],
    once: true,
    dialogue: {
      speaker: 'Radio',
      text: 'Checkpoint combine adelante. La torre de vigilancia tiene línea de tiro sobre el camino.',
      duration: 4,
    },
  })
  .trigger({
    id: 'sfw-hamlet-entry',
    position: [-100, 2, 52],
    size: [14, 4, 12],
    once: true,
    dialogue: {
      speaker: 'Radio',
      text: 'El caserío oeste está infestado. Las patrullas combine también lo saben — dejá que se desgasten entre ellos.',
      duration: 5,
    },
  })
  .trigger({
    id: 'sfw-factory-entry',
    position: [0, FACTORY_H + 2.4, -15],
    size: [18, 5, 6],
    once: true,
    dialogue: {
      speaker: 'Radio',
      text: 'La fábrica es el corazón del complejo. Hay infectados sueltos en la nave y oficinas ocupadas arriba.',
      duration: 5,
    },
  })
  .trigger({
    id: 'sfw-admin-entry',
    position: [118, ADMIN_H + 2.4, -76],
    size: [28, 5, 8],
    once: true,
    dialogue: {
      speaker: 'Radio',
      text: 'Bloque administrativo: cuatro pisos de resistencia. Arriba guardan equipamiento pesado.',
      duration: 4,
    },
  })
  .trigger({
    id: 'sfw-village-entry',
    position: [0, NORTH_H + 2, -132],
    size: [44, 4, 14],
    once: true,
    dialogue: {
      speaker: 'Radio',
      text: 'Caserío norte en silencio. Demasiado silencio: revisá casa por casa.',
      duration: 4,
    },
  })
  .trigger({
    id: 'sfw-comms-entry',
    position: [150, COMMS_H + 2, 84],
    size: [24, 4, 8],
    once: true,
    dialogue: {
      speaker: 'Radio',
      text: 'La antena es el objetivo final. Tomá la torre piso por piso y el valle es nuestro.',
      duration: 5,
    },
  });

export const SnowFactoryLevel: LevelDefinition = map.build();
