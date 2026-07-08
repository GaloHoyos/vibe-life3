import { Vector3 } from "three";
import {
  Weapon,
  type WeaponContext,
  type WeaponFireContext,
  type WeaponUpdateContext,
} from "@game/gameplay/weapons/core/Weapon";
import type { WeaponDefinition } from "@game/gameplay/weapons/core/WeaponDefinition";

const MUZZLE_FORWARD = 0.55;
const MUZZLE_RIGHT = 0.15;
const MUZZLE_DOWN = -0.12;

const tmpRight = new Vector3();
const tmpUp = new Vector3();

export class RpgWeapon extends Weapon {
  private activeRocketId: string | null = null;

  constructor(definition: WeaponDefinition, context: WeaponContext) {
    super(definition, context);
  }

  override tryFire(fireContext: WeaponFireContext): boolean {
    this.refreshRocketState();
    if (this.activeRocketId) {
      return false;
    }
    return super.tryFire(fireContext);
  }

  override canFire(now: number): boolean {
    this.refreshRocketState();
    if (this.activeRocketId) {
      return false;
    }
    return super.canFire(now);
  }

  override tryReload(now: number): boolean {
    this.refreshRocketState();
    if (this.activeRocketId) {
      return false;
    }
    return super.tryReload(now);
  }

  override update(_delta: number, context: WeaponUpdateContext): void {
    this.context.rockets.updateLaser("player", context.origin, context.direction);

    const hadActiveRocket = this.activeRocketId !== null;
    this.refreshRocketState();
    if (
      hadActiveRocket &&
      this.activeRocketId === null &&
      this.magazine <= 0 &&
      this.getReserveAmmo() > 0 &&
      !this.isReloading(context.elapsed)
    ) {
      super.tryReload(context.elapsed);
    }
  }

  override onUnequip(): void {
    this.context.rockets.hideLaser("player");
  }

  protected performFire(context: WeaponFireContext): void {
    const direction = context.direction.clone().normalize();
    tmpRight.set(1, 0, 0).applyQuaternion(context.cameraQuaternion).normalize();
    tmpUp.set(0, 1, 0).applyQuaternion(context.cameraQuaternion).normalize();
    const origin = context.origin
      .clone()
      .addScaledVector(direction, MUZZLE_FORWARD)
      .addScaledVector(tmpRight, MUZZLE_RIGHT)
      .addScaledVector(tmpUp, MUZZLE_DOWN);

    this.activeRocketId = this.context.rockets.spawn({
      origin,
      direction,
      damage: this.definition.damage,
      radius: this.definition.range,
      impulse: this.definition.impulse,
      ownerKind: "player",
      sourceId: "player",
      sourceFaction: "player",
      weaponName: this.name,
      now: context.now,
    });
  }

  private refreshRocketState(): void {
    if (this.activeRocketId && !this.context.rockets.hasRocket(this.activeRocketId)) {
      this.activeRocketId = null;
    }
  }
}
