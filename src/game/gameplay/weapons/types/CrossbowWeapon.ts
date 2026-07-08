import { Vector3 } from "three";
import {
  Weapon,
  type WeaponAlternateFireContext,
  type WeaponContext,
  type WeaponFireContext,
  type WeaponUpdateContext,
} from "@game/gameplay/weapons/core/Weapon";
import type { WeaponDefinition } from "@game/gameplay/weapons/core/WeaponDefinition";

const MUZZLE_FORWARD = 0.5;
const MUZZLE_RIGHT = 0.14;
const MUZZLE_DOWN = -0.1;
/** Velocidad del bolt (m/s). Alta y con leve arco por la gravedad del BoltSystem. */
const BOLT_SPEED = 95;
/** FOV (grados) con la mira telescópica activa. */
const SCOPE_FOV = 30;

const tmpRight = new Vector3();
const tmpUp = new Vector3();

/**
 * Crossbow de HL2: dispara un bolt balístico (proyectil con arco) de alto daño
 * vía `BoltSystem`, monotiro con recarga por disparo. El secundario (RMB)
 * togglea una mira telescópica que baja el FOV de la cámara.
 */
export class CrossbowWeapon extends Weapon {
  private scoped = false;

  constructor(definition: WeaponDefinition, context: WeaponContext) {
    super(definition, context);
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

    this.context.bolts.spawn({
      origin,
      direction,
      speed: BOLT_SPEED,
      damage: this.definition.damage,
      impulse: this.definition.impulse,
      weaponName: this.name,
      sourceId: "player",
      now: context.now,
    });
  }

  override update(_delta: number, context: WeaponUpdateContext): void {
    // Re-amartillado automático: tras disparar el único bolt, recarga solo
    // desde la reserva (comportamiento del crossbow de HL2).
    if (
      this.magazine <= 0 &&
      this.getReserveAmmo() > 0 &&
      !this.isReloading(context.elapsed)
    ) {
      this.tryReload(context.elapsed);
    }
  }

  override tryAlternateFire(context: WeaponAlternateFireContext): void {
    if (!context.pressed) {
      return;
    }
    this.setScoped(!this.scoped);
  }

  override getZoomFov(): number | null {
    return this.scoped ? SCOPE_FOV : null;
  }

  override onUnequip(): void {
    this.setScoped(false);
  }

  private setScoped(scoped: boolean): void {
    if (this.scoped === scoped) {
      return;
    }
    this.scoped = scoped;
    this.context.eventBus.emit("weapon.scope.changed", { active: scoped });
  }
}
