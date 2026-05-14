import { Vector3 } from 'three';
import type { GameEventBus } from '../../engine/GameEvents';

export interface WeaponContext {
  eventBus: GameEventBus;
}

export abstract class Weapon {
  protected lastFireTime = -Infinity;

  constructor(
    readonly name: string,
    protected readonly context: WeaponContext,
    protected ammo: number,
    protected reserveAmmo: number,
    protected cooldown: number,
  ) {}

  getAmmo(): number {
    return this.ammo;
  }

  getReserveAmmo(): number {
    return this.reserveAmmo;
  }

  canFire(now: number): boolean {
    return this.ammo > 0 && now - this.lastFireTime >= this.cooldown;
  }

  tryFire(origin: Vector3, direction: Vector3, now: number): boolean {
    if (!this.canFire(now)) {
      return false;
    }

    this.lastFireTime = now;
    this.ammo -= 1;
    this.context.eventBus.emit('weapon.fired', {
      weaponName: this.name,
      ammo: this.ammo,
      origin,
      direction,
    });
    this.context.eventBus.emit('ammo.changed', {
      current: this.ammo,
      reserve: this.reserveAmmo,
    });
    this.fire(origin, direction);
    return true;
  }

  protected abstract fire(origin: Vector3, direction: Vector3): void;
}
