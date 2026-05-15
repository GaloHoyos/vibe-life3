import type { GameEventBus } from "../../GameEvents";
import type { Weapon } from './Weapon';
import type { WeaponId } from './WeaponDefinition';

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

  equipSlot(slot: number): Weapon | null {
    const weapon = [...this.weapons.values()]
      .sort((a, b) => a.definition.slot - b.definition.slot)
      .find((candidate) => candidate.definition.slot === slot);

    return weapon ? this.equipWeapon(weapon.definition.id) : null;
  }

  nextWeapon(): Weapon | null {
    return this.cycle(1);
  }

  previousWeapon(): Weapon | null {
    return this.cycle(-1);
  }

  isEmpty(): boolean {
    return this.weapons.size === 0;
  }

  private cycle(direction: 1 | -1): Weapon | null {
    const ordered = [...this.weapons.values()].sort((a, b) => a.definition.slot - b.definition.slot);
    if (ordered.length === 0) {
      return null;
    }

    const activeIndex = Math.max(0, ordered.findIndex((weapon) => weapon.definition.id === this.activeId));
    const nextIndex = (activeIndex + direction + ordered.length) % ordered.length;
    return this.equipWeapon(ordered[nextIndex].definition.id);
  }

  private emitWeaponChanged(weapon: Weapon): void {
    this.eventBus.emit('weapon.changed', {
      weaponName: weapon.name,
      ammo: weapon.getAmmo(),
      reserve: weapon.getReserveAmmo(),
    });
    this.eventBus.emit('weapon.ammo.changed', {
      current: weapon.getAmmo(),
      reserve: weapon.getReserveAmmo(),
    });
  }
}
