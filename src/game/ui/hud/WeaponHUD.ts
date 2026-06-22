import type { Disposable } from "@shared/types/lifecycle";
import type { WeaponId } from "@game/gameplay/weapons/core/WeaponDefinition";

export interface WeaponHUDState {
  id?: WeaponId;
  name: string;
  ammo: number;
  reserve: number;
  secondaryAmmo?: number;
}

/**
 * Ammo HUD HL2-style: label "MUNICIÃ“N" arriba, nÃºmero grande del magazine
 * + nÃºmero chico de la reserva a la derecha, abajo a la derecha de la
 * pantalla. El nombre del arma no se muestra (HL2 no lo hace; el selector
 * superior se encarga cuando hace falta).
 */
export class WeaponHUD implements Disposable {
  readonly element = document.createElement("section");

  private readonly current = document.createElement("span");
  private readonly reserve = document.createElement("span");
  private readonly secondary = document.createElement("span");
  private fireTimer = 0;

  constructor() {
    this.element.className = "hl-ammo";
    this.element.innerHTML = `
      <div class="hl-ammo__label">MUNICIÃ“N</div>
      <div class="hl-ammo__secondary"></div>
      <div class="hl-ammo__row">
        <span class="hl-ammo__current"></span>
        <span class="hl-ammo__reserve"></span>
      </div>
    `;
    this.element
      .querySelector(".hl-ammo__secondary")
      ?.appendChild(this.secondary);
    this.element
      .querySelector(".hl-ammo__current")
      ?.appendChild(this.current);
    this.element
      .querySelector(".hl-ammo__reserve")
      ?.appendChild(this.reserve);
  }

  setWeapon(state: WeaponHUDState): void {
    this.current.textContent = `${state.ammo}`;
    this.reserve.textContent = `${state.reserve}`;
    const hasSecondary = state.secondaryAmmo !== undefined;
    this.secondary.textContent = hasSecondary ? `${state.secondaryAmmo}` : "";
    this.element.classList.toggle("has-secondary", hasSecondary);
    this.element.classList.toggle(
      "is-secondary-empty",
      hasSecondary && state.secondaryAmmo === 0,
    );
    this.element.classList.toggle("is-low", state.ammo > 0 && state.ammo <= 5);
    this.element.classList.toggle("is-empty", state.ammo === 0);
  }

  pulseFire(): void {
    this.element.classList.remove("is-firing");
    void this.element.offsetWidth;
    this.element.classList.add("is-firing");
    window.clearTimeout(this.fireTimer);
    this.fireTimer = window.setTimeout(
      () => this.element.classList.remove("is-firing"),
      110,
    );
  }

  dispose(): void {
    window.clearTimeout(this.fireTimer);
  }
}
