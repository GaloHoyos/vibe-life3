/**
 * Tablas declarativas que mapean *quÃ©* evento del juego dispara *quÃ©*
 * sonido del catÃ¡logo. Los sistemas reactivos (`WeaponSoundSystem`,
 * `EnemySoundSystem`, etc.) consultan estas tablas; agregar un sonido
 * nuevo se reduce a registrar el clip en `AudioClipCatalog` y una
 * entrada acÃ¡ â€” sin tocar la clase del sistema.
 */

import type { CharacterId } from "@engine/characters/CharacterDefinition";

export type SoundRef = string | readonly string[];
export type WeaponSoundEvent = "shot" | "reload" | "empty" | "altShot";

export type WeaponHitSurface =
  | "static"
  | "dynamic"
  | "door"
  | "npc"
  | "player"
  | "ragdoll"
  | "weaponPickup";

export interface WeaponSoundMap {
  shot?: SoundRef;
  reload?: SoundRef;
  empty?: SoundRef;
  /** Sonido del disparo secundario distinto del primario (ej. lanzagranadas del SMG). */
  altShot?: SoundRef;
  /** Sonido mecnico (ej. pump de la shotgun tras disparar / tras recargar). */
  cock?: SoundRef;
  /** Sonidos contextuales por tipo de superficie golpeada. */
  hit?: Partial<Record<WeaponHitSurface, SoundRef>>;
}

/**
 * Sonidos por arma, indexados por `WeaponDefinition.displayName` (es lo
 * que llega en los eventos `weapon.*`).
 */
export const WeaponAudio: Record<string, WeaponSoundMap> = {
  "9mm Pistol": {
    shot: "weapons.pistol.shot",
    reload: "weapons.pistol.reload",
    empty: "weapons.pistol.empty",
  },
  SMG: {
    shot: "weapons.smg.shot",
    reload: "weapons.smg.reload",
    empty: "weapons.smg.empty",
    altShot: "weapons.smg.secondary",
  },
  AR3: {
    shot: "weapons.ar3.shot",
    reload: "weapons.ar3.reload",
    empty: "weapons.ar3.empty",
    altShot: "weapons.ar3.hl2.altFire",
  },
  ".357 Magnum": {
    shot: ["weapons.revolver.hl2.shot1", "weapons.revolver.hl2.shot2"],
    reload: [
      "weapons.revolver.hl2.reload1",
      "weapons.revolver.hl2.reload2",
      "weapons.revolver.hl2.reload3",
    ],
    empty: "weapons.pistol.empty",
  },
  Crowbar: {
    shot: "weapons.crowbar.swing",
    hit: {
      npc: "weapons.crowbar.hitFlesh",
    },
  },
  Shotgun: {
    shot: "weapons.shotgun.shot",
    reload: "weapons.shotgun.reload",
    empty: "weapons.shotgun.empty",
    cock: "weapons.shotgun.cock",
  },
  Crossbow: {
    shot: "weapons.crossbow.hl2.shot",
    reload: [
      "weapons.crossbow.hl2.reload",
      "weapons.crossbow.hl2.load1",
      "weapons.crossbow.hl2.load2",
    ],
    empty: "weapons.pistol.empty",
    hit: {
      static: "weapons.crossbow.hl2.hitWorld",
      dynamic: "weapons.crossbow.hl2.hitWorld",
      door: "weapons.crossbow.hl2.hitWorld",
      npc: ["weapons.crossbow.hl2.hitBody1", "weapons.crossbow.hl2.hitBody2"],
      player: ["weapons.crossbow.hl2.hitBody1", "weapons.crossbow.hl2.hitBody2"],
      ragdoll: "weapons.crossbow.hl2.skewer",
    },
  },
  RPG: {
    shot: "weapons.rpg.hl2.fire",
    empty: "weapons.rpg.hl2.shotdown",
  },
  Grenade: {
    shot: "weapons.grenade.throw",
    empty: "weapons.shotgun.empty",
  },
  "Gravity Gun": {
    shot: ["weapons.gravityGun.hl2.launch1", "weapons.gravityGun.hl2.launch2"],
    altShot: [
      "weapons.gravityGun.hl2.charge",
      "weapons.gravityGun.hl2.pickup",
      "weapons.gravityGun.hl2.drop",
      "weapons.gravityGun.hl2.clawsOpen",
      "weapons.gravityGun.hl2.clawsClose",
    ],
    empty: "weapons.gravityGun.hl2.dryfire",
  },
  // Torreta de piso: el disparo llega como `weapon.fired` con weaponName 'Torreta'.
  Torreta: {
    shot: [
      "enemies.turret.hl2.attack1",
      "enemies.turret.hl2.attack2",
      "enemies.turret.hl2.attack3",
    ],
  },
  "Gunship Cannon": {
    shot: "enemies.gunship.hl2.fire",
  },
  "Strider Minigun": {
    shot: "enemies.strider.hl2.minigun",
  },
  "Strider Cannon": {
    shot: "enemies.strider.hl2.cannon",
  },
  "Strider Stomp": {
    shot: "weapons.crowbar.hitFlesh",
  },
};

export interface EnemySoundMap {
  alert?: SoundRef;
  attack?: SoundRef;
  damaged?: SoundRef;
  killed?: SoundRef;
  footstep?: SoundRef;
}

/**
 * Sonidos por familia de enemigo, indexados por `CharacterId`. El NPC
 * declara su `characterId` al emitir eventos `npc.*` para que el sistema
 * de audio pueda matchear sin parsing del instance id.
 */
export const EnemyAudio: Record<CharacterId, EnemySoundMap> = {
  zombie: {
    alert: "enemies.zombie.alert",
    attack: "enemies.zombie.attack",
    damaged: "enemies.zombie.damaged",
    killed: [
      "enemies.zombie.hl2.die1",
      "enemies.zombie.hl2.die2",
      "enemies.zombie.hl2.die3",
    ],
  },
  combine: {
    alert: ["enemies.combine.hl2.alert1", "enemies.combine.hl2.alert2"],
    attack: ["enemies.combine.hl2.attack1", "enemies.combine.hl2.attack2"],
    damaged: [
      "enemies.combine.hl2.pain1",
      "enemies.combine.hl2.pain2",
      "enemies.combine.hl2.pain3",
    ],
    killed: [
      "enemies.combine.hl2.die1",
      "enemies.combine.hl2.die2",
      "enemies.combine.hl2.die3",
    ],
  },
  combineElite: {
    alert: ["enemies.combine.hl2.alert1", "enemies.combine.hl2.alert2"],
    attack: ["enemies.combine.hl2.attack1", "enemies.combine.hl2.attack2"],
    damaged: [
      "enemies.combine.hl2.pain1",
      "enemies.combine.hl2.pain2",
      "enemies.combine.hl2.pain3",
    ],
    killed: [
      "enemies.combine.hl2.die1",
      "enemies.combine.hl2.die2",
      "enemies.combine.hl2.die3",
    ],
  },
  combineShotgunner: {
    alert: ["enemies.combine.hl2.alert1", "enemies.combine.hl2.alert2"],
    attack: ["enemies.combine.hl2.attack1", "enemies.combine.hl2.attack2"],
    damaged: [
      "enemies.combine.hl2.pain1",
      "enemies.combine.hl2.pain2",
      "enemies.combine.hl2.pain3",
    ],
    killed: [
      "enemies.combine.hl2.die1",
      "enemies.combine.hl2.die2",
      "enemies.combine.hl2.die3",
    ],
  },
  headcrab: {
    alert: "enemies.headcrab.hl2.alert",
    attack: [
      "enemies.headcrab.hl2.attack1",
      "enemies.headcrab.hl2.attack2",
      "enemies.headcrab.hl2.attack3",
      "enemies.headcrab.hl2.bite",
    ],
    damaged: [
      "enemies.headcrab.hl2.pain1",
      "enemies.headcrab.hl2.pain2",
      "enemies.headcrab.hl2.pain3",
    ],
    killed: ["enemies.headcrab.hl2.die1", "enemies.headcrab.hl2.die2"],
  },
  manhack: {
    alert: "enemies.manhack.hl2.alert",
    attack: [
      "enemies.manhack.hl2.attack",
      "enemies.manhack.hl2.attack2",
      "enemies.manhack.hl2.attack3",
    ],
    damaged: "enemies.manhack.hl2.damage1",
    killed: "enemies.manhack.hl2.die",
  },
  floorTurret: {
    alert: [
      "enemies.turret.hl2.deploy",
      "enemies.turret.hl2.active",
      "enemies.turret.hl2.alert",
    ],
    attack: [
      "enemies.turret.hl2.attack1",
      "enemies.turret.hl2.attack2",
      "enemies.turret.hl2.attack3",
    ],
    killed: ["enemies.turret.hl2.die", "enemies.turret.hl2.retract"],
  },
  gunship: {
    alert: "enemies.gunship.hl2.alert",
    attack: "enemies.gunship.hl2.fire",
    damaged: "enemies.gunship.hl2.pain",
    killed: "enemies.gunship.hl2.die",
  },
  strider: {
    alert: ["enemies.strider.hl2.alert1", "enemies.strider.hl2.alert2"],
    attack: ["enemies.strider.hl2.minigun", "enemies.strider.hl2.cannon"],
    damaged: "enemies.strider.hl2.pain",
    killed: "enemies.strider.hl2.die",
    footstep: [
      "enemies.strider.hl2.step1",
      "enemies.strider.hl2.step2",
      "enemies.strider.hl2.step3",
      "enemies.strider.hl2.step4",
      "enemies.strider.hl2.step5",
      "enemies.strider.hl2.step6",
    ],
  },
};

export const FootstepPools = {
  concrete: [
    "footsteps.hl2.concrete1",
    "footsteps.hl2.concrete2",
    "footsteps.hl2.concrete3",
    "footsteps.hl2.concrete4",
  ],
  metal: [
    "footsteps.hl2.metal1",
    "footsteps.hl2.metal2",
    "footsteps.hl2.metal3",
    "footsteps.hl2.metal4",
  ],
  metalgrate: [
    "footsteps.hl2.metalgrate1",
    "footsteps.hl2.metalgrate2",
    "footsteps.hl2.metalgrate3",
    "footsteps.hl2.metalgrate4",
  ],
  dirt: [
    "footsteps.hl2.dirt1",
    "footsteps.hl2.dirt2",
    "footsteps.hl2.dirt3",
    "footsteps.hl2.dirt4",
  ],
  grass: [
    "footsteps.hl2.grass1",
    "footsteps.hl2.grass2",
    "footsteps.hl2.grass3",
    "footsteps.hl2.grass4",
  ],
  gravel: [
    "footsteps.hl2.gravel1",
    "footsteps.hl2.gravel2",
    "footsteps.hl2.gravel3",
    "footsteps.hl2.gravel4",
  ],
  tile: [
    "footsteps.hl2.tile1",
    "footsteps.hl2.tile2",
    "footsteps.hl2.tile3",
    "footsteps.hl2.tile4",
  ],
  wood: [
    "footsteps.hl2.wood1",
    "footsteps.hl2.wood2",
    "footsteps.hl2.wood3",
    "footsteps.hl2.wood4",
  ],
  woodpanel: [
    "footsteps.hl2.woodpanel1",
    "footsteps.hl2.woodpanel2",
    "footsteps.hl2.woodpanel3",
    "footsteps.hl2.woodpanel4",
  ],
  mud: [
    "footsteps.hl2.mud1",
    "footsteps.hl2.mud2",
    "footsteps.hl2.mud3",
    "footsteps.hl2.mud4",
  ],
  sand: [
    "footsteps.hl2.sand1",
    "footsteps.hl2.sand2",
    "footsteps.hl2.sand3",
    "footsteps.hl2.sand4",
  ],
  chainlink: [
    "footsteps.hl2.chainlink1",
    "footsteps.hl2.chainlink2",
    "footsteps.hl2.chainlink3",
    "footsteps.hl2.chainlink4",
  ],
  duct: [
    "footsteps.hl2.duct1",
    "footsteps.hl2.duct2",
    "footsteps.hl2.duct3",
    "footsteps.hl2.duct4",
  ],
  ladder: [
    "footsteps.hl2.ladder1",
    "footsteps.hl2.ladder2",
    "footsteps.hl2.ladder3",
    "footsteps.hl2.ladder4",
  ],
  slosh: [
    "footsteps.hl2.slosh1",
    "footsteps.hl2.slosh2",
    "footsteps.hl2.slosh3",
    "footsteps.hl2.slosh4",
  ],
  wade: [
    "footsteps.hl2.wade1",
    "footsteps.hl2.wade2",
    "footsteps.hl2.wade3",
    "footsteps.hl2.wade4",
    "footsteps.hl2.wade5",
    "footsteps.hl2.wade6",
    "footsteps.hl2.wade7",
    "footsteps.hl2.wade8",
  ],
  snow: [
    "footsteps.snow1",
    "footsteps.snow2",
    "footsteps.snow3",
    "footsteps.snow4",
  ],
} as const satisfies Record<string, readonly string[]>;

export const FootstepsConfig = {
  /** Tiempo (s) entre pasos cuando el jugador se mueve a velocidad plena. */
  stepCooldown: 0.45,
} as const;
