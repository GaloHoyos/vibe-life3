import { createMap } from '@game/levels/builders/MapCreator';
import { crateStack, coverWall } from '@game/levels/builders/PropBuilder';

/**
 * Mapa de verificación del entity I/O + setpieces + compañera (Tier 4.1).
 * Ejercita, de punta a punta, la cadena completa:
 *
 *  1. `auto` (OnMapSpawn) → objetivo inicial + mensaje de bienvenida.
 *  2. Trigger de entrada → `relay` → `Start` de una secuencia guionada: Alyx
 *     camina a la consola, encara al jugador, señala (gesto) y habla.
 *  3. Al terminar la secuencia (`OnEnd`) → `npcSpawner` suelta 3 Combine que
 *     comparten el targetname `wave`; cada muerte (`OnDeath`) suma a un `counter`.
 *  4. `OnHitMax` del counter → abre la esclusa + ordena a Alyx `EscortTo` la zona
 *     de extracción + actualiza el objetivo.
 *  5. Al llegar Alyx (`OnEscortArrived`) → habilita el trigger de salida.
 *  6. Trigger de salida → `changelevel` (fin de la prueba).
 *
 * Verificación runtime: `window.__aiTrace` para inspeccionar la navegación de
 * Alyx; el toggle USE (E) sobre Alyx alterna follow/wait durante el combate.
 */
export const SetpieceTestLevel = createMap({
  id: 'setpiece-test',
  title: 'Prueba de Setpiece',
  description: 'Verificación del entity I/O: secuencia guionada, spawns, counter, escolta y salida.',
  objective: { text: 'Acercate a la consola con Alyx', marker: [0, 1.6, 0] },
  background: 0x0a1018,
  playerStart: [0, 1.2, 18],
  audio: {
    ambiences: ['background.wind', 'background.hl2.wind.wasteland'],
    footstepSounds: ['footsteps.snow1', 'footsteps.snow2', 'footsteps.snow3', 'footsteps.snow4'],
    soundscape: 'wasteland',
  },
})
  .ground({ size: [44, 54], boundary: { height: 4 } })
  // Pared divisoria con hueco para la esclusa de extracción.
  .boxes(
    { id: 'div-left', position: [-12, 1.6, -8], size: [16, 3.2, 0.5], material: 'wall' },
    { id: 'div-right', position: [12, 1.6, -8], size: [16, 3.2, 0.5], material: 'wall' },
  )
  .prop(
    crateStack({ id: 'cover-a', at: [-6, 4], layers: 2 }),
    crateStack({ id: 'cover-b', at: [7, 2], layers: 1 }),
    coverWall({ id: 'cover-c', at: [0, 6], axis: 'x', length: 6 }),
  )
  .pickup({ id: 'wp-pistol', weaponId: 'pistol', position: [-1.5, 0.4, 16] })
  .pickup({ id: 'wp-smg', weaponId: 'smg', position: [1.5, 0.4, 16] })
  // Compañera: sigue al jugador, es escoltable por script y toggleable con E.
  .npc({
    id: 'alyx',
    characterId: 'alyx',
    position: [3, 1, 15],
    connections: [
      { output: 'OnEscortArrived', target: 'exit-trigger', input: 'Enable' },
      { output: 'OnEscortArrived', target: 'msg-escorted', input: 'Show' },
      { output: 'OnEscortArrived', target: 'obj-done', input: 'Apply' },
    ],
  })
  .door({
    id: 'gate',
    position: [0, 1.5, -8],
    size: [4, 3, 0.5],
    openOffset: [0, 3.2, 0],
    speed: 3,
    material: 'door',
    button: {
      id: 'gate-button',
      label: 'Esclusa (bloqueada)',
      position: [2.4, 1.2, -7.2],
      size: [0.32, 0.32, 0.12],
    },
  })
  // ── Entity I/O ────────────────────────────────────────────────────────────
  .logic({ kind: 'auto', id: 'boot', name: 'boot', connections: [
    { output: 'OnMapSpawn', target: 'msg-welcome', input: 'Show' },
    { output: 'OnMapSpawn', target: 'obj-start', input: 'Apply' },
  ] })
  .logic({ kind: 'message', id: 'msg-welcome', name: 'msg-welcome', speaker: 'Sistema', text: 'Prueba de setpiece. Avanzá con Alyx hacia la consola.', duration: 4 })
  .logic({ kind: 'objective', id: 'obj-start', name: 'obj-start', text: 'Acercate a la consola con Alyx', marker: [0, 1.6, 0] })
  .logic({ kind: 'relay', id: 'intro-relay', name: 'intro-relay', connections: [
    { output: 'OnTrigger', target: 'intro-seq', input: 'Start' },
  ] })
  .sequence({
    id: 'intro-seq',
    name: 'intro-seq',
    targetNpc: 'alyx',
    position: [0, 1, -2],
    moveMode: 'walk',
    overrideAi: true,
    steps: [
      { kind: 'face', target: '!player' },
      { kind: 'gesture', gesture: 'point', duration: 1.5 },
      { kind: 'say', speaker: 'Alyx', text: 'Refuerzos Combine entrando. Cubrí la esclusa.', duration: 3 },
    ],
    connections: [{ output: 'OnEnd', target: 'spawn-wave', input: 'Spawn' }],
  })
  .logic({ kind: 'npcSpawner', id: 'spawn-wave', name: 'spawn-wave', npcs: [
    { id: 'w1', name: 'wave', characterId: 'combine', position: [-8, 1, -6], connections: [{ output: 'OnDeath', target: 'kills', input: 'Add' }] },
    { id: 'w2', name: 'wave', characterId: 'combine', position: [0, 1, -6], connections: [{ output: 'OnDeath', target: 'kills', input: 'Add' }] },
    { id: 'w3', name: 'wave', characterId: 'combine', position: [8, 1, -6], connections: [{ output: 'OnDeath', target: 'kills', input: 'Add' }] },
  ] })
  .logic({ kind: 'counter', id: 'kills', name: 'kills', max: 3, connections: [
    { output: 'OnHitMax', target: 'gate', input: 'Open' },
    { output: 'OnHitMax', target: 'alyx', input: 'EscortTo', param: 'exit-point' },
    { output: 'OnHitMax', target: 'msg-clear', input: 'Show' },
    { output: 'OnHitMax', target: 'obj-escort', input: 'Apply' },
  ] })
  .logic({ kind: 'marker', id: 'exit-point', name: 'exit-point', position: [0, 1, -18] })
  .logic({ kind: 'message', id: 'msg-clear', name: 'msg-clear', speaker: 'Alyx', text: 'Despejado. Seguime a la extracción.', duration: 3 })
  .logic({ kind: 'objective', id: 'obj-escort', name: 'obj-escort', text: 'Seguí a Alyx a la extracción', marker: [0, 1.6, -18] })
  .logic({ kind: 'message', id: 'msg-escorted', name: 'msg-escorted', speaker: 'Alyx', text: 'Extracción lista. Cruzá la esclusa.', duration: 3 })
  .logic({ kind: 'objective', id: 'obj-done', name: 'obj-done', text: 'Cruzá la esclusa de extracción', marker: [0, 1.6, -20] })
  .logic({ kind: 'changelevel', id: 'exit', name: 'exit' })
  .trigger({
    id: 'entry-trigger',
    position: [0, 1.2, 10],
    size: [44, 3, 3],
    once: true,
    connections: [{ output: 'OnStartTouch', target: 'intro-relay', input: 'Trigger' }],
  })
  .trigger({
    id: 'exit-trigger',
    position: [0, 1.2, -20],
    size: [44, 3, 3],
    once: true,
    startDisabled: true,
    connections: [{ output: 'OnStartTouch', target: 'exit', input: 'Trigger' }],
  })
  .build();
