import { createMap } from '@game/levels/builders/MapCreator';
import type { StaticBoxDefinition } from '@game/levels/LevelDefinition';

/**
 * Laboratorio 4 — de dónde sale el terreno manejable.
 *
 * Cinco piezas en fila, cada una probando una regla del rasterizado. Ninguna
 * está pintada a mano: todo el grid vehicular sale de la geometría de colisión,
 * que es lo que permite que cualquier nivel tenga navegación vehicular sin que
 * nadie autore polígonos.
 *
 *   1. Losa fina    — se maneja por arriba. Gana la altura más baja con gálibo.
 *   2. Tablero bajo — no se pasa por debajo: falta gálibo. Hay que rodearlo.
 *   3. Bloque alto  — su cara superior queda fuera del grid: es una isla que no
 *                     alcanza ninguna semilla, y el bake la descarta.
 *   4. Zona vedada  — despejada a la vista, recortada por un área `blocked`.
 *   5. Pasillo      — dos muros a poco más del ancho del buggy: el Hybrid A*
 *                     tiene que entrar derecho y salir con marcha atrás.
 *
 * Cómo leerlo: manejá el buggy del jugador por las cinco. El buggy Combine sale
 * a interceptarte y se ve cómo esquiva la zona vedada y no sube al bloque.
 */

/** Estaciones en fila sobre +X, con 30 m de aire entre una y otra. */
const SLAB_X = -50;
const DECK_X = -14;
const BLOCK_X = 20;
const BLOCKED_X = 54;
const CORRIDOR_X = 88;

const EXHIBITS: readonly StaticBoxDefinition[] = [
  // 1. Losa de 20 cm: sin la derivación por caras superiores esto sería un muro.
  { id: 'lab-slab', position: [SLAB_X, 0.1, 0], size: [22, 0.2, 22], material: 'concrete' },

  // 2. Tablero a 1,4 m sobre dos pilares: el buggy no cabe debajo.
  { id: 'lab-deck-pillar-n', position: [DECK_X, 0.7, -9], size: [2, 1.4, 2], material: 'concrete' },
  { id: 'lab-deck-pillar-s', position: [DECK_X, 0.7, 9], size: [2, 1.4, 2], material: 'concrete' },
  { id: 'lab-deck', position: [DECK_X, 1.55, 0], size: [6, 0.3, 20], material: 'concrete' },

  // 3. Bloque macizo de 3 m: arriba hay superficie y gálibo, pero no se llega.
  { id: 'lab-block', position: [BLOCK_X, 1.5, 0], size: [16, 3, 16], material: 'concrete' },

  // 5. Pasillo sin salida, apenas más ancho que el buggy.
  { id: 'lab-corridor-w', position: [CORRIDOR_X - 2.6, 1.5, 4], size: [0.6, 3, 22], material: 'wall' },
  { id: 'lab-corridor-e', position: [CORRIDOR_X + 2.6, 1.5, 4], size: [0.6, 3, 22], material: 'wall' },
  { id: 'lab-corridor-end', position: [CORRIDOR_X, 1.5, 15.3], size: [5.8, 3, 0.6], material: 'wall' },
];

export const VehicleLabTerrain = createMap({
  id: 'vehicle-lab-terrain',
  title: 'Lab 4: terreno manejable',
  description:
    'Cinco pruebas del rasterizado vehicular: losa fina, gálibo, isla inalcanzable, zona vedada y pasillo con marcha atrás.',
  objective: {
    text: 'Recorré las cinco estaciones con el buggy y mirá por dónde puede y por dónde no',
    marker: [SLAB_X, 1.2, 0],
  },
  background: 0x93a2ab,
  sun: { direction: [0.4, 0.9, 0.2], color: 0xffe6c4, intensity: 1.6 },
  playerStart: [-84, 1.2, 0],
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
  .ground({ size: [220, 90], material: 'concrete', boundary: { height: 4 } })
  .boxes(...EXHIBITS)
  // 4. La única área autorada del mapa, y es para RECORTAR. Desde que el grid
  // se deriva de la geometría, un polígono ya no dice dónde se puede manejar:
  // sólo anota o veda.
  .vehicleNavArea({
    id: 'lab-blocked-zone',
    surface: 'ground',
    blocked: true,
    polygon: [
      [BLOCKED_X - 11, 0, -11],
      [BLOCKED_X + 11, 0, -11],
      [BLOCKED_X + 11, 0, 11],
      [BLOCKED_X - 11, 0, 11],
    ],
  })
  .vehicle({
    id: 'terrain-player-buggy',
    presetId: 'buggy',
    position: [-78, 1.1, 0],
    rotation: [0, Math.PI / 2, 0],
    faction: 'resistance',
    accessPolicy: 'player',
    engineOn: false,
    portalTraversal: 'blocked',
  })
  .vehicle({
    id: 'terrain-hunter-buggy',
    presetId: 'buggy',
    position: [96, 1.1, -30],
    // Mirando a la fila de estaciones: la tripulación de un vehículo parado ve
    // por donde apunta el casco, así que de espaldas no se entera de nada.
    rotation: [0, 0, 0],
    faction: 'combine',
    accessPolicy: 'combine',
    engineOn: true,
    crew: [{ actor: 'terrain-hunter-driver', role: 'driver', seatId: 'driver' }],
    ai: { enabled: true, behavior: 'intercept' },
    portalTraversal: 'blocked',
  })
  .npc({ id: 'terrain-hunter-driver', characterId: 'combine', position: [96, 1.2, -32] })
  .pickup({ id: 'terrain-pickup-ar3', weaponId: 'ar3', position: [-82, 0.5, 4] })
  .ammo({ id: 'terrain-ammo-ar3', ammoId: 'ar3', position: [-80, 0.5, 4] })
  .build();
