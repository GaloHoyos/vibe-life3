import {
  WEAPON_ORDER,
  getSlotForWeapon,
} from "@game/config/weapons.config";
import type { GameEventBus } from "@game/GameEvents";
import type { Weapon } from "./Weapon";
import type { WeaponId } from "./WeaponDefinition";

/**
 * Inventario HL-style: cada slot puede contener varias armas, agrupadas
 * por `category`. `equipSlot(n)` equipa la primera arma del slot; si ya
 * habÃ­a una equipada en ese mismo slot, cicla a la siguiente. Las flechas
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

  getActiveWeaponId(): WeaponId | null {
    return this.activeId;
  }

  equipWeapon(id: WeaponId): Weapon | null {
    const weapon = this.weapons.get(id);
    if (!weapon || !this.isWeaponSelectable(id)) {
      return null;
    }

    this.activeId = id;
    this.emitWeaponChanged(weapon);
    return weapon;
  }

  /**
   * Equipa o cicla dentro del slot HL-style. Si la activa ya pertenece al
   * slot, avanza a la siguiente en el orden canÃ³nico. Si no, equipa la
   * primera del slot. Devuelve null si el slot estÃ¡ vacÃ­o.
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
    return this.cycle(1, true);
  }

  previousWeapon(): Weapon | null {
    return this.cycle(-1, true);
  }

  /** Id del arma que vendrÃ­a despuÃ©s en el cycling, sin equiparla. */
  peekNextWeaponId(): WeaponId | null {
    return this.peekCycle(1, true);
  }

  /** Id del arma anterior en el cycling, sin equiparla. */
  peekPreviousWeaponId(): WeaponId | null {
    return this.peekCycle(-1, true);
  }

  isEmpty(): boolean {
    return this.weapons.size === 0;
  }

  /** Armas en el slot indicado, en el orden canÃ³nico de `WEAPON_ORDER`. */
  getWeaponsInSlot(slot: number): Weapon[] {
    return this.orderedWeaponsInSlot(slot);
  }

  isWeaponSelectable(id: WeaponId): boolean {
    const weapon = this.weapons.get(id);
    if (!weapon) {
      return false;
    }
    return id !== "grenade" || weapon.getAmmo() > 0;
  }

  getSecondaryAmmoForWeapon(id: WeaponId): number | undefined {
    if (id !== "smg") {
      return undefined;
    }
    return this.weapons.get("grenade")?.getAmmo() ?? 0;
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

  private cycle(direction: 1 | -1, selectableOnly = false): Weapon | null {
    const target = this.peekCycle(direction, selectableOnly);
    return target ? this.equipWeapon(target) : null;
  }

  private peekCycle(direction: 1 | -1, selectableOnly = false): WeaponId | null {
    const ordered = this.orderedWeapons();
    if (ordered.length === 0) {
      return null;
    }

    const activeIndex = Math.max(
      0,
      ordered.findIndex((weapon) => weapon.definition.id === this.activeId),
    );
    for (let step = 1; step <= ordered.length; step += 1) {
      const nextIndex =
        (activeIndex + direction * step + ordered.length) % ordered.length;
      const id = ordered[nextIndex].definition.id;
      if (!selectableOnly || this.isWeaponSelectable(id)) {
        return id;
      }
    }
    return null;
  }

  private emitWeaponChanged(weapon: Weapon): void {
    this.eventBus.emit("weapon.changed", {
      weaponId: weapon.definition.id,
      weaponName: weapon.name,
      ammo: weapon.getAmmo(),
      reserve: weapon.getReserveAmmo(),
      secondaryAmmo: this.getSecondaryAmmoForWeapon(weapon.definition.id),
    });
    this.eventBus.emit("weapon.ammo.changed", {
      weaponId: weapon.definition.id,
      current: weapon.getAmmo(),
      reserve: weapon.getReserveAmmo(),
    });
  }
}
