/**
 * Tablas declarativas que mapean *quÃ©* evento del juego dispara *quÃ©*
 * sonido del catÃ¡logo. Los sistemas reactivos (`WeaponSoundSystem`,
 * `EnemySoundSystem`, etc.) consultan estas tablas; agregar un sonido
 * nuevo se reduce a registrar el clip en `AudioClipCatalog` y una
 * entrada acÃ¡ â€” sin tocar la clase del sistema.
 */

import type { CharacterId } from "@engine/characters/CharacterDefinition";
import type { ReverbSpace } from "@engine/audio/dsp/ReverbRack";
import type { AcousticResponseTuning } from "@engine/audio/spatial/AcousticResponse";
import type { SurfaceType } from "@shared/types/Surface";

export type SoundRef = string | readonly string[];
export type WeaponSoundEvent = "shot" | "reload" | "empty" | "altShot";
export type UiSoundCue = "hover" | "press" | "release" | "back" | "deny";
export type HevSuitSoundCue =
  | "armorPickup"
  | "healthPickup"
  | "armorChargerLoop"
  | "healthChargerLoop"
  | "chargerDone"
  | "chargerDenied"
  | "damage"
  | "armorGone"
  | "healthCritical"
  | "nearDeath"
  | "auxDepleted"
  | "powerRestored"
  | "hazardFire"
  | "hazardToxic"
  | "hazardElectric"
  | "hazardVoid"
  | "flatline";

export type SoundscapeId =
  | "outdoor"
  | "wasteland"
  | "lab"
  | "factory"
  | "metalTunnel"
  | "smallInterior"
  | "warehouse"
  | "citadelChamber";

export interface SoundscapeDefinition {
  readonly ambiences?: readonly string[];
  readonly fadeSeconds?: number;
  /**
   * Override sobre lo que mide la sonda acústica. Solo para cuando la
   * geometría no cuenta toda la historia (una cámara de la Ciudadela es más
   * grande de lo que alcanza a medir un rayo). Omitirlo es lo normal.
   */
  readonly reverb?: Partial<ReverbSpace>;
}

/**
 * Cuánto absorbe cada superficie, 0 = espejo acústico, 1 = anecoico. Alimenta
 * el tono y la duración del retorno según contra qué rebota el sonido.
 */
export const SurfaceAbsorption: Readonly<Record<SurfaceType, number>> = {
  metal: 0.05,
  tile: 0.08,
  concrete: 0.12,
  wood: 0.22,
  gravel: 0.4,
  sand: 0.5,
  dirt: 0.5,
  mud: 0.6,
  grass: 0.65,
  snow: 0.8,
};

/**
 * Rango del estimador: de un baño a un hangar. Fuera de estos límites la
 * respuesta satura en vez de extrapolar.
 */
export const AcousticResponse: AcousticResponseTuning = {
  minVolume: 30,
  maxVolume: 60_000,
  minDuration: 0.35,
  maxDuration: 2.8,
  minWet: 0.1,
  maxWet: 0.42,
  absorbentToneHz: 4_200,
  reflectiveToneHz: 9_500,
  maxEchoFeedback: 0.42,
  maxEchoWet: 0.16,
};

export const Soundscapes = {
  outdoor: {
    fadeSeconds: 2,
  },
  wasteland: {
    ambiences: ["background.hl2.wind.wasteland", "background.hl2.wind.med1"],
    fadeSeconds: 2.5,
  },
  lab: {
    ambiences: ["background.hl2.labs.machineMoving", "background.hl2.machines.labLoop"],
    fadeSeconds: 1.5,
  },
  factory: {
    ambiences: ["background.hl2.atmosphere.cityRumble", "background.hl2.machines.wallAmbient"],
    fadeSeconds: 2,
  },
  metalTunnel: {
    ambiences: ["background.hl2.canals.tunnelWind", "background.hl2.canals.generator"],
    fadeSeconds: 1.2,
    // Chapa sobre chapa: el eco del túnel es más largo de lo que da su volumen.
    reverb: { echoFeedback: 0.5, toneHz: 6_200 },
  },
  smallInterior: {
    fadeSeconds: 1,
  },
  warehouse: {
    ambiences: ["background.hl2.atmosphere.undergroundHall"],
    fadeSeconds: 2,
  },
  citadelChamber: {
    ambiences: ["background.hl2.machines.combineTerminal", "background.hl2.atmosphere.undercity"],
    fadeSeconds: 2.5,
    // La cámara sigue más allá de lo que alcanza a medir la sonda.
    reverb: { duration: 3.4, decay: 1.6, wet: 0.4, toneHz: 5_200 },
  },
} as const satisfies Record<SoundscapeId, SoundscapeDefinition>;

export const DefaultSoundscapeId: SoundscapeId = "outdoor";

export const UiAudio = {
  hover: "ui.hl2.buttonRollover",
  press: "ui.hl2.buttonClick",
  release: "ui.hl2.buttonClickRelease",
  back: "ui.hl2.buttonClickRelease",
  deny: "ui.hl2.buttonClick",
} as const satisfies Record<UiSoundCue, SoundRef>;

export const HevSuitAudio = {
  armorPickup: "hev.items.suitChargeOk",
  healthPickup: ["hev.fvox.medicalRepaired", "hev.fvox.morphine"],
  armorChargerLoop: "hev.items.suitCharge",
  healthChargerLoop: "hev.items.medCharge",
  chargerDone: "hev.items.suitChargeOk",
  chargerDenied: ["hev.items.suitChargeNo", "hev.player.denyDevice"],
  damage: "hev.fvox.damage",
  armorGone: "hev.fvox.armorGone",
  healthCritical: "hev.fvox.healthCritical",
  nearDeath: "hev.fvox.nearDeath",
  auxDepleted: ["hev.player.sprint", "hev.fvox.powerBelow"],
  powerRestored: "hev.fvox.powerRestored",
  hazardFire: "hev.fvox.heatDamage",
  hazardToxic: ["hev.fvox.biohazard", "hev.fvox.chemical"],
  hazardElectric: "hev.fvox.shockDamage",
  hazardVoid: ["hev.fvox.warning", "hev.fvox.radiation"],
  flatline: ["hev.fvox.criticalFail", "hev.fvox.flatline"],
} as const satisfies Record<HevSuitSoundCue, SoundRef>;

/**
 * Diagnóstico de daño del traje HEV, portado de Half-Life (`player.cpp`). El
 * traje no comenta cada golpe: sólo diagnostica cuando la herida deja de ser
 * trivial, y elige la línea según el tipo de daño (bala→pérdida de sangre,
 * físico→fractura, cuerpo a cuerpo→laceración), con variante grave si el golpe
 * es fuerte. Cada línea no se repite dentro de `repeatSeconds`.
 */
export const HevDamageConfig = {
  /** Sobre este % de vida el traje calla (herida trivial). */
  trivialHealthPercent: 75,
  /** Golpes por debajo de este daño no ameritan diagnóstico. */
  trivialDamage: 5,
  /** Un golpe sobre este daño es "grave" (fractura/laceración mayor). */
  majorDamage: 25,
  /** Ventana de no-repetición por línea (SUIT_NEXT_IN_30SEC de HL). */
  repeatSeconds: 30,
} as const;

export const HevDamageDiagnosis = {
  bullet: "hev.fvox.bloodLoss",
  meleeMinor: "hev.fvox.minorLacerations",
  meleeMajor: "hev.fvox.majorLacerations",
  fractureMinor: "hev.fvox.minorFracture",
  fractureMajor: "hev.fvox.majorFracture",
  generic: "hev.fvox.damage",
} as const satisfies Record<string, SoundRef>;

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
  "Ice Gun": {
    shot: "weapons.gravityGun.hl2.charge",
    altShot: "weapons.gravityGun.hl2.pickup",
    empty: "weapons.gravityGun.hl2.dryfire",
    hit: {
      static: ["weapons.energyball.hl2.bounce1", "weapons.energyball.hl2.bounce2"],
      door: ["weapons.energyball.hl2.bounce1", "weapons.energyball.hl2.bounce2"],
      dynamic: ["weapons.energyball.hl2.bounce1", "weapons.energyball.hl2.bounce2"],
    },
  },
  // Portal Gun: reusa clips de gravity gun/energy ball, sin binarios nuevos.
  "Portal Gun": {
    shot: ["weapons.gravityGun.hl2.launch1", "weapons.gravityGun.hl2.launch2"],
    altShot: ["weapons.gravityGun.hl2.launch1", "weapons.gravityGun.hl2.launch2"],
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
  // Gunship: el cañón dispara ~15 tiros/ráfaga; reproducir el clip (un loop
  // largo) por tiro lo hace atronador y sobrelapado. El disparo suena una vez
  // por ráfaga vía `npc.attack` posicional (ver EnemyAudio.gunship.attack).
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

/**
 * Vocalizaciones tacticas estilo F.E.A.R./HL2, sincronizadas con lo que el
 * NPC decide: `contact` al detectar, `alert` ante una sospecha, `engaging`
 * al flanquear/avanzar, `coverme` al recargar/cubrirse.
 */
export type NpcCalloutKind = "contact" | "engaging" | "coverme" | "alert";

export interface EnemySoundMap {
  alert?: SoundRef;
  attack?: SoundRef;
  /** Carga/telegraph previo a un ataque pesado (e.g. cañón del strider). */
  charge?: SoundRef;
  damaged?: SoundRef;
  killed?: SoundRef;
  footstep?: SoundRef;
  /** Loop de motor/vuelo atado al mesh del NPC mientras vive (e.g. gunship, manhack). */
  flightLoop?: string;
  /** Voces tacticas por momento (`npc.callout`). Familias sin clips quedan mudas. */
  callouts?: Partial<Record<NpcCalloutKind, SoundRef>>;
}

/** La radio combine: los tres presets comparten las mismas voces de squad. */
const COMBINE_CALLOUTS: Partial<Record<NpcCalloutKind, SoundRef>> = {
  alert: "enemies.combine.hl2.alert1",
  contact: "enemies.combine.hl2.alert2",
  engaging: "enemies.combine.hl2.attack1",
  coverme: "enemies.combine.hl2.attack2",
};

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
    callouts: COMBINE_CALLOUTS,
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
    callouts: COMBINE_CALLOUTS,
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
    callouts: COMBINE_CALLOUTS,
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
    flightLoop: "enemies.manhack.hl2.engine",
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
    flightLoop: "enemies.gunship.hl2.engine",
  },
  strider: {
    alert: ["enemies.strider.hl2.alert1", "enemies.strider.hl2.alert2"],
    attack: ["enemies.strider.hl2.minigun", "enemies.strider.hl2.cannon"],
    charge: "enemies.strider.hl2.cannonCharge",
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

/**
 * Pool de pasos por `SurfaceType` física. Lo consume el `FootstepSoundSystem`
 * vía `setSurfacePools`; la superficie sale del collider bajo el jugador
 * (raycast al suelo). Superficie sin entrada acá cae al pool default del nivel.
 */
export const SurfaceFootsteps: Record<SurfaceType, readonly string[]> = {
  concrete: FootstepPools.concrete,
  metal: FootstepPools.metal,
  wood: FootstepPools.wood,
  dirt: FootstepPools.dirt,
  grass: FootstepPools.grass,
  sand: FootstepPools.sand,
  gravel: FootstepPools.gravel,
  snow: FootstepPools.snow,
  tile: FootstepPools.tile,
  mud: FootstepPools.mud,
};

export const FootstepsConfig = {
  /** Tiempo (s) entre pasos cuando el jugador se mueve a velocidad plena. */
  stepCooldown: 0.45,
} as const;
