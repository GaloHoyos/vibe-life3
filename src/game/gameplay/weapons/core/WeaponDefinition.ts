import { Euler, Vector3 } from "three";
import type { WeaponHandedness as AnimationHandedness } from "@engine/animation/AnimationInput";
import type { ModelAssetId } from "@engine/assets/AssetManifest";

export type WeaponId =
  | "crowbar"
  | "pistol"
  | "revolver"
  | "smg"
  | "ar3"
  | "crossbow"
  | "gravityGun"
  | "shotgun"
  | "grenade"
  | "rpg";
export type WeaponType =
  | "melee"
  | "hitscan"
  | "shotgun"
  | "grenade"
  | "rpg"
  | "crossbow"
  | "special";
export type WeaponFireMode = "semi" | "auto";
/**
 * CÃ³mo se empuÃ±a el arma â€” define la pose del AimLayer / ReloadLayer
 * del NPC. Compartido con el view-model del player. Es el subset
 * "con arma" del `WeaponHandedness` del engine (sin "none").
 */
export type WeaponHandedness = Exclude<AnimationHandedness, "none">;

/**
 * CategorÃ­a HL-style. Cada categorÃ­a se mapea a un nÃºmero de slot (1-5)
 * en `weapons.config`. Varias armas pueden compartir slot â€” la tecla
 * cicla entre ellas. Ej.: `smg` y `ar3` viven ambas en `automatic`,
 * presionar `3` alterna entre ellas.
 */
export type WeaponCategory =
  | "melee"
  | "sidearm"
  | "automatic"
  | "heavy"
  | "special"
  | "throwable";

export interface RecoilDefinition {
  vertical: number;
  horizontal: number;
  recovery: number;
}

export interface MuzzleFlashDefinition {
  color: number;
  intensity: number;
  duration: number;
  size: number;
}

/**
 * Behaviour discreto para el disparo secundario (RMB). Cada `WeaponType`
 * implementa el subset que le corresponde â€” valores no soportados se
 * ignoran silenciosamente. Si se omite, el secundario es no-op.
 */
export type AlternateFireDefinition =
  /** Shotgun: dispara dos salvas seguidas; cada pellet sale con `damageMultiplier`. */
  | {
      kind: "doubleShot";
      /** Multiplica el daÃ±o por pellet en cada salva. */
      damageMultiplier: number;
      /** Segundos entre la primera y la segunda salva. */
      shotSpacing: number;
      /** CuÃ¡ntos cartuchos consume el doble disparo. */
      shellCost: number;
    }
  /** SMG: lanzagranadas que consume de la reserva del weapon `grenade`. */
  | {
      kind: "grenadeLauncher";
      /** Velocidad inicial (m/s) de la granada lanzada. */
      launchSpeed: number;
      /** Lift vertical extra (m/s) para que se arquee un poco. */
      launchLift: number;
    }
  /** Grenade: throw mÃ¡s corto, mismo modo fuse. */
  | {
      kind: "closeThrow";
      /** Velocidad inicial al lanzar corto (m/s). */
      throwSpeed: number;
      /** Lift vertical extra (m/s). */
      throwLift: number;
    }
  /** AR3: bola de energía Combine (rebota y vaporiza). Consume munición `energyBall`. */
  | {
      kind: "energyBall";
      /** Velocidad inicial (m/s) del orbe. */
      launchSpeed: number;
    };

export interface WeaponDefinition {
  id: WeaponId;
  displayName: string;
  modelId: ModelAssetId;
  pickupModelId: ModelAssetId;
  category: WeaponCategory;
  type: WeaponType;
  handedness: WeaponHandedness;
  damage: number;
  fireRate: number;
  magazineSize: number;
  reserveAmmoMax: number;
  ammoPerPickup: number;
  spread: number;
  range: number;
  impulse: number;
  reloadTime: number;
  recoil: RecoilDefinition;
  fireMode: WeaponFireMode;
  reloadAnimationPitch: number;
  muzzleFlash: MuzzleFlashDefinition;
  canReceiveAmmoFromDuplicatePickup: boolean;
  hasAmmo: boolean;
  viewModelOffset: Vector3;
  viewModelRotation: Euler;
  viewModelScale: number;
  pickupScale: number;
  pickupCollider: Vector3;
  /** SÃ³lo para shotgun: cantidad de pellets por disparo (hitscans paralelos en cono). */
  pelletsPerShot?: number;
  /** ConfiguraciÃ³n del disparo secundario (RMB). Omitir = no tiene secundario. */
  alternateFire?: AlternateFireDefinition;
  /**
   * Duracin (s) de la animacin de swing del view model al disparar. Si es
   * 0 o undefined, no hay animacin de swing (se usa el muzzle flash + recoil
   * default). El swing combina pitch + forward con curva sinusoidal
   * (0  peak  0). til para melee.
   */
  attackAnimationDuration?: number;
  /** Pitch mximo (rad) del swing en el peak. Positivo = tilt hacia abajo. */
  attackAnimationPitch?: number;
  /** Offset forward mximo (m, eje z local de la cmara) en el peak del swing. */
  attackAnimationForward?: number;
}
