import type { LevelDefinition } from "@game/levels/LevelDefinition";
import { BlobConfig } from "@game/config/blob.config";

/** Arena cerrada y despejada para validar la física y el daño por partes del blob. */
export const BlobPhysicsTestLevel: LevelDefinition = {
  id: "blob-physics-test",
  title: "Prueba de física Blob",
  description: "Arena con arsenal completo para desprender y manipular blobs individuales.",
  objective: {
    text: "Probá impactos, explosiones y manipulación física sobre el Blob",
    marker: [0, 1, -5],
  },
  background: 0x19252b,
  sun: {
    direction: [0.35, 1, 0.25],
    color: 0xe7f7ff,
    intensity: 1.75,
  },
  playerStart: [0, 1.05, 11],
  audio: {
    ambiences: ["background.wind", "background.hl2.labs.machineRing"],
    soundscape: "lab",
    footstepSounds: [
      "footsteps.hl2.concrete1",
      "footsteps.hl2.concrete2",
      "footsteps.hl2.concrete3",
      "footsteps.hl2.concrete4",
    ],
  },
  staticBoxes: [
    { id: "blob-arena-floor", position: [0, -0.5, 0], size: [30, 1, 30], material: "floor" },
    { id: "blob-arena-north", position: [0, 2, -15], size: [30, 4, 0.5], material: "wall" },
    { id: "blob-arena-south", position: [0, 2, 15], size: [30, 4, 0.5], material: "wall" },
    { id: "blob-arena-west", position: [-15, 2, 0], size: [0.5, 4, 30], material: "wall" },
    { id: "blob-arena-east", position: [15, 2, 0], size: [0.5, 4, 30], material: "wall" },
    { id: "blob-weapon-bench", position: [0, 0.18, 8.5], size: [14, 0.36, 1.2], material: "trim" },
    { id: "blob-backstop", position: [0, 1, -10], size: [8, 2, 0.6], material: "concrete" },
  ],
  dynamicBoxes: [
    { id: "blob-prop-crate-left", position: [-5, 0.6, 1], size: [1, 1, 1], mass: 2, material: "crate" },
    { id: "blob-prop-crate-right", position: [5, 0.6, 1], size: [1, 1, 1], mass: 2, material: "crate" },
    { id: "blob-prop-light", position: [-3, 0.4, 3], size: [0.65, 0.65, 0.65], mass: 0.8, material: "dynamic" },
    { id: "blob-prop-heavy", position: [3, 0.6, 3], size: [1.1, 1.1, 1.1], mass: 18, material: "dynamic" },
  ],
  doors: [],
  npcs: [
    {
      id: "blob-test-01",
      position: [0, BlobConfig.armor.aggregateRadius, -5],
      characterId: "blob",
    },
  ],
  weaponPickups: [
    { id: "blob-pickup-crowbar", weaponId: "crowbar", position: [-6, 0.65, 8.5] },
    { id: "blob-pickup-pistol", weaponId: "pistol", position: [-4, 0.65, 8.5] },
    { id: "blob-pickup-shotgun", weaponId: "shotgun", position: [-2, 0.65, 8.5] },
    { id: "blob-pickup-ice", weaponId: "iceGun", position: [0, 0.65, 8.5] },
    { id: "blob-pickup-gravity", weaponId: "gravityGun", position: [2, 0.65, 8.5] },
    { id: "blob-pickup-portal", weaponId: "portalGun", position: [3, 0.65, 8.5] },
    { id: "blob-pickup-rpg", weaponId: "rpg", position: [4, 0.65, 8.5] },
    { id: "blob-pickup-grenade-1", weaponId: "grenade", position: [5.5, 0.65, 8.5] },
    { id: "blob-pickup-grenade-2", weaponId: "grenade", position: [6.3, 0.65, 8.5] },
  ],
  ammoPickups: [
    { id: "blob-ammo-pistol", ammoId: "pistol", position: [-4, 0.35, 7] },
    { id: "blob-ammo-shotgun", ammoId: "shotgun", position: [-2, 0.35, 7] },
    { id: "blob-ammo-rpg", ammoId: "rpg", position: [4, 0.35, 7] },
    { id: "blob-ammo-grenade", ammoId: "grenade", position: [5.5, 0.35, 7] },
  ],
  triggers: [],
};
