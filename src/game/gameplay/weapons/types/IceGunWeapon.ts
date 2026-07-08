import {
  Weapon,
  type WeaponAlternateFireContext,
  type WeaponFireContext,
  type WeaponUpdateContext,
} from "@game/gameplay/weapons/core/Weapon";

export class IceGunWeapon extends Weapon {
  private surfing = false;

  protected performFire(context: WeaponFireContext): void {
    this.context.iceGun.fire({
      origin: context.origin,
      direction: context.direction,
      range: this.definition.range,
      now: context.now,
      sourceId: "player",
      weaponName: this.name,
    });
  }

  override update(_delta: number, context: WeaponUpdateContext): void {
    if (!context.alternateHeld) {
      if (this.surfing) {
        this.context.iceGun.stopSurf("player");
        this.surfing = false;
      }
      return;
    }

    this.surfing = true;
    this.context.iceGun.surf({
      origin: context.origin,
      direction: context.direction,
      now: context.elapsed,
      sourceId: "player",
    });
  }

  override tryAlternateFire(context: WeaponAlternateFireContext): void {
    if (!context.pressed) {
      return;
    }
    this.context.eventBus.emit("weapon.alternate.fired", {
      weaponName: this.name,
      origin: context.origin,
      direction: context.direction,
      sourceId: "player",
      sourceKind: "player",
      sourceFaction: "player",
    });
  }

  override onUnequip(): void {
    this.context.iceGun.stopSurf("player");
    this.surfing = false;
  }
}
