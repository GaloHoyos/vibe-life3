/**
 * Tablas declarativas que mapean *qué* evento del juego dispara *qué*
 * sonido del catálogo. Los sistemas reactivos (`WeaponSoundSystem`,
 * `EnemySoundSystem`, etc.) consultan estas tablas; agregar un sonido
 * nuevo se reduce a registrar el clip en `AudioClipCatalog` y una
 * entrada acá — sin tocar la clase del sistema.
 */

import type { CharacterId } from "../../engine/characters/CharacterDefinition";

export type WeaponSoundEvent = "shot" | "reload" | "empty";

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
