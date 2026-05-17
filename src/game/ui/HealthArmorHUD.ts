import { ArmorIcon, HealthIcon } from "./HudIcons";

export interface HUDValue {
  current: number;
  max: number;
}

/**
 * Vitals HUD HL2-style: dos bloques (salud + traje) abajo a la izquierda.
 * Cada bloque = icon arriba + label en caps abajo + número grande a la
 * derecha. Sin barras de progreso, sin panel box; el diseño descansa en
 * los números grandes y el icon plano amarillo.
 */
export class HealthArmorHUD {
  readonly element = document.createElement("section");

  private readonly healthValue: HTMLSpanElement;
  private readonly armorValue: HTMLSpanElement;
  private readonly armorBlock: HTMLDivElement;

  constructor() {
    this.element.className = "hl-vitals";
    this.element.innerHTML = `
      <div class="hl-vital hl-vital--health">
        <div class="hl-vital__pictogram">
          <div class="hl-vital__icon">${HealthIcon}</div>
          <div class="hl-vital__label">SALUD</div>
        </div>
        <div class="hl-vital__value">100</div>
      </div>
      <div class="hl-vital hl-vital--armor">
        <div class="hl-vital__pictogram">
          <div class="hl-vital__icon">${ArmorIcon}</div>
          <div class="hl-vital__label">TRAJE</div>
        </div>
        <div class="hl-vital__value">--</div>
      </div>
    `;

    const blocks = this.element.querySelectorAll<HTMLDivElement>(".hl-vital");
    const values = this.element.querySelectorAll<HTMLSpanElement>(
      ".hl-vital__value",
    );
    this.healthValue = values[0];
    this.armorValue = values[1];
    this.armorBlock = blocks[1];
  }

  setHealth(value: HUDValue): void {
    this.healthValue.textContent = `${Math.ceil(value.current)}`;
    this.element.classList.toggle(
      "is-critical",
      value.max > 0 && value.current / value.max <= 0.25,
    );
  }

  setArmor(value: HUDValue, enabled: boolean): void {
    this.armorValue.textContent = enabled ? `${Math.ceil(value.current)}` : "--";
    this.armorBlock.classList.toggle("is-disabled", !enabled);
  }
}
