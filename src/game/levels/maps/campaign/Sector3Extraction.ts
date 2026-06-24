import { createMap } from '@game/levels/builders/MapCreator';
import { coverWall, cargoContainer } from '@game/levels/builders/PropBuilder';

/**
 * Campaña de prueba (3/3). Ejercita: objetivo con marcador, charger de pared y
 * `endLevel` SIN `nextLevel` → fin de campaña (vuelve al menú).
 */
export const Sector3Extraction = createMap({
  id: 'test-03-extraction',
  title: 'Sector 3 — Extracción',
  description: 'Mapa de prueba: cierre de campaña con endLevel sin nivel siguiente.',
  entryLandmark: [0, 1, 20],
  objective: { text: 'Llegá a la zona de extracción', marker: [0, 1.6, -20] },
  background: 0x0a0d12,
  playerStart: [0, 1.2, 20],
  audio: {
    ambiences: ['background.wind'],
    footstepSounds: ['footsteps.snow1', 'footsteps.snow2', 'footsteps.snow3', 'footsteps.snow4'],
  },
})
  .ground({ size: [32, 48], boundary: { height: 4 } })
  .prop(
    cargoContainer({ id: 'cont-1', at: [-8, 2], axis: 'x' }),
    cargoContainer({ id: 'cont-2', at: [9, -4], axis: 'z' }),
    coverWall({ id: 'cover-ext', at: [0, -10], axis: 'x', length: 8 }),
  )
  .charger({ id: 'ch-health', kind: 'health', position: [-14.6, 0, 8], rotationY: Math.PI / 2 })
  .npc({ id: 'guard-1', characterId: 'combine', position: [4, 1, -12] })
  .trigger({
    id: 'tr-halfway',
    position: [0, 1.2, 2],
    size: [32, 3, 4],
    once: true,
    actions: [
      { kind: 'dialogue', speaker: 'Alyx', text: 'La extracción está justo adelante. Cuidado con el guardia.', duration: 3.5 },
      { kind: 'objective', text: 'Eliminá la resistencia y alcanzá la extracción', marker: [0, 1.6, -20] },
    ],
  })
  .trigger({
    id: 'tr-extraction',
    position: [0, 1.2, -20],
    size: [32, 3, 3],
    once: true,
    actions: [
      { kind: 'objective', text: 'Extracción alcanzada', completed: true },
      { kind: 'dialogue', speaker: 'Alyx', text: 'Lo lograste. Fin de la prueba.', duration: 4 },
      { kind: 'endLevel', delay: 2.5 },
    ],
  })
  .build();
