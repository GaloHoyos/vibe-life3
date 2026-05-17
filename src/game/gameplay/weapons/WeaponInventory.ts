import {
  WEAPON_ORDER,
  getSlotForWeapon,
} from "../../config/weapons.config";
import type { GameEventBus } from "../../GameEvents";
import type { Weapon } from "./Weapon";
import type { WeaponId } from "./WeaponDefinition";

/**
 * Inventario HL-style: cada slot puede contener varias armas, agrupadas
 * por `category`. `equipSlot(n)` equipa la primera arma del slot; si ya
 * había una equipada en ese mismo slot, cicla a la siguiente. Las flechas
 * (`next/previousWeapon`) ciclan por todo el inventario.
 */
export class WeaponInventory {
  private readonly weapons = new Map<WeaponId, Weapon>();
  private activeId: WeaponId | null = null;

  constructor(private readonly eventBus: GameEventBus) {}

  addWeapon(weapon: Weapon): boolean {
    const id = weapon.definition.id;
    if (this.weapons.has(id)) {
      return false;
    }

    this.weapons.set(id, weapon);
    if (!this.activeId) {
      this.equipWeapon(id);
    }
    return true;
  }

  hasWeapon(id: WeaponId): boolean {
    return this.weapons.has(id);
  }

  getWeapon(id: WeaponId): Weapon | null {
    return this.weapons.get(id) ?? null;
  }

  getActiveWeapon(): Weapon | null {
    return this.activeId ? this.weapons.get(this.activeId) ?? null : null;
  }

  equipWeapon(id: WeaponId): Weapon | null {
    const weapon = this.weapons.get(id);
    if (!weapon) {
      return null;
    }

    this.activeId = id;
    this.emitWeaponChanged(weapon);
    return weapon;
  }

  /**
   * Equipa o cicla dentro del slot HL-style. Si la activa ya pertenece al
   * slot, avanza a la siguiente en el orden canónico. Si no, equipa la
   * primera del slot. Devuelve null si el slot está vacío.
   */
  equipSlot(slot: number): Weapon | null {
    const inSlot = this.orderedWeaponsInSlot(slot);
    if (inSlot.length === 0) {
      return null;
    }

    const activeIndex = inSlot.findIndex(
      (weapon) => weapon.definition.id === this.activeId,
    );
    const nextIndex =
      activeIndex < 0 ? 0 : (activeIndex + 1) % inSlot.length;
    const target = inSlot[nextIndex];
    if (target.definition.id === this.activeId) {
      return target;
    }
    return this.equipWeapon(target.definition.id);
  }

  nextWeapon(): Weapon | null {
    return this.cycle(1);
  }

  previousWeapon(): Weapon | null {
    return this.cycle(-1);
  }

  /** Id del arma que vendría después en el cycling, sin equiparla. */
  peekNextWeaponId(): WeaponId | null {
    return this.peekCycle(1);
  }

  /** Id del arma anterior en el cycling, sin equiparla. */
  peekPreviousWeaponId(): WeaponId | null {
    return this.peekCycle(-1);
  }

  isEmpty(): boolean {
    return this.weapons.size === 0;
  }

  /** Armas en el slot indicado, en el orden canónico de `WEAPON_ORDER`. */
  getWeaponsInSlot(slot: number): Weapon[] {
    return this.orderedWeaponsInSlot(slot);
  }

  private orderedWeapons(): Weapon[] {
    return WEAPON_ORDER.map((id) => this.weapons.get(id)).filter(
      (weapon): weapon is Weapon => weapon !== undefined,
    );
  }

  private orderedWeaponsInSlot(slot: number): Weapon[] {
    return this.orderedWeapons().filter(
      (weapon) => getSlotForWeapon(weapon.definition.id) === slot,
    );
  }

  private cycle(direction: 1 | -1): Weapon | null {
    const target = this.peekCycle(direction);
    return target ? this.equipWeapon(target) : null;
  }

  private peekCycle(direction: 1 | -1): WeaponId | null {
    const ordered = this.orderedWeapons();
    if (ordered.length === 0) {
      return null;
    }

    const activeIndex = Math.max(
      0,
      ordered.findIndex((weapon) => weapon.definition.id === this.activeId),
    );
    const nextIndex =
      (activeIndex + direction + ordered.length) % ordered.length;
    return ordered[nextIndex].definition.id;
  }

  private emitWeaponChanged(weapon: Weapon): void {
    this.eventBus.emit("weapon.changed", {
      weaponName: weapon.name,
      ammo: weapon.getAmmo(),
      reserve: weapon.getReserveAmmo(),
    });
    this.eventBus.emit("weapon.ammo.changed", {
      current: weapon.getAmmo(),
      reserve: weapon.getReserveAmmo(),
    });
  }
}
