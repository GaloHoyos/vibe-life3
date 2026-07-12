import { createMap } from '@game/levels/builders/MapCreator';
import {
  crateStack,
  coverWall,
  sandbagLine,
  watchtower,
  cargoContainer,
  pillar,
} from '@game/levels/builders/PropBuilder';

/**
 * Nivel demo (1/2) — «Punto de Inserción».
 *
 * Recorrido urbano largo estilo Half-Life 2 (Ciudad 17), ~230 m de punta a
 * punta, encadenando 7 zonas: andén de llegada → plaza con apartamentos
 * explorables → puesto de control Combine → calle con patrullas → canal tóxico
 * cruzado por un puente → patio de emboscada → extracción norte. No es campaña
 * real: existe para ejercitar el entity I/O (Tier 4.1) a gran escala. Cadena de
 * setpieces:
 *
 *  1. `auto` (OnMapSpawn) → bienvenida + objetivo inicial.
 *  2. Trigger del andén → scripted_sequence: Alyx saluda y guía.
 *  3. Trigger de plaza → `npcSpawner`: primera patrulla Combine.
 *  4. Trigger del puesto → scripted_sequence: un rebelde abre la esclusa (puerta
 *     por I/O).
 *  5. Trigger de calle → `npcSpawner`: manhacks + Combine.
 *  6. Trigger del canal → scripted_sequence: Alyx avisa del agua tóxica.
 *  7. Trigger del patio → 3 oleadas escalonadas (delay); cada muerte suma a un
 *     `counter`. `OnHitMax` → abre el portón + scripted_sequence de escape que
 *     habilita el trigger final.
 *  8. Trigger de fin → `changelevel` al Nivel demo 2.
 *
 * Verificación runtime: `window.__aiTrace`; toggle USE (E) sobre Alyx alterna
 * follow/wait.
 */
export const Demo1Plaza = createMap({
  id: 'demo-01-plaza',
  title: 'Demo 1 — Punto de Inserción',
  description: 'Demo de triggers a gran escala: distrito urbano con puesto de control, canal, emboscada y secuencias guionadas.',
  nextLevel: 'demo-02-ravenholm',
  objective: { text: 'Seguí a Alyx hasta el puesto de control', marker: [0, 1.6, 68] },
  background: 0x1a2430,
  sun: { direction: [0.5, 1.0, 0.2], color: 0xdfe6ee, intensity: 1.5 },
  playerStart: [0, 1.2, 114],
  audio: {
    ambiences: ['background.wind', 'background.hl2.wind.wasteland'],
    footstepSounds: ['footsteps.snow1', 'footsteps.snow2', 'footsteps.snow3', 'footsteps.snow4'],
    soundscape: 'wasteland',
  },
})
  .ground({ size: [96, 240], material: 'concrete', boundary: { height: 8, material: 'wall' } })
  // ── Muros divisorios de zona (con hueco para las esclusas) ──────────────────
  .boxes(
    // Puesto de control (z=68).
    { id: 'div-cp-left', position: [-25, 1.8, 68], size: [46, 3.6, 0.6], material: 'wall' },
    { id: 'div-cp-right', position: [25, 1.8, 68], size: [46, 3.6, 0.6], material: 'wall' },
    // Portón de salida del patio (z=-26).
    { id: 'div-ex-left', position: [-25, 1.8, -26], size: [46, 3.6, 0.6], material: 'wall' },
    { id: 'div-ex-right', position: [25, 1.8, -26], size: [46, 3.6, 0.6], material: 'wall' },
    // Banco del canal (paredes bajas que enmarcan el agua tóxica).
    { id: 'canal-bank-s-l', position: [-27, 0.6, 33.6], size: [42, 1.2, 0.5], material: 'concrete' },
    { id: 'canal-bank-s-r', position: [27, 0.6, 33.6], size: [42, 1.2, 0.5], material: 'concrete' },
    { id: 'canal-bank-n-l', position: [-27, 0.6, 24.4], size: [42, 1.2, 0.5], material: 'concrete' },
    { id: 'canal-bank-n-r', position: [27, 0.6, 24.4], size: [42, 1.2, 0.5], material: 'concrete' },
  )
  // ── Zona A: andén de llegada ────────────────────────────────────────────────
  .house({ id: 'kiosk', center: [-34, 104], floorY: 0, width: 7, depth: 6, height: 3, door: { side: 'east', width: 1.4 }, groundSlab: true, wallMaterial: 'plaster' })
  .prop(
    pillar({ id: 'anden-pillar-a', at: [-9, 100], height: 3.6 }),
    pillar({ id: 'anden-pillar-b', at: [9, 100], height: 3.6 }),
    crateStack({ id: 'anden-crates', at: [-6, 96], layers: 1, seed: 11 }),
  )
  // ── Zona B: plaza sur con apartamentos explorables ──────────────────────────
  .structure({
    id: 'apt-w', center: [-36, 84], groundY: 0, width: 12, depth: 12, storyHeight: 3.2, roof: 'flat',
    palette: { base: 'brick', upper: 'plaster', trim: 'concrete', roof: 'roof', floor: 'floor' },
    stories: [
      { doors: [{ side: 'east', width: 2 }], windows: 'auto', stair: { footprint: { x: [-4, -1], z: [-4, 2] }, topAt: 'north' } },
      { windows: 'auto' },
    ],
  })
  .structure({
    id: 'apt-e', center: [36, 84], groundY: 0, width: 12, depth: 12, storyHeight: 3.2, roof: 'flat',
    palette: { base: 'brick', upper: 'plaster', trim: 'concrete', roof: 'roof', floor: 'floor' },
    stories: [
      { doors: [{ side: 'west', width: 2 }], windows: 'auto', stair: { footprint: { x: [1, 4], z: [-4, 2] }, topAt: 'north' } },
      { windows: 'auto' },
    ],
  })
  .prop(
    pillar({ id: 'plaza-monument', at: [-11, 82], height: 4.2, side: 1.1 }),
    crateStack({ id: 'plaza-crates-a', at: [-10, 90], layers: 1, seed: 5 }),
    crateStack({ id: 'plaza-crates-b', at: [11, 88], layers: 2, seed: 7 }),
    coverWall({ id: 'plaza-cover-a', at: [-9, 76], axis: 'x', length: 6 }),
    coverWall({ id: 'plaza-cover-b', at: [8, 72], axis: 'z', length: 5 }),
  )
  // ── Zona C: puesto de control Combine ───────────────────────────────────────
  .prop(
    watchtower({ id: 'cp-tower', at: [-32, 74], rampSide: 'east' }),
    sandbagLine({ id: 'cp-sandbags', from: [-14, 62], to: [14, 62] }),
  )
  // ── Zona D: calle / callejón ────────────────────────────────────────────────
  .house({ id: 'shop', center: [36, 50], floorY: 0, width: 9, depth: 8, height: 3.4, door: { side: 'west', width: 1.6 }, groundSlab: true, wallMaterial: 'concrete' })
  .prop(
    cargoContainer({ id: 'street-cont-a', at: [-9, 58], axis: 'x' }),
    cargoContainer({ id: 'street-cont-b', at: [11, 48], axis: 'x' }),
    coverWall({ id: 'street-cover-a', at: [-14, 50], axis: 'z', length: 6 }),
    crateStack({ id: 'street-crates', at: [4, 44], layers: 1, seed: 3 }),
    pillar({ id: 'street-pillar', at: [-6, 42] }),
  )
  // ── Zona E: canal tóxico + puente ───────────────────────────────────────────
  .ramp({ id: 'bridge-ramp-s', start: [0, 39], end: [0, 34], startY: 0, endY: 2.6, width: 4, steps: 9 })
  .boxes({ id: 'bridge-deck', position: [0, 2.4, 29], size: [10, 0.4, 10], material: 'trim' })
  .ramp({ id: 'bridge-ramp-n', start: [0, 24], end: [0, 19], startY: 2.6, endY: 0, width: 4, steps: 9 })
  .boxes(
    { id: 'bridge-rail-w', position: [-5.2, 3.0, 29], size: [0.2, 1.2, 10], material: 'trim' },
    { id: 'bridge-rail-e', position: [5.2, 3.0, 29], size: [0.2, 1.2, 10], material: 'trim' },
  )
  // ── Zona F: patio de emboscada ──────────────────────────────────────────────
  .prop(
    watchtower({ id: 'arena-tower', at: [34, -6], rampSide: 'west' }),
    sandbagLine({ id: 'arena-sb-1', from: [-16, 10], to: [8, 10] }),
    coverWall({ id: 'arena-cover-a', at: [-10, 0], axis: 'x', length: 6 }),
    crateStack({ id: 'arena-crates-a', at: [12, -2], layers: 2, seed: 3 }),
    crateStack({ id: 'arena-crates-b', at: [-14, -10], layers: 1, seed: 9 }),
    cargoContainer({ id: 'arena-cont-1', at: [16, 6], axis: 'z' }),
    pillar({ id: 'arena-pillar-a', at: [6, -14] }),
    pillar({ id: 'arena-pillar-b', at: [-4, -18] }),
  )
  // ── Zona G: extracción norte ────────────────────────────────────────────────
  .house({ id: 'guardpost', center: [34, -66], floorY: 0, width: 9, depth: 8, height: 3.4, door: { side: 'west', width: 1.6 }, groundSlab: true, wallMaterial: 'brick' })
  .prop(
    cargoContainer({ id: 'exit-cont', at: [-12, -44], axis: 'z' }),
    coverWall({ id: 'exit-cover-a', at: [6, -50], axis: 'x', length: 6 }),
    coverWall({ id: 'exit-cover-b', at: [-8, -72], axis: 'z', length: 6 }),
    crateStack({ id: 'exit-crates', at: [10, -80], layers: 1, seed: 5 }),
  )
  // ── Puertas ─────────────────────────────────────────────────────────────────
  .door({
    id: 'gate1', position: [0, 1.5, 68], size: [4, 3, 0.6], openOffset: [0, 3.2, 0], speed: 3, material: 'door',
    button: { id: 'gate1-btn', label: 'Esclusa del puesto', position: [2.4, 1.2, 68.8], size: [0.32, 0.32, 0.12] },
  })
  .door({
    id: 'gate2', position: [0, 1.5, -26], size: [4, 3, 0.6], openOffset: [0, 3.2, 0], speed: 3, material: 'door',
    // Botón del lado NORTE (lejano): no se alcanza desde el patio hasta que abre por I/O.
    button: { id: 'gate2-btn', label: 'Portón de salida', position: [2.4, 1.2, -26.8], size: [0.32, 0.32, 0.12] },
  })
  // ── Personajes presentes al cargar ──────────────────────────────────────────
  .npc({ id: 'alyx', characterId: 'alyx', position: [4, 1, 108] })
  .npc({ id: 'rebel-gate', characterId: 'rebelM2', position: [5, 1, 72] })
  // ── Armas / munición / vitals ───────────────────────────────────────────────
  .pickup({ id: 'wp-crowbar', weaponId: 'crowbar', position: [-3, 0.4, 110] })
  .pickup({ id: 'wp-pistol', weaponId: 'pistol', position: [-1, 0.4, 110] })
  .pickup({ id: 'wp-smg', weaponId: 'smg', position: [1, 0.4, 110] })
  .ammo({ id: 'am-pistol', ammoId: 'pistol', position: [-1, 0.4, 108.5] })
  .ammo({ id: 'am-smg', ammoId: 'smg', position: [1, 0.4, 108.5] })
  .item({ id: 'it-medkit', itemId: 'medkit', position: [3, 0.4, 110] })
  .ammoInRoom('kiosk', 0, [0, 0], { id: 'am-pistol-2', ammoId: 'pistol' })
  // Loot en los apartamentos de la plaza.
  .pickupInRoom('apt-w', 1, [0, 0], { id: 'wp-ar3', weaponId: 'ar3' })
  .itemInRoom('apt-w', 1, [1.5, 1], { id: 'it-battery', itemId: 'hevBattery' })
  .ammoInRoom('apt-e', 1, [0, 0], { id: 'am-ar3', ammoId: 'ar3' })
  // Kit de la calle (tienda) y del patio.
  .item({ id: 'it-medkit-2', itemId: 'medkit', position: [36, 0.4, 50] })
  .ammo({ id: 'am-smg-2', ammoId: 'smg', position: [34, 0.4, 51] })
  .pickup({ id: 'wp-shotgun', weaponId: 'shotgun', position: [16, 0.4, -2] })
  .pickup({ id: 'wp-grenade', weaponId: 'grenade', position: [12, 0.4, -3] })
  .ammo({ id: 'am-shotgun', ammoId: 'shotgun', position: [14, 0.4, -3] })
  .charger({ id: 'ch-health-cp', kind: 'health', position: [-2.6, 0, 66], rotationY: 0 })
  .charger({ id: 'ch-health-ex', kind: 'health', position: [29.4, 0, -66], rotationY: Math.PI / 2 })
  // ── Barriles explosivos (trampas tácticas) ──────────────────────────────────
  .explosiveBarrel({ id: 'barrel-street-1', position: [10, 0, 46] })
  .explosiveBarrel({ id: 'barrel-street-2', position: [11, 0, 47] })
  .explosiveBarrel({ id: 'barrel-arena-1', position: [10, 0, -6] })
  .explosiveBarrel({ id: 'barrel-arena-2', position: [11, 0, -7] })
  .explosiveBarrel({ id: 'barrel-arena-3', position: [9, 0, -7] })
  // ── Peligro ambiental: canal tóxico ─────────────────────────────────────────
  .hazardVolume({ id: 'canal-toxic', position: [0, 0.6, 29], size: [96, 2, 8], kind: 'toxic', damagePerSecond: 18 })
  // ── Entity I/O ──────────────────────────────────────────────────────────────
  .logic({
    kind: 'auto', id: 'boot', name: 'boot',
    connections: [
      { output: 'OnMapSpawn', target: 'msg-welcome', input: 'Show' },
      { output: 'OnMapSpawn', target: 'obj-follow', input: 'Apply' },
    ],
  })
  .logic({ kind: 'message', id: 'msg-welcome', name: 'msg-welcome', speaker: 'Alyx', text: 'Llegaste. Bienvenido a la Ciudad 17, Gordon. Seguime.', duration: 4 })
  .logic({ kind: 'objective', id: 'obj-follow', name: 'obj-follow', text: 'Seguí a Alyx hasta el puesto de control', marker: [0, 1.6, 68] })
  .logic({ kind: 'objective', id: 'obj-checkpoint', name: 'obj-checkpoint', text: 'Llegá al puesto de control Combine', marker: [0, 1.6, 68] })
  .logic({ kind: 'objective', id: 'obj-arena', name: 'obj-arena', text: 'Cruzá la calle y el canal, y despejá el patio', marker: [0, 1.6, -4] })
  .logic({ kind: 'objective', id: 'obj-exit', name: 'obj-exit', text: 'Escapá a la zona de extracción norte', marker: [0, 1.6, -100] })
  .logic({ kind: 'message', id: 'msg-patrol', name: 'msg-patrol', speaker: 'Alyx', text: '¡Patrulla Combine en la plaza! Cubrite.', duration: 3 })
  .logic({ kind: 'message', id: 'msg-gate', name: 'msg-gate', speaker: 'Rebelde', text: 'Esclusa abierta. Cuidado, hay patrullas del otro lado.', duration: 3.5 })
  .logic({ kind: 'message', id: 'msg-street', name: 'msg-street', speaker: 'Alyx', text: '¡Manhacks! Vienen por la calle.', duration: 3 })
  .logic({ kind: 'message', id: 'msg-ambush', name: 'msg-ambush', speaker: 'Alyx', text: '¡Emboscada! Combine entrando al patio.', duration: 3 })
  .logic({ kind: 'message', id: 'msg-clear', name: 'msg-clear', speaker: 'Alyx', text: 'Despejado. Buen trabajo. Seguime a la salida.', duration: 3 })
  .logic({ kind: 'message', id: 'msg-exit', name: 'msg-exit', speaker: 'Alyx', text: 'La extracción está adelante. Cruzá cuando quieras.', duration: 3 })
  // Secuencia de intro (Alyx guía).
  .logic({ kind: 'relay', id: 'intro-relay', name: 'intro-relay', connections: [{ output: 'OnTrigger', target: 'intro-seq', input: 'Start' }] })
  .sequence({
    id: 'intro-seq', name: 'intro-seq', targetNpc: 'alyx', position: [2, 1, 98], moveMode: 'walk', overrideAi: true,
    steps: [
      { kind: 'face', target: '!player' },
      { kind: 'gesture', gesture: 'wave', duration: 1.5 },
      { kind: 'say', speaker: 'Alyx', text: '¿Estás entero? El puesto de control está al final de la plaza. Vamos.', duration: 3.5 },
    ],
    connections: [{ output: 'OnEnd', target: 'obj-checkpoint', input: 'Apply' }],
  })
  // Patrulla de plaza.
  .logic({ kind: 'npcSpawner', id: 'spawn-patrol', name: 'spawn-patrol', npcs: [
    { id: 'pat1', characterId: 'combine', position: [-10, 1, 78] },
    { id: 'pat2', characterId: 'combine', position: [10, 1, 80] },
  ] })
  // Secuencia del rebelde: abre la esclusa.
  .sequence({
    id: 'rebel-seq', name: 'rebel-seq', targetNpc: 'rebel-gate', position: [3, 1, 71], moveMode: 'walk', overrideAi: true,
    steps: [
      { kind: 'face', target: '!player' },
      { kind: 'say', speaker: 'Rebelde', text: 'Freeman... te estábamos esperando. Aguantá, te abro la esclusa.', duration: 3 },
      { kind: 'gesture', gesture: 'point', duration: 1.2 },
    ],
    connections: [
      { output: 'OnEnd', target: 'gate1', input: 'Open' },
      { output: 'OnEnd', target: 'msg-gate', input: 'Show' },
      { output: 'OnEnd', target: 'obj-arena', input: 'Apply' },
    ],
  })
  // Patrulla de la calle.
  .logic({ kind: 'npcSpawner', id: 'spawn-street', name: 'spawn-street', npcs: [
    { id: 'str1', characterId: 'manhack', position: [-6, 2.6, 52] },
    { id: 'str2', characterId: 'manhack', position: [6, 2.6, 50] },
    { id: 'str3', characterId: 'combine', position: [0, 1, 46] },
  ] })
  // Aviso del canal.
  .sequence({
    id: 'canal-seq', name: 'canal-seq', targetNpc: 'alyx', position: [0, 1, 40], moveMode: 'none', overrideAi: true,
    steps: [
      { kind: 'face', target: '!player' },
      { kind: 'say', speaker: 'Alyx', text: 'El canal está contaminado. Cruzá por el puente, no toques el agua.', duration: 3.5 },
    ],
  })
  // Oleadas del patio.
  .logic({ kind: 'npcSpawner', id: 'spawn-wave1', name: 'spawn-wave1', npcs: [
    { id: 'w1a', name: 'wave', characterId: 'combine', position: [-10, 1, -6], connections: [{ output: 'OnDeath', target: 'kills', input: 'Add' }] },
    { id: 'w1b', name: 'wave', characterId: 'combine', position: [10, 1, -8], connections: [{ output: 'OnDeath', target: 'kills', input: 'Add' }] },
  ] })
  .logic({ kind: 'npcSpawner', id: 'spawn-wave2', name: 'spawn-wave2', npcs: [
    { id: 'w2a', name: 'wave', characterId: 'combine', position: [0, 1, -12], connections: [{ output: 'OnDeath', target: 'kills', input: 'Add' }] },
    { id: 'w2b', name: 'wave', characterId: 'manhack', position: [-6, 2.6, -10], connections: [{ output: 'OnDeath', target: 'kills', input: 'Add' }] },
  ] })
  .logic({ kind: 'npcSpawner', id: 'spawn-wave3', name: 'spawn-wave3', npcs: [
    { id: 'w3a', name: 'wave', characterId: 'combineShotgunner', position: [-12, 1, -16], connections: [{ output: 'OnDeath', target: 'kills', input: 'Add' }] },
    { id: 'w3b', name: 'wave', characterId: 'combineElite', position: [12, 1, -16], connections: [{ output: 'OnDeath', target: 'kills', input: 'Add' }] },
    { id: 'w3c', name: 'wave', characterId: 'combine', position: [0, 1, -18], connections: [{ output: 'OnDeath', target: 'kills', input: 'Add' }] },
  ] })
  .logic({ kind: 'counter', id: 'kills', name: 'kills', max: 7, connections: [
    { output: 'OnHitMax', target: 'gate2', input: 'Open' },
    { output: 'OnHitMax', target: 'msg-clear', input: 'Show' },
    { output: 'OnHitMax', target: 'exit-seq', input: 'Start', delay: 1 },
    // La salida se habilita desde el counter (no desde Alyx): sin softlock si cae.
    { output: 'OnHitMax', target: 'obj-exit', input: 'Apply', delay: 2 },
    { output: 'OnHitMax', target: 'exit-trigger', input: 'Enable', delay: 2 },
  ] })
  .logic({ kind: 'marker', id: 'exit-point', name: 'exit-point', position: [0, 1, -40] })
  .sequence({
    id: 'exit-seq', name: 'exit-seq', targetNpc: 'alyx', position: [0, 1, -40], moveMode: 'run', overrideAi: true,
    steps: [
      { kind: 'face', target: '!player' },
      { kind: 'gesture', gesture: 'wave', duration: 1.2 },
      { kind: 'say', speaker: 'Alyx', text: '¡La salida está al norte, vamos!', duration: 3 },
    ],
    connections: [{ output: 'OnEnd', target: 'msg-exit', input: 'Show' }],
  })
  .logic({ kind: 'changelevel', id: 'exit-level', name: 'exit-level', landmark: [0, 1, -100] })
  // ── Triggers ────────────────────────────────────────────────────────────────
  .trigger({ id: 'intro-trigger', position: [0, 1.2, 106], size: [88, 3, 3], once: true,
    connections: [{ output: 'OnStartTouch', target: 'intro-relay', input: 'Trigger' }] })
  .trigger({ id: 'patrol-trigger', position: [0, 1.2, 92], size: [88, 3, 3], once: true,
    connections: [
      { output: 'OnStartTouch', target: 'spawn-patrol', input: 'Spawn' },
      { output: 'OnStartTouch', target: 'msg-patrol', input: 'Show' },
    ] })
  .trigger({ id: 'checkpoint-trigger', position: [0, 1.2, 76], size: [88, 3, 3], once: true,
    connections: [{ output: 'OnStartTouch', target: 'rebel-seq', input: 'Start' }] })
  .trigger({ id: 'street-trigger', position: [0, 1.2, 62], size: [46, 3, 3], once: true,
    connections: [
      { output: 'OnStartTouch', target: 'spawn-street', input: 'Spawn' },
      { output: 'OnStartTouch', target: 'msg-street', input: 'Show' },
    ] })
  .trigger({ id: 'canal-trigger', position: [0, 1.2, 42], size: [46, 3, 3], once: true,
    connections: [{ output: 'OnStartTouch', target: 'canal-seq', input: 'Start' }] })
  .trigger({ id: 'ambush-trigger', position: [0, 1.2, 14], size: [46, 3, 3], once: true,
    connections: [
      { output: 'OnStartTouch', target: 'msg-ambush', input: 'Show' },
      { output: 'OnStartTouch', target: 'spawn-wave1', input: 'Spawn' },
      { output: 'OnStartTouch', target: 'spawn-wave2', input: 'Spawn', delay: 4 },
      { output: 'OnStartTouch', target: 'spawn-wave3', input: 'Spawn', delay: 8 },
    ] })
  .trigger({ id: 'exit-trigger', position: [0, 1.2, -100], size: [88, 3, 3], once: true, startDisabled: true,
    connections: [{ output: 'OnStartTouch', target: 'exit-level', input: 'Trigger', delay: 1 }] })
  // ── Checkpoints ─────────────────────────────────────────────────────────────
  .checkpoint({ id: 'cp-start', position: [0, 1.2, 100], size: [16, 3, 4], respawn: [0, 1.2, 104] })
  .checkpoint({ id: 'cp-plaza', position: [0, 1.2, 86], size: [16, 3, 3], respawn: [0, 1.2, 86] })
  .checkpoint({ id: 'cp-street', position: [0, 1.2, 46], size: [16, 3, 3], respawn: [0, 1.2, 46] })
  .checkpoint({ id: 'cp-arena', position: [0, 1.2, -22], size: [10, 3, 3], respawn: [0, 1.2, -20] })
  .build();
