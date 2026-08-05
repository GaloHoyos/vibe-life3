import { createMap } from '@game/levels/builders/MapCreator';
import type { VehicleDefinition } from '@game/levels/LevelDefinition';
import { coverWall, crateStack } from '@game/levels/builders/PropBuilder';

/**
 * Laboratorio 1 — ¿le conviene el vehículo o me sigue a pie?
 *
 * Una recta larga y despejada, y nada más. La pregunta que responde es la del
 * `NpcVehicleSensor`: un Combine que te ve pasar a toda velocidad calcula que a
 * pie no te alcanza nunca y sale a buscar el buggy que tiene al lado.
 *
 * Los tres puestos están calibrados para mostrar las tres respuestas posibles:
 * los dos primeros consiguen vehículo, el tercero se lo queda mirando porque el
 * `VehicleCrewDirector` sólo deja dos vehículos oportunistas por facción. El
 * cuarto puesto es el control: ahí el buggy es de la resistencia y ningún
 * Combine puede tocarlo.
 *
 * Cómo leerlo: arrancá el buggy del jugador y recorré la recta sin frenar.
 */

const HALF_LENGTH = 150;
const HALF_WIDTH = 26;

interface Post {
  readonly id: string;
  readonly x: number;
  /** `null` = el puesto no tiene vehículo propio (control a pie). */
  readonly vehicle: 'combine' | 'resistance' | null;
  readonly note: string;
}

/**
 * Los puestos van en orden de recorrido. El orden importa: el cupo por facción
 * se reparte por orden de llegada, así que el tercero es el que queda a pie.
 */
const POSTS: readonly Post[] = [
  { id: 'a', x: -40, vehicle: 'combine', note: 'primero en pedir: consigue buggy' },
  { id: 'b', x: 20, vehicle: 'combine', note: 'segundo: consigue el último cupo' },
  { id: 'c', x: 78, vehicle: 'combine', note: 'tercero: cupo agotado, sale a pie' },
  { id: 'd', x: 126, vehicle: 'resistance', note: 'control: buggy de otra facción' },
];

function postVehicle(post: Post): VehicleDefinition | null {
  if (!post.vehicle) return null;
  return {
    id: `chase-buggy-${post.id}`,
    presetId: 'buggy',
    position: [post.x - 7, 1.1, -7],
    rotation: [0, Math.PI / 2, 0],
    faction: post.vehicle,
    accessPolicy: post.vehicle,
    engineOn: false,
    portalTraversal: 'blocked',
  };
}

const map = createMap({
  id: 'vehicle-lab-chase',
  title: 'Lab 1: persecución y embarque',
  description:
    'Recta despejada con puestos Combine y buggies abandonados. Prueba la decisión de subirse a un vehículo y el cupo por facción.',
  objective: {
    text: 'Recorré la recta sin frenar y mirá cuáles te persiguen en vehículo',
    marker: [HALF_LENGTH - 20, 1.2, 0],
  },
  background: 0x9aaab4,
  sun: { direction: [0.35, 0.9, 0.25], color: 0xffe3ba, intensity: 1.65 },
  playerStart: [-HALF_LENGTH + 14, 1.2, 6],
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
  .ground({
    size: [HALF_LENGTH * 2, HALF_WIDTH * 2],
    material: 'concrete',
    boundary: { height: 4 },
  })
  // El buggy del jugador, en la línea de largada.
  .vehicle({
    id: 'chase-player-buggy',
    presetId: 'buggy',
    position: [-HALF_LENGTH + 20, 1.1, 0],
    rotation: [0, Math.PI / 2, 0],
    faction: 'resistance',
    accessPolicy: 'player',
    engineOn: false,
    portalTraversal: 'blocked',
  })
  .pickup({ id: 'chase-pickup-ar3', weaponId: 'ar3', position: [-HALF_LENGTH + 16, 0.5, 4] })
  .ammo({ id: 'chase-ammo-ar3', ammoId: 'ar3', position: [-HALF_LENGTH + 16, 0.5, 6] });

for (const post of POSTS) {
  const vehicle = postVehicle(post);
  if (vehicle) map.vehicle(vehicle);
  // Dos por puesto: uno se sienta a los mandos y el otro a la torreta, que es
  // el reparto que hace el registro de oportunidad al ordenar por rol.
  map
    .npc({ id: `chase-${post.id}-1`, characterId: 'combine', position: [post.x, 1.2, -3] })
    .npc({ id: `chase-${post.id}-2`, characterId: 'combineElite', position: [post.x + 3, 1.2, -3] })
    // Un poco de cobertura para que el puesto se lea como puesto y no como dos
    // soldados sueltos en una explanada.
    .prop(
      coverWall({ id: `chase-${post.id}-wall`, at: [post.x + 1, 4], axis: 'x', length: 6 }),
      crateStack({ id: `chase-${post.id}-crates`, at: [post.x - 4, 5], layers: 2 }),
    );
}

export const VehicleLabChase = map.build();
