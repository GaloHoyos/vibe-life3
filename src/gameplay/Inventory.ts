import type { Weapon } from './weapons/Weapon';

export class Inventory {
  private readonly weapons: Weapon[] = [];
  private activeIndex = 0;

  addWeapon(weapon: Weapon): void {
    this.weapons.push(weapon);
  }

  getActiveWeapon(): Weapon | null {
    return this.weapons[this.activeIndex] ?? null;
  }

  select(index: number): void {
    if (index < 0 || index >= this.weapons.length) {
      return;
    }

    this.activeIndex = index;
  }
}
