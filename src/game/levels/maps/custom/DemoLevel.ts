import type { LevelDefinition } from '@game/levels/LevelDefinition';

export const DemoLevel: LevelDefinition = {
  id: 'demo',
  title: 'Instalacion de Pruebas',
  description: 'Sector de entrenamiento Black Mesa Norte. Movimiento, interaccion y armamento basico.',
  background: 0x071019,
  playerStart: [0, 1.05, 8],
  audio: {
    ambiences: ['background.wind'],
    footstepSounds: [
      'footsteps.snow1',
      'footsteps.snow2',
      'footsteps.snow3',
      'footsteps.snow4',
    ],
  },
  staticBoxes: [
    { id: 'floor-main', position: [0, -0.5, 0], size: [28, 1, 34], material: 'floor' },
    { id: 'ceiling-main', position: [0, 4.2, 0], size: [28, 0.4, 34], material: 'wall' },
    { id: 'wall-north', position: [0, 1.8, -17], size: [28, 4.6, 0.6], material: 'wall' },
    { id: 'wall-south', position: [0, 1.8, 17], size: [28, 4.6, 0.6], material: 'wall' },
    { id: 'wall-west', position: [-14, 1.8, 0], size: [0.6, 4.6, 34], material: 'wall' },
    { id: 'wall-east', position: [14, 1.8, 0], size: [0.6, 4.6, 34], material: 'wall' },
    { id: 'lab-left', position: [-6.2, 1.2, -3], size: [0.5, 2.4, 17], material: 'wall' },
    { id: 'lab-right', position: [6.2, 1.2, -3], size: [0.5, 2.4, 17], material: 'wall' },
    { id: 'entry-console', position: [-3.5, 0.45, 5.4], size: [3.2, 0.9, 1], material: 'trim' },
    { id: 'server-bank-a', position: [10.5, 1.1, 3.5], size: [2.2, 2.2, 5.5], material: 'trim' },
    { id: 'server-bank-b', position: [-10.5, 1.1, -8], size: [2.2, 2.2, 5.5], material: 'trim' },
    { id: 'crate-stack-a', position: [4.2, 0.6, 7], size: [1.3, 1.2, 1.3], material: 'crate' },
    { id: 'crate-stack-b', position: [5.8, 0.45, 6.6], size: [1.1, 0.9, 1.1], material: 'crate' },
    { id: 'hazard-barrier', position: [0, 0.35, -12.8], size: [5.2, 0.7, 0.35], material: 'hazard' },
  ],
  dynamicBoxes: [
    { id: 'physics-cube-a', position: [-2.4, 1.1, 1.6], size: [0.9, 0.9, 0.9], mass: 1.2, material: 'dynamic' },
    { id: 'physics-cube-b', position: [2.1, 1.1, 2.1], size: [0.8, 0.8, 0.8], mass: 1, material: 'dynamic' },
    { id: 'physics-cube-c', position: [8.8, 1.4, -3.2], size: [1.1, 1.1, 1.1], mass: 1.8, material: 'dynamic' },
  ],
  doors: [
    {
      id: 'lab-door-a',
      position: [0, 1.15, -5.8],
      size: [3.4, 2.3, 0.45],
      openOffset: [0, 2.8, 0],
      speed: 3.2,
      material: 'door',
      button: {
        id: 'lab-door-a-button',
        label: 'Alternar puerta',
        position: [-2.7, 1.2, -4.8],
        size: [0.32, 0.32, 0.12],
      },
    },
  ],
  npcs: [
    { id: 'npc-zombie-01', position: [4.6, 0.95, 1.5], characterId: 'zombie' },
  ],
  weaponPickups: [
    { id: 'pickup-crowbar', weaponId: 'crowbar', position: [-4.8, 0.35, 8.4] },
    { id: 'pickup-pistol', weaponId: 'pistol', position: [-2.8, 0.35, 8.3] },
    { id: 'pickup-smg', weaponId: 'smg', position: [-0.8, 0.35, 8.2] },
    { id: 'pickup-ar3', weaponId: 'ar3', position: [1.2, 0.35, 8.2] },
    { id: 'pickup-gravity-gun', weaponId: 'gravityGun', position: [3.4, 0.35, 8.4] },
    { id: 'pickup-shotgun', weaponId: 'shotgun', position: [5.4, 0.35, 8.4] },
    { id: 'pickup-grenade-1', weaponId: 'grenade', position: [7.2, 0.35, 8.4] },
    { id: 'pickup-grenade-2', weaponId: 'grenade', position: [7.7, 0.35, 8.4] },
    { id: 'pickup-grenade-3', weaponId: 'grenade', position: [8.2, 0.35, 8.4] },
  ],
  triggers: [
    {
      id: 'intro-trigger',
      position: [0, 1, 6.5],
      size: [5, 2, 3],
      once: true,
      dialogue: {
        speaker: 'Sistema',
        text: 'Modulo de entrenamiento activo. Prueba movimiento, interaccion y arma.',
        duration: 4,
      },
    },
  ],
  checkpoints: [
    {
      id: 'checkpoint-lab-entry',
      position: [0, 1.2, 3.5],
      size: [11, 3, 2],
      respawn: [0, 1.2, 6],
    },
    {
      id: 'checkpoint-lab-deep',
      position: [0, 1.2, -8],
      size: [11, 3, 2],
      respawn: [0, 1.2, -6],
    },
  ],
  explosiveBarrels: [
    { id: 'barrel-1', position: [3.6, 0, 0.4] },
    { id: 'barrel-2', position: [4.5, 0, -0.3] },
    { id: 'barrel-3', position: [-3.2, 0, -2.4] },
  ],
  hazardVolumes: [
    { id: 'toxic-pool', position: [0, 0.8, -14.5], size: [6, 1.6, 3], kind: 'toxic', damagePerSecond: 18 },
  ],
};
