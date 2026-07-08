import { HitscanWeapon } from "./HitscanWeapon";
import type { WeaponAlternateFireContext } from "@game/gameplay/weapons/core/Weapon";

const MUZZLE_FORWARD = 0.6;
/** Cooldown propio del secundario, independiente del fireRate primario. */
const LAUNCHER_COOLDOWN = 0.6;

/**
 * AR3 = `HitscanWeapon` con un secundario estilo AR2: lanza una bola de energía
 * Combine que rebota y vaporiza enemigos. Consume munición `energyBall` (reserva
 * separada de la primaria). Sin munición secundaria, el alt emite `weapon.empty`.
 */
export class Ar3Weapon extends HitscanWeapon {
  private lastLaunchTime = -Infinity;

  override tryAlternateFire(context: WeaponAlternateFireContext): void {
    if (!context.pressed) {
      return;
    }
    const alt = this.definition.alternateFire;
    if (alt?.kind !== "energyBall") {
      return;
    }
    if (context.now - this.lastLaunchTime < LAUNCHER_COOLDOWN) {
      return;
    }
    if (!this.context.ammo.consume("energyBall", 1)) {
      this.context.eventBus.emit("weapon.empty", { weaponName: this.name });
      return;
    }

    this.lastLaunchTime = context.now;

    const dir = context.direction.clone().normalize();
    const origin = context.origin.clone().addScaledVector(dir, MUZZLE_FORWARD);

    this.context.energyBalls.spawn({
      origin,
      direction: dir,
      speed: alt.launchSpeed,
      sourceId: "player",
      now: context.now,
    });

    this.context.eventBus.emit("weapon.alternate.fired", {
      weaponName: this.name,
      origin: context.origin,
      direction: context.direction,
      sourceId: "player",
      sourceKind: "player",
      sourceFaction: "player",
    });
    this.context.eventBus.emit("world.noise", {
      kind: "gunshot",
      position: context.origin.clone(),
      radius: 45,
      sourceId: "player",
      sourceFaction: "player",
    });

    this.context.getInventory().refreshActiveWeapon();
  }
}
