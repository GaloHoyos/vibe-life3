import { Quaternion, Vector3 } from "three";
import type { GameEventBus } from "@game/GameEvents";
import type { Raycast } from "@engine/physics/Raycast";
import type { GrenadeSystem } from "@game/gameplay/weapons/grenade/GrenadeSystem";
import type { WeaponDefinition } from "./WeaponDefinition";
import type { WeaponInventory } from "./WeaponInventory";

export interface WeaponContext {
  eventBus: GameEventBus;
  raycast: Raycast;
  /** Sistema de granadas activas. Lo usan `GrenadeWeapon` y el secundario del SMG. */
  grenades: GrenadeSystem;
  /**
   * Inventario del jugador. Permite a un arma consultar otra (ej. SMG-alt
   * mira la reserva del `grenade`). Es un getter porque el inventario
   * existe antes que cualquier arma â€” lazy para evitar ciclos.
   */
  getInventory: () => WeaponInventory;
}

export interface WeaponFireContext {
  origin: Vector3;
  direction: Vector3;
  /** Orientación completa de la cámara. Necesario para armas que rotan props (gravity gun). */
  cameraQuaternion: Quaternion;
  now: number;
}

export interface WeaponUpdateContext {
  delta: number;
  elapsed: number;
  /** Posición de la cámara (igual al `origin` de un `tryFire`). */
  origin: Vector3;
  /** Dirección de mira normalizada. */
  direction: Vector3;
  /** Orientación completa de la cámara. */
  cameraQuaternion: Quaternion;
  alternateHeld: boolean;
  ownerGrounded: boolean;
}

export interface WeaponAlternateFireContext extends WeaponFireContext {
  /** True en el frame en que RMB pasó a estar pulsado. */
  pressed: boolean;
  /** True mientras RMB esté sostenido. */
  held: boolean;
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
      weaponType: this.definition.type,
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
      weaponId: this.definition.id,
      current: this.getAmmo(),
      reserve: this.getReserveAmmo(),
    });
  }

  /**
   * Hook por-frame para armas con estado continuo (ej. gravity gun
   * posicionando el prop holdeado). Default no-op.
   */
  update(_delta: number, _context: WeaponUpdateContext): void {}

  /**
   * Llamado cuando RMB cambia de estado. Default no-op. Sirve para grab/drop,
   * ADS, etc. Las armas que no necesitan acción secundaria lo ignoran.
   */
  tryAlternateFire(_context: WeaponAlternateFireContext): void {}

  /**
   * Llamado cuando esta arma deja de ser la activa (switch o pickup). Las
   * armas con estado externo (props holdeados, charge, etc.) deben liberar
   * recursos acá.
   */
  onUnequip(): void {}

  protected abstract performFire(context: WeaponFireContext): void;
}
