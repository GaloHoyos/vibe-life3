import { AMMO_ORDER } from "@game/config/ammo.config";
import { WEAPON_ORDER } from "@game/config/weapons.config";
import type {
  AmmoPickupDefinition,
  LevelDefinition,
  StaticBoxDefinition,
  WeaponPickupDefinition,
} from "@game/levels/LevelDefinition";

const WeaponSpacing = 1.75;
const AmmoSpacing = 1.55;

const weaponPickups: WeaponPickupDefinition[] = WEAPON_ORDER.map((weaponId, index) => ({
  id: `scale-weapon-${weaponId}`,
  weaponId,
  position: [rowX(index, WEAPON_ORDER.length, WeaponSpacing), 0.35, 5.2],
}));

const ammoPickups: AmmoPickupDefinition[] = AMMO_ORDER.map((ammoId, index) => ({
  id: `scale-ammo-${ammoId}`,
  ammoId,
  position: [rowX(index, AMMO_ORDER.length, AmmoSpacing), 0.35, 3.3],
}));

const referenceBoxes: StaticBoxDefinition[] = [
  { id: "ref-025m", position: [-1.75, 0.125, 0.7], size: [0.25, 0.25, 0.25], material: "dynamic" },
  { id: "ref-050m", position: [0, 0.25, 0.7], size: [0.5, 0.5, 0.5], material: "dynamic" },
  { id: "ref-100m", position: [2.0, 0.5, 0.7], size: [1, 1, 1], material: "dynamic" },
];

export const WeaponScaleTestLevel: LevelDefinition = {
  id: "weapon-scale-test",
  title: "Weapon Scale Test",
  description: "Mapa custom para calibrar worldmodels, viewmodels y municion.",
  objective: {
    text: "Calibrar armas y municion",
    marker: [0, 1.0, 5.2],
  },
  background: 0x9da4a8,
  sun: {
    direction: [0.25, 0.9, 0.35],
    color: 0xffffff,
    intensity: 1.8,
  },
  playerStart: [0, 1.05, 9.5],
  audio: {
    ambiences: ["background.wind", "background.hl2.labs.machineRing"],
    footstepSounds: [
      "footsteps.hl2.concrete1",
      "footsteps.hl2.concrete2",
      "footsteps.hl2.concrete3",
      "footsteps.hl2.concrete4",
    ],
  },
  staticBoxes: [
    { id: "scale-room-floor", position: [0, -0.5, 2.5], size: [24, 1, 18], material: "floor" },
    { id: "scale-room-back", position: [0, 1.55, -6.5], size: [24, 3.1, 0.4], material: "wall" },
    { id: "scale-room-left", position: [-12, 1.55, 2.5], size: [0.4, 3.1, 18], material: "wall" },
    { id: "scale-room-right", position: [12, 1.55, 2.5], size: [0.4, 3.1, 18], material: "wall" },
    { id: "scale-room-front-lip", position: [0, 0.3, 11.5], size: [24, 0.6, 0.35], material: "trim" },
    { id: "scale-row-weapons", position: [0, 0.02, 5.2], size: [21, 0.04, 0.08], material: "trim" },
    { id: "scale-row-ammo", position: [0, 0.02, 3.3], size: [18, 0.04, 0.08], material: "trim" },
    { id: "scale-row-reference", position: [0, 0.02, 0.7], size: [8, 0.04, 0.08], material: "trim" },
    ...referenceBoxes,
  ],
  dynamicBoxes: [],
  doors: [],
  npcs: [],
  weaponPickups,
  ammoPickups,
  triggers: [],
};

function rowX(index: number, count: number, spacing: number): number {
  return (index - (count - 1) / 2) * spacing;
}
