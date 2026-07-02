import { createMap } from '@game/levels/builders/MapCreator';
import { crateStack, coverWall } from '@game/levels/builders/PropBuilder';

/**
 * Campaña de prueba (1/3). Ejercita: objetivo + brújula, trigger con diálogo,
 * apertura de puerta por trigger y encadenado al Sector 2 vía `endLevel`.
 */
export const Sector1Arrival = createMap({
  id: 'test-01-arrival',
  title: 'Sector 1 — Llegada',
  description: 'Mapa de prueba: objetivos, triggers y encadenado de niveles.',
  nextLevel: 'test-02-ambush',
  objective: { text: 'Avanzá hacia la esclusa norte', marker: [0, 1.6, -2] },
  background: 0x0a1018,
  playerStart: [0, 1.2, 22],
  audio: {
    ambiences: ['background.wind', 'background.hl2.wind.wasteland'],
    footstepSounds: ['footsteps.snow1', 'footsteps.snow2', 'footsteps.snow3', 'footsteps.snow4'],
    soundscape: 'wasteland',
  },
})
  .ground({ size: [40, 52], boundary: { height: 4 } })
  // Pared interna con hueco para la puerta-esclusa.
  .boxes(
    { id: 'div-wall-left', position: [-11, 1.6, -2], size: [18, 3.2, 0.5], material: 'wall' },
    { id: 'div-wall-right', position: [11, 1.6, -2], size: [18, 3.2, 0.5], material: 'wall' },
  )
  .prop(
    crateStack({ id: 'crates-a', at: [-6, 10], layers: 2 }),
    crateStack({ id: 'crates-b', at: [7, 4], layers: 1 }),
    coverWall({ id: 'cover-a', at: [3, 14], axis: 'x', length: 6 }),
  )
  .door({
    id: 'gate-1',
    position: [0, 1.5, -2],
    size: [4, 3, 0.5],
    openOffset: [0, 3.2, 0],
    speed: 3,
    material: 'door',
    button: {
      id: 'gate-1-button',
      label: 'Esclusa (bloqueada)',
      position: [2.4, 1.2, -1.2],
      size: [0.32, 0.32, 0.12],
    },
  })
  .pickup({ id: 'wp-pistol', weaponId: 'pistol', position: [-1.5, 0.4, 20] })
  .pickup({ id: 'wp-smg', weaponId: 'smg', position: [1.5, 0.4, 20] })
  .item({ id: 'it-medkit', itemId: 'medkit', position: [0, 0.4, 16] })
  .trigger({
    id: 'tr-gate-open',
    position: [0, 1.2, 8],
    size: [40, 3, 4],
    once: true,
    actions: [
      { kind: 'dialogue', speaker: 'Sistema', text: 'Esclusa norte desbloqueada.', duration: 3 },
      { kind: 'door', doorId: 'gate-1', open: true },
      { kind: 'objective', text: 'Cruzá la esclusa hacia la extracción', marker: [0, 1.6, -23] },
    ],
  })
  .trigger({
    id: 'tr-exit',
    position: [0, 1.2, -23],
    size: [40, 3, 3],
    once: true,
    actions: [
      { kind: 'objective', text: 'Sector 1 asegurado', completed: true },
      { kind: 'endLevel', landmark: [0, 1, -23], delay: 1.2 },
    ],
  })
  .build();
