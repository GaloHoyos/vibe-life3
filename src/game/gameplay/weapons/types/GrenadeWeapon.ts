import { Vector3 } from "three";
import {
  Weapon,
  type WeaponAlternateFireContext,
  type WeaponContext,
  type WeaponFireContext,
} from "@game/gameplay/weapons/core/Weapon";
import type { WeaponDefinition } from "@game/gameplay/weapons/core/WeaponDefinition";

const DEFAULT_THROW_SPEED = 22;
const DEFAULT_THROW_LIFT = 3;
const SPAWN_OFFSET = 0.6;

/**
 * Arma "throwable" estilo HL2.
 *
 * Las granadas viven en `reserve` (no hay magazine). Tanto el throw largo
 * (LMB) como el corto (RMB, `alternateFire.closeThrow`) consumen una de
 * la reserva y spawnean una granada `fuse` en `GrenadeSystem`.
 *
 * El SMG-alt tambin consume de esta reserva  va `tryConsumeAmmo()`
 * cuando dispara su lanzagranadas.
 */
export class GrenadeWeapon extends Weapon {
  constructor(definition: WeaponDefinition, context: WeaponContext) {
    super(definition, context);
  }

  override getAmmo(): number {
    return this.reserve;
  }

  override getReserveAmmo(): number {
    return 0;
  }

  override canFire(now: number): boolean {
    if (now - this.lastFireTime < 1 / this.definition.fireRate) {
      return false;
    }
    return this.reserve > 0;
  }

  override tryFire(fireContext: WeaponFireContext): boolean {
    if (this.reserve <= 0) {
      this.context.eventBus.emit("weapon.empty", { weaponName: this.name });
      return false;
    }
    if (!this.canFire(fireContext.now)) {
      return false;
    }

    this.consumeOne(fireContext.now);
    this.emitFired(fireContext.origin, fireContext.direction);
    this.spawnFuseGrenade(
      fireContext.origin,
      fireContext.direction,
      DEFAULT_THROW_SPEED,
      DEFAULT_THROW_LIFT,
      fireContext.now,
    );
    this.emitAmmoChanged();
    return true;
  }

  override tryAlternateFire(context: WeaponAlternateFireContext): void {
    if (!context.pressed) {
      return;
    }
    const alt = this.definition.alternateFire;
    if (alt?.kind !== "closeThrow") {
      return;
    }
    if (this.reserve <= 0) {
      this.context.eventBus.emit("weapon.empty", { weaponName: this.name });
      return;
    }
    if (!this.canFire(context.now)) {
      return;
    }

    this.consumeOne(context.now);
    this.emitFired(context.origin, context.direction);
    this.spawnFuseGrenade(
      context.origin,
      context.direction,
      alt.throwSpeed,
      alt.throwLift,
      context.now,
    );
    this.emitAmmoChanged();
  }

  /**
   * Consume una granada sin lanzarla. Usado por el secundario del SMG
   * (`grenadeLauncher`) que comparte reserva con esta arma.
   */
  tryConsumeAmmo(): boolean {
    if (this.reserve <= 0) {
      return false;
    }
    this.reserve -= 1;
    this.emitAmmoChanged();
    return true;
  }

  protected performFire(_context: WeaponFireContext): void {
    // tryFire est sobreescrito; este abstract method no se usa pero
    // tiene que existir para satisfacer el contrato de Weapon.
  }

  private consumeOne(now: number): void {
    this.lastFireTime = now;
    this.reserve = Math.max(0, this.reserve - 1);
  }

  private emitFired(origin: Vector3, direction: Vector3): void {
    this.context.eventBus.emit("weapon.fired", {
      weaponName: this.name,
      weaponType: this.definition.type,
      ammo: this.getAmmo(),
      origin,
      direction,
      range: this.definition.range,
      sourceId: "player",
      sourceKind: "player",
      sourceFaction: "player",
    });
    this.context.eventBus.emit("world.noise", {
      kind: "movement",
      position: origin.clone(),
      radius: 10,
      sourceId: "player",
      sourceFaction: "player",
    });
  }

  private spawnFuseGrenade(
    origin: Vector3,
    direction: Vector3,
    speed: number,
    lift: number,
    now: number,
  ): void {
    const dir = direction.clone().normalize();
    const spawnOrigin = origin.clone().addScaledVector(dir, SPAWN_OFFSET);
    const velocity = dir.multiplyScalar(speed);
    velocity.y += lift;
    this.context.grenades.spawn({
      mode: "fuse",
      origin: spawnOrigin,
      velocity,
      damage: this.definition.damage,
      radius: this.definition.range,
      impulse: this.definition.impulse,
      ownerKind: "player",
      sourceId: "player",
      sourceFaction: "player",
      weaponName: this.name,
      now,
    });
  }
}
