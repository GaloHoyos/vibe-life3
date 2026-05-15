import { Weapon, type WeaponFireContext } from "./Weapon";

/**
 * Stub controlado del Gravity Gun.
 *
 * Comparte la cadencia, recoil, view-model y reload-stub de `Weapon`,
 * pero su `performFire` no inflige daño ni aplica impulso: solo emite
 * un subtítulo informando que la mecánica completa (carga/punt, hold
 * distance, constraints físicas) está pendiente. Mantenemos el stub
 * en producción para no degradar la UX del jugador que prueba el slot,
 * con la mecánica real reservada para una pasada futura.
 */
export class GravityGunWeapon extends Weapon {
  protected performFire(_context: WeaponFireContext): void {
    this.context.eventBus.emit("subtitle.show", {
      speaker: "HEV",
      text: "Gravity Gun functionality pending.",
      duration: 1.6,
    });
  }
}
