import { Euler, Vector3 } from "three";
import type {
  WeaponCategory,
  WeaponDefinition,
  WeaponId,
} from "../gameplay/weapons/WeaponDefinition";

/**
 * Mapa categoría → número de slot HL-style. Varias armas con la misma
 * categoría comparten slot (la tecla del slot cicla entre ellas en
 * `WeaponInventory.equipSlot`).
 */
export const SlotByCategory: Record<WeaponCategory, number> = {
  melee: 1,
  special: 1,
  sidearm: 2,
  automatic: 3,
  heavy: 4,
};

/** Cuántos slots hay en total. Usado por `WeaponController` para iterar las teclas. */
export const WEAPON_SLOT_COUNT = 4;

/**
 * Configuración data-driven de todas las armas del juego.
 *
 * Agregar un arma nueva = añadir una entrada acá + (si su comportamiento no
 * encaja en hitscan/melee/special) crear una subclase de `Weapon`.
 * El factory en `WeaponFactory.createWeapon` la instancia según `type`.
 *
 * El orden de declaración define el orden de cycling dentro de un slot —
 * `smg` antes que `ar3` ⇒ presionar `3` con ambas equipadas alterna en ese
 * orden.
 */
export const WeaponDefinitions: Record<WeaponId, WeaponDefinition> = {
  crowbar: {
    id: "crowbar",
    displayName: "Crowbar",
    modelId: "crowbar",
    pickupModelId: "crowbar",
    category: "melee",
    type: "melee",
    handedness: "oneHanded",
    damage: 25,
    fireRate: 2.2,
    magazineSize: 0,
    reserveAmmoMax: 0,
    ammoPerPickup: 0,
    spread: 0,
    range: 1.8,
    impulse: 5,
    reloadTime: 0,
    recoil: { vertical: 0.05, horizontal: 0.02, recovery: 10 },
    fireMode: "semi",
    reloadAnimationPitch: 0.32,
    muzzleFlash: {
      color: 0xffb24a,
      intensity: 0.8,
      duration: 0.06,
      size: 0.08,
    },
    canReceiveAmmoFromDuplicatePickup: false,
    hasAmmo: false,
    viewModelOffset: new Vector3(0.14, -0.22, -0.5),
    viewModelRotation: new Euler(0.15, -0.35, -0.22),
    viewModelScale: 0.28,
    pickupScale: 0.55,
    pickupCollider: new Vector3(0.9, 0.18, 0.18),
  },
  pistol: {
    id: "pistol",
    displayName: "9mm Pistol",
    modelId: "pistol",
    pickupModelId: "pistol",
    category: "sidearm",
    type: "hitscan",
    handedness: "oneHanded",
    damage: 18,
    fireRate: 4,
    magazineSize: 18,
    reserveAmmoMax: 90,
    ammoPerPickup: 18,
    spread: 0.01,
    range: 85,
    impulse: 6,
    reloadTime: 1.05,
    recoil: { vertical: 0.06, horizontal: 0.025, recovery: 12 },
    fireMode: "semi",
    reloadAnimationPitch: 0.38,
    muzzleFlash: {
      color: 0xffb24a,
      intensity: 1.4,
      duration: 0.055,
      size: 0.11,
    },
    canReceiveAmmoFromDuplicatePickup: true,
    hasAmmo: true,
    viewModelOffset: new Vector3(0.28, -0.22, -0.55),
    viewModelRotation: new Euler(0, -0.08, 0),
    viewModelScale: 0.22,
    pickupScale: 0.38,
    pickupCollider: new Vector3(0.42, 0.22, 0.28),
  },
  smg: {
    id: "smg",
    displayName: "SMG",
    modelId: "smg",
    pickupModelId: "smg",
    category: "automatic",
    type: "hitscan",
    handedness: "twoHanded",
    damage: 9,
    fireRate: 12,
    magazineSize: 45,
    reserveAmmoMax: 225,
    ammoPerPickup: 45,
    spread: 0.035,
    range: 70,
    impulse: 4,
    reloadTime: 1.35,
    recoil: { vertical: 0.035, horizontal: 0.035, recovery: 14 },
    fireMode: "auto",
    reloadAnimationPitch: 0.44,
    muzzleFlash: { color: 0xff9a2d, intensity: 1.2, duration: 0.04, size: 0.1 },
    canReceiveAmmoFromDuplicatePickup: true,
    hasAmmo: true,
    viewModelOffset: new Vector3(0.16, -0.22, -0.46),
    viewModelRotation: new Euler(0.02, -0.12, 0),
    viewModelScale: 0.28,
    pickupScale: 0.42,
    pickupCollider: new Vector3(0.72, 0.24, 0.32),
  },
  ar3: {
    id: "ar3",
    displayName: "AR3",
    modelId: "ar3",
    pickupModelId: "ar3",
    category: "automatic",
    type: "hitscan",
    handedness: "twoHanded",
    damage: 14,
    fireRate: 8,
    magazineSize: 30,
    reserveAmmoMax: 180,
    ammoPerPickup: 30,
    spread: 0.018,
    range: 100,
    impulse: 5,
    reloadTime: 1.45,
    recoil: { vertical: 0.045, horizontal: 0.025, recovery: 13 },
    fireMode: "auto",
    reloadAnimationPitch: 0.46,
    muzzleFlash: {
      color: 0xffb24a,
      intensity: 1.25,
      duration: 0.045,
      size: 0.11,
    },
    canReceiveAmmoFromDuplicatePickup: true,
    hasAmmo: true,
    viewModelOffset: new Vector3(0.17, -0.21, -0.5),
    viewModelRotation: new Euler(0.02, -0.1, 0),
    viewModelScale: 0.29,
    pickupScale: 0.42,
    pickupCollider: new Vector3(0.82, 0.24, 0.32),
  },
  gravityGun: {
    id: "gravityGun",
    displayName: "Gravity Gun",
    modelId: "gravityGun",
    pickupModelId: "gravityGun",
    category: "special",
    type: "special",
    handedness: "twoHanded",
    damage: 0,
    fireRate: 1.5,
    magazineSize: 0,
    reserveAmmoMax: 0,
    ammoPerPickup: 0,
    spread: 0,
    range: 0,
    impulse: 0,
    reloadTime: 0,
    recoil: { vertical: 0.025, horizontal: 0.01, recovery: 9 },
    fireMode: "semi",
    reloadAnimationPitch: 0.35,
    muzzleFlash: {
      color: 0x73dfff,
      intensity: 0.8,
      duration: 0.08,
      size: 0.14,
    },
    canReceiveAmmoFromDuplicatePickup: false,
    hasAmmo: false,
    viewModelOffset: new Vector3(0.14, -0.24, -0.5),
    viewModelRotation: new Euler(0.02, -0.13, 0),
    viewModelScale: 0.26,
    pickupScale: 0.38,
    pickupCollider: new Vector3(0.86, 0.34, 0.38),
  },
};

/**
 * Orden canónico de las armas. Define el orden de cycling dentro de un slot
 * y es el orden de declaración del `WeaponDefinitions`. Cambiar el orden acá
 * cambia cómo cicla cada slot.
 */
export const WEAPON_ORDER: readonly WeaponId[] = Object.keys(
  WeaponDefinitions,
) as WeaponId[];

export function getWeaponDefinition(id: WeaponId): WeaponDefinition {
  return WeaponDefinitions[id];
}

export function getAllWeaponDefinitions(): WeaponDefinition[] {
  return WEAPON_ORDER.map((id) => WeaponDefinitions[id]);
}

export function getSlotForCategory(category: WeaponCategory): number {
  return SlotByCategory[category];
}

export function getSlotForWeapon(id: WeaponId): number {
  return SlotByCategory[WeaponDefinitions[id].category];
}

/** Límites globales del sistema de efectos de armas. */
export const WeaponEffectsConfig = {
  /** Máximo de tracers (líneas de disparo) en escena simultáneos. */
  maxTracers: 24,
  /** Máximo de decals (marcas de impacto) en escena simultáneos. */
  maxDecals: 48,
  /** Duración (s) del tracer antes de desvanecerse. */
  tracerDuration: 0.06,
  /** Duración (s) del decal antes de desvanecerse. */
  decalDuration: 16,
} as const;
