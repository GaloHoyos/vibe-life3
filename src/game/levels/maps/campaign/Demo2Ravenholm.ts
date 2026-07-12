import { createMap } from '@game/levels/builders/MapCreator';
import {
  crateStack,
  coverWall,
  sandbagLine,
  pillar,
  watchtower,
} from '@game/levels/builders/PropBuilder';

/**
 * Nivel demo (2/2) — «No Vamos a Ravenholm».
 *
 * Recorrido de horror largo estilo Half-Life 2 (capítulo Ravenholm), ~230 m,
 * encadenando 7 zonas: entrada del pueblo → plaza con hordas → iglesia-refugio
 * de paso (interior) → callejones → pasarela elevada sobre un patio de zombies →
 * callejón en llamas con gauntlet cronometrado → mina de escape. Cierra la
 * campaña demo (`changelevel` sin `nextLevel` → menú). Cadena de setpieces:
 *
 *  1. `auto` → bienvenida + objetivo.
 *  2. Trigger de entrada → scripted_sequence: Grigori despierta la primera horda
 *     (`npcSpawner`); cada muerte suma a un `counter`.
 *  3. `OnHitMax` de la horda → objetivo de la iglesia.
 *  4. Trigger de la iglesia → scripted_sequence: un rebelde herido advierte +
 *     spawn de headcrabs.
 *  5. Trigger del callejón → `timer` que suelta oleadas contadas por un segundo
 *     `counter`; al máximo apaga el timer, abre el portón de la mina y arranca
 *     la scripted_sequence de escape.
 *  6. Trigger dentro de la mina → `changelevel` (fin de la campaña demo).
 *
 * Robustez: la salida se habilita desde los counters, no desde la supervivencia
 * de los NPCs guionados. Peligros: `hazardVolume` de fuego que esquivar.
 */
export const Demo2Ravenholm = createMap({
  id: 'demo-02-ravenholm',
  title: 'Demo 2 — No Vamos a Ravenholm',
  description: 'Demo de triggers a gran escala: pueblo de horror con hordas, iglesia, pasarela, gauntlet cronometrado y escape.',
  entryLandmark: [0, 1, 110],
  objective: { text: 'Encontrá la salida del pueblo', marker: [0, 1.6, -72] },
  background: 0x07090c,
  sun: { direction: [0.2, 0.7, -0.35], color: 0x445264, intensity: 0.55 },
  playerStart: [0, 1.2, 110],
  audio: {
    ambiences: ['background.wind', 'background.hl2.wind.wasteland'],
    footstepSounds: ['footsteps.snow1', 'footsteps.snow2', 'footsteps.snow3', 'footsteps.snow4'],
    soundscape: 'warehouse',
  },
})
  .ground({ size: [92, 240], material: 'concrete', boundary: { height: 8, material: 'wall' } })
  // ── Muros de zona ───────────────────────────────────────────────────────────
  .boxes(
    // Flancos de la iglesia (z=48): fuerzan el paso por adentro.
    { id: 'church-flank-w', position: [-27.5, 1.8, 48], size: [37, 3.6, 1.0], material: 'wall' },
    { id: 'church-flank-e', position: [27.5, 1.8, 48], size: [37, 3.6, 1.0], material: 'wall' },
    // Portón de la mina (z=-42).
    { id: 'div-mine-left', position: [-24, 1.8, -42], size: [44, 3.6, 0.6], material: 'wall' },
    { id: 'div-mine-right', position: [24, 1.8, -42], size: [44, 3.6, 0.6], material: 'wall' },
  )
  // ── Zona A: entrada del pueblo ──────────────────────────────────────────────
  .prop(
    sandbagLine({ id: 'grigori-barricade', from: [-18, 102], to: [-4, 102] }),
    watchtower({ id: 'town-tower', at: [16, 98], rampSide: 'south' }),
    pillar({ id: 'entry-pillar-a', at: [-8, 94] }),
    pillar({ id: 'entry-pillar-b', at: [8, 94] }),
  )
  // ── Zona B: plaza del pueblo ────────────────────────────────────────────────
  .house({ id: 'house-a', center: [-18, 80], floorY: 0, width: 7, depth: 6, height: 3.2, door: { side: 'east', width: 1.4 }, groundSlab: true, wallMaterial: 'woodDark' })
  .house({ id: 'house-b', center: [17, 74], floorY: 0, width: 6, depth: 6, height: 3, door: { side: 'west', width: 1.4 }, groundSlab: true, wallMaterial: 'brick' })
  .house({ id: 'house-c', center: [-16, 60], floorY: 0, width: 6, depth: 5, height: 3, door: { side: 'east', width: 1.4 }, groundSlab: true, wallMaterial: 'plaster' })
  .prop(
    crateStack({ id: 'plaza-crates-a', at: [-8, 84], layers: 1, seed: 2 }),
    crateStack({ id: 'plaza-crates-b', at: [8, 78], layers: 2, seed: 4 }),
    coverWall({ id: 'plaza-cover', at: [-9, 66], axis: 'x', length: 5 }),
    pillar({ id: 'plaza-pillar', at: [10, 62] }),
  )
  // ── Zona C: iglesia-refugio (interior de paso) ──────────────────────────────
  .structure({
    id: 'church', center: [0, 48], groundY: 0, width: 18, depth: 14, storyHeight: 5, roof: 'gable',
    palette: { base: 'concrete', upper: 'concrete', trim: 'trim', roof: 'roof', floor: 'floor' },
    pilasters: true,
    stories: [{ doors: [{ side: 'south', width: 3 }, { side: 'north', width: 3 }], windows: 'auto' }],
  })
  // ── Zona D: callejones ──────────────────────────────────────────────────────
  .house({ id: 'house-d', center: [18, 28], floorY: 0, width: 6, depth: 6, height: 3, door: { side: 'west', width: 1.4 }, groundSlab: true, wallMaterial: 'woodDark' })
  .house({ id: 'house-e', center: [-18, 24], floorY: 0, width: 6, depth: 5, height: 3, door: { side: 'east', width: 1.4 }, groundSlab: true, wallMaterial: 'plaster' })
  .prop(
    coverWall({ id: 'alley-cover-a', at: [-4, 34], axis: 'x', length: 6 }),
    coverWall({ id: 'alley-cover-b', at: [6, 26], axis: 'z', length: 6 }),
    crateStack({ id: 'alley-crates', at: [-6, 20], layers: 1, seed: 6 }),
    pillar({ id: 'alley-pillar', at: [8, 18] }),
  )
  // ── Zona E: pasarela elevada sobre el patio de zombies ──────────────────────
  .ramp({ id: 'catwalk-ramp-s', start: [0, 14], end: [0, 9], startY: 0, endY: 3.2, width: 3.5, steps: 11 })
  .boxes(
    { id: 'catwalk-deck', position: [0, 3.0, -0.5], size: [4, 0.4, 19], material: 'trim' },
    { id: 'catwalk-rail-w', position: [-2.1, 3.6, -0.5], size: [0.2, 1.2, 19], material: 'trim' },
    { id: 'catwalk-rail-e', position: [2.1, 3.6, -0.5], size: [0.2, 1.2, 19], material: 'trim' },
  )
  .ramp({ id: 'catwalk-ramp-n', start: [0, -10], end: [0, -15], startY: 3.2, endY: 0, width: 3.5, steps: 11 })
  .prop(
    crateStack({ id: 'pit-crates-a', at: [-12, 2], layers: 1, seed: 8 }),
    crateStack({ id: 'pit-crates-b', at: [12, -4], layers: 2, seed: 1 }),
    coverWall({ id: 'pit-cover', at: [-8, -8], axis: 'x', length: 6 }),
  )
  // ── Zona F: callejón en llamas + gauntlet ───────────────────────────────────
  .prop(
    coverWall({ id: 'gauntlet-cover-a', at: [-6, -22], axis: 'z', length: 6 }),
    coverWall({ id: 'gauntlet-cover-b', at: [4, -30], axis: 'x', length: 5 }),
    crateStack({ id: 'gauntlet-crates', at: [-8, -34], layers: 1, seed: 3 }),
  )
  // ── Zona G: mina (salida) ───────────────────────────────────────────────────
  .structure({
    id: 'mine', center: [0, -72], groundY: 0, width: 16, depth: 12, storyHeight: 4.5, roof: 'flat',
    palette: { base: 'concrete', trim: 'trim', roof: 'roof', floor: 'floor' },
    stories: [{ doors: [{ side: 'south', width: 4 }], windows: 'none' }],
  })
  // ── Portón de la mina ───────────────────────────────────────────────────────
  .door({
    id: 'gate-mine', position: [0, 1.5, -42], size: [4, 3, 0.6], openOffset: [0, 3.2, 0], speed: 3, material: 'door',
    button: { id: 'gate-mine-btn', label: 'Entrada a la mina', position: [2.4, 1.2, -42.8], size: [0.32, 0.32, 0.12] },
  })
  // ── Personajes presentes al cargar ──────────────────────────────────────────
  .npc({ id: 'grigori', characterId: 'rebelM3', position: [-10, 1, 100] })
  .npc({ id: 'brother', characterId: 'rebelM1', position: [4, 1, 46] })
  // ── Armas / munición / vitals (kit de Ravenholm) ────────────────────────────
  .pickup({ id: 'wp-crowbar', weaponId: 'crowbar', position: [2, 0.4, 106] })
  .pickup({ id: 'wp-gravity', weaponId: 'gravityGun', position: [0, 0.4, 106] })
  .pickup({ id: 'wp-shotgun', weaponId: 'shotgun', position: [-2, 0.4, 106] })
  .ammo({ id: 'am-shotgun', ammoId: 'shotgun', position: [-2, 0.4, 104.5] })
  .pickup({ id: 'wp-grenade', weaponId: 'grenade', position: [2, 0.4, 104.5] })
  .item({ id: 'it-medkit', itemId: 'medkit', position: [0, 0.4, 104.5] })
  // Refugio en la iglesia.
  .charger({ id: 'ch-health-church', kind: 'health', position: [-8.2, 0, 48], rotationY: Math.PI / 2 })
  .itemInRoom('church', 0, [3, 0], { id: 'it-medkit-2', itemId: 'medkit' })
  .ammoInRoom('church', 0, [-2, 2], { id: 'am-shotgun-2', ammoId: 'shotgun' })
  .charger({ id: 'ch-health-gauntlet', kind: 'health', position: [-14, 0, -24], rotationY: -Math.PI / 2 })
  // ── Barriles explosivos (trampas) ───────────────────────────────────────────
  .explosiveBarrel({ id: 'trap-1', position: [0, 0, 74] })
  .explosiveBarrel({ id: 'trap-2', position: [1, 0, 73] })
  .explosiveBarrel({ id: 'trap-3', position: [-1, 0, 73] })
  .explosiveBarrel({ id: 'trap-4', position: [-6, 0, 18] })
  .explosiveBarrel({ id: 'trap-5', position: [-4, 0, -30] })
  // ── Peligro ambiental: casa en llamas ───────────────────────────────────────
  .hazardVolume({ id: 'fire-wreck', position: [12, 1.5, -26], size: [8, 4, 8], kind: 'fire', damagePerSecond: 12 })
  // ── Entity I/O ──────────────────────────────────────────────────────────────
  .logic({
    kind: 'auto', id: 'boot', name: 'boot',
    connections: [
      { output: 'OnMapSpawn', target: 'msg-welcome', input: 'Show' },
      { output: 'OnMapSpawn', target: 'obj-find', input: 'Apply' },
    ],
  })
  .logic({ kind: 'message', id: 'msg-welcome', name: 'msg-welcome', speaker: 'Sistema', text: 'Ravenholm. No deberíamos estar acá.', duration: 4 })
  .logic({ kind: 'objective', id: 'obj-find', name: 'obj-find', text: 'Encontrá la salida del pueblo', marker: [0, 1.6, -72] })
  .logic({ kind: 'objective', id: 'obj-fight', name: 'obj-fight', text: 'Sobreviví a la horda', marker: [0, 1.6, 70] })
  .logic({ kind: 'objective', id: 'obj-church', name: 'obj-church', text: 'Refugiate en la iglesia', marker: [0, 1.6, 48] })
  .logic({ kind: 'objective', id: 'obj-alley', name: 'obj-alley', text: 'Bajá por los callejones hacia la mina', marker: [0, 1.6, -30] })
  .logic({ kind: 'objective', id: 'obj-mine', name: 'obj-mine', text: 'Entrá a la mina y escapá', marker: [0, 1.6, -72] })
  .logic({ kind: 'message', id: 'msg-run', name: 'msg-run', speaker: 'Grigori', text: '¡Corré, hermano! ¡Ya vienen!', duration: 3 })
  .logic({ kind: 'message', id: 'msg-clear1', name: 'msg-clear1', speaker: 'Grigori', text: 'Bien... pero no aflojes. Metete en la iglesia.', duration: 3.5 })
  .logic({ kind: 'message', id: 'msg-church', name: 'msg-church', speaker: 'Sistema', text: '¡Headcrabs en las vigas!', duration: 3 })
  .logic({ kind: 'message', id: 'msg-gauntlet', name: 'msg-gauntlet', speaker: 'Grigori', text: '¡Siguen llegando! Seguí hasta la mina, yo los contengo.', duration: 3.5 })
  .logic({ kind: 'message', id: 'msg-gauntlet-clear', name: 'msg-gauntlet-clear', speaker: 'Grigori', text: '¡El portón de la mina está abierto! ¡Metete!', duration: 3.5 })
  .logic({ kind: 'message', id: 'msg-end', name: 'msg-end', speaker: 'Grigori', text: 'Andá con cuidado, hermano Freeman. Que la luz te acompañe.', duration: 4 })
  // Secuencia de intro: Grigori despierta la horda.
  .sequence({
    id: 'grigori-seq', name: 'grigori-seq', targetNpc: 'grigori', position: [-10, 1, 100], moveMode: 'walk', overrideAi: true,
    steps: [
      { kind: 'face', target: '!player' },
      { kind: 'gesture', gesture: 'wave', duration: 1.2 },
      { kind: 'say', speaker: 'Grigori', text: '¡Hermano Freeman! No deberías estar en Ravenholm... pero ya que llegaste, mandemos a estos pecadores de vuelta al infierno.', duration: 5 },
      { kind: 'gesture', gesture: 'point', duration: 1.2 },
    ],
    connections: [
      { output: 'OnEnd', target: 'spawn-horde1', input: 'Spawn' },
      { output: 'OnEnd', target: 'msg-run', input: 'Show' },
      { output: 'OnEnd', target: 'obj-fight', input: 'Apply' },
    ],
  })
  .logic({ kind: 'npcSpawner', id: 'spawn-horde1', name: 'spawn-horde1', npcs: [
    { id: 'hz1', name: 'horde', characterId: 'zombie', position: [-6, 1, 78], connections: [{ output: 'OnDeath', target: 'horde1-count', input: 'Add' }] },
    { id: 'hz2', name: 'horde', characterId: 'zombie', position: [6, 1, 80], connections: [{ output: 'OnDeath', target: 'horde1-count', input: 'Add' }] },
    { id: 'hz3', name: 'horde', characterId: 'zombie', position: [0, 1, 84], connections: [{ output: 'OnDeath', target: 'horde1-count', input: 'Add' }] },
    { id: 'hh1', name: 'horde', characterId: 'headcrab', position: [-9, 1, 74], connections: [{ output: 'OnDeath', target: 'horde1-count', input: 'Add' }] },
    { id: 'hh2', name: 'horde', characterId: 'headcrab', position: [9, 1, 74], connections: [{ output: 'OnDeath', target: 'horde1-count', input: 'Add' }] },
  ] })
  .logic({ kind: 'counter', id: 'horde1-count', name: 'horde1-count', max: 5, connections: [
    { output: 'OnHitMax', target: 'msg-clear1', input: 'Show' },
    { output: 'OnHitMax', target: 'obj-church', input: 'Apply' },
  ] })
  // Secuencia de la iglesia: el rebelde herido advierte + scare de headcrabs.
  .sequence({
    id: 'church-seq', name: 'church-seq', targetNpc: 'brother', position: [4, 1, 46], moveMode: 'none', overrideAi: true,
    steps: [
      { kind: 'face', target: '!player' },
      { kind: 'say', speaker: 'Hermano', text: 'Freeman... ya no queda nadie vivo acá. Bajá por los callejones, la mina es la única salida.', duration: 4.5 },
      { kind: 'gesture', gesture: 'point', duration: 1.2 },
    ],
    connections: [{ output: 'OnEnd', target: 'obj-alley', input: 'Apply' }],
  })
  .logic({ kind: 'npcSpawner', id: 'spawn-church', name: 'spawn-church', npcs: [
    { id: 'ch1', characterId: 'headcrab', position: [-4, 1, 45] },
    { id: 'ch2', characterId: 'headcrab', position: [4, 1, 51] },
  ] })
  // Patio de zombies bajo la pasarela.
  .logic({ kind: 'npcSpawner', id: 'spawn-pit', name: 'spawn-pit', npcs: [
    { id: 'pit1', characterId: 'zombie', position: [-6, 1, 2] },
    { id: 'pit2', characterId: 'zombie', position: [6, 1, -2] },
    { id: 'pit3', characterId: 'zombie', position: [0, 1, -6] },
  ] })
  // Gauntlet del callejón: timer que suelta oleadas hasta 3 ticks.
  .logic({ kind: 'timer', id: 'gauntlet-timer', name: 'gauntlet-timer', interval: 5, startDisabled: true, connections: [
    { output: 'OnTimer', target: 'spawn-trickle', input: 'Spawn' },
    { output: 'OnTimer', target: 'wave-count', input: 'Add' },
  ] })
  .logic({ kind: 'npcSpawner', id: 'spawn-trickle', name: 'spawn-trickle', npcs: [
    { id: 'tz1', name: 'trickle', characterId: 'zombie', position: [-4, 1, -34] },
    { id: 'tz2', name: 'trickle', characterId: 'zombie', position: [4, 1, -34] },
  ] })
  .logic({ kind: 'counter', id: 'wave-count', name: 'wave-count', max: 3, connections: [
    { output: 'OnHitMax', target: 'gauntlet-timer', input: 'Disable' },
    { output: 'OnHitMax', target: 'gate-mine', input: 'Open' },
    { output: 'OnHitMax', target: 'msg-gauntlet-clear', input: 'Show' },
    { output: 'OnHitMax', target: 'obj-mine', input: 'Apply' },
    { output: 'OnHitMax', target: 'grigori-exit-seq', input: 'Start', delay: 1 },
    { output: 'OnHitMax', target: 'exit-trigger', input: 'Enable', delay: 1.5 },
  ] })
  .sequence({
    id: 'grigori-exit-seq', name: 'grigori-exit-seq', targetNpc: 'grigori', position: [0, 1, -38], moveMode: 'run', overrideAi: true,
    steps: [
      { kind: 'face', target: '!player' },
      { kind: 'say', speaker: 'Grigori', text: '¡La mina! Por ahí se sale. Corré, yo los contengo.', duration: 4 },
      { kind: 'gesture', gesture: 'point', duration: 1.2 },
    ],
  })
  .logic({ kind: 'changelevel', id: 'exit-level', name: 'exit-level' })
  // ── Triggers ────────────────────────────────────────────────────────────────
  .trigger({ id: 'grigori-trigger', position: [0, 1.2, 100], size: [84, 3, 3], once: true,
    connections: [{ output: 'OnStartTouch', target: 'grigori-seq', input: 'Start' }] })
  .trigger({ id: 'church-trigger', position: [0, 1.2, 53], size: [16, 3, 2], once: true,
    connections: [
      { output: 'OnStartTouch', target: 'church-seq', input: 'Start' },
      { output: 'OnStartTouch', target: 'spawn-church', input: 'Spawn' },
      { output: 'OnStartTouch', target: 'msg-church', input: 'Show' },
    ] })
  .trigger({ id: 'catwalk-trigger', position: [0, 1.2, 12], size: [84, 3, 3], once: true,
    connections: [{ output: 'OnStartTouch', target: 'spawn-pit', input: 'Spawn' }] })
  .trigger({ id: 'alley-trigger', position: [0, 1.2, -16], size: [84, 3, 3], once: true,
    connections: [
      { output: 'OnStartTouch', target: 'gauntlet-timer', input: 'Enable' },
      { output: 'OnStartTouch', target: 'msg-gauntlet', input: 'Show' },
    ] })
  .trigger({ id: 'exit-trigger', position: [0, 1.2, -72], size: [14, 3, 3], once: true, startDisabled: true,
    connections: [
      { output: 'OnStartTouch', target: 'msg-end', input: 'Show' },
      { output: 'OnStartTouch', target: 'exit-level', input: 'Trigger', delay: 2.5 },
    ] })
  // ── Checkpoints ─────────────────────────────────────────────────────────────
  .checkpoint({ id: 'cp-entry', position: [0, 1.2, 104], size: [16, 3, 3], respawn: [0, 1.2, 106] })
  .checkpoint({ id: 'cp-plaza', position: [0, 1.2, 57], size: [12, 3, 3], respawn: [0, 1.2, 57] })
  .checkpoint({ id: 'cp-alley', position: [0, 1.2, -14], size: [16, 3, 3], respawn: [0, 1.2, -14] })
  .checkpoint({ id: 'cp-mine', position: [0, 1.2, -46], size: [10, 3, 3], respawn: [0, 1.2, -46] })
  .build();
