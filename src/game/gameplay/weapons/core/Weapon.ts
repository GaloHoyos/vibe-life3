import { Quaternion, Vector3 } from "three";
import type { GameEventBus } from "@game/GameEvents";
import type { Raycast } from "@engine/physics/Raycast";
import type { GrenadeSystem } from "@game/gameplay/weapons/grenade/GrenadeSystem";
import type { RocketSystem } from "@game/gameplay/weapons/rocket/RocketSystem";
import type { BoltSystem } from "@game/gameplay/weapons/bolt/BoltSystem";
import type { EnergyBallSystem } from "@game/gameplay/weapons/energyball/EnergyBallSystem";
import type { IceGunSystem } from "@game/gameplay/weapons/ice/IceGunSystem";
import type { AmmoInventory } from "./AmmoInventory";
import type { WeaponDefinition } from "./WeaponDefinition";
import type { WeaponInventory } from "./WeaponInventory";

export interface WeaponContext {
  eventBus: GameEventBus;
  raycast: Raycast;
  /** Sistema de granadas activas. Lo usan `GrenadeWeapon` y el secundario del SMG. */
  grenades: GrenadeSystem;
  /** Sistema de cohetes guiados. Lo usa el RPG del jugador. */
  rockets: RocketSystem;
  /** Sistema de bolts balísticos. Lo usa el crossbow del jugador. */
  bolts: BoltSystem;
  /** Sistema de bolas de energía Combine. Lo usa el secundario del AR3. */
  energyBalls: EnergyBallSystem;
  /** Sistema de hielo Blobulator-style. Lo usa el Ice Gun. */
  iceGun: IceGunSystem;
  /** Reserva global de munición por tipo; las armas guardan solo cargador. */
  ammo: AmmoInventory;
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
  private reloadingUntil = 0;

  constructor(
    readonly definition: WeaponDefinition,
    protected readonly context: WeaponContext,
  ) {
    this.magazine = definition.hasAmmo ? definition.magazineSize : 0;
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
    return this.definition.hasAmmo
      ? this.context.ammo.getForWeapon(this.definition.id)
      : 0;
  }

  addPickupAmmo(emit = true): number {
    if (
      !this.definition.hasAmmo ||
      !this.definition.canReceiveAmmoFromDuplicatePickup
    ) {
      return 0;
    }

    const gained = this.context.ammo.addForWeapon(
      this.definition.id,
      this.definition.ammoPerPickup,
    );
    if (emit) {
      this.emitAmmoChanged();
    }
    return gained;
  }

  /**
   * Fija munición de cargador y reserva a valores exactos (restauración de
   * loadout en respawn). No emite: el `WeaponController` emite al equipar.
   */
  restoreAmmo(magazine: number, reserve: number): void {
    if (!this.definition.hasAmmo) {
      return;
    }
    this.magazine = Math.max(0, Math.min(magazine, this.definition.magazineSize));
    this.context.ammo.setForWeapon(this.definition.id, reserve);
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
      sourceId: "player",
      sourceKind: "player",
      sourceFaction: "player",
    });
    const fireNoiseRadius =
      this.definition.noise?.fireRadius ??
      defaultFireNoiseRadius(this.definition.type, this.definition.range);
    // Un swing de melee al aire no hace ruido: radio 0 => no se emite. El
    // impacto real de melee lo emite `MeleeWeapon` desde el punto de golpe.
    if (fireNoiseRadius > 0) {
      this.context.eventBus.emit("world.noise", {
        kind:
          this.definition.noise?.fireKind ??
          (this.definition.type === "melee" ? "impact" : "gunshot"),
        position: fireContext.origin.clone(),
        radius: fireNoiseRadius,
        sourceId: "player",
        sourceFaction: "player",
      });
    }
    this.performFire(fireContext);
    this.emitAmmoChanged();
    return true;
  }

  tryReload(now: number): boolean {
    if (
      !this.definition.hasAmmo ||
      this.magazine >= this.definition.magazineSize ||
      this.getReserveAmmo() <= 0
    ) {
      return false;
    }

    this.reloadingUntil = now + this.definition.reloadTime;
    const missing = this.definition.magazineSize - this.magazine;
    const moved = Math.min(missing, this.getReserveAmmo());
    if (!this.context.ammo.consumeForWeapon(this.definition.id, moved)) {
      return false;
    }
    this.magazine += moved;
    this.emitAmmoChanged();
    this.context.eventBus.emit("weapon.reloaded", {
      weaponName: this.name,
      ammo: this.magazine,
      reserve: this.getReserveAmmo(),
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
   * FOV objetivo (grados) cuando el arma fuerza un zoom de mira. `null` =
   * sin zoom (FOV default). El `WeaponController` lerpea la cámara hacia este
   * valor cada frame. Default sin zoom; el crossbow lo sobrescribe al estar scoped.
   */
  getZoomFov(): number | null {
    return null;
  }

  /**
   * Llamado cuando esta arma deja de ser la activa (switch o pickup). Las
   * armas con estado externo (props holdeados, charge, etc.) deben liberar
   * recursos acá.
   */
  onUnequip(): void {}

  protected abstract performFire(context: WeaponFireContext): void;
}

function defaultFireNoiseRadius(
  type: WeaponDefinition["type"],
  range: number,
): number {
  // Melee y especial (gravity gun) no hacen ruido al usarse: el ruido nace
  // del impacto real, no del gesto.
  if (type === "melee" || type === "special") {
    return 0;
  }
  if (type === "grenade") {
    return 18;
  }
  if (type === "rpg") {
    return 60;
  }
  return Math.max(24, Math.min(range * 0.6, 55));
}
