import { AuxPowerBar } from "./AuxPowerBar";
import { ArmorIcon, HealthIcon } from "./HudIcons";

export interface HUDValue {
  current: number;
  max: number;
}

/**
 * Vitals HUD HL2-style. Salud + traje arriba como números grandes con icono.
 * Debajo, indicador secundario "AUX. POWER" — barra horizontal segmentada
 * (10 segmentos amarillos) que representa la stamina del sprint. La barra
 * vive en `AuxPowerBar`; este componente solo orquesta el render del bloque
 * principal y delega la sub-vista.
 */
export class HealthArmorHUD {
  readonly element = document.createElement("section");

  private readonly healthValue: HTMLDivElement;
  private readonly armorValue: HTMLDivElement;
  private readonly armorBlock: HTMLDivElement;
  private readonly auxPower = new AuxPowerBar();

  constructor() {
    this.element.className = "hl-vitals";

    const main = document.createElement("div");
    main.className = "hl-vitals__main";
    main.innerHTML = `
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

    this.element.append(this.auxPower.element, main);

    const blocks = main.querySelectorAll<HTMLDivElement>(".hl-vital");
    const values = main.querySelectorAll<HTMLDivElement>(".hl-vital__value");
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

  setAux(value: HUDValue, depleted: boolean): void {
    const percent = value.max > 0 ? (value.current / value.max) * 100 : 0;
    this.auxPower.setAux(percent, depleted);
  }
}
