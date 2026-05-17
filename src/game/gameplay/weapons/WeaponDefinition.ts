import { Euler, Vector3 } from "three";
import type { ModelAssetId } from "../../../engine/assets/AssetManifest";

export type WeaponId = "crowbar" | "pistol" | "smg" | "ar3" | "gravityGun";
export type WeaponType = "melee" | "hitscan" | "special";
export type WeaponFireMode = "semi" | "auto";

/**
 * Categoría HL-style. Cada categoría se mapea a un número de slot (1-5)
 * en `weapons.config`. Varias armas pueden compartir slot — la tecla
 * cicla entre ellas. Ej.: `smg` y `ar3` viven ambas en `automatic`,
 * presionar `3` alterna entre ellas.
 */
export type WeaponCategory =
  | "melee"
  | "sidearm"
  | "automatic"
  | "heavy"
  | "special";

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

export interface WeaponDefinition {
  id: WeaponId;
  displayName: string;
  modelId: ModelAssetId;
  pickupModelId: ModelAssetId;
  category: WeaponCategory;
  type: WeaponType;
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
}
