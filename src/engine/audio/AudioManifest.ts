import type { AudioBusName } from "@engine/audio/core/AudioSystem";

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

interface Hl2ClipSpec {
  id: string;
  path: string;
  category: AudioCategory;
  bus: AudioBusName;
  loop?: boolean;
  volume?: number;
}

const hl2SoundUrls = import.meta.glob("../assets/sounds/hl2/**/*.{wav,mp3}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function hl2Sound(path: string): string {
  const key = `../assets/sounds/hl2/${path}`;
  const url = hl2SoundUrls[key];
  if (!url) {
    throw new Error(`Missing HL2 sound asset: ${path}`);
  }
  return url;
}

function hl2Clip(spec: Hl2ClipSpec): AudioClipDefinition {
  return {
    id: spec.id,
    path: hl2Sound(spec.path),
    loop: spec.loop ?? false,
    volume: spec.volume ?? 0.75,
    bus: spec.bus,
    category: spec.category,
  };
}

function repeatHl2Footsteps(surface: string, count: number): Hl2ClipSpec[] {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    return {
      id: `footsteps.hl2.${surface}${n}`,
      path: `footsteps/${surface}${n}.wav`,
      category: "footsteps",
      bus: "footsteps",
      volume: surface === "wade" ? 0.48 : 0.55,
    };
  });
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

const shotgunShot = new URL(
  "../assets/sounds/weapons/shotgun/shot.mp3",
  import.meta.url,
).href;
const shotgunReload = new URL(
  "../assets/sounds/weapons/shotgun/reload.mp3",
  import.meta.url,
).href;
const shotgunCock = new URL(
  "../assets/sounds/weapons/shotgun/cock.mp3",
  import.meta.url,
).href;
const shotgunEmpty = new URL(
  "../assets/sounds/weapons/shotgun/empty.mp3",
  import.meta.url,
).href;

const grenadeThrow = new URL(
  "../assets/sounds/weapons/grenade/throw.mp3",
  import.meta.url,
).href;
const grenadeBeep = new URL(
  "../assets/sounds/weapons/grenade/beep.mp3",
  import.meta.url,
).href;
const grenadeExplosion = new URL(
  "../assets/sounds/weapons/grenade/explosion.mp3",
  import.meta.url,
).href;

const smgSecondary = new URL(
  "../assets/sounds/weapons/smg/secondary.mp3",
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
      secondary: {
        path: smgSecondary,
        loop: false,
        volume: 0.85,
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
    shotgun: {
      shot: {
        path: shotgunShot,
        loop: false,
        volume: 0.9,
        bus: "weapons" as const,
      },
      reload: {
        path: shotgunReload,
        loop: false,
        volume: 0.75,
        bus: "weapons" as const,
      },
      cock: {
        path: shotgunCock,
        loop: false,
        volume: 0.7,
        bus: "weapons" as const,
      },
      empty: {
        path: shotgunEmpty,
        loop: false,
        volume: 0.6,
        bus: "weapons" as const,
      },
    },
    grenade: {
      throw: {
        path: grenadeThrow,
        loop: false,
        volume: 0.7,
        bus: "weapons" as const,
      },
      beep: {
        path: grenadeBeep,
        loop: false,
        volume: 0.55,
        bus: "weapons" as const,
      },
      explosion: {
        path: grenadeExplosion,
        loop: false,
        volume: 1,
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

const hl2WeaponClips: Hl2ClipSpec[] = [
  { id: "weapons.revolver.hl2.shot1", path: "weapons/357/357_fire2.wav", category: "weapons", bus: "weapons", volume: 0.95 },
  { id: "weapons.revolver.hl2.shot2", path: "weapons/357/357_fire3.wav", category: "weapons", bus: "weapons", volume: 0.95 },
  { id: "weapons.revolver.hl2.reload1", path: "weapons/357/357_reload1.wav", category: "weapons", bus: "weapons", volume: 0.75 },
  { id: "weapons.revolver.hl2.reload2", path: "weapons/357/357_reload3.wav", category: "weapons", bus: "weapons", volume: 0.75 },
  { id: "weapons.revolver.hl2.reload3", path: "weapons/357/357_reload4.wav", category: "weapons", bus: "weapons", volume: 0.75 },
  { id: "weapons.revolver.hl2.spin", path: "weapons/357/357_spin1.wav", category: "weapons", bus: "weapons", volume: 0.7 },
  { id: "weapons.crossbow.hl2.shot", path: "weapons/crossbow/fire1.wav", category: "weapons", bus: "weapons", volume: 0.8 },
  { id: "weapons.crossbow.hl2.reload", path: "weapons/crossbow/reload1.wav", category: "weapons", bus: "weapons", volume: 0.7 },
  { id: "weapons.crossbow.hl2.load1", path: "weapons/crossbow/bolt_load1.wav", category: "weapons", bus: "weapons", volume: 0.72 },
  { id: "weapons.crossbow.hl2.load2", path: "weapons/crossbow/bolt_load2.wav", category: "weapons", bus: "weapons", volume: 0.72 },
  { id: "weapons.crossbow.hl2.fly", path: "weapons/crossbow/bolt_fly4.wav", category: "weapons", bus: "weapons", volume: 0.62 },
  { id: "weapons.crossbow.hl2.hitWorld", path: "weapons/crossbow/hit1.wav", category: "weapons", bus: "weapons", volume: 0.65 },
  { id: "weapons.crossbow.hl2.hitBody1", path: "weapons/crossbow/hitbod1.wav", category: "weapons", bus: "weapons", volume: 0.75 },
  { id: "weapons.crossbow.hl2.hitBody2", path: "weapons/crossbow/hitbod2.wav", category: "weapons", bus: "weapons", volume: 0.75 },
  { id: "weapons.crossbow.hl2.skewer", path: "weapons/crossbow/bolt_skewer1.wav", category: "weapons", bus: "weapons", volume: 0.75 },
  { id: "weapons.rpg.hl2.fire", path: "weapons/rpg/rocketfire1.wav", category: "weapons", bus: "weapons", volume: 0.95 },
  { id: "weapons.rpg.hl2.rocketLoop", path: "weapons/rpg/rocket1.wav", category: "weapons", bus: "weapons", loop: true, volume: 0.75 },
  { id: "weapons.rpg.hl2.shotdown", path: "weapons/rpg/shotdown.wav", category: "weapons", bus: "weapons", volume: 0.75 },
  { id: "weapons.rpg.hl2.explosion", path: "npcs/combine_gunship/gunship_explode2.wav", category: "weapons", bus: "weapons", volume: 1 },
  { id: "weapons.ar3.hl2.altFire", path: "weapons/ar2/ar2_altfire.wav", category: "weapons", bus: "weapons", volume: 0.9 },
  { id: "weapons.ar3.hl2.altEmpty", path: "weapons/ar2/ar2_empty.wav", category: "weapons", bus: "weapons", volume: 0.65 },
  { id: "weapons.energyball.hl2.bounce1", path: "weapons/physcannon/energy_bounce1.wav", category: "weapons", bus: "weapons", volume: 0.72 },
  { id: "weapons.energyball.hl2.bounce2", path: "weapons/physcannon/energy_bounce2.wav", category: "weapons", bus: "weapons", volume: 0.72 },
  { id: "weapons.energyball.hl2.disintegrate1", path: "weapons/physcannon/energy_disintegrate4.wav", category: "weapons", bus: "weapons", volume: 0.82 },
  { id: "weapons.energyball.hl2.disintegrate2", path: "weapons/physcannon/energy_disintegrate5.wav", category: "weapons", bus: "weapons", volume: 0.82 },
  { id: "weapons.energyball.hl2.explosion", path: "weapons/physcannon/energy_sing_explosion2.wav", category: "weapons", bus: "weapons", volume: 0.82 },
  { id: "weapons.energyball.hl2.flyby1", path: "weapons/physcannon/energy_sing_flyby1.wav", category: "weapons", bus: "weapons", volume: 0.55 },
  { id: "weapons.energyball.hl2.flyby2", path: "weapons/physcannon/energy_sing_flyby2.wav", category: "weapons", bus: "weapons", volume: 0.55 },
  { id: "weapons.gravityGun.hl2.charge", path: "weapons/physcannon/physcannon_charge.wav", category: "weapons", bus: "weapons", volume: 0.75 },
  { id: "weapons.gravityGun.hl2.dryfire", path: "weapons/physcannon/physcannon_dryfire.wav", category: "weapons", bus: "weapons", volume: 0.7 },
  { id: "weapons.gravityGun.hl2.pickup", path: "weapons/physcannon/physcannon_pickup.wav", category: "weapons", bus: "weapons", volume: 0.75 },
  { id: "weapons.gravityGun.hl2.drop", path: "weapons/physcannon/physcannon_drop.wav", category: "weapons", bus: "weapons", volume: 0.75 },
  { id: "weapons.gravityGun.hl2.clawsOpen", path: "weapons/physcannon/physcannon_claws_open.wav", category: "weapons", bus: "weapons", volume: 0.65 },
  { id: "weapons.gravityGun.hl2.clawsClose", path: "weapons/physcannon/physcannon_claws_close.wav", category: "weapons", bus: "weapons", volume: 0.65 },
  { id: "weapons.gravityGun.hl2.launch1", path: "weapons/physcannon/superphys_launch1.wav", category: "weapons", bus: "weapons", volume: 0.8 },
  { id: "weapons.gravityGun.hl2.launch2", path: "weapons/physcannon/superphys_launch2.wav", category: "weapons", bus: "weapons", volume: 0.8 },
];

const hl2EnemyClips: Hl2ClipSpec[] = [
  { id: "enemies.headcrab.hl2.alert", path: "npcs/headcrab/alert1.wav", category: "enemies", bus: "enemies", volume: 0.75 },
  { id: "enemies.headcrab.hl2.attack1", path: "npcs/headcrab/attack1.wav", category: "enemies", bus: "enemies", volume: 0.75 },
  { id: "enemies.headcrab.hl2.attack2", path: "npcs/headcrab/attack2.wav", category: "enemies", bus: "enemies", volume: 0.75 },
  { id: "enemies.headcrab.hl2.attack3", path: "npcs/headcrab/attack3.wav", category: "enemies", bus: "enemies", volume: 0.75 },
  { id: "enemies.headcrab.hl2.bite", path: "npcs/headcrab/headbite.wav", category: "enemies", bus: "enemies", volume: 0.75 },
  { id: "enemies.headcrab.hl2.pain1", path: "npcs/headcrab/pain1.wav", category: "enemies", bus: "enemies", volume: 0.75 },
  { id: "enemies.headcrab.hl2.pain2", path: "npcs/headcrab/pain2.wav", category: "enemies", bus: "enemies", volume: 0.75 },
  { id: "enemies.headcrab.hl2.pain3", path: "npcs/headcrab/pain3.wav", category: "enemies", bus: "enemies", volume: 0.75 },
  { id: "enemies.headcrab.hl2.die1", path: "npcs/headcrab/die1.wav", category: "enemies", bus: "enemies", volume: 0.75 },
  { id: "enemies.headcrab.hl2.die2", path: "npcs/headcrab/die2.wav", category: "enemies", bus: "enemies", volume: 0.75 },
  { id: "enemies.manhack.hl2.alert", path: "npcs/manhack/mh_blade_snick1.wav", category: "enemies", bus: "enemies", volume: 0.65 },
  { id: "enemies.manhack.hl2.attack", path: "npcs/manhack/grind_flesh1.wav", category: "enemies", bus: "enemies", volume: 0.72 },
  { id: "enemies.manhack.hl2.attack2", path: "npcs/manhack/grind_flesh2.wav", category: "enemies", bus: "enemies", volume: 0.72 },
  { id: "enemies.manhack.hl2.attack3", path: "npcs/manhack/grind_flesh3.wav", category: "enemies", bus: "enemies", volume: 0.72 },
  { id: "enemies.manhack.hl2.engine", path: "npcs/manhack/mh_engine_loop1.wav", category: "enemies", bus: "enemies", loop: true, volume: 0.45 },
  { id: "enemies.manhack.hl2.damage1", path: "npcs/manhack/bat_away.wav", category: "enemies", bus: "enemies", volume: 0.7 },
  { id: "enemies.manhack.hl2.die", path: "npcs/manhack/gib.wav", category: "enemies", bus: "enemies", volume: 0.8 },
  { id: "enemies.turret.hl2.deploy", path: "npcs/turret_floor/deploy.wav", category: "enemies", bus: "enemies", volume: 0.72 },
  { id: "enemies.turret.hl2.active", path: "npcs/turret_floor/active.wav", category: "enemies", bus: "enemies", volume: 0.6 },
  { id: "enemies.turret.hl2.alert", path: "npcs/turret_floor/alert.wav", category: "enemies", bus: "enemies", volume: 0.72 },
  { id: "enemies.turret.hl2.attack1", path: "npcs/turret_floor/shoot1.wav", category: "enemies", bus: "weapons", volume: 0.82 },
  { id: "enemies.turret.hl2.attack2", path: "npcs/turret_floor/shoot2.wav", category: "enemies", bus: "weapons", volume: 0.82 },
  { id: "enemies.turret.hl2.attack3", path: "npcs/turret_floor/shoot3.wav", category: "enemies", bus: "weapons", volume: 0.82 },
  { id: "enemies.turret.hl2.die", path: "npcs/turret_floor/die.wav", category: "enemies", bus: "enemies", volume: 0.85 },
  { id: "enemies.turret.hl2.retract", path: "npcs/turret_floor/retract.wav", category: "enemies", bus: "enemies", volume: 0.72 },
  { id: "enemies.combine.hl2.alert1", path: "npcs/combine_soldier/vo/alert1.wav", category: "enemies", bus: "enemies", volume: 0.75 },
  { id: "enemies.combine.hl2.alert2", path: "npcs/combine_soldier/vo/contact.wav", category: "enemies", bus: "enemies", volume: 0.75 },
  { id: "enemies.combine.hl2.attack1", path: "npcs/combine_soldier/vo/engaging.wav", category: "enemies", bus: "enemies", volume: 0.75 },
  { id: "enemies.combine.hl2.attack2", path: "npcs/combine_soldier/vo/coverme.wav", category: "enemies", bus: "enemies", volume: 0.75 },
  { id: "enemies.combine.hl2.pain1", path: "npcs/combine_soldier/pain1.wav", category: "enemies", bus: "enemies", volume: 0.75 },
  { id: "enemies.combine.hl2.pain2", path: "npcs/combine_soldier/pain2.wav", category: "enemies", bus: "enemies", volume: 0.75 },
  { id: "enemies.combine.hl2.pain3", path: "npcs/combine_soldier/pain3.wav", category: "enemies", bus: "enemies", volume: 0.75 },
  { id: "enemies.combine.hl2.die1", path: "npcs/combine_soldier/die1.wav", category: "enemies", bus: "enemies", volume: 0.8 },
  { id: "enemies.combine.hl2.die2", path: "npcs/combine_soldier/die2.wav", category: "enemies", bus: "enemies", volume: 0.8 },
  { id: "enemies.combine.hl2.die3", path: "npcs/combine_soldier/die3.wav", category: "enemies", bus: "enemies", volume: 0.8 },
  { id: "enemies.zombie.hl2.die1", path: "npcs/zombie/zombie_die1.wav", category: "enemies", bus: "enemies", volume: 0.8 },
  { id: "enemies.zombie.hl2.die2", path: "npcs/zombie/zombie_die2.wav", category: "enemies", bus: "enemies", volume: 0.8 },
  { id: "enemies.zombie.hl2.die3", path: "npcs/zombie/zombie_die3.wav", category: "enemies", bus: "enemies", volume: 0.8 },
  { id: "enemies.gunship.hl2.alert", path: "npcs/combine_gunship/see_enemy.wav", category: "enemies", bus: "enemies", volume: 0.82 },
  { id: "enemies.gunship.hl2.pain", path: "npcs/combine_gunship/gunship_pain.wav", category: "enemies", bus: "enemies", volume: 0.8 },
  { id: "enemies.gunship.hl2.die", path: "npcs/combine_gunship/gunship_explode2.wav", category: "enemies", bus: "enemies", volume: 0.85 },
  { id: "enemies.gunship.hl2.fire", path: "npcs/combine_gunship/gunship_weapon_fire_loop6.wav", category: "enemies", bus: "enemies", volume: 0.5 },
  { id: "enemies.gunship.hl2.engine", path: "npcs/combine_gunship/gunship_engine_loop3.wav", category: "enemies", bus: "enemies", loop: true, volume: 0.5 },
  { id: "enemies.strider.hl2.alert1", path: "npcs/strider/striderx_alert2.wav", category: "enemies", bus: "enemies", volume: 0.82 },
  { id: "enemies.strider.hl2.alert2", path: "npcs/strider/striderx_alert4.wav", category: "enemies", bus: "enemies", volume: 0.82 },
  { id: "enemies.strider.hl2.pain", path: "npcs/strider/striderx_pain2.wav", category: "enemies", bus: "enemies", volume: 0.8 },
  { id: "enemies.strider.hl2.die", path: "npcs/strider/striderx_die1.wav", category: "enemies", bus: "enemies", volume: 0.85 },
  { id: "enemies.strider.hl2.minigun", path: "npcs/strider/strider_minigun.wav", category: "enemies", bus: "weapons", volume: 0.82 },
  { id: "enemies.strider.hl2.cannon", path: "npcs/strider/fire.wav", category: "enemies", bus: "weapons", volume: 0.85 },
  { id: "enemies.strider.hl2.cannonCharge", path: "npcs/strider/charging.wav", category: "enemies", bus: "enemies", volume: 0.8 },
  { id: "enemies.strider.hl2.step1", path: "npcs/strider/strider_step1.wav", category: "enemies", bus: "enemies", volume: 0.8 },
  { id: "enemies.strider.hl2.step2", path: "npcs/strider/strider_step2.wav", category: "enemies", bus: "enemies", volume: 0.8 },
  { id: "enemies.strider.hl2.step3", path: "npcs/strider/strider_step3.wav", category: "enemies", bus: "enemies", volume: 0.8 },
  { id: "enemies.strider.hl2.step4", path: "npcs/strider/strider_step4.wav", category: "enemies", bus: "enemies", volume: 0.8 },
  { id: "enemies.strider.hl2.step5", path: "npcs/strider/strider_step5.wav", category: "enemies", bus: "enemies", volume: 0.8 },
  { id: "enemies.strider.hl2.step6", path: "npcs/strider/strider_step6.wav", category: "enemies", bus: "enemies", volume: 0.8 },
];

const hl2FootstepClips: Hl2ClipSpec[] = [
  ...repeatHl2Footsteps("chainlink", 4),
  ...repeatHl2Footsteps("concrete", 4),
  ...repeatHl2Footsteps("dirt", 4),
  ...repeatHl2Footsteps("duct", 4),
  ...repeatHl2Footsteps("grass", 4),
  ...repeatHl2Footsteps("gravel", 4),
  ...repeatHl2Footsteps("ladder", 4),
  ...repeatHl2Footsteps("metal", 4),
  ...repeatHl2Footsteps("metalgrate", 4),
  ...repeatHl2Footsteps("mud", 4),
  ...repeatHl2Footsteps("sand", 4),
  ...repeatHl2Footsteps("slosh", 4),
  ...repeatHl2Footsteps("tile", 4),
  ...repeatHl2Footsteps("wade", 8),
  ...repeatHl2Footsteps("wood", 4),
  ...repeatHl2Footsteps("woodpanel", 4),
];

const hl2BackgroundClips: Hl2ClipSpec[] = [
  { id: "background.hl2.wind.wasteland", path: "ambient/wind/wasteland_wind.wav", category: "background", bus: "ambience", loop: true, volume: 0.42 },
  { id: "background.hl2.wind.med1", path: "ambient/wind/wind_med1.wav", category: "background", bus: "ambience", loop: true, volume: 0.35 },
  { id: "background.hl2.wind.med2", path: "ambient/wind/wind_med2.wav", category: "background", bus: "ambience", loop: true, volume: 0.35 },
  { id: "background.hl2.wind.rooftop", path: "ambient/wind/wind_rooftop1.wav", category: "background", bus: "ambience", loop: true, volume: 0.35 },
  { id: "background.hl2.wind.tunnel", path: "ambient/wind/wind_tunnel1.wav", category: "background", bus: "ambience", loop: true, volume: 0.35 },
  { id: "background.hl2.labs.equipmentBeep", path: "ambient/levels/labs/equipment_beep_loop1.wav", category: "background", bus: "ambience", loop: true, volume: 0.26 },
  { id: "background.hl2.labs.machineMoving", path: "ambient/levels/labs/machine_moving_loop3.wav", category: "background", bus: "ambience", loop: true, volume: 0.28 },
  { id: "background.hl2.labs.machineRing", path: "ambient/levels/labs/machine_ring_resonance_loop1.wav", category: "background", bus: "ambience", loop: true, volume: 0.24 },
  { id: "background.hl2.labs.teleportActive", path: "ambient/levels/labs/teleport_active_loop1.wav", category: "background", bus: "ambience", loop: true, volume: 0.24 },
  { id: "background.hl2.canals.tunnelWind", path: "ambient/levels/canals/tunnel_wind_loop1.wav", category: "background", bus: "ambience", loop: true, volume: 0.36 },
  { id: "background.hl2.canals.waterRivulet", path: "ambient/levels/canals/water_rivulet_loop2.wav", category: "background", bus: "ambience", loop: true, volume: 0.25 },
  { id: "background.hl2.canals.waterLeak", path: "ambient/levels/canals/waterleak_loop1.wav", category: "background", bus: "ambience", loop: true, volume: 0.24 },
  { id: "background.hl2.canals.generator", path: "ambient/levels/canals/generator_ambience_loop1.wav", category: "background", bus: "ambience", loop: true, volume: 0.3 },
  { id: "background.hl2.canals.manhackMachine", path: "ambient/levels/canals/manhack_machine_loop1.wav", category: "background", bus: "ambience", loop: true, volume: 0.26 },
  { id: "background.hl2.streetwar.battle1", path: "ambient/levels/streetwar/city_battle1.wav", category: "background", bus: "ambience", volume: 0.34 },
  { id: "background.hl2.streetwar.battle5", path: "ambient/levels/streetwar/city_battle5.wav", category: "background", bus: "ambience", volume: 0.34 },
  { id: "background.hl2.streetwar.riot", path: "ambient/levels/streetwar/city_riot1.wav", category: "background", bus: "ambience", loop: true, volume: 0.22 },
  { id: "background.hl2.streetwar.gunshipDistant", path: "ambient/levels/streetwar/gunship_distant1.wav", category: "background", bus: "ambience", volume: 0.35 },
  { id: "background.hl2.streetwar.striderDistantWalk", path: "ambient/levels/streetwar/strider_distant_walk1.wav", category: "background", bus: "ambience", volume: 0.34 },
  { id: "background.hl2.atmosphere.cityRumble", path: "ambient/atmosphere/city_rumble_loop1.wav", category: "background", bus: "ambience", loop: true, volume: 0.24 },
  { id: "background.hl2.atmosphere.plaza", path: "ambient/atmosphere/plaza_amb.wav", category: "background", bus: "ambience", loop: true, volume: 0.24 },
  { id: "background.hl2.atmosphere.undergroundHall", path: "ambient/atmosphere/underground_hall_loop1.wav", category: "background", bus: "ambience", loop: true, volume: 0.26 },
  { id: "background.hl2.atmosphere.undercity", path: "ambient/atmosphere/undercity_loop1.wav", category: "background", bus: "ambience", loop: true, volume: 0.26 },
  { id: "background.hl2.atmosphere.trainstation", path: "ambient/atmosphere/trainstation_ambient_loop1.wav", category: "background", bus: "ambience", loop: true, volume: 0.26 },
  { id: "background.hl2.machines.combineTerminal", path: "ambient/machines/combine_terminal_loop1.wav", category: "background", bus: "ambience", loop: true, volume: 0.22 },
  { id: "background.hl2.machines.labLoop", path: "ambient/machines/lab_loop1.wav", category: "background", bus: "ambience", loop: true, volume: 0.24 },
  { id: "background.hl2.machines.wallAmbient", path: "ambient/machines/wall_ambient_loop1.wav", category: "background", bus: "ambience", loop: true, volume: 0.22 },
  { id: "background.hl2.machines.trainRumble", path: "ambient/machines/train_rumble.wav", category: "background", bus: "ambience", loop: true, volume: 0.28 },
];

const hl2UiClips: Hl2ClipSpec[] = [
  { id: "ui.hl2.buttonRollover", path: "ui/buttonrollover.wav", category: "ui", bus: "ui", volume: 0.42 },
  { id: "ui.hl2.buttonClick", path: "ui/buttonclick.wav", category: "ui", bus: "ui", volume: 0.5 },
  { id: "ui.hl2.buttonClickRelease", path: "ui/buttonclickrelease.wav", category: "ui", bus: "ui", volume: 0.48 },
];

const hl2HevClips: Hl2ClipSpec[] = [
  { id: "hev.items.suitCharge", path: "items/suitcharge1.wav", category: "ui", bus: "ui", loop: true, volume: 0.34 },
  { id: "hev.items.suitChargeNo", path: "items/suitchargeno1.wav", category: "ui", bus: "ui", volume: 0.48 },
  { id: "hev.items.suitChargeOk", path: "items/suitchargeok1.wav", category: "ui", bus: "ui", volume: 0.48 },
  { id: "hev.items.medCharge", path: "items/medcharge4.wav", category: "ui", bus: "ui", loop: true, volume: 0.34 },
  { id: "hev.player.denyDevice", path: "player/suit_denydevice.wav", category: "ui", bus: "ui", volume: 0.52 },
  { id: "hev.player.sprint", path: "player/suit_sprint.wav", category: "ui", bus: "ui", volume: 0.5 },
  { id: "hev.fvox.flatline", path: "hl1/fvox/flatline.wav", category: "dialogue", bus: "dialogue", volume: 0.72 },
  { id: "hev.fvox.criticalFail", path: "hl1/fvox/hev_critical_fail.wav", category: "dialogue", bus: "dialogue", volume: 0.72 },
  { id: "hev.fvox.generalFail", path: "hl1/fvox/hev_general_fail.wav", category: "dialogue", bus: "dialogue", volume: 0.72 },
  { id: "hev.fvox.shutdown", path: "hl1/fvox/hev_shutdown.wav", category: "dialogue", bus: "dialogue", volume: 0.72 },
  { id: "hev.fvox.healthCritical", path: "hl1/fvox/health_critical.wav", category: "dialogue", bus: "dialogue", volume: 0.72 },
  { id: "hev.fvox.nearDeath", path: "hl1/fvox/near_death.wav", category: "dialogue", bus: "dialogue", volume: 0.72 },
  { id: "hev.fvox.damage", path: "hl1/fvox/hev_damage.wav", category: "dialogue", bus: "dialogue", volume: 0.68 },
  { id: "hev.fvox.armorGone", path: "hl1/fvox/armor_gone.wav", category: "dialogue", bus: "dialogue", volume: 0.7 },
  { id: "hev.fvox.powerBelow", path: "hl1/fvox/power_below.wav", category: "dialogue", bus: "dialogue", volume: 0.7 },
  { id: "hev.fvox.powerRestored", path: "hl1/fvox/power_restored.wav", category: "dialogue", bus: "dialogue", volume: 0.68 },
  { id: "hev.fvox.heatDamage", path: "hl1/fvox/heat_damage.wav", category: "dialogue", bus: "dialogue", volume: 0.72 },
  { id: "hev.fvox.shockDamage", path: "hl1/fvox/shock_damage.wav", category: "dialogue", bus: "dialogue", volume: 0.72 },
  { id: "hev.fvox.biohazard", path: "hl1/fvox/biohazard_detected.wav", category: "dialogue", bus: "dialogue", volume: 0.72 },
  { id: "hev.fvox.chemical", path: "hl1/fvox/chemical_detected.wav", category: "dialogue", bus: "dialogue", volume: 0.72 },
  { id: "hev.fvox.radiation", path: "hl1/fvox/radiation_detected.wav", category: "dialogue", bus: "dialogue", volume: 0.72 },
  { id: "hev.fvox.warning", path: "hl1/fvox/warning.wav", category: "dialogue", bus: "dialogue", volume: 0.72 },
  { id: "hev.fvox.medicalRepaired", path: "hl1/fvox/medical_repaired.wav", category: "dialogue", bus: "dialogue", volume: 0.66 },
  { id: "hev.fvox.morphine", path: "hl1/fvox/morphine_shot.wav", category: "dialogue", bus: "dialogue", volume: 0.66 },
];

const HL2AudioClipCatalog: Record<string, AudioClipDefinition> = Object.fromEntries(
  [
    ...hl2WeaponClips,
    ...hl2EnemyClips,
    ...hl2FootstepClips,
    ...hl2BackgroundClips,
    ...hl2UiClips,
    ...hl2HevClips,
  ].map((spec) => [spec.id, hl2Clip(spec)]),
);

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
  "weapons.smg.secondary": {
    id: "weapons.smg.secondary",
    path: AudioManifest.weapons.smg.secondary.path,
    loop: AudioManifest.weapons.smg.secondary.loop,
    volume: AudioManifest.weapons.smg.secondary.volume,
    bus: AudioManifest.weapons.smg.secondary.bus,
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
  "weapons.shotgun.shot": {
    id: "weapons.shotgun.shot",
    path: AudioManifest.weapons.shotgun.shot.path,
    loop: AudioManifest.weapons.shotgun.shot.loop,
    volume: AudioManifest.weapons.shotgun.shot.volume,
    bus: AudioManifest.weapons.shotgun.shot.bus,
    category: "weapons",
  },
  "weapons.shotgun.reload": {
    id: "weapons.shotgun.reload",
    path: AudioManifest.weapons.shotgun.reload.path,
    loop: AudioManifest.weapons.shotgun.reload.loop,
    volume: AudioManifest.weapons.shotgun.reload.volume,
    bus: AudioManifest.weapons.shotgun.reload.bus,
    category: "weapons",
  },
  "weapons.shotgun.cock": {
    id: "weapons.shotgun.cock",
    path: AudioManifest.weapons.shotgun.cock.path,
    loop: AudioManifest.weapons.shotgun.cock.loop,
    volume: AudioManifest.weapons.shotgun.cock.volume,
    bus: AudioManifest.weapons.shotgun.cock.bus,
    category: "weapons",
  },
  "weapons.shotgun.empty": {
    id: "weapons.shotgun.empty",
    path: AudioManifest.weapons.shotgun.empty.path,
    loop: AudioManifest.weapons.shotgun.empty.loop,
    volume: AudioManifest.weapons.shotgun.empty.volume,
    bus: AudioManifest.weapons.shotgun.empty.bus,
    category: "weapons",
  },
  "weapons.grenade.throw": {
    id: "weapons.grenade.throw",
    path: AudioManifest.weapons.grenade.throw.path,
    loop: AudioManifest.weapons.grenade.throw.loop,
    volume: AudioManifest.weapons.grenade.throw.volume,
    bus: AudioManifest.weapons.grenade.throw.bus,
    category: "weapons",
  },
  "weapons.grenade.beep": {
    id: "weapons.grenade.beep",
    path: AudioManifest.weapons.grenade.beep.path,
    loop: AudioManifest.weapons.grenade.beep.loop,
    volume: AudioManifest.weapons.grenade.beep.volume,
    bus: AudioManifest.weapons.grenade.beep.bus,
    category: "weapons",
  },
  "weapons.grenade.explosion": {
    id: "weapons.grenade.explosion",
    path: AudioManifest.weapons.grenade.explosion.path,
    loop: AudioManifest.weapons.grenade.explosion.loop,
    volume: AudioManifest.weapons.grenade.explosion.volume,
    bus: AudioManifest.weapons.grenade.explosion.bus,
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
  ...HL2AudioClipCatalog,
};
