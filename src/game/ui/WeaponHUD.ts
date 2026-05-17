import type { Disposable } from "../../shared/types/lifecycle";

export interface WeaponHUDState {
  name: string;
  ammo: number;
  reserve: number;
}

/**
 * Ammo HUD HL2-style: label "MUNICIÓN" arriba, número grande del magazine
 * + número chico de la reserva a la derecha, abajo a la derecha de la
 * pantalla. El nombre del arma no se muestra (HL2 no lo hace; el selector
 * superior se encarga cuando hace falta).
 */
export class WeaponHUD implements Disposable {
  readonly element = document.createElement("section");

  private readonly current = document.createElement("span");
  private readonly reserve = document.createElement("span");
  private fireTimer = 0;

  constructor() {
    this.element.className = "hl-ammo";
    this.element.innerHTML = `
      <div class="hl-ammo__label">MUNICIÓN</div>
      <div class="hl-ammo__row">
        <span class="hl-ammo__current"></span>
        <span class="hl-ammo__reserve"></span>
      </div>
    `;
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
