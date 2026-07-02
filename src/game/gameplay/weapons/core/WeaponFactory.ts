import {
  getWeaponDefinition,
  getAllWeaponDefinitions,
} from "@game/config/weapons.config";
import { GravityGunWeapon } from "@game/gameplay/weapons/types/GravityGunWeapon";
import { GrenadeWeapon } from "@game/gameplay/weapons/types/GrenadeWeapon";
import { HitscanWeapon } from "@game/gameplay/weapons/types/HitscanWeapon";
import { IceGunWeapon } from "@game/gameplay/weapons/types/IceGunWeapon";
import { Ar3Weapon } from "@game/gameplay/weapons/types/Ar3Weapon";
import { CrossbowWeapon } from "@game/gameplay/weapons/types/CrossbowWeapon";
import { MeleeWeapon } from "@game/gameplay/weapons/types/MeleeWeapon";
import { RpgWeapon } from "@game/gameplay/weapons/types/RpgWeapon";
import { ShotgunWeapon } from "@game/gameplay/weapons/types/ShotgunWeapon";
import { SmgWeapon } from "@game/gameplay/weapons/types/SmgWeapon";
import type { Weapon, WeaponContext } from "./Weapon";
import type { WeaponDefinition, WeaponId } from "./WeaponDefinition";

/**
 * FÃ¡brica data-driven de armas.
 *
 * Instancia la subclase correcta de `Weapon` discriminando por
 * `definition.type`. Para agregar un tipo nuevo: declararlo en
 * `WeaponType` + agregar una rama acÃ¡.
 */
export function createWeapon(id: WeaponId, context: WeaponContext): Weapon {
  const definition = getWeaponDefinition(id);
  return instantiateWeapon(definition, context);
}

export function getWeapon(id: WeaponId): WeaponDefinition {
  return getWeaponDefinition(id);
}

export function listWeapons(): WeaponDefinition[] {
  return getAllWeaponDefinitions();
}

function instantiateWeapon(
  definition: WeaponDefinition,
  context: WeaponContext,
): Weapon {
  switch (definition.type) {
    case "hitscan":
      if (definition.alternateFire?.kind === "grenadeLauncher") {
        return new SmgWeapon(definition, context);
      }
      if (definition.alternateFire?.kind === "energyBall") {
        return new Ar3Weapon(definition, context);
      }
      return new HitscanWeapon(definition, context);
    case "shotgun":
      return new ShotgunWeapon(definition, context);
    case "grenade":
      return new GrenadeWeapon(definition, context);
    case "rpg":
      return new RpgWeapon(definition, context);
    case "crossbow":
      return new CrossbowWeapon(definition, context);
    case "melee":
      return new MeleeWeapon(definition, context);
    case "iceGun":
      return new IceGunWeapon(definition, context);
    case "special":
      return new GravityGunWeapon(definition, context);
  }
}
