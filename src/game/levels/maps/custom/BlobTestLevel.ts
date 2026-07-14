import type { LevelDefinition } from '@game/levels/LevelDefinition';

/**
 * Deterministic Blob V2 validation station.
 *
 * The 64 x 56 metre shell is divided into independently readable test zones:
 * a protected spawn/weapon gallery in the south, a west traversal lane, the
 * fixed pose turntable in the centre, a three-slot squeeze grate in the north,
 * and an east return maze with a dead-end fragment-withering pocket.
 */
export const BlobTestLevel: LevelDefinition = {
  id: 'blob-test',
  title: 'Estacion de pruebas Blob V2',
  description: 'Laboratorio determinista de locomocion, dano, biomasa, split/merge, poses y portales.',
  background: 0x263238,
  sun: {
    direction: [0.28, 1, 0.16],
    color: 0xe5f5ff,
    intensity: 1.35,
  },
  // The closed airlock at z=20 keeps initial simulation and prey out of spawn.
  playerStart: [0, 1, 25.2],
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
    // 64 x 56 metre station shell.
    { id: 'blob-lab-floor', position: [0, -0.2, 0], size: [64, 0.4, 56], material: 'floor' },
    { id: 'blob-lab-wall-north', position: [0, 3, -28], size: [64, 6, 0.5], material: 'wall' },
    { id: 'blob-lab-wall-south', position: [0, 3, 28], size: [64, 6, 0.5], material: 'wall' },
    { id: 'blob-lab-wall-west', position: [-32, 3, 0], size: [0.5, 6, 56], material: 'wall' },
    { id: 'blob-lab-wall-east', position: [32, 3, 0], size: [0.5, 6, 56], material: 'wall' },

    // Protected south spawn and deterministic weapon gallery.
    { id: 'blob-spawn-wall-west', position: [-15, 2, 24], size: [0.35, 4, 8], material: 'concrete' },
    { id: 'blob-spawn-wall-east', position: [15, 2, 24], size: [0.35, 4, 8], material: 'concrete' },
    { id: 'blob-spawn-wall-north-west', position: [-8.15, 2, 20], size: [13.7, 4, 0.35], material: 'concrete' },
    { id: 'blob-spawn-wall-north-east', position: [8.15, 2, 20], size: [13.7, 4, 0.35], material: 'concrete' },
    { id: 'blob-spawn-door-lintel', position: [0, 3.5, 20], size: [2.6, 1, 0.35], material: 'hazard' },
    { id: 'blob-gallery-plinth', position: [0, 0.09, 23], size: [27.5, 0.18, 2.25], material: 'trim' },
    { id: 'blob-gallery-backdrop-left', position: [-7.75, 1.35, 21.82], size: [12.5, 2.7, 0.12], material: 'metalRusted' },
    { id: 'blob-gallery-backdrop-right', position: [7.75, 1.35, 21.82], size: [12.5, 2.7, 0.12], material: 'metalRusted' },
    { id: 'blob-gallery-light-left', position: [-7.2, 3.55, 22], size: [12.2, 0.12, 0.22], material: 'lightWarm' },
    { id: 'blob-gallery-light-right', position: [7.2, 3.55, 22], size: [12.2, 0.12, 0.22], material: 'lightWarm' },
    { id: 'blob-spawn-safety-stripe', position: [0, 0.025, 19.55], size: [29.5, 0.05, 0.45], material: 'hazard' },

    // West traversal lane. The Y sizes are the canonical measured heights.
    { id: 'blob-traversal-inner-rail', position: [-18, 0.7, 0], size: [0.3, 1.4, 31], material: 'metalRusted' },
    { id: 'blob-traversal-entry-stripe', position: [-24.75, 0.025, 16], size: [13.2, 0.05, 0.5], material: 'signalBlue' },
    { id: 'blob-traversal-step-032', position: [-24.75, 0.16, 10], size: [13.2, 0.32, 1.2], material: 'concrete' },
    { id: 'blob-traversal-climb-125', position: [-24.75, 0.625, 3], size: [13.2, 1.25, 1.2], material: 'concrete' },
    { id: 'blob-traversal-blocked-150', position: [-24.75, 0.75, -4], size: [13.2, 1.5, 1.2], material: 'hazard' },
    { id: 'blob-traversal-exit-stripe', position: [-24.75, 0.025, -11], size: [13.2, 0.05, 0.5], material: 'signalBlue' },
    { id: 'blob-traversal-light-south', position: [-24.75, 4.5, 8], size: [7, 0.15, 0.35], material: 'lightWarm' },
    { id: 'blob-traversal-light-north', position: [-24.75, 4.5, -6], size: [7, 0.15, 0.35], material: 'lightWarm' },

    // Fixed central turntable: two static tiers, a hazard rim, and four fixed lamps.
    { id: 'blob-turntable-base', position: [0, 0.12, -9], size: [10, 0.24, 10], material: 'metalRusted' },
    { id: 'blob-turntable-deck', position: [0, 0.3, -9], size: [8.8, 0.12, 8.8], material: 'trim' },
    { id: 'blob-turntable-rim-north', position: [0, 0.4, -13.5], size: [10, 0.18, 0.22], material: 'hazard' },
    { id: 'blob-turntable-rim-south', position: [0, 0.4, -4.5], size: [10, 0.18, 0.22], material: 'hazard' },
    { id: 'blob-turntable-rim-west', position: [-4.5, 0.4, -9], size: [0.22, 0.18, 8.8], material: 'hazard' },
    { id: 'blob-turntable-rim-east', position: [4.5, 0.4, -9], size: [0.22, 0.18, 8.8], material: 'hazard' },
    { id: 'blob-turntable-lamp-post-west', position: [-7, 2.25, -9], size: [0.22, 4.5, 0.22], material: 'metalRusted' },
    { id: 'blob-turntable-lamp-post-east', position: [7, 2.25, -9], size: [0.22, 4.5, 0.22], material: 'metalRusted' },
    { id: 'blob-turntable-lamp-west', position: [-5.7, 4.45, -9], size: [2.5, 0.18, 0.55], material: 'lightWarm' },
    { id: 'blob-turntable-lamp-east', position: [5.7, 4.45, -9], size: [2.5, 0.18, 0.55], material: 'lightWarm' },

    // North quarantine bulkhead. Only the three measured grate slots permit Blob flow.
    { id: 'blob-quarantine-bulkhead-west', position: [-19, 3, -18], size: [26, 6, 0.4], material: 'wall' },
    { id: 'blob-quarantine-bulkhead-east', position: [19, 3, -18], size: [26, 6, 0.4], material: 'wall' },
    {
      id: 'blob-flow-grate',
      position: [0, 1.75, -18],
      size: [12, 3.5, 0.24],
      material: 'trim',
      blobPermeable: true,
      blobFlow: {
        openings: [
          { offset: -3.2, width: 0.72, base: 0.12, height: 2.55 },
          { offset: 0, width: 0.72, base: 0.12, height: 2.55 },
          { offset: 3.2, width: 0.72, base: 0.12, height: 2.55 },
        ],
        brainCrossFraction: 0.6,
      },
    },
    { id: 'blob-grate-header', position: [0, 4.75, -18], size: [12.4, 2.5, 0.5], material: 'hazard' },
    { id: 'blob-quarantine-light-west', position: [-8, 4.65, -23], size: [5, 0.14, 0.45], material: 'lightWarm' },
    { id: 'blob-quarantine-light-east', position: [8, 4.65, -23], size: [5, 0.14, 0.45], material: 'lightWarm' },

    // Portal calibration panels are large, continuous static surfaces.
    { id: 'blob-portal-panel-a', position: [12.5, 2.4, 4], size: [0.4, 4.8, 7], material: 'concrete' },
    { id: 'blob-portal-panel-a-frame', position: [12.25, 4.9, 4], size: [0.18, 0.25, 7.4], material: 'signalBlue' },
    { id: 'blob-portal-panel-b', position: [8.5, 2.4, 11.5], size: [7, 4.8, 0.4], material: 'concrete' },
    { id: 'blob-portal-panel-b-frame', position: [8.5, 4.9, 11.25], size: [7.4, 0.25, 0.18], material: 'signalRed' },
    { id: 'blob-portal-floor-panel', position: [4, 0.04, 13.5], size: [6, 0.08, 5], material: 'concrete' },

    // East return maze: alternating baffles force four turns back toward the stage.
    { id: 'blob-maze-inner-rail-south', position: [18, 1.3, 12], size: [0.3, 2.6, 10], material: 'metalRusted' },
    { id: 'blob-maze-inner-rail-north', position: [18, 1.3, -9], size: [0.3, 2.6, 12], material: 'metalRusted' },
    { id: 'blob-maze-baffle-south', position: [22, 1.3, 12], size: [8, 2.6, 0.35], material: 'wall' },
    { id: 'blob-maze-baffle-mid-south', position: [27, 1.3, 6], size: [8, 2.6, 0.35], material: 'wall' },
    { id: 'blob-maze-baffle-mid-north', position: [22, 1.3, 0], size: [8, 2.6, 0.35], material: 'wall' },
    { id: 'blob-maze-baffle-north', position: [27, 1.3, -6], size: [8, 2.6, 0.35], material: 'wall' },
    { id: 'blob-maze-route-light-south', position: [26, 4.35, 9], size: [6, 0.14, 0.4], material: 'lightWarm' },
    { id: 'blob-maze-route-light-north', position: [22, 4.35, -3], size: [6, 0.14, 0.4], material: 'lightWarm' },

    // A three-sided dead end isolates detached fragments long enough to wither.
    { id: 'blob-wither-pocket-west', position: [23, 1.5, -13], size: [0.35, 3, 7], material: 'metalRusted' },
    { id: 'blob-wither-pocket-east', position: [30, 1.5, -13], size: [0.35, 3, 7], material: 'metalRusted' },
    { id: 'blob-wither-pocket-back', position: [26.5, 1.5, -16.5], size: [7.35, 3, 0.35], material: 'signalRed' },
    { id: 'blob-wither-pocket-threshold', position: [26.5, 0.025, -9.5], size: [7, 0.05, 0.45], material: 'hazard' },
  ],
  buildings: [],
  dynamicBoxes: [
    {
      id: 'blob-biomass-calibration-crate',
      position: [-10, 0.5, -23],
      size: [1, 1, 1],
      mass: 8,
      material: 'crate',
      blobConsumable: { consumeSeconds: 2, biomass: 4 },
    },
    {
      id: 'blob-nonconsumable-control-crate',
      position: [16, 0.5, -23],
      size: [1, 1, 1],
      mass: 8,
      material: 'dynamic',
    },
  ],
  doors: [
    {
      id: 'blob-spawn-airlock-door',
      position: [0, 1.5, 20],
      size: [2.6, 3, 0.32],
      openOffset: [3, 0, 0],
      speed: 2,
      material: 'door',
      button: {
        id: 'blob-spawn-airlock-button',
        label: 'Abrir esclusa de pruebas',
        position: [1.75, 1.1, 20.22],
        size: [0.35, 0.55, 0.16],
      },
    },
  ],
  npcs: [
    {
      id: 'blob-lab-subject',
      name: 'blob-lab-subject',
      characterId: 'blob',
      position: [0, 1, -9],
      patrol: [[0, 0.5, 8]],
      blobPoses: [
        { id: 'ball', kind: 'sphere', marker: 'blob-pose-center', radius: 2, duration: 0.8 },
        { id: 'column', kind: 'column', marker: 'blob-pose-center', height: 5, radius: 1.1, duration: 1 },
        { id: 'tentacle', kind: 'tendril', marker: 'blob-pose-center', targetMarker: 'blob-pose-target', radius: 0.65, duration: 1 },
        { id: 'bridge', kind: 'bridge', marker: 'blob-pose-center', targetMarker: 'blob-pose-target', width: 1.2, duration: 1.2 },
        { id: 'wall', kind: 'wall', marker: 'blob-wall-a', targetMarker: 'blob-wall-b', height: 3.2, depth: 0.65, duration: 1.2 },
      ],
    },
    // CharacterPresets owns prey biomass: headcrab=4, zombie=12.
    { id: 'blob-prey-headcrab', characterId: 'headcrab', position: [-4, 0.5, -23] },
    { id: 'blob-prey-zombie', characterId: 'zombie', position: [4, 1, -23] },
    // floorTurret deliberately has no blobPrey metadata: this is the negative control.
    { id: 'blob-prey-control-turret', characterId: 'floorTurret', position: [11, 0.6, -23], rotation: [0, Math.PI, 0] },
  ],
  logicEntities: [
    { kind: 'marker', id: 'blob-pose-center', name: 'blob-pose-center', position: [0, 1, -9] },
    { kind: 'marker', id: 'blob-pose-target', name: 'blob-pose-target', position: [0, 3, 8] },
    { kind: 'marker', id: 'blob-wall-a', name: 'blob-wall-a', position: [-6, 0.5, 7] },
    { kind: 'marker', id: 'blob-wall-b', name: 'blob-wall-b', position: [6, 0.5, 7] },
  ],
  weaponPickups: [
    { id: 'blob-gallery-pistol', weaponId: 'pistol', position: [-12, 0.62, 23] },
    { id: 'blob-gallery-revolver', weaponId: 'revolver', position: [-9, 0.62, 23] },
    { id: 'blob-test-smg', weaponId: 'smg', position: [-6, 0.62, 23] },
    { id: 'blob-test-shotgun', weaponId: 'shotgun', position: [-3, 0.62, 23] },
    { id: 'blob-gallery-crossbow', weaponId: 'crossbow', position: [0, 0.62, 23] },
    { id: 'blob-test-grenade', weaponId: 'grenade', position: [3, 0.62, 23] },
    { id: 'blob-gallery-rpg', weaponId: 'rpg', position: [6, 0.62, 23] },
    { id: 'blob-gallery-ice-gun', weaponId: 'iceGun', position: [9, 0.62, 23] },
    { id: 'blob-test-portal', weaponId: 'portalGun', position: [12, 0.62, 23] },
  ],
  triggers: [],
};
