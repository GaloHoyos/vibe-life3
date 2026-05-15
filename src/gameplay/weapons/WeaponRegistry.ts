import { Euler, Vector3 } from 'three';
import type { GameEventBus } from '../../engine/GameEvents';
import type { Raycast } from '../../physics/Raycast';
import type { Weapon } from './Weapon';
import type { WeaponDefinition, WeaponId } from './WeaponDefinition';
import { AR3 } from './weapons/AR3';
import { Crowbar } from './weapons/Crowbar';
import { GravityGun } from './weapons/GravityGun';
import { Pistol } from './weapons/Pistol';
import { SMG } from './weapons/SMG';

export interface WeaponCreateContext {
  eventBus: GameEventBus;
  raycast: Raycast;
}

export const WeaponDefinitions: Record<WeaponId, WeaponDefinition> = {
  crowbar: {
    id: 'crowbar',
    displayName: 'Crowbar',
    modelId: 'crowbar',
    pickupModelId: 'crowbar',
    slot: 1,
    type: 'melee',
    damage: 25,
    fireRate: 2.2,
    magazineSize: 0,
    reserveAmmoMax: 0,
    ammoPerPickup: 0,
    spread: 0,
    range: 1.6,
    impulse: 5,
    reloadTime: 0,
    recoil: { vertical: 0.05, horizontal: 0.02, recovery: 10 },
    muzzleFlash: { color: 0xffb24a, intensity: 0.8, duration: 0.06, size: 0.08 },
    canReceiveAmmoFromDuplicatePickup: false,
    hasAmmo: false,
    viewModelOffset: new Vector3(0.22, -0.28, -0.7),
    viewModelRotation: new Euler(0.15, -0.35, -0.22),
    viewModelScale: 0.24,
    pickupScale: 0.55,
    pickupCollider: new Vector3(0.9, 0.18, 0.18),
  },
  pistol: {
    id: 'pistol',
    displayName: '9mm Pistol',
    modelId: 'pistol',
    pickupModelId: 'pistol',
    slot: 2,
    type: 'hitscan',
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
    muzzleFlash: { color: 0xffb24a, intensity: 1.4, duration: 0.055, size: 0.11 },
    canReceiveAmmoFromDuplicatePickup: true,
    hasAmmo: true,
    viewModelOffset: new Vector3(0.28, -0.22, -0.55),
    viewModelRotation: new Euler(0, -0.08, 0),
    viewModelScale: 0.22,
    pickupScale: 0.38,
    pickupCollider: new Vector3(0.42, 0.22, 0.28),
  },
  smg: {
    id: 'smg',
    displayName: 'SMG',
    modelId: 'smg',
    pickupModelId: 'smg',
    slot: 3,
    type: 'hitscan',
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
    muzzleFlash: { color: 0xff9a2d, intensity: 1.2, duration: 0.04, size: 0.1 },
    canReceiveAmmoFromDuplicatePickup: true,
    hasAmmo: true,
    viewModelOffset: new Vector3(0.25, -0.28, -0.72),
    viewModelRotation: new Euler(0.02, -0.12, 0),
    viewModelScale: 0.24,
    pickupScale: 0.42,
    pickupCollider: new Vector3(0.72, 0.24, 0.32),
  },
  ar3: {
    id: 'ar3',
    displayName: 'AR3',
    modelId: 'ar3',
    pickupModelId: 'ar3',
    slot: 4,
    type: 'hitscan',
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
    muzzleFlash: { color: 0xffb24a, intensity: 1.25, duration: 0.045, size: 0.11 },
    canReceiveAmmoFromDuplicatePickup: true,
    hasAmmo: true,
    viewModelOffset: new Vector3(0.25, -0.27, -0.78),
    viewModelRotation: new Euler(0.02, -0.1, 0),
    viewModelScale: 0.24,
    pickupScale: 0.42,
    pickupCollider: new Vector3(0.82, 0.24, 0.32),
  },
  gravityGun: {
    id: 'gravityGun',
    displayName: 'Gravity Gun',
    modelId: 'gravityGun',
    pickupModelId: 'gravityGun',
    slot: 5,
    type: 'special',
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
    muzzleFlash: { color: 0x73dfff, intensity: 0.8, duration: 0.08, size: 0.14 },
    canReceiveAmmoFromDuplicatePickup: false,
    hasAmmo: false,
    viewModelOffset: new Vector3(0.24, -0.3, -0.76),
    viewModelRotation: new Euler(0.02, -0.13, 0),
    viewModelScale: 0.22,
    pickupScale: 0.38,
    pickupCollider: new Vector3(0.86, 0.34, 0.38),
  },
};

export class WeaponRegistry {
  static get(id: WeaponId): WeaponDefinition {
    return WeaponDefinitions[id];
  }

  static all(): WeaponDefinition[] {
    return Object.values(WeaponDefinitions).sort((a, b) => a.slot - b.slot);
  }

  static create(id: WeaponId, context: WeaponCreateContext): Weapon {
    const definition = WeaponDefinitions[id];
    if (id === 'crowbar') return new Crowbar(definition, context);
    if (id === 'pistol') return new Pistol(definition, context);
    if (id === 'smg') return new SMG(definition, context);
    if (id === 'ar3') return new AR3(definition, context);
    return new GravityGun(definition, context);
  }
}
