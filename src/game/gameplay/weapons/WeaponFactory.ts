import {
  getWeaponDefinition,
  getAllWeaponDefinitions,
} from "../../config/weapons.config";
import { GravityGunWeapon } from "./GravityGunWeapon";
import { HitscanWeapon } from "./HitscanWeapon";
import { MeleeWeapon } from "./MeleeWeapon";
import type { Weapon, WeaponContext } from "./Weapon";
import type { WeaponDefinition, WeaponId } from "./WeaponDefinition";

/**
 * Fábrica data-driven de armas.
 *
 * Instancia la subclase correcta de `Weapon` discriminando por
 * `definition.type`. Para agregar un tipo nuevo: declararlo en
 * `WeaponType` + agregar una rama acá.
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
