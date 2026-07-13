import type { LevelDefinition } from '@game/levels/LevelDefinition';

/** Galería compacta para validar el organismo Blob y sus poses coreografiadas. */
export const BlobTestLevel: LevelDefinition = {
  id: 'blob-test',
  title: 'Laboratorio Blob EP3',
  description: 'Reja permeable, colisiones, absorción, split/merge, poses y portales.',
  background: 0x50605c,
  sun: {
    direction: [0.35, 1, 0.2],
    color: 0xe3fff4,
    intensity: 1.45,
  },
  // Spawn inside the organism bay so the browser visual smoke test sees the
  // surface immediately; the grate/obstacle course remains behind the player.
  playerStart: [0, 1, -5],
  audio: {
    ambiences: ['background.hl2.atmosphere.cityRumble'],
    soundscape: 'lab',
    footstepSounds: [
      'footsteps.hl2.concrete1',
      'footsteps.hl2.concrete2',
      'footsteps.hl2.concrete3',
      'footsteps.hl2.concrete4',
    ],
  },
  staticBoxes: [
    { id: 'blob-lab-floor', position: [0, -0.2, 0], size: [36, 0.4, 32], material: 'floor' },
    { id: 'blob-lab-north', position: [0, 2, -16], size: [36, 4, 0.5], material: 'wall' },
    { id: 'blob-lab-south', position: [0, 2, 16], size: [36, 4, 0.5], material: 'wall' },
    { id: 'blob-lab-west', position: [-18, 2, 0], size: [0.5, 4, 32], material: 'wall' },
    { id: 'blob-lab-east', position: [18, 2, 0], size: [0.5, 4, 32], material: 'wall' },
    { id: 'blob-high-wall', position: [-9, 1.5, -3], size: [7, 3, 0.55], material: 'brick' },
    { id: 'blob-low-step', position: [-9, 0.3, 5], size: [7, 0.6, 1.4], material: 'concrete' },
    {
      id: 'blob-flow-grate',
      position: [0, 1.5, -2],
      size: [8, 3, 0.18],
      material: 'trim',
      blobPermeable: true,
    },
    { id: 'blob-portal-wall-a', position: [12, 2, -6], size: [0.5, 4, 9], material: 'wall' },
    { id: 'blob-portal-wall-b', position: [12, 2, 8], size: [0.5, 4, 9], material: 'wall' },
  ],
  buildings: [],
  dynamicBoxes: [
    {
      id: 'blob-food-crate',
      position: [6, 0.5, -7],
      size: [1, 1, 1],
      mass: 8,
      material: 'crate',
      blobConsumable: { consumeSeconds: 2, biomass: 4 },
    },
    {
      id: 'blob-push-crate',
      position: [9, 0.5, -7],
      size: [1, 1, 1],
      mass: 8,
      material: 'crate',
    },
  ],
  doors: [],
  npcs: [
    {
      id: 'blob-lab-subject',
      name: 'blob-lab-subject',
      characterId: 'blob',
      position: [0, 1, -11],
      patrol: [[0, 0.5, 10]],
      blobPoses: [
        { id: 'ball', kind: 'sphere', marker: 'blob-pose-center', radius: 2, duration: 0.8 },
        { id: 'column', kind: 'column', marker: 'blob-pose-center', height: 5, radius: 1.1, duration: 1 },
        { id: 'tentacle', kind: 'tendril', marker: 'blob-pose-center', targetMarker: 'blob-pose-target', radius: 0.65, duration: 1 },
        { id: 'bridge', kind: 'bridge', marker: 'blob-pose-center', targetMarker: 'blob-pose-target', width: 1.2, duration: 1.2 },
        { id: 'wall', kind: 'wall', marker: 'blob-wall-a', targetMarker: 'blob-wall-b', height: 3.2, depth: 0.65, duration: 1.2 },
      ],
    },
    { id: 'blob-food-zombie', characterId: 'zombie', position: [-5, 1, -9] },
    { id: 'blob-food-headcrab', characterId: 'headcrab', position: [5, 0.5, -9] },
  ],
  logicEntities: [
    { kind: 'marker', id: 'blob-pose-center', name: 'blob-pose-center', position: [0, 1, -8] },
    { kind: 'marker', id: 'blob-pose-target', name: 'blob-pose-target', position: [0, 3, 5] },
    { kind: 'marker', id: 'blob-wall-a', name: 'blob-wall-a', position: [-6, 0.5, 7] },
    { kind: 'marker', id: 'blob-wall-b', name: 'blob-wall-b', position: [6, 0.5, 7] },
  ],
  weaponPickups: [
    // Arma inmediata para el smoke test Playwright de impactos sobre la piel.
    { id: 'blob-test-smg', weaponId: 'smg', position: [0, 0.6, -5] },
    { id: 'blob-test-shotgun', weaponId: 'shotgun', position: [-3, 0.6, 12] },
    { id: 'blob-test-grenade', weaponId: 'grenade', position: [0, 0.6, 12] },
    { id: 'blob-test-portal', weaponId: 'portalGun', position: [3, 0.6, 12] },
  ],
  triggers: [],
};
