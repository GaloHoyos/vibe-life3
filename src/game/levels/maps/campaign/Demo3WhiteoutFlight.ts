import { createMap } from '@game/levels/builders/MapCreator';
import type { VectorTuple } from '@shared/math/VectorTuple';
import type { NPCDefinition } from '@game/levels/LevelDefinition';
import {
  cargoContainer,
  coverWall,
  crateStack,
  pillar,
  sandbagLine,
  watchtower,
} from '@game/levels/builders/PropBuilder';
import { D3_ROAD, DEMO3_PASS_ARTIFACT } from './Demo3WhiteoutPassGeometry';

/**
 * Demo 3 — El paso blanco.
 *
 * Capítulo de montaña en cinco actos que alterna pie y vehículo: control
 * Combine a cielo abierto, depósito tomado, la ruta del paso en buggy, el
 * asedio del relé y una extracción que hay que pilotear. Los vehículos son el
 * hilo, pero el peso está en el combate a pie y en los eventos guionados.
 *
 * Convención de ejes del capítulo: el jugador entra por el sur (+Z) y avanza
 * hacia el norte (−Z). El valle jugable es x ∈ [−110, 110].
 */

const SNOW_FOOTSTEPS = [
  'footsteps.snow1',
  'footsteps.snow2',
  'footsteps.snow3',
  'footsteps.snow4',
];

/** Enemigo que le suma al contador de su encuentro al morir. */
function counted(
  counter: string,
  def: Omit<NPCDefinition, 'connections'>,
): NPCDefinition {
  return {
    ...def,
    connections: [{ output: 'OnDeath', target: counter, input: 'Add', param: 1 }],
  };
}

const ROAD_LANE: VectorTuple[] = D3_ROAD.map(([x, z]) => [x, 0, z]);

const map = createMap({
  id: 'demo-03-whiteout-flight',
  title: 'Demo 3 — El paso blanco',
  description:
    'Capítulo de montaña: un control Combine a cielo abierto, un depósito tomado, la ruta del paso en buggy, el asedio del relé y una extracción que hay que pilotear.',
  nextLevel: 'snow-field',
  entryLandmark: { position: [-46, 1.2, 138], yaw: 0 },
  objective: { text: 'Cruzá el control Combine del paso', marker: [10, 1.6, 98] },
  background: 0xccdbe3,
  sun: { direction: [-0.24, 0.66, 0.22], color: 0xe6f1f6, intensity: 0.76 },
  playerStart: [-46, 1.2, 138],
  audio: {
    ambiences: ['background.wind', 'background.hl2.wind.wasteland'],
    footstepSounds: SNOW_FOOTSTEPS,
    soundscape: 'wasteland',
  },
})
  .ground({
    size: [340, 320],
    material: 'snow',
    boundary: { height: 20, thickness: 1, material: 'rock' },
  })
  .building(DEMO3_PASS_ARTIFACT);

// ── Acto 1: boca del paso ────────────────────────────────────────────────────
// El convoy rebelde reventado es a la vez el arsenal de arranque y la lección
// de lectura del capítulo: lo que quedó tirado marca por dónde se avanza.
map
  .boxes(
    { id: 'd3-convoy-slab', position: [-46, 0.04, 139], size: [22, 0.08, 16], material: 'concrete' },
    { id: 'd3-convoy-wreck-a', position: [-53, 1, 144], size: [5.4, 2, 2.4], material: 'metalRusted', rotation: [0, 0.34, 0.12] },
    { id: 'd3-convoy-wreck-b', position: [-38, 0.8, 145], size: [4.6, 1.6, 2.2], material: 'metalRusted', rotation: [0, -0.5, -0.08] },
  )
  .prop(
    cargoContainer({ id: 'd3-convoy-container', at: [-57, 133], axis: 'z' }),
    crateStack({ id: 'd3-convoy-crates', at: [-38, 135], rows: 2, cols: 2, layers: 2, seed: 331 }),
    sandbagLine({ id: 'd3-convoy-bags', from: [-52, 131], to: [-42, 131] }),
  )
  .charger({ id: 'd3-charger-start-health', kind: 'health', position: [-58, 0, 138], rotationY: Math.PI / 2 })
  .pickup({ id: 'd3-pickup-crowbar', weaponId: 'crowbar', position: [-48, 0.5, 137] })
  .pickup({ id: 'd3-pickup-pistol', weaponId: 'pistol', position: [-46.4, 0.5, 137] })
  .pickup({ id: 'd3-pickup-ar3', weaponId: 'ar3', position: [-44.8, 0.5, 137] })
  .ammo({ id: 'd3-ammo-pistol-start', ammoId: 'pistol', position: [-48, 0.45, 135.4] })
  .ammo({ id: 'd3-ammo-ar3-start', ammoId: 'ar3', position: [-46.4, 0.45, 135.4] })
  .item({ id: 'd3-item-medkit-start', itemId: 'medkit', position: [-44.8, 0.45, 135.4] })
  .npc({
    id: 'd3-alyx',
    name: 'd3-alyx',
    characterId: 'alyx',
    position: [-42, 1.2, 140],
    transitionKey: 'campaign-alyx',
  });

// ── Acto 1: el cuenco del control ────────────────────────────────────────────
// Arena de combate libre. Tres vías de ataque —rocas al oeste, contenedores por
// el centro, berma al este— y una posición alta enemiga que obliga a moverse.
map
  .house({
    id: 'd3-checkpoint-post',
    center: [18, 96],
    floorY: 0,
    width: 13,
    depth: 9,
    height: 3.6,
    door: { side: 'south', width: 1.8 },
    windows: 'auto',
    groundSlab: true,
    wallMaterial: 'concrete',
    roofMaterial: 'metalRusted',
  })
  .prop(
    watchtower({ id: 'd3-checkpoint-tower', at: [-30, 92], platformHeight: 4, rampSide: 'south' }),
    cargoContainer({ id: 'd3-bowl-container-a', at: [-52, 104], axis: 'z' }),
    cargoContainer({ id: 'd3-bowl-container-b', at: [56, 92], axis: 'x' }),
    cargoContainer({ id: 'd3-bowl-container-c', at: [2, 82], axis: 'z' }),
    coverWall({ id: 'd3-bowl-cover-a', at: [-8, 101], axis: 'x', length: 13, material: 'concrete' }),
    coverWall({ id: 'd3-bowl-cover-b', at: [38, 102], axis: 'x', length: 10, material: 'concrete' }),
    coverWall({ id: 'd3-bowl-cover-c', at: [-40, 76], axis: 'x', length: 12, material: 'concrete' }),
    sandbagLine({ id: 'd3-bowl-bags-a', from: [-72, 88], to: [-54, 88] }),
    sandbagLine({ id: 'd3-bowl-bags-b', from: [62, 110], to: [78, 110] }),
    crateStack({ id: 'd3-bowl-crates-a', at: [-18, 78], rows: 2, cols: 3, layers: 2, seed: 907 }),
    crateStack({ id: 'd3-bowl-crates-b', at: [34, 70], rows: 2, cols: 2, layers: 1, seed: 908 }),
    pillar({ id: 'd3-bowl-pillar-a', at: [-6, 90], height: 4.2 }),
    pillar({ id: 'd3-bowl-pillar-b', at: [28, 84], height: 4.2 }),
  )
  .explosiveBarrel({ id: 'd3-barrel-bowl-a', position: [-49, 0, 101] })
  .explosiveBarrel({ id: 'd3-barrel-bowl-b', position: [-47.4, 0, 102.6] })
  .explosiveBarrel({ id: 'd3-barrel-bowl-c', position: [54, 0, 89] })
  .ammo({ id: 'd3-ammo-ar3-bowl', ammoId: 'ar3', position: [16, 0.45, 94] })
  .item({ id: 'd3-item-medkit-bowl', itemId: 'medkit', position: [19, 0.45, 94] })

  .npc(counted('d3-count-bowl', { id: 'd3-cmb-bowl-a', characterId: 'combine', position: [12, 1.2, 100] }))
  .npc(counted('d3-count-bowl', { id: 'd3-cmb-bowl-b', characterId: 'combine', position: [24, 1.2, 102] }))
  .npc(counted('d3-count-bowl', { id: 'd3-cmb-bowl-c', characterId: 'combineShotgunner', position: [-12, 1.2, 88] }))
  .npc(counted('d3-count-bowl', { id: 'd3-cmb-bowl-d', characterId: 'combine', position: [-44, 1.2, 96] }))
  // Tirador alto sobre la torre: es el que rompe el punto muerto detrás de los
  // contenedores y empuja al jugador a rodear.
  .npc(counted('d3-count-bowl', { id: 'd3-cmb-bowl-tower', characterId: 'combine', position: [-30, 4.5, 92] }));

// ── Acto 2: el depósito ──────────────────────────────────────────────────────
map
  .structure({
    id: 'd3-depot-warehouse',
    center: [-78, 12],
    groundY: 0,
    width: 30,
    depth: 22,
    storyHeight: 4.4,
    stories: [
      {
        doors: [
          { side: 'south', offset: 7, width: 3.2 },
          { side: 'east', offset: 0, width: 6, height: 3.4 },
        ],
        windows: 'auto',
        stair: { footprint: { x: [-13, -8], z: [-4, 6] }, topAt: 'north' },
      },
      // El balcón al este convierte la planta alta en una galería de tiro sobre
      // la playa: el jugador entra bajo fuego cruzado y tiene que subir.
      { openSides: ['east'], windows: 'auto' },
    ],
    groundSlab: true,
    roof: 'walkable',
    palette: {
      base: 'concrete',
      upper: 'metalRusted',
      trim: 'concrete',
      roof: 'metalRusted',
      floor: 'concrete',
    },
  })
  .prop(
    cargoContainer({ id: 'd3-depot-container-a', at: [-50, 28], axis: 'x' }),
    cargoContainer({ id: 'd3-depot-container-b', at: [-38, 8], axis: 'z' }),
    crateStack({ id: 'd3-depot-crates-a', at: [-56, 6], rows: 2, cols: 2, layers: 2, seed: 515 }),
    crateStack({ id: 'd3-depot-crates-b', at: [-44, 30], rows: 1, cols: 3, layers: 1, seed: 516 }),
    sandbagLine({ id: 'd3-depot-bags', from: [-60, 32], to: [-48, 32] }),
    coverWall({ id: 'd3-depot-cover', at: [-58, 22], axis: 'x', length: 9, material: 'concrete' }),
  )
  .explosiveBarrel({ id: 'd3-barrel-depot-a', position: [-40, 0, 24] })
  .explosiveBarrel({ id: 'd3-barrel-depot-b', position: [-38.6, 0, 25.4] })
  // Portón del galpón: la salida del buggy, cerrada hasta que el jugador
  // encuentra el pulsador adentro.
  .door({
    id: 'd3-depot-gate',
    position: [-63, 1.7, 12],
    size: [6, 3.4, 0.6],
    openOffset: [0, 3.3, 0],
    speed: 1.6,
    material: 'metalRusted',
    button: {
      id: 'd3-depot-gate-button',
      label: 'ABRIR EL PORTÓN',
      position: [-66.2, 1.2, 15.6],
      size: [0.5, 0.5, 0.18],
    },
    connections: [
      { output: 'OnOpen', target: 'd3-msg-gate-open', input: 'Show', maxFires: 1 },
      { output: 'OnOpen', target: 'd3-obj-take-buggy', input: 'Apply', maxFires: 1 },
    ],
  })
  .pickupInRoom('d3-depot-warehouse', 0, [9, -6], { id: 'd3-pickup-shotgun', weaponId: 'shotgun' })
  .ammoInRoom('d3-depot-warehouse', 0, [7.4, -6], { id: 'd3-ammo-shotgun-depot', ammoId: 'shotgun' })
  .itemInRoom('d3-depot-warehouse', 0, [5.8, -6], { id: 'd3-item-battery-depot', itemId: 'hevBattery' })
  .ammoInRoom('d3-depot-warehouse', 1, [-6, 4], { id: 'd3-ammo-ar3-depot', ammoId: 'ar3' })
  .item({ id: 'd3-item-medkit-depot', itemId: 'medkit', position: [-52, 0.45, 31] })
  .chargerInRoom('d3-depot-warehouse', 0, [-13.4, -8], { id: 'd3-charger-depot', kind: 'armor' })

  .npc(counted('d3-count-depot', { id: 'd3-cmb-depot-a', characterId: 'combineShotgunner', position: [-72, 1.2, 16] }))
  .npc(counted('d3-count-depot', { id: 'd3-cmb-depot-b', characterId: 'combine', position: [-70, 5.6, 8] }))
  .npc(counted('d3-count-depot', { id: 'd3-cmb-depot-c', characterId: 'combine', position: [-76, 5.6, 16] }))
  .npc(counted('d3-count-depot', { id: 'd3-cmb-depot-d', characterId: 'combine', position: [-48, 1.2, 20] }))
  .npc(counted('d3-count-depot', { id: 'd3-cmb-depot-e', characterId: 'combine', position: [-44, 1.2, 30] }))
  .npc({ id: 'd3-vania', name: 'd3-vania', characterId: 'rebelF1', position: [-58, 1.2, 33] });

// ── Acto 3: la ruta del paso ─────────────────────────────────────────────────
// El estrechamiento es lo que convierte un valle abierto en un control: sin él,
// una barrera sobre la calzada no bloquea nada, se la rodea por la nieve.
map
  .boxes(
    { id: 'd3-narrows-west', position: [-13, 8, -24], size: [194, 16, 12], material: 'rock' },
    { id: 'd3-narrows-east', position: [103, 8, -24], size: [14, 16, 12], material: 'rock' },
    { id: 'd3-combine-pad', position: [64, 0.05, -40], size: [22, 0.1, 22], material: 'concrete' },
  )
  .house({
    id: 'd3-gate-post',
    center: [70, -10],
    floorY: 0,
    width: 12,
    depth: 10,
    height: 3.6,
    door: { side: 'east', width: 1.8 },
    windows: 'auto',
    groundSlab: true,
    wallMaterial: 'concrete',
    roofMaterial: 'metalRusted',
  })
  .prop(
    sandbagLine({ id: 'd3-gate-bags-a', from: [80, -14], to: [80, -4] }),
    sandbagLine({ id: 'd3-gate-bags-b', from: [92, -12], to: [102, -12] }),
    coverWall({ id: 'd3-gate-cover', at: [86, -6], axis: 'x', length: 10, material: 'concrete' }),
    cargoContainer({ id: 'd3-gate-container', at: [96, -4], axis: 'z' }),
    crateStack({ id: 'd3-road-crates', at: [30, 12], rows: 2, cols: 2, layers: 1, seed: 733 }),
    cargoContainer({ id: 'd3-road-container', at: [52, -2], axis: 'x' }),
    // Mira a la boca del estrechamiento: es de donde va a salir el jugador.
    sandbagLine({ id: 'd3-pad-bags', from: [76, -48], to: [76, -32] }),
  )
  .explosiveBarrel({ id: 'd3-barrel-gate-a', position: [94, 0, -8] })
  .explosiveBarrel({ id: 'd3-barrel-pad-a', position: [56, 0, -48] })
  .explosiveBarrel({ id: 'd3-barrel-pad-b', position: [57.4, 0, -49.4] })
  // Barrera del control. El pulsador vive dentro del puesto: hay que bajarse
  // del buggy y tomarlo a pie, que es el corte de ritmo del acto vehicular.
  .door({
    id: 'd3-gate-barrier',
    position: [90, 1.8, -24],
    size: [12.4, 3.6, 0.8],
    openOffset: [0, 3.5, 0],
    speed: 1.4,
    material: 'hazard',
    button: {
      id: 'd3-gate-barrier-button',
      label: 'LIBERAR LA BARRERA DEL PASO',
      position: [70, 1.2, -5.6],
      size: [0.5, 0.5, 0.18],
    },
    connections: [
      { output: 'OnOpen', target: 'd3-relay-gate-open', input: 'Trigger', maxFires: 1 },
    ],
  })
  .pickup({ id: 'd3-pickup-rpg', weaponId: 'rpg', position: [72, 0.5, -12] })
  .ammo({ id: 'd3-ammo-rpg-gate', ammoId: 'rpg', position: [73.4, 0.45, -12] })
  .ammo({ id: 'd3-ammo-shotgun-gate', ammoId: 'shotgun', position: [68.6, 0.45, -12] })
  .item({ id: 'd3-item-medkit-gate', itemId: 'medkit', position: [70, 0.45, -13.6] })

  .npc(counted('d3-count-gate', { id: 'd3-cmb-gate-a', characterId: 'combine', position: [82, 1.2, -10] }))
  .npc(counted('d3-count-gate', { id: 'd3-cmb-gate-b', characterId: 'combine', position: [94, 1.2, -14] }))
  .npc(counted('d3-count-gate', { id: 'd3-cmb-gate-c', characterId: 'combineShotgunner', position: [72, 1.2, -8] }))
  .npc(counted('d3-count-gate', { id: 'd3-cmb-gate-d', characterId: 'combine', position: [98, 1.2, -6] }))
  .npc(counted('d3-count-gate', { id: 'd3-cmb-gate-elite', characterId: 'combineElite', position: [88, 1.2, -16] }))

  // Guardias del pad: son la futura tripulación del helicóptero. Matarlos antes
  // de que suene la alarma deja al aparato clavado en tierra, y eso es una
  // recompensa legítima por explorar en vez de correr por la calzada.
  .npc({ id: 'd3-cmb-pad-a', characterId: 'combine', position: [56, 1.2, -32] })
  .npc({ id: 'd3-cmb-pad-b', characterId: 'combine', position: [72, 1.2, -32] })

  .vehicle({
    id: 'd3-player-buggy',
    presetId: 'buggy',
    position: [-70, 1.1, 12],
    rotation: [0, Math.PI / 2, 0],
    faction: 'resistance',
    accessPolicy: 'player',
    weaponEnabled: true,
    engineOn: false,
    transitionKey: 'campaign-pass-buggy',
    portalTraversal: 'blocked',
    connections: [
      { output: 'OnPlayerEntered', target: 'd3-msg-buggy', input: 'Show', maxFires: 1 },
      { output: 'OnPlayerEntered', target: 'd3-obj-reach-relay', input: 'Apply', maxFires: 1 },
    ],
  })
  .vehicle({
    id: 'd3-cmb-buggy-a',
    presetId: 'buggy',
    position: [66, 1.1, -4],
    rotation: [0, -Math.PI / 2, 0],
    faction: 'combine',
    accessPolicy: 'combine',
    crew: [
      { actor: 'd3-drv-buggy-a', role: 'driver', seatId: 'driver' },
      { actor: 'd3-gnr-buggy-a', role: 'gunner', seatId: 'gunner' },
    ],
    weaponEnabled: true,
    engineOn: true,
    startDisabled: true,
    ai: { enabled: true, behavior: 'intercept', goal: 'd3-marker-ambush' },
    portalTraversal: 'blocked',
  })
  .vehicle({
    id: 'd3-cmb-buggy-b',
    presetId: 'buggy',
    position: [58, 1.1, -6],
    rotation: [0, -Math.PI / 2, 0],
    faction: 'combine',
    accessPolicy: 'combine',
    crew: [{ actor: 'd3-drv-buggy-b', role: 'driver', seatId: 'driver' }],
    weaponEnabled: true,
    engineOn: true,
    startDisabled: true,
    ai: { enabled: true, behavior: 'flank', goal: 'd3-marker-ambush' },
    portalTraversal: 'blocked',
  })
  // Transporte Combine del pad. Arranca inerte y sin ofrecer puestos: la
  // tripulación corre hacia él recién cuando el guion da la alarma.
  .vehicle({
    id: 'd3-cmb-helicopter',
    presetId: 'helicopterFree',
    position: [64, 1.4, -40],
    rotation: [0, Math.PI, 0],
    faction: 'combine',
    accessPolicy: 'combine',
    weaponEnabled: true,
    engineOn: true,
    startDisabled: true,
    aiCrew: { enabled: false, roles: ['pilot', 'gunner'], radius: 30 },
    ai: { enabled: true, behavior: 'intercept', goal: '!player' },
    portalTraversal: 'blocked',
    connections: [
      { output: 'OnCrashed', target: 'd3-msg-heli-down', input: 'Show', maxFires: 1 },
      { output: 'OnDestroyed', target: 'd3-msg-heli-down', input: 'Show', maxFires: 1 },
    ],
  })
  .npc({ id: 'd3-drv-buggy-a', characterId: 'combine', position: [64, 1.2, -2] })
  .npc({ id: 'd3-gnr-buggy-a', characterId: 'combine', position: [68, 1.2, -2] })
  .npc({ id: 'd3-drv-buggy-b', characterId: 'combine', position: [56, 1.2, -4] });

// ── Acto 4: el relé ──────────────────────────────────────────────────────────
// Recinto con dos bocas —el portón del sur y la brecha del este— para que la
// defensa sea una decisión de reparto y no un pasillo.
map
  .boxes(
    { id: 'd3-relay-wall-s-a', position: [30, 2.2, -80], size: [40, 4.4, 1.2], material: 'concrete' },
    { id: 'd3-relay-wall-s-b', position: [67, 2.2, -80], size: [10, 4.4, 1.2], material: 'concrete' },
    { id: 'd3-relay-wall-n', position: [41, 2.2, -136], size: [62, 4.4, 1.2], material: 'concrete' },
    { id: 'd3-relay-wall-w', position: [10, 2.2, -108], size: [1.2, 4.4, 56], material: 'concrete' },
    { id: 'd3-relay-wall-e-a', position: [72, 2.2, -118], size: [1.2, 4.4, 36], material: 'concrete' },
    { id: 'd3-relay-wall-e-b', position: [72, 2.2, -86], size: [1.2, 4.4, 12], material: 'concrete' },
    { id: 'd3-relay-breach-rubble', position: [72, 0.55, -96], size: [3, 1.1, 8], material: 'rock' },
    { id: 'd3-relay-helipad', position: [22, 0.05, -92], size: [18, 0.1, 18], material: 'concrete' },
    { id: 'd3-relay-yard', position: [44, 0.04, -110], size: [50, 0.08, 46], material: 'concrete' },
    { id: 'd3-extraction-pad', position: [-60, 0.05, -140], size: [24, 0.1, 24], material: 'concrete' },
  )
  .structure({
    id: 'd3-relay-tower',
    center: [30, -122],
    groundY: 0,
    width: 14,
    depth: 14,
    storyHeight: 4,
    stories: [
      {
        doors: [{ side: 'south', offset: 0, width: 1.8 }],
        windows: 'auto',
        stair: { footprint: { x: [-5, -1], z: [-4, 4] }, topAt: 'north' },
      },
      { windows: 'auto' },
    ],
    groundSlab: true,
    roof: 'walkable',
    wallMaterial: 'concrete',
    roofMaterial: 'metalRusted',
  })
  .house({
    id: 'd3-relay-shed',
    center: [58, -124],
    floorY: 0,
    width: 11,
    depth: 9,
    height: 3.4,
    door: { side: 'west', width: 1.6 },
    windows: 'auto',
    groundSlab: true,
    wallMaterial: 'metalRusted',
    roofMaterial: 'metalRusted',
  })
  .prop(
    sandbagLine({ id: 'd3-relay-bags-gate', from: [48, -90], to: [64, -90] }),
    sandbagLine({ id: 'd3-relay-bags-breach', from: [64, -100], to: [64, -88] }),
    coverWall({ id: 'd3-relay-cover-a', at: [40, -96], axis: 'x', length: 12, material: 'concrete' }),
    coverWall({ id: 'd3-relay-cover-b', at: [20, -108], axis: 'z', length: 10, material: 'concrete' }),
    crateStack({ id: 'd3-relay-crates', at: [46, -128], rows: 2, cols: 2, layers: 2, seed: 141 }),
    cargoContainer({ id: 'd3-relay-container', at: [58, -108], axis: 'z' }),
    pillar({ id: 'd3-relay-mast', at: [30, -104], height: 9, side: 1.2, material: 'metalRusted' }),
  )
  .explosiveBarrel({ id: 'd3-barrel-relay-a', position: [66, -0, -84] })
  .explosiveBarrel({ id: 'd3-barrel-relay-b', position: [70, 0, -98] })
  // Consola del relé: abrirla es encender el faro que rompe el bloqueo, y por
  // eso mismo es la que trae encima a media guarnición del paso.
  .door({
    id: 'd3-relay-console',
    position: [34, 1.15, -104],
    size: [1.8, 2.3, 0.5],
    openOffset: [0, 2.2, 0],
    speed: 1.1,
    material: 'signalBlue',
    button: {
      id: 'd3-relay-console-button',
      label: 'ARRANCAR EL RELÉ',
      position: [34, 1.2, -103.6],
      size: [0.5, 0.5, 0.18],
    },
    connections: [{ output: 'OnOpen', target: 'd3-relay-siege-start', input: 'Trigger', maxFires: 1 }],
  })
  .charger({ id: 'd3-charger-relay-health', kind: 'health', position: [26, 0, -96], rotationY: Math.PI })
  .charger({ id: 'd3-charger-relay-armor', kind: 'armor', position: [29, 0, -96], rotationY: Math.PI })
  .pickup({ id: 'd3-pickup-grenade', weaponId: 'grenade', position: [44, 0.45, -112] })
  .ammo({ id: 'd3-ammo-grenade-relay', ammoId: 'grenade', position: [45.4, 0.45, -112] })
  .ammo({ id: 'd3-ammo-ar3-relay', ammoId: 'ar3', position: [42.6, 0.45, -112] })
  .ammo({ id: 'd3-ammo-shotgun-relay', ammoId: 'shotgun', position: [41.2, 0.45, -112] })
  .ammo({ id: 'd3-ammo-rpg-relay', ammoId: 'rpg', position: [47, 0.45, -112] })
  .item({ id: 'd3-item-medkit-relay-a', itemId: 'medkit', position: [44, 0.45, -113.6] })
  .item({ id: 'd3-item-medkit-relay-b', itemId: 'medkit', position: [62, 0.45, -122] })
  .itemInRoom('d3-relay-tower', 1, [3, 2], { id: 'd3-item-battery-relay', itemId: 'hevBattery' })
  .ammoInRoom('d3-relay-tower', 1, [-3, 2], { id: 'd3-ammo-ar3-tower', ammoId: 'ar3' })

  .npc({ id: 'd3-rebel-a', name: 'd3-rebel-a', characterId: 'rebelM1', position: [38, 1.2, -100] })
  .npc({ id: 'd3-rebel-b', name: 'd3-rebel-b', characterId: 'rebelF2', position: [50, 1.2, -104] })
  .npc({ id: 'd3-rebel-medic', name: 'd3-rebel-medic', characterId: 'rebelMedic', position: [30, 1.2, -110] })

  // El helicóptero de extracción está desde el principio, trabado: se ve, se
  // entiende para qué es, y no se puede usar hasta terminar el trabajo.
  .vehicle({
    id: 'd3-extraction-helicopter',
    presetId: 'helicopterFree',
    position: [22, 1.4, -92],
    rotation: [0, 0, 0],
    faction: 'resistance',
    accessPolicy: 'player',
    weaponEnabled: true,
    engineOn: false,
    startLocked: true,
    allowPlayerExit: true,
    transitionKey: 'campaign-extraction-helicopter',
    portalTraversal: 'blocked',
    connections: [
      { output: 'OnPlayerEntered', target: 'd3-msg-lift', input: 'Show', maxFires: 1 },
      { output: 'OnPlayerEntered', target: 'd3-extraction-helicopter', input: 'Attach', param: 'd3-alyx', delay: 0.8, maxFires: 1 },
    ],
  })
  .vehicle({
    id: 'd3-cmb-glider',
    presetId: 'combineGlider',
    position: [92, 1.1, -74],
    rotation: [0, Math.PI, 0],
    faction: 'combine',
    accessPolicy: 'combine',
    crew: [{ actor: 'd3-drv-glider', role: 'driver', seatId: 'driver' }],
    weaponEnabled: true,
    engineOn: true,
    startDisabled: true,
    ai: { enabled: true, behavior: 'intercept', goal: 'd3-marker-relay-gate' },
    portalTraversal: 'blocked',
  })
  .npc({ id: 'd3-drv-glider', characterId: 'combine', position: [90, 1.2, -72] });

// ── Navegación vehicular ─────────────────────────────────────────────────────
map
  .vehicleNavArea({
    id: 'd3-nav-valley',
    polygon: [[-106, 0, -152], [106, 0, -152], [106, 0, 32], [-106, 0, 32]],
    surface: 'ground',
    speedLimit: 26,
  })
  .vehicleNavArea({
    id: 'd3-nav-depot-apron',
    polygon: [[-62, 0, 4], [-32, 0, 4], [-32, 0, 32], [-62, 0, 32]],
    surface: 'ground',
    speedLimit: 12,
    flags: ['parking'],
  })
  .vehicleNavLane({
    id: 'd3-lane-pass',
    points: ROAD_LANE,
    width: 9,
    direction: 'both',
    speedLimit: 24,
    priority: 4,
    tags: ['paso'],
  })
  .vehicleNavMarker({ id: 'd3-marker-depot', position: [-46, 0, 20], heading: Math.PI / 2, kind: 'parking' })
  // La emboscada converge sobre la calzada por delante del jugador, no sobre
  // el depósito: además de leerse mejor, un destino a 100 m se le va del
  // presupuesto de nodos al Hybrid-A* y los deja sin plan.
  .vehicleNavMarker({ id: 'd3-marker-ambush', position: [30, 0, 10], heading: Math.PI, kind: 'dropZone' })
  .vehicleNavMarker({ id: 'd3-marker-gate-bay', position: [78, 0, -4], heading: Math.PI, kind: 'passingBay' })
  .vehicleNavMarker({ id: 'd3-marker-relay-gate', position: [56, 0, -84], heading: Math.PI, kind: 'dropZone' })
  .vehicleNavMarker({ id: 'd3-marker-combine-pad', position: [64, 0, -40], heading: Math.PI, kind: 'landingZone', allowedPresets: ['helicopterFree'] })
  .vehicleNavMarker({ id: 'd3-marker-relay-pad', position: [22, 0, -92], heading: 0, kind: 'landingZone', allowedPresets: ['helicopterFree'] })
  .vehicleNavMarker({ id: 'd3-marker-extraction', position: [-60, 0, -140], heading: 0, kind: 'landingZone', allowedPresets: ['helicopterFree'] });

// ── Diálogo, objetivos y paisajes sonoros ────────────────────────────────────
map
  .logic({
    kind: 'auto',
    id: 'd3-auto',
    connections: [
      { output: 'OnMapSpawn', target: 'd3-msg-cold-open', input: 'Show', delay: 1.2 },
      { output: 'OnMapSpawn', target: 'd3-seq-alyx-open', input: 'Start', delay: 3.4 },
    ],
  })

  // Los objetivos SIEMPRE salen de triggers y contadores, nunca del `OnEnd` de
  // una secuencia: una coreografía que se demora termina aplicando su objetivo
  // encima de uno mucho más avanzado y el HUD retrocede solo.
  .logic({ kind: 'objective', id: 'd3-obj-depot', name: 'd3-obj-depot', text: 'Bajá al depósito por el hueco del oeste', marker: [-60, 1.6, 30] })
  .logic({ kind: 'objective', id: 'd3-obj-clear-depot', name: 'd3-obj-clear-depot', text: 'Despejá el depósito y encontrá el control del portón', marker: [-66, 1.6, 16] })
  .logic({ kind: 'objective', id: 'd3-obj-take-buggy', name: 'd3-obj-take-buggy', text: 'Tomá el buggy y salí a la ruta del paso', marker: [-70, 1.6, 12] })
  .logic({ kind: 'objective', id: 'd3-obj-reach-relay', name: 'd3-obj-reach-relay', text: 'Seguí la calzada hasta la estación de relé', marker: [56, 1.6, -84] })
  .logic({ kind: 'objective', id: 'd3-obj-gate', name: 'd3-obj-gate', text: 'Tomá el puesto y liberá la barrera del paso', marker: [70, 1.6, -6] })
  .logic({ kind: 'objective', id: 'd3-obj-air', name: 'd3-obj-air', text: 'Derribá el transporte Combine', marker: [64, 12, -40] })
  .logic({ kind: 'objective', id: 'd3-obj-relay', name: 'd3-obj-relay', text: 'Arrancá el relé de la estación', marker: [34, 1.6, -104] })
  .logic({ kind: 'objective', id: 'd3-obj-defend', name: 'd3-obj-defend', text: 'Aguantá la estación mientras el relé toma potencia', marker: [44, 1.6, -104] })
  .logic({ kind: 'objective', id: 'd3-obj-extract', name: 'd3-obj-extract', text: 'Llevá el helicóptero a la plataforma del norte', marker: [-60, 1.6, -140] })

  .logic({ kind: 'message', id: 'd3-msg-cold-open', name: 'd3-msg-cold-open', speaker: 'Radio de la Resistencia', text: 'Paso Norte, repetimos: el relé del valle nos tapa la banda. Sin relé no entra ninguna extracción.', duration: 5.5 })
  .logic({ kind: 'message', id: 'd3-msg-bowl', name: 'd3-msg-bowl', speaker: 'Alyx', text: 'Control en el cuenco. Tienen altura sobre la torre: no te quedes quieto detrás de los contenedores.', duration: 5 })
  .logic({ kind: 'message', id: 'd3-msg-bowl-reinforce', name: 'd3-msg-bowl-reinforce', speaker: 'Alyx', text: '¡Están llamando refuerzos desde el depósito!', duration: 3.5 })
  .logic({ kind: 'message', id: 'd3-msg-bowl-clear', name: 'd3-msg-bowl-clear', speaker: 'Alyx', text: 'Despejado. El hueco del oeste baja al depósito; ahí guardan los vehículos del paso.', duration: 5 })
  .logic({ kind: 'message', id: 'd3-msg-depot', name: 'd3-msg-depot', speaker: 'Vania', text: '¡Están arriba, en la pasarela! Yo no llego al pulsador del portón con ese fuego.', duration: 5 })
  .logic({ kind: 'message', id: 'd3-msg-depot-clear', name: 'd3-msg-depot-clear', speaker: 'Vania', text: 'Limpio. El pulsador del portón está contra la pared del fondo.', duration: 4.5 })
  .logic({ kind: 'message', id: 'd3-msg-gate-open', name: 'd3-msg-gate-open', speaker: 'Vania', text: 'Portón arriba. El buggy tiene tanque lleno y la calzada es la única forma de cruzar el paso.', duration: 5.5 })
  .logic({ kind: 'message', id: 'd3-msg-buggy', name: 'd3-msg-buggy', speaker: 'Vania', text: 'Andá con todo. La estación está al otro lado del estrechamiento, siguiendo los mojones.', duration: 5 })
  .logic({ kind: 'message', id: 'd3-msg-ambush', name: 'd3-msg-ambush', speaker: 'Alyx', text: '¡Dos buggies saliendo del recodo! No frenes, usá la torreta.', duration: 4 })
  .logic({ kind: 'message', id: 'd3-msg-gate', name: 'd3-msg-gate', speaker: 'Alyx', text: 'Barrera abajo y el estrechamiento no se rodea. Bajate: el control está en el puesto.', duration: 5.5 })
  .logic({ kind: 'message', id: 'd3-msg-gate-clear', name: 'd3-msg-gate-clear', speaker: 'Alyx', text: 'Barrera liberada. Volvé al buggy antes de que reorganicen el puesto.', duration: 4.5 })
  .logic({ kind: 'message', id: 'd3-msg-air-alarm', name: 'd3-msg-air-alarm', speaker: 'Alyx', text: '¡Aire! Están tripulando el transporte del pad. Bajalo antes de que tome altura.', duration: 5 })
  .logic({ kind: 'message', id: 'd3-msg-heli-down', name: 'd3-msg-heli-down', speaker: 'Alyx', text: 'Cayó. Con eso el paso queda sin ojos: metele hasta la estación.', duration: 4.5 })
  .logic({ kind: 'message', id: 'd3-msg-relay', name: 'd3-msg-relay', speaker: 'Marek', text: 'Llegaste. La consola está en el patio, pero apenas la abras van a venir del portón y de la brecha del este.', duration: 6 })
  .logic({ kind: 'message', id: 'd3-msg-siege', name: 'd3-msg-siege', speaker: 'Marek', text: '¡Relé encendido! Aguantá el patio, esto tarda en levantar potencia.', duration: 4.5 })
  .logic({ kind: 'message', id: 'd3-msg-siege-mid', name: 'd3-msg-siege-mid', speaker: 'Marek', text: 'Sesenta por ciento. Vienen por la brecha del este, ¡no dejes que lleguen al mástil!', duration: 4.5 })
  .logic({ kind: 'message', id: 'd3-msg-siege-last', name: 'd3-msg-siege-last', speaker: 'Marek', text: '¡Blindados! Ese deslizador entra por el portón, sacalo de encima.', duration: 4.5 })
  .logic({ kind: 'message', id: 'd3-msg-siege-clear', name: 'd3-msg-siege-clear', speaker: 'Radio de la Resistencia', text: 'Banda limpia. Los tenemos, Freeman. El helicóptero del patio está liberado: la plataforma del norte los espera.', duration: 6 })
  .logic({ kind: 'message', id: 'd3-msg-lift', name: 'd3-msg-lift', speaker: 'Alyx', text: 'Yo voy atrás. Colectivo con espacio, morro abajo para avanzar, y no te comas la ladera.', duration: 5.5 })

  .logic({ kind: 'soundscape', id: 'd3-ss-outdoor', name: 'd3-ss-outdoor', soundscape: 'wasteland' })
  .logic({ kind: 'soundscape', id: 'd3-ss-depot', name: 'd3-ss-depot', soundscape: 'warehouse' })
  .logic({ kind: 'soundscape', id: 'd3-ss-relay', name: 'd3-ss-relay', soundscape: 'factory' });

// ── Coreografías breves ──────────────────────────────────────────────────────
map
  .sequence({
    id: 'd3-seq-alyx-open',
    name: 'd3-seq-alyx-open',
    targetNpc: 'd3-alyx',
    position: [-44, 1.2, 137],
    moveMode: 'walk',
    overrideAi: true,
    steps: [
      { kind: 'face', target: '!player' },
      { kind: 'say', speaker: 'Alyx', text: 'El convoy no llegó ni a la boca del paso. Lo que sirva, tomalo ahora.', duration: 4.5 },
      { kind: 'gesture', gesture: 'point', duration: 1.1 },
      { kind: 'say', speaker: 'Alyx', text: 'El relé está del otro lado del valle. Primero hay que pasar el control.', duration: 4.5 },
    ],
  })
  .sequence({
    id: 'd3-seq-vania',
    name: 'd3-seq-vania',
    targetNpc: 'd3-vania',
    position: [-60, 1.2, 20],
    moveMode: 'run',
    overrideAi: true,
    steps: [
      { kind: 'face', target: '!player' },
      { kind: 'say', speaker: 'Vania', text: 'Pensé que el depósito era mi tumba. Gracias.', duration: 3.5 },
      { kind: 'gesture', gesture: 'point', duration: 1.1 },
      { kind: 'say', speaker: 'Vania', text: 'Adentro quedó un buggy con la torreta puesta. El pulsador del portón está en la pared del fondo.', duration: 6 },
    ],
  })
  .sequence({
    id: 'd3-seq-marek',
    name: 'd3-seq-marek',
    targetNpc: 'd3-rebel-a',
    position: [40, 1.2, -98],
    moveMode: 'run',
    overrideAi: true,
    steps: [
      { kind: 'face', target: '!player' },
      { kind: 'say', speaker: 'Marek', text: 'Somos tres y no alcanzamos a cubrir las dos bocas. Con vos, sí.', duration: 4.5 },
      { kind: 'gesture', gesture: 'point', duration: 1.1 },
    ],
  });

// ── Encuentros y progresión ──────────────────────────────────────────────────
map
  .logic({
    kind: 'counter',
    id: 'd3-count-bowl',
    name: 'd3-count-bowl',
    max: 9,
    connections: [
      { output: 'OnHitMax', target: 'd3-msg-bowl-clear', input: 'Show' },
      { output: 'OnHitMax', target: 'd3-obj-depot', input: 'Apply' },
    ],
  })
  .logic({
    kind: 'npcSpawner',
    id: 'd3-spawn-bowl',
    name: 'd3-spawn-bowl',
    npcs: [
      counted('d3-count-bowl', { id: 'd3-cmb-bowl-r1', characterId: 'combine', position: [-8, 1.2, 66] }),
      counted('d3-count-bowl', { id: 'd3-cmb-bowl-r2', characterId: 'combine', position: [8, 1.2, 66] }),
      counted('d3-count-bowl', { id: 'd3-cmb-bowl-r3', characterId: 'manhack', position: [-2, 2.4, 68] }),
      counted('d3-count-bowl', { id: 'd3-cmb-bowl-r4', characterId: 'manhack', position: [14, 2.4, 68] }),
    ],
    // Sin esta red, un spawn fallido deja el contador corto y el capítulo
    // clavado esperando muertos que nunca existieron.
    connections: [{ output: 'OnSpawnFailed', target: 'd3-count-bowl', input: 'Add', param: 4 }],
  })

  .logic({
    kind: 'counter',
    id: 'd3-count-depot',
    name: 'd3-count-depot',
    max: 5,
    connections: [
      { output: 'OnHitMax', target: 'd3-msg-depot-clear', input: 'Show' },
      { output: 'OnHitMax', target: 'd3-seq-vania', input: 'Start', delay: 1.2 },
    ],
  })

  .logic({
    kind: 'counter',
    id: 'd3-count-gate',
    name: 'd3-count-gate',
    max: 5,
    connections: [{ output: 'OnHitMax', target: 'd3-msg-gate', input: 'Show' }],
  })
  .logic({
    kind: 'relay',
    id: 'd3-relay-gate-open',
    name: 'd3-relay-gate-open',
    triggerOnce: true,
    connections: [
      { output: 'OnTrigger', target: 'd3-msg-gate-clear', input: 'Show' },
      { output: 'OnTrigger', target: 'd3-obj-reach-relay', input: 'Apply' },
      { output: 'OnTrigger', target: 'd3-trg-air-alarm', input: 'Enable' },
    ],
  })
  .logic({
    kind: 'relay',
    id: 'd3-relay-air-alarm',
    name: 'd3-relay-air-alarm',
    triggerOnce: true,
    connections: [
      { output: 'OnTrigger', target: 'd3-msg-air-alarm', input: 'Show' },
      { output: 'OnTrigger', target: 'd3-obj-air', input: 'Apply' },
      { output: 'OnTrigger', target: 'd3-cmb-helicopter', input: 'Enable' },
      // La oferta de puestos se enciende acá: recién ahora los guardias del pad
      // dejan su posición y corren a tripularlo.
      { output: 'OnTrigger', target: 'd3-cmb-helicopter', input: 'EnableCrewing', delay: 0.4 },
    ],
  })

  .logic({
    kind: 'relay',
    id: 'd3-relay-siege-start',
    name: 'd3-relay-siege-start',
    triggerOnce: true,
    connections: [
      { output: 'OnTrigger', target: 'd3-msg-siege', input: 'Show' },
      { output: 'OnTrigger', target: 'd3-obj-defend', input: 'Apply' },
      { output: 'OnTrigger', target: 'd3-ss-relay', input: 'Activate' },
      { output: 'OnTrigger', target: 'd3-spawn-relay-a', input: 'Spawn', delay: 2.5 },
      { output: 'OnTrigger', target: 'd3-msg-siege-mid', input: 'Show', delay: 26 },
      { output: 'OnTrigger', target: 'd3-spawn-relay-b', input: 'Spawn', delay: 28 },
      { output: 'OnTrigger', target: 'd3-msg-siege-last', input: 'Show', delay: 56 },
      { output: 'OnTrigger', target: 'd3-spawn-relay-c', input: 'Spawn', delay: 58 },
      { output: 'OnTrigger', target: 'd3-cmb-glider', input: 'Enable', delay: 58 },
    ],
  })
  .logic({
    kind: 'npcSpawner',
    id: 'd3-spawn-relay-a',
    name: 'd3-spawn-relay-a',
    npcs: [
      counted('d3-count-relay', { id: 'd3-cmb-relay-a1', characterId: 'combine', position: [52, 1.2, -68] }),
      counted('d3-count-relay', { id: 'd3-cmb-relay-a2', characterId: 'combine', position: [58, 1.2, -70] }),
      counted('d3-count-relay', { id: 'd3-cmb-relay-a3', characterId: 'combine', position: [64, 1.2, -66] }),
      counted('d3-count-relay', { id: 'd3-cmb-relay-a4', characterId: 'combineShotgunner', position: [46, 1.2, -70] }),
    ],
    connections: [{ output: 'OnSpawnFailed', target: 'd3-count-relay', input: 'Add', param: 4 }],
  })
  .logic({
    kind: 'npcSpawner',
    id: 'd3-spawn-relay-b',
    name: 'd3-spawn-relay-b',
    npcs: [
      counted('d3-count-relay', { id: 'd3-cmb-relay-b1', characterId: 'combine', position: [84, 1.2, -94] }),
      counted('d3-count-relay', { id: 'd3-cmb-relay-b2', characterId: 'combine', position: [88, 1.2, -100] }),
      counted('d3-count-relay', { id: 'd3-cmb-relay-b3', characterId: 'combineShotgunner', position: [86, 1.2, -88] }),
      counted('d3-count-relay', { id: 'd3-cmb-relay-b4', characterId: 'manhack', position: [82, 2.6, -96] }),
      counted('d3-count-relay', { id: 'd3-cmb-relay-b5', characterId: 'manhack', position: [90, 2.6, -92] }),
    ],
    connections: [{ output: 'OnSpawnFailed', target: 'd3-count-relay', input: 'Add', param: 5 }],
  })
  .logic({
    kind: 'npcSpawner',
    id: 'd3-spawn-relay-c',
    name: 'd3-spawn-relay-c',
    npcs: [
      counted('d3-count-relay', { id: 'd3-cmb-relay-c1', characterId: 'combineElite', position: [56, 1.2, -70] }),
      counted('d3-count-relay', { id: 'd3-cmb-relay-c2', characterId: 'combineShotgunner', position: [62, 1.2, -72] }),
      counted('d3-count-relay', { id: 'd3-cmb-relay-c3', characterId: 'combine', position: [84, 1.2, -98] }),
    ],
    connections: [{ output: 'OnSpawnFailed', target: 'd3-count-relay', input: 'Add', param: 3 }],
  })
  .logic({
    kind: 'counter',
    id: 'd3-count-relay',
    name: 'd3-count-relay',
    max: 12,
    connections: [{ output: 'OnHitMax', target: 'd3-relay-siege-clear', input: 'Trigger' }],
  })
  .logic({
    kind: 'relay',
    id: 'd3-relay-siege-clear',
    name: 'd3-relay-siege-clear',
    triggerOnce: true,
    connections: [
      { output: 'OnTrigger', target: 'd3-msg-siege-clear', input: 'Show' },
      { output: 'OnTrigger', target: 'd3-obj-extract', input: 'Apply' },
      { output: 'OnTrigger', target: 'd3-extraction-helicopter', input: 'Unlock' },
      { output: 'OnTrigger', target: 'd3-extraction-helicopter', input: 'TurnOn' },
      { output: 'OnTrigger', target: 'd3-trg-extraction', input: 'Enable' },
      { output: 'OnTrigger', target: 'd3-ss-outdoor', input: 'Activate' },
    ],
  })
  .logic({
    kind: 'changelevel',
    id: 'd3-changelevel-north',
    name: 'd3-changelevel-north',
    landmark: { position: [-60, 1.2, -140], yaw: 0 },
  });

// ── Triggers ─────────────────────────────────────────────────────────────────
map
  .trigger({
    id: 'd3-trg-bowl',
    position: [-45, 3, 117],
    size: [32, 8, 8],
    once: true,
    connections: [{ output: 'OnStartTouch', target: 'd3-msg-bowl', input: 'Show' }],
  })
  .trigger({
    id: 'd3-trg-bowl-push',
    position: [0, 3, 88],
    size: [130, 8, 8],
    once: true,
    connections: [
      { output: 'OnStartTouch', target: 'd3-msg-bowl-reinforce', input: 'Show' },
      { output: 'OnStartTouch', target: 'd3-spawn-bowl', input: 'Spawn', delay: 1.5 },
    ],
  })
  .trigger({
    id: 'd3-trg-depot-yard',
    position: [-48, 3, 31],
    size: [30, 8, 10],
    once: true,
    connections: [
      { output: 'OnStartTouch', target: 'd3-msg-depot', input: 'Show' },
      { output: 'OnStartTouch', target: 'd3-obj-clear-depot', input: 'Apply' },
    ],
  })
  .trigger({
    id: 'd3-trg-depot-inside',
    position: [-78, 3, 12],
    size: [26, 8, 18],
    once: false,
    wait: 4,
    connections: [
      { output: 'OnStartTouch', target: 'd3-ss-depot', input: 'Activate' },
      { output: 'OnEndTouch', target: 'd3-ss-outdoor', input: 'Activate' },
    ],
  })
  .trigger({
    id: 'd3-trg-road-ambush',
    position: [10, 3, 18],
    size: [28, 8, 14],
    once: true,
    connections: [
      { output: 'OnStartTouch', target: 'd3-msg-ambush', input: 'Show' },
      { output: 'OnStartTouch', target: 'd3-cmb-buggy-a', input: 'Enable' },
      { output: 'OnStartTouch', target: 'd3-cmb-buggy-b', input: 'Enable', delay: 1.5 },
    ],
  })
  .trigger({
    id: 'd3-trg-gate-approach',
    position: [72, 4, 2],
    size: [52, 10, 18],
    once: true,
    connections: [{ output: 'OnStartTouch', target: 'd3-obj-gate', input: 'Apply' }],
  })
  .trigger({
    id: 'd3-trg-air-alarm',
    position: [90, 5, -34],
    size: [26, 12, 12],
    once: true,
    startDisabled: true,
    connections: [{ output: 'OnStartTouch', target: 'd3-relay-air-alarm', input: 'Trigger' }],
  })
  .trigger({
    id: 'd3-trg-relay-arrive',
    position: [56, 5, -78],
    size: [18, 12, 10],
    once: true,
    connections: [
      { output: 'OnStartTouch', target: 'd3-msg-relay', input: 'Show' },
      { output: 'OnStartTouch', target: 'd3-obj-relay', input: 'Apply' },
      { output: 'OnStartTouch', target: 'd3-seq-marek', input: 'Start', delay: 4 },
    ],
  })
  .trigger({
    id: 'd3-trg-extraction',
    position: [-60, 7, -140],
    size: [28, 14, 28],
    once: true,
    startDisabled: true,
    connections: [{ output: 'OnStartTouch', target: 'd3-changelevel-north', input: 'Trigger' }],
  })

  .checkpoint({ id: 'd3-cp-start', position: [-46, 3, 138], size: [26, 8, 18], respawn: [-46, 1.2, 138] })
  .checkpoint({ id: 'd3-cp-bowl', position: [0, 3, 72], size: [100, 8, 14], respawn: [-6, 1.2, 72] })
  .checkpoint({ id: 'd3-cp-depot', position: [-46, 3, 20], size: [26, 8, 24], respawn: [-46, 1.2, 24] })
  .checkpoint({ id: 'd3-cp-gate', position: [90, 4, -30], size: [16, 10, 10], respawn: [90, 1.2, -30] })
  .checkpoint({ id: 'd3-cp-relay', position: [56, 4, -86], size: [16, 10, 10], respawn: [56, 1.2, -88] });

export const Demo3WhiteoutFlight = map.build();
