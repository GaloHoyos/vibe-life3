import {
  AmmoDefinitions,
  type AmmoId,
} from "@game/config/ammo.config";
import type { WeaponId } from "./WeaponDefinition";

export interface AmmoLoadoutEntry {
  id: AmmoId;
  amount: number;
}

export class AmmoInventory {
  private readonly reserves = new Map<AmmoId, number>();

  get(id: AmmoId): number {
    return this.reserves.get(id) ?? 0;
  }

  getForWeapon(weaponId: WeaponId): number {
    const ammoId = ammoIdForWeapon(weaponId);
    return ammoId ? this.get(ammoId) : 0;
  }

  add(id: AmmoId, amount = AmmoDefinitions[id].amount): number {
    if (amount <= 0) {
      return 0;
    }
    const definition = AmmoDefinitions[id];
    const before = this.get(id);
    const next = Math.min(definition.max, before + amount);
    this.reserves.set(id, next);
    return next - before;
  }

  addForWeapon(weaponId: WeaponId, amount?: number): number {
    const ammoId = ammoIdForWeapon(weaponId);
    return ammoId ? this.add(ammoId, amount) : 0;
  }

  consume(id: AmmoId, amount: number): boolean {
    if (amount <= 0) {
      return true;
    }
    const before = this.get(id);
    if (before < amount) {
      return false;
    }
    this.reserves.set(id, before - amount);
    return true;
  }

  consumeForWeapon(weaponId: WeaponId, amount: number): boolean {
    const ammoId = ammoIdForWeapon(weaponId);
    return ammoId ? this.consume(ammoId, amount) : false;
  }

  set(id: AmmoId, amount: number): void {
    const max = AmmoDefinitions[id].max;
    this.reserves.set(id, Math.max(0, Math.min(amount, max)));
  }

  setForWeapon(weaponId: WeaponId, amount: number): void {
    const ammoId = ammoIdForWeapon(weaponId);
    if (ammoId) {
      this.set(ammoId, amount);
    }
  }

  capture(): AmmoLoadoutEntry[] {
    return Object.keys(AmmoDefinitions).map((id) => ({
      id: id as AmmoId,
      amount: this.get(id as AmmoId),
    }));
  }

  restore(entries: readonly AmmoLoadoutEntry[]): void {
    this.clear();
    for (const entry of entries) {
      if (entry.id in AmmoDefinitions) {
        this.set(entry.id, entry.amount);
      }
    }
  }

  clear(): void {
    this.reserves.clear();
  }
}

export function ammoIdForWeapon(weaponId: WeaponId): AmmoId | null {
  return weaponId in AmmoDefinitions ? (weaponId as AmmoId) : null;
}
