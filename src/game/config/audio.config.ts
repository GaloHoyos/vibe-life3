/**
 * Tablas declarativas que mapean *quÃ©* evento del juego dispara *quÃ©*
 * sonido del catÃ¡logo. Los sistemas reactivos (`WeaponSoundSystem`,
 * `EnemySoundSystem`, etc.) consultan estas tablas; agregar un sonido
 * nuevo se reduce a registrar el clip en `AudioClipCatalog` y una
 * entrada acÃ¡ â€” sin tocar la clase del sistema.
 */

import type { CharacterId } from "@engine/characters/CharacterDefinition";

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
  shot?: string;
  reload?: string;
  empty?: string;
  /** Sonido del disparo secundario distinto del primario (ej. lanzagranadas del SMG). */
  altShot?: string;
  /** Sonido mecnico (ej. pump de la shotgun tras disparar / tras recargar). */
  cock?: string;
  /** Sonidos contextuales por tipo de superficie golpeada. */
  hit?: Partial<Record<WeaponHitSurface, string>>;
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
  Grenade: {
    shot: "weapons.grenade.throw",
    empty: "weapons.shotgun.empty",
  },
};

export interface EnemySoundMap {
  alert?: string;
  attack?: string;
  damaged?: string;
  killed?: string;
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
  },
};

export const FootstepsConfig = {
  /** Tiempo (s) entre pasos cuando el jugador se mueve a velocidad plena. */
  stepCooldown: 0.45,
} as const;
