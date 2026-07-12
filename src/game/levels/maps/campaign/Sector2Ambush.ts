import { createMap } from '@game/levels/builders/MapCreator';
import { sandbagLine, crateStack, watchtower } from '@game/levels/builders/PropBuilder';

/**
 * Campaña de prueba (2/3). Ejercita: spawners de NPCs disparados por trigger
 * (emboscada con delay escalonado en las conexiones), acción de nivel
 * (`spawnAllWeapons`) y salida al Sector 3.
 */
export const Sector2Ambush = createMap({
  id: 'test-02-ambush',
  title: 'Sector 2 — Emboscada',
  description: 'Mapa de prueba: triggers que spawnean enemigos y acciones de nivel.',
  nextLevel: 'test-03-extraction',
  entryLandmark: [0, 1, 24],
  objective: { text: 'Cruzá el patio hacia el portón sur', marker: [0, 1.6, -24] },
  background: 0x0c1014,
  playerStart: [0, 1.2, 24],
  audio: {
    ambiences: ['background.wind', 'background.hl2.wind.wasteland'],
    footstepSounds: ['footsteps.snow1', 'footsteps.snow2', 'footsteps.snow3', 'footsteps.snow4'],
    soundscape: 'wasteland',
  },
})
  .ground({ size: [44, 56], boundary: { height: 4 } })
  .prop(
    sandbagLine({ id: 'sb-1', from: [-12, 6], to: [12, 6] }),
    sandbagLine({ id: 'sb-2', from: [-14, -8], to: [-2, -8] }),
    crateStack({ id: 'crates-c', at: [10, -6], layers: 2 }),
    watchtower({ id: 'tower-1', at: [-15, -14], rampSide: 'east' }),
  )
  .pickup({ id: 'wp-shotgun', weaponId: 'shotgun', position: [0, 0.4, 21] })
  .item({ id: 'it-battery', itemId: 'hevBattery', position: [-2, 0.4, 21] })
  .logic({ kind: 'message', id: 'msg-ambush', name: 'msg-ambush', speaker: 'Alyx', text: '¡Emboscada! Vienen del patio.', duration: 3 })
  .logic({ kind: 'objective', id: 'obj-ambush', name: 'obj-ambush', text: 'Sobreviví a la emboscada y llegá al portón sur', marker: [0, 1.6, -24] })
  .logic({ kind: 'npcSpawner', id: 'spawn-wave1', name: 'spawn-wave1', npcs: [
    { id: 'amb-z1', characterId: 'zombie', position: [-8, 1, -2] },
    { id: 'amb-z2', characterId: 'zombie', position: [8, 1, -2] },
    { id: 'amb-h1', characterId: 'headcrab', position: [-11, 1, 2] },
    { id: 'amb-h2', characterId: 'headcrab', position: [11, 1, 2] },
    // Torreta de piso cubriendo el centro del patio (mira hacia el norte, de
    // donde viene el player). `patrol[0]` = punto de montaje hacia el que apunta.
    { id: 'amb-turret', characterId: 'floorTurret', position: [0, 1, -10], patrol: [[0, 1, 10]] },
  ] })
  .logic({ kind: 'npcSpawner', id: 'spawn-wave2', name: 'spawn-wave2', npcs: [
    { id: 'amb-c1', characterId: 'combine', position: [-6, 1, -14] },
    { id: 'amb-c2', characterId: 'combine', position: [6, 1, -14] },
  ] })
  .logic({ kind: 'npcSpawner', id: 'spawn-wave3', name: 'spawn-wave3', npcs: [
    { id: 'amb-m1', characterId: 'manhack', position: [-5, 2.6, -16] },
    { id: 'amb-m2', characterId: 'manhack', position: [5, 2.6, -16] },
  ] })
  .logic({ kind: 'message', id: 'msg-cache', name: 'msg-cache', speaker: 'Sistema', text: 'Caja de armamento desplegada.', duration: 2.5 })
  .logic({ kind: 'levelAction', id: 'act-weapons', name: 'act-weapons', action: 'spawnAllWeapons' })
  .logic({ kind: 'objective', id: 'obj-s2-done', name: 'obj-s2-done', text: 'Patio despejado', completed: true })
  .logic({ kind: 'changelevel', id: 'exit-s2', name: 'exit-s2', landmark: [0, 1, -25] })
  .trigger({
    id: 'tr-ambush',
    position: [0, 1.2, 10],
    size: [44, 3, 4],
    once: true,
    connections: [
      { output: 'OnStartTouch', target: 'msg-ambush', input: 'Show' },
      { output: 'OnStartTouch', target: 'obj-ambush', input: 'Apply' },
      { output: 'OnStartTouch', target: 'spawn-wave1', input: 'Spawn' },
      { output: 'OnStartTouch', target: 'spawn-wave2', input: 'Spawn', delay: 3 },
      { output: 'OnStartTouch', target: 'spawn-wave3', input: 'Spawn', delay: 5 },
    ],
  })
  // Caja de armamento de emergencia: despliega el arsenal al cruzar.
  .trigger({
    id: 'tr-cache',
    position: [14, 1.2, 4],
    size: [4, 3, 4],
    once: true,
    connections: [
      { output: 'OnStartTouch', target: 'msg-cache', input: 'Show' },
      { output: 'OnStartTouch', target: 'act-weapons', input: 'Trigger' },
    ],
  })
  .trigger({
    id: 'tr-exit',
    position: [0, 1.2, -25],
    size: [44, 3, 3],
    once: true,
    connections: [
      { output: 'OnStartTouch', target: 'obj-s2-done', input: 'Apply' },
      { output: 'OnStartTouch', target: 'exit-s2', input: 'Trigger', delay: 1.2 },
    ],
  })
  .build();
