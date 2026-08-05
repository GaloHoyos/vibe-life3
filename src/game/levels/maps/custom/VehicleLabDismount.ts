import { createMap } from '@game/levels/builders/MapCreator';
import { buildHouse, type HouseSpec } from '@game/levels/builders/HouseBuilder';
import { sandbagLine } from '@game/levels/builders/PropBuilder';

/**
 * Laboratorio 2 — bajarse del vehículo para seguirte a pie.
 *
 * Tres refugios abiertos por una puerta de persona. El vano mide menos que el
 * ancho de un buggy, así que el interior queda como isla propia del grid
 * vehicular y el bake la descarta: para la IA de conducción, ahí no se llega.
 *
 * Metete en cualquiera de los tres quedando a la vista desde la puerta. Los
 * Combine que te venían siguiendo pierden la ruta —no la vista— y aplican la
 * regla de desembarque: baja siempre al menos uno, y el conductor es lo último
 * que se suelta.
 *
 * Con buggies de dos plazas eso significa que baja el artillero y el conductor
 * queda cubriendo la salida. El refugio del medio tiene enfrente un vehículo con
 * un solo tripulante, para ver el otro extremo de la regla: ahí baja el propio
 * conductor y el buggy queda vacío.
 */

const SHELTERS: readonly HouseSpec[] = [
  {
    id: 'lab-shelter-west',
    center: [-34, 0],
    floorY: 0,
    width: 8,
    depth: 8,
    height: 3.2,
    door: { side: 'east', width: 1.3 },
  },
  {
    id: 'lab-shelter-mid',
    center: [0, 22],
    floorY: 0,
    width: 9,
    depth: 7,
    height: 3.2,
    door: { side: 'south', width: 1.3 },
  },
  {
    id: 'lab-shelter-east',
    center: [36, -6],
    floorY: 0,
    width: 8,
    depth: 8,
    height: 3.2,
    door: { side: 'west', width: 1.3 },
  },
];

const map = createMap({
  id: 'vehicle-lab-dismount',
  title: 'Lab 2: desembarco y persecución a pie',
  description:
    'Refugios con vano de persona: el vehículo no entra y la tripulación tiene que bajarse a seguirte.',
  objective: {
    text: 'Dejate ver, metete en un refugio y mirá quién se baja del vehículo',
    marker: [-34, 1.2, 0],
  },
  background: 0x8f9fa8,
  sun: { direction: [0.3, 0.95, 0.4], color: 0xffe0b8, intensity: 1.5 },
  playerStart: [0, 1.2, -34],
  audio: {
    ambiences: ['background.wind', 'background.hl2.wind.wasteland'],
    footstepSounds: [
      'footsteps.hl2.concrete1',
      'footsteps.hl2.concrete2',
      'footsteps.hl2.concrete3',
      'footsteps.hl2.concrete4',
    ],
    soundscape: 'wasteland',
  },
})
  .ground({ size: [130, 130], material: 'concrete', boundary: { height: 4 } })
  // Buggy del jugador: sirve para que te vean escapando y salgan a perseguirte
  // antes de que te metas en un refugio.
  .vehicle({
    id: 'dismount-player-buggy',
    presetId: 'buggy',
    position: [6, 1.1, -34],
    rotation: [0, 0, 0],
    faction: 'resistance',
    accessPolicy: 'player',
    engineOn: false,
    portalTraversal: 'blocked',
  })
  // Dos plazas y dos tripulantes: baja el artillero, queda el conductor.
  .vehicle({
    id: 'dismount-hunter-full',
    presetId: 'buggy',
    position: [-16, 1.1, -20],
    rotation: [0, Math.PI * 0.75, 0],
    faction: 'combine',
    accessPolicy: 'combine',
    engineOn: true,
    crew: [
      { actor: 'dismount-full-driver', role: 'driver', seatId: 'driver' },
      { actor: 'dismount-full-gunner', role: 'gunner', seatId: 'gunner' },
    ],
    ai: { enabled: true, behavior: 'intercept' },
    portalTraversal: 'blocked',
  })
  // Un solo tripulante: baja el conductor y el buggy queda abandonado.
  .vehicle({
    id: 'dismount-hunter-solo',
    presetId: 'buggy',
    position: [18, 1.1, 14],
    rotation: [0, -Math.PI * 0.5, 0],
    faction: 'combine',
    accessPolicy: 'combine',
    engineOn: true,
    crew: [{ actor: 'dismount-solo-driver', role: 'driver', seatId: 'driver' }],
    ai: { enabled: true, behavior: 'intercept' },
    portalTraversal: 'blocked',
  })
  .npc({ id: 'dismount-full-driver', characterId: 'combine', position: [-16, 1.2, -22] })
  .npc({ id: 'dismount-full-gunner', characterId: 'combineElite', position: [-14, 1.2, -22] })
  .npc({ id: 'dismount-solo-driver', characterId: 'combine', position: [18, 1.2, 12] })
  .prop(
    sandbagLine({ id: 'dismount-sandbags-a', from: [-24, 8], to: [-16, 8] }),
    sandbagLine({ id: 'dismount-sandbags-b', from: [22, -26], to: [22, -18] }),
  )
  .pickup({ id: 'dismount-pickup-shotgun', weaponId: 'shotgun', position: [-3, 0.5, -36] })
  .ammo({ id: 'dismount-ammo-shotgun', ammoId: 'shotgun', position: [-1, 0.5, -36] });

for (const shelter of SHELTERS) map.building(buildHouse(shelter));

export const VehicleLabDismount = map.build();
