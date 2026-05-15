import { Vector3 } from "three";
import type { GameEventBus } from "../../engine/GameEvents";
import type { Raycast } from "../../physics/Raycast";
import type { WeaponDefinition } from "./WeaponDefinition";

export interface WeaponContext {
  eventBus: GameEventBus;
  raycast: Raycast;
}

export interface WeaponFireContext {
  origin: Vector3;
  direction: Vector3;
  now: number;
}

export abstract class Weapon {
  protected lastFireTime = -Infinity;
  private lastDryFireTime = -Infinity;
  protected magazine: number;
  protected reserve: number;
  private reloadingUntil = 0;

  constructor(
    readonly definition: WeaponDefinition,
    protected readonly context: WeaponContext,
  ) {
    this.magazine = definition.hasAmmo ? definition.magazineSize : 0;
    this.reserve = definition.hasAmmo
      ? Math.min(definition.ammoPerPickup, definition.reserveAmmoMax)
      : 0;
  }

  get id(): string {
    return this.definition.id;
  }

  get name(): string {
    return this.definition.displayName;
  }

  getAmmo(): number {
    return this.definition.hasAmmo ? this.magazine : 0;
  }

  getReserveAmmo(): number {
    return this.definition.hasAmmo ? this.reserve : 0;
  }

  addPickupAmmo(emit = true): number {
    if (
      !this.definition.hasAmmo ||
      !this.definition.canReceiveAmmoFromDuplicatePickup
    ) {
      return 0;
    }

    const before = this.reserve;
    this.reserve = Math.min(
      this.reserve + this.definition.ammoPerPickup,
      this.definition.reserveAmmoMax,
    );
    if (emit) {
      this.emitAmmoChanged();
    }
    return this.reserve - before;
  }

  canFire(now: number): boolean {
    if (now < this.reloadingUntil) {
      return false;
    }

    if (now - this.lastFireTime < 1 / this.definition.fireRate) {
      return false;
    }

    return !this.definition.hasAmmo || this.magazine > 0;
  }

  tryFire(fireContext: WeaponFireContext): boolean {
    if (
      this.definition.hasAmmo &&
      this.magazine <= 0 &&
      fireContext.now >= this.reloadingUntil
    ) {
      if (
        fireContext.now - this.lastDryFireTime >=
        1 / this.definition.fireRate
      ) {
        this.lastDryFireTime = fireContext.now;
        this.context.eventBus.emit("weapon.empty", {
          weaponName: this.name,
        });
      }
      return false;
    }

    if (!this.canFire(fireContext.now)) {
      return false;
    }

    this.lastFireTime = fireContext.now;
    if (this.definition.hasAmmo) {
      this.magazine = Math.max(0, this.magazine - 1);
    }

    this.context.eventBus.emit("weapon.fired", {
      weaponName: this.name,
      ammo: this.getAmmo(),
      origin: fireContext.origin,
      direction: fireContext.direction,
      range: this.definition.range,
    });
    this.performFire(fireContext);
    this.emitAmmoChanged();
    return true;
  }

  tryReload(now: number): boolean {
    if (
      !this.definition.hasAmmo ||
      this.magazine >= this.definition.magazineSize ||
      this.reserve <= 0
    ) {
      return false;
    }

    this.reloadingUntil = now + this.definition.reloadTime;
    const missing = this.definition.magazineSize - this.magazine;
    const moved = Math.min(missing, this.reserve);
    this.magazine += moved;
    this.reserve -= moved;
    this.emitAmmoChanged();
    this.context.eventBus.emit("weapon.reloaded", {
      weaponName: this.name,
      ammo: this.magazine,
      reserve: this.reserve,
    });
    return true;
  }

  isReloading(now: number): boolean {
    return now < this.reloadingUntil;
  }

  protected emitAmmoChanged(): void {
    this.context.eventBus.emit("weapon.ammo.changed", {
      current: this.getAmmo(),
      reserve: this.getReserveAmmo(),
    });
  }

  protected abstract performFire(context: WeaponFireContext): void;
}
