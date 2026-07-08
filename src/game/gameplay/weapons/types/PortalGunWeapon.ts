import {
  Weapon,
  type WeaponAlternateFireContext,
  type WeaponFireContext,
} from "@game/gameplay/weapons/core/Weapon";

export class PortalGunWeapon extends Weapon {
  private lastAlternateFireTime = -Infinity;

  protected performFire(context: WeaponFireContext): void {
    this.context.portals.fire({
      slot: "a",
      origin: context.origin,
      direction: context.direction,
      cameraQuaternion: context.cameraQuaternion,
    });
  }

  override tryAlternateFire(context: WeaponAlternateFireContext): void {
    if (!context.pressed) {
      return;
    }
    const interval = 1 / this.definition.fireRate;
    if (context.now - this.lastAlternateFireTime < interval) {
      return;
    }
    this.lastAlternateFireTime = context.now;
    this.context.eventBus.emit("weapon.alternate.fired", {
      weaponName: this.name,
      origin: context.origin,
      direction: context.direction,
      sourceId: "player",
      sourceKind: "player",
      sourceFaction: "player",
    });
    this.context.portals.fire({
      slot: "b",
      origin: context.origin,
      direction: context.direction,
      cameraQuaternion: context.cameraQuaternion,
    });
  }
}
