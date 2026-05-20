import { HitscanWeapon } from "./HitscanWeapon";
import type { WeaponAlternateFireContext } from "@game/gameplay/weapons/core/Weapon";
import { GrenadeWeapon } from "./GrenadeWeapon";

const SPAWN_OFFSET = 0.6;
/** Cooldown propio del lanzagranadas, independiente del fireRate del SMG. */
const LAUNCHER_COOLDOWN = 0.55;

/**
 * SMG = `HitscanWeapon` con un secundario que es un lanzagranadas de
 * contacto. El lanzagranadas consume munici n de la reserva del
 * `GrenadeWeapon` del player (compartido) y spawnea una granada en modo
 * `impact` (explota al primer contacto).
 *
 * Si el player no tiene granadas (o no tiene el arma `grenade`), el alt
 * emite `weapon.empty` y no consume nada del SMG.
 */
export class SmgWeapon extends HitscanWeapon {
  private lastLaunchTime = -Infinity;

  override tryAlternateFire(context: WeaponAlternateFireContext): void {
    if (!context.pressed) {
      return;
    }
    const alt = this.definition.alternateFire;
    if (alt?.kind !== "grenadeLauncher") {
      return;
    }
    if (context.now - this.lastLaunchTime < LAUNCHER_COOLDOWN) {
      return;
    }

    const inventory = this.context.getInventory();
    const grenadeWeapon = inventory.getWeapon("grenade");
    if (!(grenadeWeapon instanceof GrenadeWeapon)) {
      this.context.eventBus.emit("weapon.empty", { weaponName: this.name });
      return;
    }
    if (!grenadeWeapon.tryConsumeAmmo()) {
      this.context.eventBus.emit("weapon.empty", { weaponName: this.name });
      return;
    }

    this.lastLaunchTime = context.now;

    const dir = context.direction.clone().normalize();
    const spawnOrigin = context.origin.clone().addScaledVector(dir, SPAWN_OFFSET);
    const velocity = dir.multiplyScalar(alt.launchSpeed);
    velocity.y += alt.launchLift;

    this.context.eventBus.emit("weapon.alternate.fired", {
      weaponName: this.name,
      origin: context.origin,
      direction: context.direction,
    });

    this.context.grenades.spawn({
      mode: "impact",
      origin: spawnOrigin,
      velocity,
      damage: grenadeWeapon.definition.damage,
      radius: grenadeWeapon.definition.range,
      impulse: grenadeWeapon.definition.impulse,
      ownerKind: "player",
      weaponName: grenadeWeapon.definition.displayName,
      now: context.now,
    });
  }
}
