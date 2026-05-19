import {
  getWeaponDefinition,
  getAllWeaponDefinitions,
} from "@game/config/weapons.config";
import { GravityGunWeapon } from "@game/gameplay/weapons/types/GravityGunWeapon";
import { HitscanWeapon } from "@game/gameplay/weapons/types/HitscanWeapon";
import { MeleeWeapon } from "@game/gameplay/weapons/types/MeleeWeapon";
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
      return new HitscanWeapon(definition, context);
    case "melee":
      return new MeleeWeapon(definition, context);
    case "special":
      return new GravityGunWeapon(definition, context);
  }
}
