import { createMap } from '@game/levels/builders/MapCreator';
import { crateStack } from '@game/levels/builders/PropBuilder';

/**
 * Laboratorio 3 — extracción aérea.
 *
 * Explanada con una zona de aterrizaje marcada y un transporte Combine esperando
 * lejos. La cadena que prueba es la que arranca cuando una tripulación pierde su
 * vehículo:
 *
 *   destruís el buggy -> la tripulación evacúa -> al tocar tierra pide recogida
 *   -> el director le asigna el transporte -> baja vacío a la zona -> suben -> se va.
 *
 * Ese es el único disparador automático de recogida que existe: perder el
 * vehículo. No hay umbral de "van perdiendo", que sin jugarlo no se puede
 * calibrar.
 *
 * Cómo leerlo: agarrá el RPG, reventá el buggy Combine y no toques nada más.
 * Si matás también a la tripulación no hay a quién recoger y el transporte se
 * queda donde está, que es el comportamiento correcto.
 */

const LANDING_ZONE: [number, number, number] = [0, 0, 30];

export const VehicleLabExtraction = createMap({
  id: 'vehicle-lab-extraction',
  title: 'Lab 3: extracción aérea',
  description:
    'Perdé un vehículo Combine y mirá cómo su tripulación pide recogida y el transporte baja a buscarla.',
  objective: {
    text: 'Destruí el buggy Combine y seguí a la tripulación hasta la zona de recogida',
    marker: LANDING_ZONE,
  },
  background: 0x8ea4b0,
  sun: { direction: [0.3, 0.85, -0.35], color: 0xffdcae, intensity: 1.55 },
  playerStart: [-46, 1.2, -30],
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
  .ground({ size: [140, 140], material: 'concrete', boundary: { height: 4 } })
  // La zona de recogida. El cerebro aéreo se posa acá aunque venga vacío: un
  // transporte normal sólo aterriza con carga, y `pickupAt` pisa esa regla.
  .vehicleNavMarker({
    id: 'extraction-lz',
    position: LANDING_ZONE,
    heading: Math.PI,
    kind: 'landingZone',
    allowedPresets: ['helicopterFree'],
  })
  // Patrulla Combine: es la que va a quedarse a pie.
  .vehicle({
    id: 'extraction-target-buggy',
    presetId: 'buggy',
    position: [10, 1.1, -12],
    rotation: [0, Math.PI, 0],
    faction: 'combine',
    accessPolicy: 'combine',
    engineOn: true,
    crew: [
      { actor: 'extraction-driver', role: 'driver', seatId: 'driver' },
      { actor: 'extraction-gunner', role: 'gunner', seatId: 'gunner' },
    ],
    ai: { enabled: true, behavior: 'patrol' },
    portalTraversal: 'blocked',
  })
  // El transporte, lejos y sin tripulación autorada: los puestos los cubre la
  // facción cuando hace falta.
  .vehicle({
    id: 'extraction-transport',
    presetId: 'helicopterFree',
    position: [56, 1.2, 56],
    rotation: [0, -Math.PI * 0.75, 0],
    faction: 'combine',
    accessPolicy: 'combine',
    engineOn: false,
    ai: { enabled: true, behavior: 'transport' },
    aiCrew: { enabled: true, roles: ['pilot'] },
    portalTraversal: 'blocked',
  })
  .npc({ id: 'extraction-driver', characterId: 'combine', position: [10, 1.2, -14] })
  .npc({ id: 'extraction-gunner', characterId: 'combineElite', position: [12, 1.2, -14] })
  .npc({ id: 'extraction-pilot', characterId: 'combine', position: [52, 1.2, 54] })
  .prop(
    crateStack({ id: 'extraction-crates-a', at: [-6, 26], layers: 2 }),
    crateStack({ id: 'extraction-crates-b', at: [8, 34], layers: 1 }),
  )
  .pickup({ id: 'extraction-pickup-rpg', weaponId: 'rpg', position: [-44, 0.5, -28] })
  .ammo({ id: 'extraction-ammo-rpg', ammoId: 'rpg', position: [-42, 0.5, -28] })
  .pickup({ id: 'extraction-pickup-ar3', weaponId: 'ar3', position: [-46, 0.5, -26] })
  .build();
