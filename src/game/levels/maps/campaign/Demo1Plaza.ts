import type { StaticBoxDefinition } from '@game/levels/LevelDefinition';
import { createMap } from '@game/levels/builders/MapCreator';
import {
  cargoContainer,
  coverWall,
  crate,
  crateStack,
  pillar,
  sandbagLine,
  watchtower,
} from '@game/levels/builders/PropBuilder';
import { DEMO1_DETAIL_BOXES } from './Demo1PlazaGeometry';

/**
 * Demo 1 — «Frecuencia muerta».
 *
 * Una historia autocontenida de 45–60 minutos organizada como un loop urbano:
 * anexo ferroviario → mercado → plaza → imprenta-refugio → depósito Combine →
 * canal → estación de bombeo → corredor de servicio → plaza transformada →
 * transmisor. La antena central se ve desde el primer tercio, pero recién queda
 * accesible después de recuperar el módulo de fase y restaurar la energía.
 *
 * El ritmo alterna los cinco tipos de beat usados por Valve para describir HL2:
 * exploración, vista, coreografía, combate y problema espacial. Los triggers
 * viven en umbrales concretos; ningún evento crítico depende de cruzar una línea
 * invisible que abarque todo el mapa. Los counters abren los gates, con relays
 * de seguridad que evitan softlocks si un spawn falla.
 */

const DISTRICT_BLOCKERS: StaticBoxDefinition[] = [
  // Línea urbana que separa la plaza del anillo industrial. Sólo se atraviesa
  // por la imprenta al ir y por la compuerta oeste al volver.
  { id: 'd1-block-divider-far-west', position: [-94, 2.5, 56], size: [32, 5, 0.55], material: 'brick' },
  { id: 'd1-block-divider-west', position: [-47, 2.5, 56], size: [44, 5, 0.55], material: 'brick' },
  { id: 'd1-block-divider-safehouse-w', position: [29, 2.5, 56], size: [8, 5, 0.55], material: 'brick' },
  { id: 'd1-block-divider-safehouse-e', position: [80.5, 2.5, 56], size: [59, 5, 0.55], material: 'brick' },

  // Recinto del transmisor: el jugador lo puede leer desde la plaza, pero el
  // único acceso jugable es la esclusa norte que abre el combate de retorno.
  { id: 'd1-block-radio-nw', position: [-14, 1.7, 60], size: [22, 3.4, 0.45], material: 'metalRusted' },
  { id: 'd1-block-radio-ne', position: [14, 1.7, 60], size: [22, 3.4, 0.45], material: 'metalRusted' },
  { id: 'd1-block-radio-w', position: [-25, 1.7, 40], size: [0.45, 3.4, 40], material: 'metalRusted' },
  { id: 'd1-block-radio-e', position: [25, 1.7, 40], size: [0.45, 3.4, 40], material: 'metalRusted' },
  { id: 'd1-block-radio-s', position: [0, 1.7, 20], size: [50, 3.4, 0.45], material: 'metalRusted' },

  // Riberas altas: hacen que el agua tóxica sea un obstáculo real. Los dos
  // huecos corresponden al puente principal (x=39) y al puente de retorno
  // (x=-72), ambos controlados por gates.
  { id: 'd1-block-canal-n-a', position: [-92.5, 1.1, -5], size: [35, 2.2, 0.65], material: 'concrete' },
  { id: 'd1-block-canal-n-b', position: [-17, 1.1, -5], size: [104, 2.2, 0.65], material: 'concrete' },
  { id: 'd1-block-canal-n-c', position: [76.5, 1.1, -5], size: [67, 2.2, 0.65], material: 'concrete' },
  { id: 'd1-block-canal-s-a', position: [-92.5, 1.1, -19], size: [35, 2.2, 0.65], material: 'concrete' },
  { id: 'd1-block-canal-s-b', position: [-17, 1.1, -19], size: [104, 2.2, 0.65], material: 'concrete' },
  { id: 'd1-block-canal-s-c', position: [76.5, 1.1, -19], size: [67, 2.2, 0.65], material: 'concrete' },
];

const map = createMap({
  id: 'demo-01-plaza',
  title: 'Demo 1 — Frecuencia muerta',
  description:
    'Una misión urbana autocontenida: recuperá un módulo Combine, restaurá la energía del distrito y defendé una transmisión de evacuación en un nivel plegado, vertical y explorable.',
  nextLevel: 'demo-02-ravenholm',
  objective: { text: 'Escuchá el plan de Alyx en el anexo', marker: [-66, 1.6, 138] },
  background: 0x202b32,
  sun: { direction: [-0.48, 0.82, 0.28], color: 0xffdfbd, intensity: 1.8 },
  playerStart: [-78, 1.2, 138],
  audio: {
    ambiences: ['background.hl2.atmosphere.cityRumble', 'background.hl2.atmosphere.plaza'],
    footstepSounds: [
      'footsteps.hl2.concrete1',
      'footsteps.hl2.concrete2',
      'footsteps.hl2.concrete3',
      'footsteps.hl2.concrete4',
    ],
    soundscape: 'outdoor',
  },
})
  .ground({ size: [220, 320], material: 'asphalt', boundary: { height: 12, material: 'wall' } })
  .boxes(...DISTRICT_BLOCKERS, ...DEMO1_DETAIL_BOXES)

  // ── Arquitectura funcional y recorrible ───────────────────────────────────
  .structure({
    id: 'd1-building-arrival-annex',
    center: [-78, 138],
    groundY: 0,
    width: 24,
    depth: 18,
    storyHeight: 3.4,
    groundSlab: true,
    roof: 'gable',
    palette: { base: 'brick', upper: 'plaster', trim: 'concrete', roof: 'roof', floor: 'concrete' },
    stories: [{ doors: [{ side: 'east', width: 3.2 }], windows: 'auto' }],
  })
  .house({
    id: 'd1-building-arrival-office',
    center: [-49, 132],
    floorY: 0,
    width: 13,
    depth: 11,
    height: 3.2,
    door: { side: 'south', width: 1.6 },
    groundSlab: true,
    palette: { base: 'plaster', trim: 'woodDark', roof: 'roof', floor: 'floor' },
  })
  .structure({
    id: 'd1-building-tenement-west',
    center: [-78, 91],
    groundY: 0,
    width: 22,
    depth: 26,
    storyHeight: 3.25,
    roof: 'walkable',
    palette: { base: 'brick', upper: 'plaster', trim: 'concrete', roof: 'roof', floor: 'floor' },
    stories: [
      {
        doors: [{ side: 'east', width: 2.6 }],
        windows: 'auto',
        stair: { footprint: { x: [-8.5, -5.3], z: [-5, 4] }, topAt: 'north', cutoutPadding: 0.55 },
      },
      {
        windows: 'auto',
        stair: { footprint: { x: [5.3, 8.5], z: [-4, 5] }, topAt: 'south', cutoutPadding: 0.55 },
      },
      { windows: 'auto' },
    ],
  })
  .structure({
    id: 'd1-building-tenement-east',
    center: [22, 106],
    groundY: 0,
    width: 24,
    depth: 20,
    storyHeight: 3.2,
    roof: 'flat',
    palette: { base: 'concrete', upper: 'plaster', trim: 'concrete', roof: 'roof', floor: 'floor' },
    stories: [
      {
        doors: [{ side: 'west', width: 2.4 }, { side: 'south', width: 1.8 }],
        windows: 'auto',
        stair: { footprint: { x: [7.1, 10.2], z: [-4, 4] }, topAt: 'north', cutoutPadding: 0.55 },
      },
      {
        windows: 'auto',
        stair: { footprint: { x: [-10.2, -7.1], z: [-4, 4] }, topAt: 'south', cutoutPadding: 0.55 },
      },
      { windows: 'auto' },
    ],
  })
  .house({
    id: 'd1-building-market-cafe',
    center: [-40, 83],
    floorY: 0,
    width: 14,
    depth: 12,
    height: 3.25,
    door: { side: 'east', width: 1.8 },
    groundSlab: true,
    palette: { base: 'plaster', trim: 'woodDark', roof: 'roof', floor: 'floor' },
  })
  .structure({
    id: 'd1-building-safehouse',
    center: [42, 65],
    groundY: 0,
    width: 18,
    depth: 16,
    storyHeight: 3.3,
    groundSlab: true,
    roof: 'gable',
    palette: { base: 'brick', upper: 'plaster', trim: 'woodDark', roof: 'roof', floor: 'concrete' },
    stories: [
      {
        doors: [{ side: 'south', width: 3.2 }, { side: 'north', width: 3.2 }],
        windows: 'auto',
        stair: { footprint: { x: [5.4, 7.8], z: [-3.5, 3.5] }, topAt: 'north', cutoutPadding: 0.55 },
        interiorWalls: [
          { id: 'safehouse-partition-w', position: [-4.8, 1.65, 0], size: [0.28, 3.1, 7.2], material: 'woodDark' },
          { id: 'safehouse-partition-e', position: [0.8, 1.65, -3.2], size: [6.8, 3.1, 0.28], material: 'woodDark' },
        ],
      },
      { windows: 'auto' },
    ],
  })
  .structure({
    id: 'd1-building-depot',
    center: [58, 18],
    groundY: 0,
    width: 32,
    depth: 28,
    storyHeight: 4,
    groundSlab: true,
    roof: 'flat',
    palette: { base: 'brick', upper: 'concrete', trim: 'metalRusted', roof: 'concrete', floor: 'concrete' },
    stories: [
      {
        doors: [
          { side: 'south', width: 5.5, height: 3.2 },
          { side: 'north', width: 4, height: 3 },
          { side: 'west', width: 2.4 },
        ],
        windows: 'auto',
        stair: { footprint: { x: [-14.3, -11.2], z: [-4.5, 4.5] }, topAt: 'north', cutoutPadding: 0.6 },
        interiorWalls: [
          { id: 'depot-office-wall-a', position: [6, 2, -5], size: [10, 3.8, 0.32], material: 'concrete' },
          { id: 'depot-office-wall-b', position: [11, 2, -1.5], size: [0.32, 3.8, 7], material: 'concrete' },
        ],
      },
      {
        windows: 'auto',
        interiorWalls: [
          { id: 'depot-catwalk-office', position: [5, 6, 4], size: [0.3, 3.6, 9], material: 'concrete' },
        ],
      },
    ],
  })
  .house({
    id: 'd1-building-depot-office',
    center: [87, 27],
    floorY: 0,
    width: 12,
    depth: 10,
    height: 3.2,
    door: { side: 'west', width: 1.6 },
    groundSlab: true,
    roof: false,
    palette: { base: 'concrete', trim: 'metalRusted', floor: 'concrete' },
  })
  .structure({
    id: 'd1-building-pump-house',
    center: [-54, -34],
    groundY: 0,
    width: 22,
    depth: 18,
    storyHeight: 3.4,
    groundSlab: true,
    roof: 'flat',
    palette: { base: 'brick', upper: 'concrete', trim: 'metalRusted', roof: 'concrete', floor: 'concrete' },
    stories: [
      {
        doors: [{ side: 'east', width: 3.2 }, { side: 'north', width: 1.8 }],
        windows: 'auto',
        stair: { footprint: { x: [-8.8, -5.7], z: [-3.8, 3.8] }, topAt: 'north', cutoutPadding: 0.55 },
        interiorWalls: [
          { id: 'pump-partition', position: [2.2, 1.7, 2.7], size: [9, 3.2, 0.3], material: 'metalRusted' },
        ],
      },
      { windows: 'auto' },
    ],
  })
  .structure({
    id: 'd1-building-service-block',
    center: [-88, 25],
    groundY: 0,
    width: 18,
    depth: 24,
    storyHeight: 3.2,
    roof: 'flat',
    palette: { base: 'concrete', upper: 'plaster', trim: 'concrete', roof: 'roof', floor: 'floor' },
    stories: [
      {
        doors: [{ side: 'east', width: 2.2 }],
        windows: 'auto',
        stair: { footprint: { x: [-7.2, -4.6], z: [-4.2, 4.2] }, topAt: 'north', cutoutPadding: 0.5 },
      },
      { windows: 'auto' },
    ],
  })
  .structure({
    id: 'd1-building-transmitter',
    center: [0, 40],
    groundY: 0,
    width: 16,
    depth: 16,
    storyHeight: 3.2,
    groundSlab: true,
    roof: 'flat',
    palette: { base: 'concrete', upper: 'brick', trim: 'signalBlue', roof: 'metalRusted', floor: 'concrete' },
    stories: [
      {
        doors: [{ side: 'south', width: 3 }, { side: 'north', width: 2 }],
        windows: 'auto',
        stair: { footprint: { x: [4.6, 7], z: [-3.2, 3.2] }, topAt: 'north', cutoutPadding: 0.55 },
      },
      {
        windows: 'auto',
        stair: { footprint: { x: [-7, -4.6], z: [-3.2, 3.2] }, topAt: 'south', cutoutPadding: 0.55 },
      },
      {
        windows: 'auto',
        stair: { footprint: { x: [4.6, 7], z: [-3.2, 3.2] }, topAt: 'north', cutoutPadding: 0.55 },
      },
      { windows: 'none', openSides: ['north', 'south', 'east', 'west'] },
    ],
  });

// ── Cobertura, lectura espacial y física ────────────────────────────────────
map.prop(
  // Mercado: tres rutas conectadas, cobertura baja y un borde elevado.
  crateStack({ id: 'd1-prop-market-crates-a', at: [-31, 102], rows: 2, cols: 3, layers: 1, seed: 11 }),
  crateStack({ id: 'd1-prop-market-crates-b', at: [-7, 91], rows: 2, cols: 2, layers: 2, seed: 12 }),
  coverWall({ id: 'd1-prop-market-cover-a', at: [-20, 96], axis: 'x', length: 7, material: 'concrete' }),
  coverWall({ id: 'd1-prop-market-cover-b', at: [5, 86], axis: 'z', length: 6, material: 'brick' }),
  sandbagLine({ id: 'd1-prop-market-bags', from: [7, 99], to: [18, 99], material: 'sand' }),
  pillar({ id: 'd1-prop-plaza-memorial', at: [-8, 80], height: 5.5, side: 1.5, material: 'concrete' }),

  // Puesto de control y depósito: líneas de tiro diagonales y catwalk usable.
  sandbagLine({ id: 'd1-prop-depot-bags-a', from: [45, 38], to: [54, 38], material: 'sand' }),
  sandbagLine({ id: 'd1-prop-depot-bags-b', from: [63, 35], to: [72, 35], material: 'sand' }),
  watchtower({ id: 'd1-prop-depot-watch', at: [84, 7], platformHeight: 3.4, rampSide: 'west', material: 'metalRusted' }),
  cargoContainer({ id: 'd1-prop-depot-container-a', at: [78, 18], axis: 'z', material: 'metalRusted' }),
  cargoContainer({ id: 'd1-prop-depot-container-b', at: [45, 12], axis: 'x', material: 'trim' }),
  crateStack({ id: 'd1-prop-depot-crates-a', at: [51, 18], rows: 2, cols: 3, layers: 2, seed: 21 }),
  crateStack({ id: 'd1-prop-depot-crates-b', at: [68, 9], rows: 2, cols: 2, layers: 1, seed: 22 }),
  coverWall({ id: 'd1-prop-depot-cover-a', at: [58, 14], axis: 'x', length: 6, material: 'concrete' }),
  coverWall({ id: 'd1-prop-depot-cover-b', at: [70, 23], axis: 'z', length: 5, material: 'metalRusted' }),

  // Bombeo: silueta industrial, maquinaria y salida de presión.
  pillar({ id: 'd1-prop-pump-stack-a', at: [-63, -44], height: 11, side: 1.8, material: 'brick' }),
  pillar({ id: 'd1-prop-pump-stack-b', at: [-57, -46], height: 14, side: 1.5, material: 'metalRusted' }),
  cargoContainer({ id: 'd1-prop-pump-machine', at: [-52, -37], axis: 'x', material: 'metalRusted' }),
  coverWall({ id: 'd1-prop-pump-cover', at: [-45, -27], axis: 'z', length: 6, material: 'concrete' }),
  crateStack({ id: 'd1-prop-pump-crates', at: [-62, -27], rows: 2, cols: 2, layers: 1, seed: 31 }),

  // Plaza transformada y recinto final: cobertura que sirve primero para
  // observar y después para combatir desde ángulos distintos.
  watchtower({ id: 'd1-prop-plaza-overlook', at: [14, 70], platformHeight: 3.2, rampSide: 'east', material: 'metalRusted' }),
  sandbagLine({ id: 'd1-prop-return-bags-a', from: [-53, 72], to: [-41, 72], material: 'sand' }),
  sandbagLine({ id: 'd1-prop-return-bags-b', from: [-17, 68], to: [-5, 68], material: 'sand' }),
  coverWall({ id: 'd1-prop-return-cover', at: [-30, 82], axis: 'z', length: 7, material: 'concrete' }),
  crateStack({ id: 'd1-prop-return-crates', at: [5, 73], rows: 2, cols: 3, layers: 1, seed: 41 }),
  coverWall({ id: 'd1-prop-radio-cover-w', at: [-15, 45], axis: 'z', length: 7, material: 'concrete' }),
  coverWall({ id: 'd1-prop-radio-cover-e', at: [15, 35], axis: 'z', length: 7, material: 'metalRusted' }),
  sandbagLine({ id: 'd1-prop-radio-bags-n', from: [-18, 53], to: [-7, 53], material: 'sand' }),
  sandbagLine({ id: 'd1-prop-radio-bags-s', from: [7, 27], to: [18, 27], material: 'sand' }),
  crateStack({ id: 'd1-prop-radio-crates', at: [17, 49], rows: 2, cols: 2, layers: 2, seed: 42 }),

  // Clutter dinámico: objetos manipulables que convierten la física en táctica.
  crate({ id: 'd1-prop-dyn-arrival-a', at: [-61, 0, 129], dynamic: true, mass: 16 }),
  crate({ id: 'd1-prop-dyn-arrival-b', at: [-59.8, 0, 128], dynamic: true, mass: 16 }),
  crate({ id: 'd1-prop-dyn-market-a', at: [-24, 0, 104], dynamic: true, mass: 18 }),
  crate({ id: 'd1-prop-dyn-market-b', at: [-16, 0, 89], dynamic: true, mass: 18 }),
  crate({ id: 'd1-prop-dyn-market-c', at: [2, 0, 96], dynamic: true, mass: 18 }),
  crate({ id: 'd1-prop-dyn-depot-a', at: [52, 0, 25], dynamic: true, mass: 20 }),
  crate({ id: 'd1-prop-dyn-depot-b', at: [55, 0, 11], dynamic: true, mass: 20 }),
  crate({ id: 'd1-prop-dyn-depot-c', at: [64, 0, 17], dynamic: true, mass: 20 }),
  crate({ id: 'd1-prop-dyn-depot-d', at: [70, 0, 8], dynamic: true, mass: 20 }),
  crate({ id: 'd1-prop-dyn-canal-a', at: [47, 0, -25], dynamic: true, mass: 15 }),
  crate({ id: 'd1-prop-dyn-canal-b', at: [33, 0, -27], dynamic: true, mass: 15 }),
  crate({ id: 'd1-prop-dyn-canal-c', at: [20, 0, -24], dynamic: true, mass: 15 }),
  crate({ id: 'd1-prop-dyn-pump-a', at: [-48, 0, -32], dynamic: true, mass: 22 }),
  crate({ id: 'd1-prop-dyn-radio-a', at: [-12, 0, 34], dynamic: true, mass: 18 }),
  crate({ id: 'd1-prop-dyn-radio-b', at: [10, 0, 51], dynamic: true, mass: 18 }),
  crate({ id: 'd1-prop-dyn-radio-c', at: [18, 0, 41], dynamic: true, mass: 18 }),
);

// ── Gates diegéticos e interacción principal ────────────────────────────────
map
  .door({
    id: 'd1-door-safehouse-entry',
    position: [42, 1.5, 73],
    size: [3.2, 3, 0.45],
    openOffset: [0, 3.3, 0],
    speed: 2.2,
    material: 'signalBlue',
    button: {
      id: 'd1-door-safehouse-entry-btn',
      label: 'Cerradura remota: mercado',
      position: [42, 5.4, 73.35],
      size: [0.3, 0.3, 0.12],
    },
  })
  .door({
    id: 'd1-door-safehouse-gate',
    position: [42, 1.5, 57],
    size: [3.2, 3, 0.45],
    openOffset: [0, 3.3, 0],
    speed: 2.2,
    material: 'metalRusted',
    button: { id: 'd1-door-safehouse-gate-btn', label: 'Cierre interno', position: [42, -1, 56.4], size: [0.3, 0.3, 0.12] },
  })
  .door({
    id: 'd1-door-depot-locker',
    position: [66, 1.3, 9.5],
    size: [2.6, 2.6, 0.35],
    openOffset: [0, 2.9, 0],
    speed: 2,
    material: 'door',
    button: { id: 'd1-door-depot-locker-btn', label: 'Depósito sellado', position: [66, -1, 9.2], size: [0.3, 0.3, 0.12] },
  })
  .door({
    id: 'd1-door-canal-gate',
    position: [39, 1.5, -4.7],
    size: [7.4, 3, 0.45],
    openOffset: [0, 3.3, 0],
    speed: 2.4,
    material: 'metalRusted',
    button: { id: 'd1-door-canal-gate-btn', label: 'Puente bloqueado', position: [39, -1, -5.3], size: [0.3, 0.3, 0.12] },
  })
  .door({
    id: 'd1-door-service-bridge',
    position: [-72, 1.5, -4.7],
    size: [5.8, 3, 0.45],
    openOffset: [0, 3.3, 0],
    speed: 2.4,
    material: 'metalRusted',
    button: { id: 'd1-door-service-bridge-btn', label: 'Puente de servicio', position: [-72, -1, -5.3], size: [0.3, 0.3, 0.12] },
  })
  .door({
    id: 'd1-door-return-gate',
    position: [-72, 1.6, 56],
    size: [5.8, 3.2, 0.45],
    openOffset: [0, 3.5, 0],
    speed: 2.5,
    material: 'door',
    button: { id: 'd1-door-return-gate-btn', label: 'Acceso de mantenimiento', position: [-72, -1, 55.4], size: [0.3, 0.3, 0.12] },
  })
  .door({
    id: 'd1-door-radio-gate',
    position: [0, 1.6, 60],
    size: [5.8, 3.2, 0.45],
    openOffset: [0, 3.5, 0],
    speed: 2.6,
    material: 'door',
    button: { id: 'd1-door-radio-gate-btn', label: 'Recinto del transmisor', position: [0, -1, 59.4], size: [0.3, 0.3, 0.12] },
  })
  .door({
    id: 'd1-door-transmitter-switch',
    position: [0, 10.35, 34],
    size: [1.8, 1.4, 0.28],
    openOffset: [0, 1.55, 0],
    speed: 1.4,
    material: 'signalBlue',
    button: {
      id: 'd1-door-transmitter-switch-btn',
      label: 'ACTIVAR TRANSMISIÓN DE EMERGENCIA',
      position: [1.25, 10.35, 34.18],
      size: [0.42, 0.42, 0.16],
    },
    connections: [{ output: 'OnOpen', target: 'd1-relay-broadcast', input: 'Trigger', maxFires: 1 }],
  })
  .door({
    id: 'd1-door-pump-switch',
    position: [-57, 1.05, -36.5],
    size: [1.6, 1.8, 0.3],
    openOffset: [0, 1.95, 0],
    speed: 1.5,
    material: 'signalRed',
    button: {
      id: 'd1-door-pump-switch-btn',
      label: 'INSTALAR MÓDULO Y ARRANCAR BATERÍAS',
      position: [-55.85, 1.05, -36.32],
      size: [0.42, 0.42, 0.16],
    },
    connections: [{ output: 'OnOpen', target: 'd1-relay-power', input: 'Trigger', maxFires: 1 }],
  })
  .door({
    id: 'd1-door-exit-gate',
    position: [-86, 1.6, 40],
    size: [0.45, 3.2, 5.5],
    openOffset: [0, 3.5, 0],
    speed: 2.6,
    material: 'door',
    button: { id: 'd1-door-exit-gate-btn', label: 'Salida del distrito', position: [-86.5, -1, 40], size: [0.3, 0.3, 0.12] },
  });

// ── Personajes y arsenal con progresión ─────────────────────────────────────
map
  .npc({ id: 'd1-npc-alyx', name: 'alyx', characterId: 'alyx', position: [-69, 1, 138] })
  // Inicio: una herramienta y un arma corta, no un arsenal alineado.
  .pickup({ id: 'd1-pickup-crowbar', weaponId: 'crowbar', position: [-77, 0.45, 136] })
  .pickup({ id: 'd1-pickup-pistol', weaponId: 'pistol', position: [-73.5, 0.45, 136] })
  .ammo({ id: 'd1-ammo-pistol-start', ammoId: 'pistol', position: [-72, 0.45, 134.8] })
  .item({ id: 'd1-item-medkit-start', itemId: 'medkit', position: [-80, 0.45, 134.8] })
  // Recompensa del primer combate y secretos de exploración vertical.
  .pickup({ id: 'd1-pickup-smg', weaponId: 'smg', position: [-29, 0.45, 86] })
  .ammo({ id: 'd1-ammo-smg-market', ammoId: 'smg', position: [-27.8, 0.45, 86] })
  .pickupInRoom('d1-building-tenement-west', 2, [1.5, 2], { id: 'd1-pickup-crossbow-secret', weaponId: 'crossbow' })
  .ammoInRoom('d1-building-tenement-west', 2, [-1, 2], { id: 'd1-ammo-crossbow-secret', ammoId: 'crossbow' })
  .itemInRoom('d1-building-tenement-west', 1, [2, -2], { id: 'd1-item-battery-tenement', itemId: 'hevBattery' })
  // Safehouse: preparación del asalto al depósito.
  .ammoInRoom('d1-building-safehouse', 0, [-1, 2], { id: 'd1-ammo-smg-safehouse', ammoId: 'smg' })
  .itemInRoom('d1-building-safehouse', 0, [2, 2], { id: 'd1-item-medkit-safehouse', itemId: 'medkit' })
  .chargerInRoom('d1-building-safehouse', 0, [-6.8, -4.5], { id: 'd1-charger-safehouse-health', kind: 'health' })
  .chargerInRoom('d1-building-safehouse', 0, [-5.2, -4.5], { id: 'd1-charger-safehouse-armor', kind: 'armor' })
  // Shotgun antes de los espacios cerrados; gravity gun presentada como el
  // módulo robado para ligar recompensa, historia y mecánica.
  .pickup({ id: 'd1-pickup-shotgun', weaponId: 'shotgun', position: [49, 0.45, 28] })
  .ammo({ id: 'd1-ammo-shotgun-depot-a', ammoId: 'shotgun', position: [50.2, 0.45, 28] })
  .ammo({ id: 'd1-ammo-shotgun-depot-b', ammoId: 'shotgun', position: [51.4, 0.45, 28] })
  .pickup({ id: 'd1-pickup-gravity-module', weaponId: 'gravityGun', position: [66, 0.5, 8.6] })
  .item({ id: 'd1-item-battery-module', itemId: 'hevBattery', position: [64.7, 0.45, 8.6] })
  // El canal demuestra enseguida la física con granadas, cajas y barriles.
  .pickup({ id: 'd1-pickup-grenade', weaponId: 'grenade', position: [48, 0.45, -24] })
  .ammo({ id: 'd1-ammo-smg-canal', ammoId: 'smg', position: [46.8, 0.45, -24] })
  .pickupInRoom('d1-building-pump-house', 1, [2, 1], { id: 'd1-pickup-ar3-secret', weaponId: 'ar3' })
  .ammoInRoom('d1-building-pump-house', 1, [0, 1], { id: 'd1-ammo-ar3-secret', ammoId: 'ar3' })
  .itemInRoom('d1-building-pump-house', 0, [4, -4], { id: 'd1-item-medkit-pump', itemId: 'medkit' })
  // Resupply del clímax distribuido en rutas opuestas del recinto.
  .ammo({ id: 'd1-ammo-shotgun-radio', ammoId: 'shotgun', position: [-18, 0.45, 51] })
  .ammo({ id: 'd1-ammo-smg-radio', ammoId: 'smg', position: [18, 0.45, 30] })
  .ammo({ id: 'd1-ammo-ar3-radio', ammoId: 'ar3', position: [17, 0.45, 52] })
  .item({ id: 'd1-item-medkit-radio-a', itemId: 'medkit', position: [-19, 0.45, 30] })
  .item({ id: 'd1-item-battery-radio', itemId: 'hevBattery', position: [19, 0.45, 44] })
  .charger({ id: 'd1-charger-radio-health', kind: 'health', position: [-6.8, 0, 47], rotationY: Math.PI })
  .charger({ id: 'd1-charger-radio-armor', kind: 'armor', position: [6.8, 0, 47], rotationY: Math.PI });

// Trampas físicas y microhistorias de combate.
for (const [id, position] of [
  ['d1-barrel-market-a', [-3, 0, 91]],
  ['d1-barrel-market-b', [10, 0, 88]],
  ['d1-barrel-depot-a', [54, 0, 13]],
  ['d1-barrel-depot-b', [68, 0, 20]],
  ['d1-barrel-depot-c', [72, 0, 9]],
  ['d1-barrel-canal-a', [27, 0, -26]],
  ['d1-barrel-canal-b', [15, 0, -24]],
  ['d1-barrel-return-a', [-25, 0, 75]],
  ['d1-barrel-radio-a', [-14, 0, 29]],
  ['d1-barrel-radio-b', [15, 0, 50]],
] as const) {
  map.explosiveBarrel({ id, position: [...position] });
}

map.hazardVolume({
  id: 'd1-hazard-toxic-canal',
  position: [0, 0.65, -12],
  size: [210, 2.2, 13.2],
  kind: 'toxic',
  damagePerSecond: 42,
});

// ── Objetivos, mensajes y ambientes ─────────────────────────────────────────
map
  .logic({
    kind: 'auto',
    id: 'd1-auto-boot',
    name: 'd1-auto-boot',
    connections: [
      { output: 'OnMapSpawn', target: 'd1-msg-cold-open', input: 'Show' },
      { output: 'OnMapSpawn', target: 'd1-obj-listen', input: 'Apply' },
    ],
  })
  .logic({ kind: 'objective', id: 'd1-obj-listen', name: 'd1-obj-listen', text: 'Escuchá el plan de Alyx en el anexo', marker: [-66, 1.6, 138] })
  .logic({ kind: 'objective', id: 'd1-obj-safehouse', name: 'd1-obj-safehouse', text: 'Cruzá el mercado y llegá a la imprenta-refugio', marker: [42, 1.6, 70] })
  .logic({ kind: 'objective', id: 'd1-obj-depot', name: 'd1-obj-depot', text: 'Entrá al depósito y recuperá el módulo de fase', marker: [66, 1.6, 9] })
  .logic({ kind: 'objective', id: 'd1-obj-clear-depot', name: 'd1-obj-clear-depot', text: 'Despejá el depósito Combine', marker: [58, 1.6, 16] })
  .logic({ kind: 'objective', id: 'd1-obj-power', name: 'd1-obj-power', text: 'Cruzá el canal y restaurá energía en la estación de bombeo', marker: [-57, 1.4, -36] })
  .logic({ kind: 'objective', id: 'd1-obj-return', name: 'd1-obj-return', text: 'Volvé a la plaza por el corredor de servicio oeste', marker: [-72, 1.6, 65] })
  .logic({ kind: 'objective', id: 'd1-obj-clear-plaza', name: 'd1-obj-clear-plaza', text: 'Recuperá la plaza y abrí el recinto del transmisor', marker: [0, 1.6, 60] })
  .logic({ kind: 'objective', id: 'd1-obj-transmitter', name: 'd1-obj-transmitter', text: 'Subí a la cabina y activá la transmisión', marker: [0, 10.4, 34] })
  .logic({ kind: 'objective', id: 'd1-obj-defend', name: 'd1-obj-defend', text: 'Defendé la antena hasta completar el código de evacuación', marker: [0, 1.6, 40] })
  .logic({ kind: 'objective', id: 'd1-obj-exit', name: 'd1-obj-exit', text: 'La señal salió: escapá por el acceso oeste', marker: [-96, 1.6, 40] })

  .logic({ kind: 'message', id: 'd1-msg-cold-open', name: 'd1-msg-cold-open', speaker: 'Radio de la Resistencia', text: 'Distrito Once, transmisión interrumpida. Ventana de evacuación cancelada.', duration: 4 })
  .logic({ kind: 'message', id: 'd1-msg-vista', name: 'd1-msg-vista', speaker: 'Alyx', text: '¿Ves la antena azul? Lucía escondió civiles debajo. Si vuelve a emitir, van a saber cuándo correr.', duration: 5 })
  .logic({ kind: 'message', id: 'd1-msg-market', name: 'd1-msg-market', speaker: 'Alyx', text: 'Nos marcaron. Usá los puestos: cortales la línea de tiro y rodealos.', duration: 4 })
  .logic({ kind: 'message', id: 'd1-msg-market-clear', name: 'd1-msg-market-clear', speaker: 'Alyx', text: 'Despejado. La puerta verde de la imprenta está al este.', duration: 3.5 })
  .logic({ kind: 'message', id: 'd1-msg-safehouse-open', name: 'd1-msg-safehouse-open', speaker: 'Lucía', text: 'Abrí la salida del taller. El depósito está pegado al canal; entren por el patio de carga.', duration: 4 })
  .logic({ kind: 'message', id: 'd1-msg-depot', name: 'd1-msg-depot', speaker: 'Alyx', text: 'Patio vacío, luces encendidas... es una trampa. Revisá también las pasarelas.', duration: 4 })
  .logic({ kind: 'message', id: 'd1-msg-depot-clear', name: 'd1-msg-depot-clear', speaker: 'Lucía', text: 'Ese gabinete. El módulo emite un pulso azul; no lo dañen.', duration: 4 })
  .logic({ kind: 'message', id: 'd1-msg-module', name: 'd1-msg-module', speaker: 'Alyx', text: 'Lo tenemos. Y le adaptaron un campo de gravedad... probalo con las cajas del canal.', duration: 4.5 })
  .logic({ kind: 'message', id: 'd1-msg-canal', name: 'd1-msg-canal', speaker: 'Alyx', text: 'El agua está cargada de químicos. Puente alto o nada; hay manhacks en los conductos.', duration: 4 })
  .logic({ kind: 'message', id: 'd1-msg-power', name: 'd1-msg-power', speaker: 'Lucía', text: '¡La batería tomó carga! El corredor oeste y la antena vuelven a responder.', duration: 4 })
  .logic({ kind: 'message', id: 'd1-msg-infestation', name: 'd1-msg-infestation', speaker: 'Alyx', text: 'El arranque abrió las compuertas de drenaje. ¡Tenemos compañía!', duration: 3.5 })
  .logic({ kind: 'message', id: 'd1-msg-return', name: 'd1-msg-return', speaker: 'Lucía', text: 'El Combine entró a la plaza. Si toman la antena antes que ustedes, todo esto no sirvió.', duration: 4.5 })
  .logic({ kind: 'message', id: 'd1-msg-plaza-clear', name: 'd1-msg-plaza-clear', speaker: 'Alyx', text: 'Recinto abierto. Subí; yo sostengo el patio.', duration: 3.5 })
  .logic({ kind: 'message', id: 'd1-msg-broadcast', name: 'd1-msg-broadcast', speaker: 'Lucía', text: 'Portadora estable. Estoy enviando el código... noventa segundos. No dejen que corten la antena.', duration: 5 })
  .logic({ kind: 'message', id: 'd1-msg-finish', name: 'd1-msg-finish', speaker: 'Lucía', text: 'Código recibido. Los refugios están evacuando. Distrito Once tiene una salida.', duration: 5 })
  .logic({ kind: 'message', id: 'd1-msg-tenement-story', name: 'd1-msg-tenement-story', speaker: 'Grabación doméstica', text: 'Día diecinueve: la luz azul sigue parpadeando. Mientras parpadee, alguien todavía escucha.', duration: 5 })
  .logic({ kind: 'message', id: 'd1-msg-depot-log', name: 'd1-msg-depot-log', speaker: 'Terminal Combine', text: 'Incautación 11-C: modulador civil reconfigurado. Ejecución del técnico aplazada.', duration: 4.5 })

  .logic({ kind: 'soundscape', id: 'd1-ss-outdoor', name: 'd1-ss-outdoor', soundscape: 'outdoor' })
  .logic({ kind: 'soundscape', id: 'd1-ss-safehouse', name: 'd1-ss-safehouse', soundscape: 'smallInterior' })
  .logic({ kind: 'soundscape', id: 'd1-ss-depot', name: 'd1-ss-depot', soundscape: 'warehouse' })
  .logic({ kind: 'soundscape', id: 'd1-ss-canal', name: 'd1-ss-canal', soundscape: 'metalTunnel' })
  .logic({ kind: 'soundscape', id: 'd1-ss-pump', name: 'd1-ss-pump', soundscape: 'factory' })
  .logic({ kind: 'soundscape', id: 'd1-ss-radio', name: 'd1-ss-radio', soundscape: 'lab' });

// ── Coreografías breves, siempre dentro del mundo y sin quitar control ──────
map
  .sequence({
    id: 'd1-seq-intro',
    name: 'd1-seq-intro',
    targetNpc: 'alyx',
    position: [-68, 1, 138],
    moveMode: 'walk',
    overrideAi: true,
    steps: [
      { kind: 'face', target: '!player' },
      { kind: 'gesture', gesture: 'point', duration: 1.1 },
      { kind: 'say', speaker: 'Alyx', text: 'El Combine apagó el transmisor del barrio. Lucía tiene cuarenta personas escondidas bajo la plaza.', duration: 5 },
      { kind: 'say', speaker: 'Alyx', text: 'Recuperamos lo que robaron, devolvemos corriente y les damos una ventana para salir. Una vuelta al distrito. Después nos vamos.', duration: 6 },
    ],
    connections: [{ output: 'OnEnd', target: 'd1-obj-safehouse', input: 'Apply' }],
  })
  .sequence({
    id: 'd1-seq-lucia',
    name: 'd1-seq-lucia',
    targetNpc: 'lucia',
    position: [40, 1, 65],
    moveMode: 'walk',
    overrideAi: true,
    steps: [
      { kind: 'face', target: '!player' },
      { kind: 'say', speaker: 'Lucía', text: 'Pensé que no venían. Se llevaron el módulo de fase al depósito, y quemaron la alimentación del canal.', duration: 5.5 },
      { kind: 'gesture', gesture: 'point', duration: 1.1 },
      { kind: 'say', speaker: 'Lucía', text: 'Tráiganlo a la estación de bombeo. El banco de baterías puede levantar la antena una última vez.', duration: 5 },
    ],
    connections: [{ output: 'OnEnd', target: 'd1-relay-safehouse-release', input: 'Trigger' }],
  })
  .sequence({
    id: 'd1-seq-power',
    name: 'd1-seq-power',
    targetNpc: 'alyx',
    position: [-48, 1, -33],
    moveMode: 'run',
    overrideAi: false,
    steps: [
      { kind: 'face', target: '!player' },
      { kind: 'gesture', gesture: 'point', duration: 1 },
      { kind: 'say', speaker: 'Alyx', text: 'El camino de vuelta está abierto. Volvemos por el puente de servicio, no por donde entramos.', duration: 4.5 },
    ],
  })
  .sequence({
    id: 'd1-seq-resolution',
    name: 'd1-seq-resolution',
    targetNpc: 'alyx',
    position: [-20, 1, 47],
    moveMode: 'run',
    overrideAi: false,
    steps: [
      { kind: 'face', target: '!player' },
      { kind: 'say', speaker: 'Alyx', text: 'Mirá las luces bajo la plaza... se están moviendo. Llegamos a tiempo.', duration: 4.5 },
      { kind: 'gesture', gesture: 'wave', duration: 1.1 },
    ],
  });

// ── Encuentros y grafo Entity I/O ───────────────────────────────────────────
map
  .logic({
    kind: 'npcSpawner',
    id: 'd1-spawn-safehouse-allies',
    name: 'd1-spawn-safehouse-allies',
    npcs: [
      { id: 'd1-npc-lucia', name: 'lucia', characterId: 'rebelF2', position: [40, 1, 65] },
      { id: 'd1-npc-medic', characterId: 'rebelMedic', position: [46, 1, 67] },
      { id: 'd1-npc-safehouse-guard', characterId: 'rebelM3', position: [45, 1, 61] },
    ],
    connections: [{ output: 'OnSpawned', target: 'd1-seq-lucia', input: 'Start' }],
  })
  .logic({
    kind: 'relay',
    id: 'd1-relay-safehouse-release',
    name: 'd1-relay-safehouse-release',
    triggerOnce: true,
    connections: [
      { output: 'OnTrigger', target: 'd1-door-safehouse-gate', input: 'Open' },
      { output: 'OnTrigger', target: 'd1-msg-safehouse-open', input: 'Show' },
      { output: 'OnTrigger', target: 'd1-obj-depot', input: 'Apply' },
    ],
  })
  .logic({
    kind: 'npcSpawner',
    id: 'd1-spawn-market',
    name: 'd1-spawn-market',
    npcs: [
      { id: 'd1-enemy-market-a', characterId: 'combine', position: [-20, 1, 96], connections: [{ output: 'OnDeath', target: 'd1-count-market', input: 'Add' }] },
      { id: 'd1-enemy-market-b', characterId: 'combine', position: [-3, 1, 88], connections: [{ output: 'OnDeath', target: 'd1-count-market', input: 'Add' }] },
      { id: 'd1-enemy-market-c', characterId: 'combine', position: [12, 1, 93], connections: [{ output: 'OnDeath', target: 'd1-count-market', input: 'Add' }] },
      { id: 'd1-enemy-market-d', characterId: 'manhack', position: [0, 3.2, 99], connections: [{ output: 'OnDeath', target: 'd1-count-market', input: 'Add' }] },
    ],
  })
  .logic({
    kind: 'counter',
    id: 'd1-count-market',
    name: 'd1-count-market',
    max: 4,
    connections: [
      { output: 'OnHitMax', target: 'd1-msg-market-clear', input: 'Show' },
      { output: 'OnHitMax', target: 'd1-obj-safehouse', input: 'Apply' },
      { output: 'OnHitMax', target: 'd1-door-safehouse-entry', input: 'Open', delay: 0.4 },
    ],
  })

  .logic({
    kind: 'npcSpawner',
    id: 'd1-spawn-depot-a',
    name: 'd1-spawn-depot-a',
    npcs: [
      { id: 'd1-enemy-depot-a', characterId: 'combine', position: [52, 1, 16], connections: [{ output: 'OnDeath', target: 'd1-count-depot', input: 'Add' }] },
      { id: 'd1-enemy-depot-b', characterId: 'combine', position: [65, 1, 13], connections: [{ output: 'OnDeath', target: 'd1-count-depot', input: 'Add' }] },
      { id: 'd1-enemy-depot-c', characterId: 'combineShotgunner', position: [58, 1, 6], connections: [{ output: 'OnDeath', target: 'd1-count-depot', input: 'Add' }] },
    ],
  })
  .logic({
    kind: 'npcSpawner',
    id: 'd1-spawn-depot-b',
    name: 'd1-spawn-depot-b',
    npcs: [
      { id: 'd1-enemy-depot-d', characterId: 'combine', position: [49, 4.4, 13], connections: [{ output: 'OnDeath', target: 'd1-count-depot', input: 'Add' }] },
      { id: 'd1-enemy-depot-e', characterId: 'combineShotgunner', position: [67, 4.4, 21], connections: [{ output: 'OnDeath', target: 'd1-count-depot', input: 'Add' }] },
      { id: 'd1-enemy-depot-f', characterId: 'manhack', position: [58, 5.8, 22], connections: [{ output: 'OnDeath', target: 'd1-count-depot', input: 'Add' }] },
    ],
  })
  .logic({
    kind: 'counter',
    id: 'd1-count-depot',
    name: 'd1-count-depot',
    max: 6,
    connections: [
      { output: 'OnHitMax', target: 'd1-door-depot-locker', input: 'Open' },
      { output: 'OnHitMax', target: 'd1-module-trigger', input: 'Enable' },
      { output: 'OnHitMax', target: 'd1-msg-depot-clear', input: 'Show' },
    ],
  })

  .logic({
    kind: 'relay',
    id: 'd1-relay-canal-ambush',
    name: 'd1-relay-canal-ambush',
    triggerOnce: true,
    connections: [
      { output: 'OnTrigger', target: 'd1-msg-canal', input: 'Show' },
      { output: 'OnTrigger', target: 'd1-spawn-canal', input: 'Spawn', delay: 1 },
      { output: 'OnTrigger', target: 'd1-ss-canal', input: 'Activate' },
    ],
  })
  .logic({
    kind: 'npcSpawner',
    id: 'd1-spawn-canal',
    name: 'd1-spawn-canal',
    npcs: [
      { id: 'd1-enemy-canal-a', characterId: 'manhack', position: [30, 3.2, -10] },
      { id: 'd1-enemy-canal-b', characterId: 'manhack', position: [43, 4, -14] },
      { id: 'd1-enemy-canal-c', characterId: 'manhack', position: [34, 2.8, -23] },
    ],
  })

  .logic({
    kind: 'relay',
    id: 'd1-relay-power',
    name: 'd1-relay-power',
    triggerOnce: true,
    connections: [
      { output: 'OnTrigger', target: 'd1-msg-power', input: 'Show' },
      { output: 'OnTrigger', target: 'd1-msg-infestation', input: 'Show', delay: 2.5 },
      { output: 'OnTrigger', target: 'd1-door-service-bridge', input: 'Open' },
      { output: 'OnTrigger', target: 'd1-door-return-gate', input: 'Open', delay: 0.4 },
      { output: 'OnTrigger', target: 'd1-obj-return', input: 'Apply', delay: 1 },
      { output: 'OnTrigger', target: 'd1-spawn-pump', input: 'Spawn', delay: 2.5 },
      { output: 'OnTrigger', target: 'd1-seq-power', input: 'Start', delay: 4 },
    ],
  })
  .logic({
    kind: 'npcSpawner',
    id: 'd1-spawn-pump',
    name: 'd1-spawn-pump',
    npcs: [
      { id: 'd1-enemy-pump-a', characterId: 'zombie', position: [-45, 1, -41] },
      { id: 'd1-enemy-pump-b', characterId: 'zombie', position: [-64, 1, -32] },
      { id: 'd1-enemy-pump-c', characterId: 'headcrab', position: [-48, 1, -27] },
      { id: 'd1-enemy-pump-d', characterId: 'headcrab', position: [-59, 1, -25] },
      { id: 'd1-enemy-pump-e', characterId: 'headcrab', position: [-68, 1, -39] },
    ],
  })

  .logic({
    kind: 'npcSpawner',
    id: 'd1-spawn-return-a',
    name: 'd1-spawn-return-a',
    npcs: [
      { id: 'd1-enemy-return-a', characterId: 'combine', position: [-50, 1, 82], connections: [{ output: 'OnDeath', target: 'd1-count-return', input: 'Add' }] },
      { id: 'd1-enemy-return-b', characterId: 'combine', position: [-28, 1, 75], connections: [{ output: 'OnDeath', target: 'd1-count-return', input: 'Add' }] },
      { id: 'd1-enemy-return-c', characterId: 'combineShotgunner', position: [-12, 1, 84], connections: [{ output: 'OnDeath', target: 'd1-count-return', input: 'Add' }] },
      { id: 'd1-enemy-return-d', characterId: 'manhack', position: [-34, 3.4, 91], connections: [{ output: 'OnDeath', target: 'd1-count-return', input: 'Add' }] },
    ],
  })
  .logic({
    kind: 'npcSpawner',
    id: 'd1-spawn-return-b',
    name: 'd1-spawn-return-b',
    npcs: [
      { id: 'd1-enemy-return-e', characterId: 'combine', position: [5, 1, 76], connections: [{ output: 'OnDeath', target: 'd1-count-return', input: 'Add' }] },
      { id: 'd1-enemy-return-f', characterId: 'combineElite', position: [13, 1, 66], connections: [{ output: 'OnDeath', target: 'd1-count-return', input: 'Add' }] },
      { id: 'd1-enemy-return-g', characterId: 'manhack', position: [4, 3.6, 94], connections: [{ output: 'OnDeath', target: 'd1-count-return', input: 'Add' }] },
    ],
  })
  .logic({
    kind: 'counter',
    id: 'd1-count-return',
    name: 'd1-count-return',
    max: 7,
    connections: [
      { output: 'OnHitMax', target: 'd1-door-radio-gate', input: 'Open' },
      { output: 'OnHitMax', target: 'd1-msg-plaza-clear', input: 'Show' },
      { output: 'OnHitMax', target: 'd1-obj-transmitter', input: 'Apply', delay: 0.5 },
    ],
  })

  .logic({
    kind: 'relay',
    id: 'd1-relay-broadcast',
    name: 'd1-relay-broadcast',
    triggerOnce: true,
    connections: [
      { output: 'OnTrigger', target: 'd1-msg-broadcast', input: 'Show' },
      { output: 'OnTrigger', target: 'd1-obj-defend', input: 'Apply' },
      { output: 'OnTrigger', target: 'd1-spawn-final-a', input: 'Spawn', delay: 1.5 },
      { output: 'OnTrigger', target: 'd1-spawn-final-b', input: 'Spawn', delay: 10 },
      { output: 'OnTrigger', target: 'd1-spawn-final-c', input: 'Spawn', delay: 20 },
      // Fallback de supervivencia: si un NPC queda fuera del nav o no spawnea,
      // la transmisión igual termina después de 100 s.
      { output: 'OnTrigger', target: 'd1-relay-finish', input: 'Trigger', delay: 100 },
    ],
  })
  .logic({
    kind: 'npcSpawner',
    id: 'd1-spawn-final-a',
    name: 'd1-spawn-final-a',
    npcs: [
      { id: 'd1-enemy-final-a', characterId: 'combine', position: [-18, 1, 49], connections: [{ output: 'OnDeath', target: 'd1-count-final', input: 'Add' }] },
      { id: 'd1-enemy-final-b', characterId: 'combine', position: [18, 1, 50], connections: [{ output: 'OnDeath', target: 'd1-count-final', input: 'Add' }] },
      { id: 'd1-enemy-final-c', characterId: 'combineShotgunner', position: [0, 1, 25], connections: [{ output: 'OnDeath', target: 'd1-count-final', input: 'Add' }] },
    ],
  })
  .logic({
    kind: 'npcSpawner',
    id: 'd1-spawn-final-b',
    name: 'd1-spawn-final-b',
    npcs: [
      { id: 'd1-enemy-final-d', characterId: 'combineShotgunner', position: [-19, 1, 34], connections: [{ output: 'OnDeath', target: 'd1-count-final', input: 'Add' }] },
      { id: 'd1-enemy-final-e', characterId: 'combine', position: [19, 1, 35], connections: [{ output: 'OnDeath', target: 'd1-count-final', input: 'Add' }] },
      { id: 'd1-enemy-final-f', characterId: 'manhack', position: [-8, 4, 29], connections: [{ output: 'OnDeath', target: 'd1-count-final', input: 'Add' }] },
    ],
  })
  .logic({
    kind: 'npcSpawner',
    id: 'd1-spawn-final-c',
    name: 'd1-spawn-final-c',
    npcs: [
      { id: 'd1-enemy-final-g', characterId: 'combineElite', position: [0, 1, 53], connections: [{ output: 'OnDeath', target: 'd1-count-final', input: 'Add' }] },
      { id: 'd1-enemy-final-h', characterId: 'combine', position: [-17, 1, 27], connections: [{ output: 'OnDeath', target: 'd1-count-final', input: 'Add' }] },
      { id: 'd1-enemy-final-i', characterId: 'combine', position: [17, 1, 27], connections: [{ output: 'OnDeath', target: 'd1-count-final', input: 'Add' }] },
      { id: 'd1-enemy-final-j', characterId: 'manhack', position: [9, 4.5, 51], connections: [{ output: 'OnDeath', target: 'd1-count-final', input: 'Add' }] },
    ],
  })
  .logic({
    kind: 'counter',
    id: 'd1-count-final',
    name: 'd1-count-final',
    max: 10,
    connections: [{ output: 'OnHitMax', target: 'd1-relay-finish', input: 'Trigger' }],
  })
  .logic({
    kind: 'relay',
    id: 'd1-relay-finish',
    name: 'd1-relay-finish',
    triggerOnce: true,
    connections: [
      { output: 'OnTrigger', target: 'd1-msg-finish', input: 'Show' },
      { output: 'OnTrigger', target: 'd1-door-exit-gate', input: 'Open' },
      { output: 'OnTrigger', target: 'd1-door-return-gate', input: 'Open' },
      { output: 'OnTrigger', target: 'd1-door-radio-gate', input: 'Open' },
      { output: 'OnTrigger', target: 'd1-exit-trigger', input: 'Enable' },
      { output: 'OnTrigger', target: 'd1-obj-exit', input: 'Apply', delay: 0.8 },
      { output: 'OnTrigger', target: 'd1-seq-resolution', input: 'Start', delay: 2 },
    ],
  })
  .logic({ kind: 'changelevel', id: 'd1-changelevel', name: 'd1-changelevel', landmark: [-100, 1.2, 40] });

// ── Triggers en umbrales reales ─────────────────────────────────────────────
map
  .trigger({
    id: 'd1-intro-trigger',
    position: [-65, 1.2, 138],
    size: [3, 3, 10],
    once: true,
    connections: [{ output: 'OnStartTouch', target: 'd1-seq-intro', input: 'Start' }],
  })
  .trigger({
    id: 'd1-vista-trigger',
    position: [-50, 1.2, 113],
    size: [10, 3, 8],
    once: true,
    connections: [{ output: 'OnStartTouch', target: 'd1-msg-vista', input: 'Show' }],
  })
  .trigger({
    id: 'd1-market-trigger',
    position: [-35, 1.2, 101],
    size: [10, 3, 6],
    once: true,
    connections: [
      { output: 'OnStartTouch', target: 'd1-spawn-market', input: 'Spawn' },
      { output: 'OnStartTouch', target: 'd1-msg-market', input: 'Show' },
      // Antibloqueo: si una baja no llega al counter, el refugio se abre igual.
      { output: 'OnStartTouch', target: 'd1-door-safehouse-entry', input: 'Open', delay: 75 },
    ],
  })
  .trigger({
    id: 'd1-safehouse-enter-trigger',
    position: [42, 1.2, 70],
    size: [5, 3, 3],
    once: true,
    connections: [
      { output: 'OnStartTouch', target: 'd1-ss-safehouse', input: 'Activate' },
      { output: 'OnStartTouch', target: 'd1-spawn-safehouse-allies', input: 'Spawn' },
      // La salida no depende de que Lucía sobreviva ni de que termine su locomoción.
      { output: 'OnStartTouch', target: 'd1-relay-safehouse-release', input: 'Trigger', delay: 20 },
    ],
  })
  .trigger({
    id: 'd1-safehouse-exit-trigger',
    position: [42, 1.2, 54.5],
    size: [5, 3, 3],
    once: true,
    connections: [{ output: 'OnStartTouch', target: 'd1-ss-outdoor', input: 'Activate' }],
  })
  .trigger({
    id: 'd1-depot-trigger',
    position: [58, 1.2, 33],
    size: [9, 3, 3],
    once: true,
    connections: [
      { output: 'OnStartTouch', target: 'd1-ss-depot', input: 'Activate' },
      { output: 'OnStartTouch', target: 'd1-msg-depot', input: 'Show' },
      { output: 'OnStartTouch', target: 'd1-obj-clear-depot', input: 'Apply' },
      { output: 'OnStartTouch', target: 'd1-spawn-depot-a', input: 'Spawn', delay: 0.8 },
      { output: 'OnStartTouch', target: 'd1-spawn-depot-b', input: 'Spawn', delay: 7 },
      // Fallback de 90 s para un spawn fallido.
      { output: 'OnStartTouch', target: 'd1-door-depot-locker', input: 'Open', delay: 90 },
      { output: 'OnStartTouch', target: 'd1-module-trigger', input: 'Enable', delay: 90 },
    ],
  })
  .trigger({
    id: 'd1-module-trigger',
    position: [66, 1.2, 8.6],
    size: [4, 3, 4],
    once: true,
    startDisabled: true,
    connections: [
      { output: 'OnStartTouch', target: 'd1-msg-module', input: 'Show' },
      { output: 'OnStartTouch', target: 'd1-door-canal-gate', input: 'Open' },
      { output: 'OnStartTouch', target: 'd1-obj-power', input: 'Apply' },
      { output: 'OnStartTouch', target: 'd1-ss-outdoor', input: 'Activate' },
    ],
  })
  .trigger({
    id: 'd1-canal-trigger',
    position: [39, 1.5, -22.5],
    size: [8, 4, 4],
    once: true,
    connections: [{ output: 'OnStartTouch', target: 'd1-relay-canal-ambush', input: 'Trigger' }],
  })
  .trigger({
    id: 'd1-pump-enter-trigger',
    position: [-42.5, 1.2, -34],
    size: [3, 3, 6],
    once: true,
    connections: [{ output: 'OnStartTouch', target: 'd1-ss-pump', input: 'Activate' }],
  })
  .trigger({
    id: 'd1-return-trigger',
    position: [-66, 1.2, 66],
    size: [8, 3, 5],
    once: true,
    connections: [
      { output: 'OnStartTouch', target: 'd1-ss-outdoor', input: 'Activate' },
      { output: 'OnStartTouch', target: 'd1-msg-return', input: 'Show' },
      { output: 'OnStartTouch', target: 'd1-obj-clear-plaza', input: 'Apply' },
      { output: 'OnStartTouch', target: 'd1-spawn-return-a', input: 'Spawn', delay: 0.5 },
      { output: 'OnStartTouch', target: 'd1-spawn-return-b', input: 'Spawn', delay: 8 },
      // Fallback: la esclusa abre tras dos minutos aunque un actor se pierda.
      { output: 'OnStartTouch', target: 'd1-door-radio-gate', input: 'Open', delay: 120 },
      { output: 'OnStartTouch', target: 'd1-obj-transmitter', input: 'Apply', delay: 120 },
    ],
  })
  .trigger({
    id: 'd1-radio-yard-trigger',
    position: [0, 1.2, 56],
    size: [7, 3, 4],
    once: true,
    connections: [
      { output: 'OnStartTouch', target: 'd1-ss-radio', input: 'Activate' },
      { output: 'OnStartTouch', target: 'd1-obj-transmitter', input: 'Apply' },
    ],
  })
  .trigger({
    id: 'd1-tenement-story-trigger',
    position: [-78, 7.7, 91],
    size: [8, 2.5, 8],
    once: true,
    connections: [{ output: 'OnStartTouch', target: 'd1-msg-tenement-story', input: 'Show' }],
  })
  .trigger({
    id: 'd1-depot-log-trigger',
    position: [67, 4.7, 22],
    size: [5, 2.5, 5],
    once: true,
    connections: [{ output: 'OnStartTouch', target: 'd1-msg-depot-log', input: 'Show' }],
  })
  .trigger({
    id: 'd1-exit-trigger',
    position: [-96, 1.2, 40],
    size: [4, 3, 8],
    once: true,
    startDisabled: true,
    connections: [{ output: 'OnStartTouch', target: 'd1-changelevel', input: 'Trigger', delay: 1.2 }],
  });

// ── Checkpoints colocados antes de eventos stateful ─────────────────────────
map
  .checkpoint({ id: 'd1-cp-market', position: [-47, 1.2, 109], size: [8, 3, 4], respawn: [-48, 1.2, 111] })
  .checkpoint({ id: 'd1-cp-depot', position: [58, 1.2, 37], size: [9, 3, 4], respawn: [58, 1.2, 38] })
  .checkpoint({ id: 'd1-cp-canal-south', position: [39, 1.2, -24], size: [8, 3, 3], respawn: [39, 1.2, -23] })
  .checkpoint({ id: 'd1-cp-pump', position: [-45, 1.2, -34], size: [5, 3, 6], respawn: [-44, 1.2, -34] })
  .checkpoint({ id: 'd1-cp-return', position: [-72, 1.2, 63], size: [7, 3, 4], respawn: [-72, 1.2, 64] })
  .checkpoint({ id: 'd1-cp-radio-yard', position: [0, 1.2, 55], size: [6, 3, 3], respawn: [0, 1.2, 54] })
  .checkpoint({ id: 'd1-cp-transmitter', position: [0, 10.8, 39], size: [8, 2.5, 8], respawn: [0, 10.8, 39] });

export const Demo1Plaza = map.build();
