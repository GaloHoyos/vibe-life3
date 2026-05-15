import type { AudioBusName } from "./AudioSystem";

export type AudioCategory =
  | "background"
  | "music"
  | "weapons"
  | "enemies"
  | "footsteps"
  | "dialogue"
  | "ui"
  | "sfx";

export interface AudioClipDefinition {
  id: string;
  path: string;
  loop: boolean;
  volume: number;
  bus: AudioBusName;
  category: AudioCategory;
}

const backgroundWind = new URL(
  "../assets/sounds/background/wind.mp3",
  import.meta.url,
).href;

const footstepConcrete1 = new URL(
  "../assets/sounds/footsteps/concrete/concrete1.mp3",
  import.meta.url,
).href;
const footstepSnow1 = new URL(
  "../assets/sounds/footsteps/snow/snow1.mp3",
  import.meta.url,
).href;
const footstepSnow2 = new URL(
  "../assets/sounds/footsteps/snow/snow2.mp3",
  import.meta.url,
).href;
const footstepSnow3 = new URL(
  "../assets/sounds/footsteps/snow/snow3.mp3",
  import.meta.url,
).href;
const footstepSnow4 = new URL(
  "../assets/sounds/footsteps/snow/snow4.mp3",
  import.meta.url,
).href;

const pistolShot = new URL(
  "../assets/sounds/weapons/pistol/shot.mp3",
  import.meta.url,
).href;
const pistolReload = new URL(
  "../assets/sounds/weapons/pistol/reload.mp3",
  import.meta.url,
).href;
const pistolEmpty = new URL(
  "../assets/sounds/weapons/pistol/empty.mp3",
  import.meta.url,
).href;

const smgShot = new URL(
  "../assets/sounds/weapons/smg/shot.mp3",
  import.meta.url,
).href;
const smgReload = new URL(
  "../assets/sounds/weapons/smg/reload.mp3",
  import.meta.url,
).href;
const smgEmpty = new URL(
  "../assets/sounds/weapons/smg/empty.mp3",
  import.meta.url,
).href;

const ar3Shot = new URL(
  "../assets/sounds/weapons/ar3/shot.mp3",
  import.meta.url,
).href;
const ar3Reload = new URL(
  "../assets/sounds/weapons/ar3/reload.mp3",
  import.meta.url,
).href;
const ar3Empty = new URL(
  "../assets/sounds/weapons/ar3/empty.mp3",
  import.meta.url,
).href;

const crowbarSwing = new URL(
  "../assets/sounds/weapons/crowbar/swing.mp3",
  import.meta.url,
).href;
const crowbarHitFlesh = new URL(
  "../assets/sounds/weapons/crowbar/hitFlesh.mp3",
  import.meta.url,
).href;
const weaponPickup = new URL(
  "../assets/sounds/weapons/pickup.mp3",
  import.meta.url,
).href;

const zombieAlert = new URL(
  "../assets/sounds/npcs/zombie/alert.mp3",
  import.meta.url,
).href;
const zombieAttack = new URL(
  "../assets/sounds/npcs/zombie/attack.mp3",
  import.meta.url,
).href;
const zombieDamaged = new URL(
  "../assets/sounds/npcs/zombie/damaged.mp3",
  import.meta.url,
).href;

export const AudioManifest = {
  background: {
    wind: {
      path: backgroundWind,
      loop: true,
      volume: 0.45,
      bus: "ambience" as const,
    },
  },
  music: {},
  weapons: {
    pistol: {
      shot: {
        path: pistolShot,
        loop: false,
        volume: 0.85,
        bus: "weapons" as const,
      },
      reload: {
        path: pistolReload,
        loop: false,
        volume: 0.7,
        bus: "weapons" as const,
      },
      empty: {
        path: pistolEmpty,
        loop: false,
        volume: 0.6,
        bus: "weapons" as const,
      },
    },
    smg: {
      shot: {
        path: smgShot,
        loop: false,
        volume: 0.75,
        bus: "weapons" as const,
      },
      reload: {
        path: smgReload,
        loop: false,
        volume: 0.7,
        bus: "weapons" as const,
      },
      empty: {
        path: smgEmpty,
        loop: false,
        volume: 0.6,
        bus: "weapons" as const,
      },
    },
    ar3: {
      shot: {
        path: ar3Shot,
        loop: false,
        volume: 0.8,
        bus: "weapons" as const,
      },
      reload: {
        path: ar3Reload,
        loop: false,
        volume: 0.7,
        bus: "weapons" as const,
      },
      empty: {
        path: ar3Empty,
        loop: false,
        volume: 0.6,
        bus: "weapons" as const,
      },
    },
    crowbar: {
      swing: {
        path: crowbarSwing,
        loop: false,
        volume: 0.55,
        bus: "weapons" as const,
      },
      hitFlesh: {
        path: crowbarHitFlesh,
        loop: false,
        volume: 0.7,
        bus: "weapons" as const,
      },
    },
    pickup: {
      path: weaponPickup,
      loop: false,
      volume: 0.7,
      bus: "sfx" as const,
    },
  },
  enemies: {
    zombie: {
      alert: {
        path: zombieAlert,
        loop: false,
        volume: 0.8,
        bus: "enemies" as const,
      },
      attack: {
        path: zombieAttack,
        loop: false,
        volume: 0.85,
        bus: "enemies" as const,
      },
      damaged: {
        path: zombieDamaged,
        loop: false,
        volume: 0.8,
        bus: "enemies" as const,
      },
    },
  },
  footsteps: {
    concrete1: {
      path: footstepConcrete1,
      loop: false,
      volume: 0.55,
      bus: "footsteps" as const,
    },
    snow1: {
      path: footstepSnow1,
      loop: false,
      volume: 0.55,
      bus: "footsteps" as const,
    },
    snow2: {
      path: footstepSnow2,
      loop: false,
      volume: 0.55,
      bus: "footsteps" as const,
    },
    snow3: {
      path: footstepSnow3,
      loop: false,
      volume: 0.55,
      bus: "footsteps" as const,
    },
    snow4: {
      path: footstepSnow4,
      loop: false,
      volume: 0.55,
      bus: "footsteps" as const,
    },
  },
  dialogue: {},
  ui: {},
  sfx: {},
} as const;

export const AudioClipCatalog: Record<string, AudioClipDefinition> = {
  "background.wind": {
    id: "background.wind",
    path: AudioManifest.background.wind.path,
    loop: AudioManifest.background.wind.loop,
    volume: AudioManifest.background.wind.volume,
    bus: AudioManifest.background.wind.bus,
    category: "background",
  },
  "footsteps.concrete1": {
    id: "footsteps.concrete1",
    path: AudioManifest.footsteps.concrete1.path,
    loop: AudioManifest.footsteps.concrete1.loop,
    volume: AudioManifest.footsteps.concrete1.volume,
    bus: AudioManifest.footsteps.concrete1.bus,
    category: "footsteps",
  },
  "footsteps.snow1": {
    id: "footsteps.snow1",
    path: AudioManifest.footsteps.snow1.path,
    loop: AudioManifest.footsteps.snow1.loop,
    volume: AudioManifest.footsteps.snow1.volume,
    bus: AudioManifest.footsteps.snow1.bus,
    category: "footsteps",
  },
  "footsteps.snow2": {
    id: "footsteps.snow2",
    path: AudioManifest.footsteps.snow2.path,
    loop: AudioManifest.footsteps.snow2.loop,
    volume: AudioManifest.footsteps.snow2.volume,
    bus: AudioManifest.footsteps.snow2.bus,
    category: "footsteps",
  },
  "footsteps.snow3": {
    id: "footsteps.snow3",
    path: AudioManifest.footsteps.snow3.path,
    loop: AudioManifest.footsteps.snow3.loop,
    volume: AudioManifest.footsteps.snow3.volume,
    bus: AudioManifest.footsteps.snow3.bus,
    category: "footsteps",
  },
  "footsteps.snow4": {
    id: "footsteps.snow4",
    path: AudioManifest.footsteps.snow4.path,
    loop: AudioManifest.footsteps.snow4.loop,
    volume: AudioManifest.footsteps.snow4.volume,
    bus: AudioManifest.footsteps.snow4.bus,
    category: "footsteps",
  },
  "weapons.pistol.shot": {
    id: "weapons.pistol.shot",
    path: AudioManifest.weapons.pistol.shot.path,
    loop: AudioManifest.weapons.pistol.shot.loop,
    volume: AudioManifest.weapons.pistol.shot.volume,
    bus: AudioManifest.weapons.pistol.shot.bus,
    category: "weapons",
  },
  "weapons.pistol.reload": {
    id: "weapons.pistol.reload",
    path: AudioManifest.weapons.pistol.reload.path,
    loop: AudioManifest.weapons.pistol.reload.loop,
    volume: AudioManifest.weapons.pistol.reload.volume,
    bus: AudioManifest.weapons.pistol.reload.bus,
    category: "weapons",
  },
  "weapons.pistol.empty": {
    id: "weapons.pistol.empty",
    path: AudioManifest.weapons.pistol.empty.path,
    loop: AudioManifest.weapons.pistol.empty.loop,
    volume: AudioManifest.weapons.pistol.empty.volume,
    bus: AudioManifest.weapons.pistol.empty.bus,
    category: "weapons",
  },
  "weapons.smg.shot": {
    id: "weapons.smg.shot",
    path: AudioManifest.weapons.smg.shot.path,
    loop: AudioManifest.weapons.smg.shot.loop,
    volume: AudioManifest.weapons.smg.shot.volume,
    bus: AudioManifest.weapons.smg.shot.bus,
    category: "weapons",
  },
  "weapons.smg.reload": {
    id: "weapons.smg.reload",
    path: AudioManifest.weapons.smg.reload.path,
    loop: AudioManifest.weapons.smg.reload.loop,
    volume: AudioManifest.weapons.smg.reload.volume,
    bus: AudioManifest.weapons.smg.reload.bus,
    category: "weapons",
  },
  "weapons.smg.empty": {
    id: "weapons.smg.empty",
    path: AudioManifest.weapons.smg.empty.path,
    loop: AudioManifest.weapons.smg.empty.loop,
    volume: AudioManifest.weapons.smg.empty.volume,
    bus: AudioManifest.weapons.smg.empty.bus,
    category: "weapons",
  },
  "weapons.ar3.shot": {
    id: "weapons.ar3.shot",
    path: AudioManifest.weapons.ar3.shot.path,
    loop: AudioManifest.weapons.ar3.shot.loop,
    volume: AudioManifest.weapons.ar3.shot.volume,
    bus: AudioManifest.weapons.ar3.shot.bus,
    category: "weapons",
  },
  "weapons.ar3.reload": {
    id: "weapons.ar3.reload",
    path: AudioManifest.weapons.ar3.reload.path,
    loop: AudioManifest.weapons.ar3.reload.loop,
    volume: AudioManifest.weapons.ar3.reload.volume,
    bus: AudioManifest.weapons.ar3.reload.bus,
    category: "weapons",
  },
  "weapons.ar3.empty": {
    id: "weapons.ar3.empty",
    path: AudioManifest.weapons.ar3.empty.path,
    loop: AudioManifest.weapons.ar3.empty.loop,
    volume: AudioManifest.weapons.ar3.empty.volume,
    bus: AudioManifest.weapons.ar3.empty.bus,
    category: "weapons",
  },
  "weapons.crowbar.swing": {
    id: "weapons.crowbar.swing",
    path: AudioManifest.weapons.crowbar.swing.path,
    loop: AudioManifest.weapons.crowbar.swing.loop,
    volume: AudioManifest.weapons.crowbar.swing.volume,
    bus: AudioManifest.weapons.crowbar.swing.bus,
    category: "weapons",
  },
  "weapons.crowbar.hitFlesh": {
    id: "weapons.crowbar.hitFlesh",
    path: AudioManifest.weapons.crowbar.hitFlesh.path,
    loop: AudioManifest.weapons.crowbar.hitFlesh.loop,
    volume: AudioManifest.weapons.crowbar.hitFlesh.volume,
    bus: AudioManifest.weapons.crowbar.hitFlesh.bus,
    category: "weapons",
  },
  "weapons.pickup": {
    id: "weapons.pickup",
    path: AudioManifest.weapons.pickup.path,
    loop: AudioManifest.weapons.pickup.loop,
    volume: AudioManifest.weapons.pickup.volume,
    bus: AudioManifest.weapons.pickup.bus,
    category: "weapons",
  },
  "enemies.zombie.alert": {
    id: "enemies.zombie.alert",
    path: AudioManifest.enemies.zombie.alert.path,
    loop: AudioManifest.enemies.zombie.alert.loop,
    volume: AudioManifest.enemies.zombie.alert.volume,
    bus: AudioManifest.enemies.zombie.alert.bus,
    category: "enemies",
  },
  "enemies.zombie.attack": {
    id: "enemies.zombie.attack",
    path: AudioManifest.enemies.zombie.attack.path,
    loop: AudioManifest.enemies.zombie.attack.loop,
    volume: AudioManifest.enemies.zombie.attack.volume,
    bus: AudioManifest.enemies.zombie.attack.bus,
    category: "enemies",
  },
  "enemies.zombie.damaged": {
    id: "enemies.zombie.damaged",
    path: AudioManifest.enemies.zombie.damaged.path,
    loop: AudioManifest.enemies.zombie.damaged.loop,
    volume: AudioManifest.enemies.zombie.damaged.volume,
    bus: AudioManifest.enemies.zombie.damaged.bus,
    category: "enemies",
  },
};
