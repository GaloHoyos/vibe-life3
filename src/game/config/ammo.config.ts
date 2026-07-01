import type { ModelAssetId } from "@engine/assets/AssetManifest";
import type { WeaponId } from "@game/gameplay/weapons/core/WeaponDefinition";
import { WeaponDefinitions } from "./weapons.config";

export type AmmoId =
  | "pistol"
  | "revolver"
  | "smg"
  | "ar3"
  | "crossbow"
  | "shotgun"
  | "rpg"
  | "grenade"
  | "energyBall";

export interface AmmoDefinition {
  id: AmmoId;
  displayName: string;
  weaponId: WeaponId;
  modelId: ModelAssetId;
  amount: number;
  max: number;
  pickupScale: number;
  pickupRadius: number;
}

export const AmmoDefinitions: Record<AmmoId, AmmoDefinition> = {
  pistol: ammo("pistol", "Municion 9mm", "pistolAmmo", 0.126, 1.35),
  revolver: ammo("revolver", "Municion .357", "revolverAmmo", 0.116, 1.35),
  smg: ammo("smg", "Municion SMG", "smgAmmo", 0.168, 1.35),
  ar3: ammo("ar3", "Municion AR3", "ar3Ammo", 0.168, 1.35),
  crossbow: ammo("crossbow", "Flechas", "crossbowAmmo", 0.199, 1.4),
  shotgun: ammo("shotgun", "Cartuchos", "shotgunAmmo", 0.147, 1.35),
  rpg: ammo("rpg", "Cohete RPG", "rpgRocket", 0.303, 1.45),
  grenade: ammo("grenade", "Granada", "grenade", 0.085, 1.35),
  // Munición secundaria del AR3 (bola de energía). No tiene arma propia: vive
  // solo en la reserva, por eso se define a mano en vez de vía `ammo()`.
  energyBall: {
    id: "energyBall",
    displayName: "Esfera de Energia",
    weaponId: "ar3",
    modelId: "ar3AltFire",
    amount: 1,
    max: 3,
    pickupScale: 0.131,
    pickupRadius: 1.4,
  },
};

export const AMMO_ORDER: readonly AmmoId[] = Object.keys(
  AmmoDefinitions,
) as AmmoId[];

export function getAmmoDefinition(id: AmmoId): AmmoDefinition {
  return AmmoDefinitions[id];
}

function ammo(
  weaponId: AmmoId & WeaponId,
  displayName: string,
  modelId: ModelAssetId,
  pickupScale: number,
  pickupRadius: number,
): AmmoDefinition {
  const weapon = WeaponDefinitions[weaponId];
  return {
    id: weaponId,
    displayName,
    weaponId,
    modelId,
    amount: weapon.ammoPerPickup,
    max: weapon.reserveAmmoMax,
    pickupScale,
    pickupRadius,
  };
}
