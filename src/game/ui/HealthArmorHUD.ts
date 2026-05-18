import { ArmorIcon, AuxIcon, HealthIcon } from "./HudIcons";

export interface HUDValue {
  current: number;
  max: number;
}

/**
 * Vitals HUD HL2-style: tres bloques (salud + traje + aux) abajo a la
 * izquierda. Cada bloque = icon arriba + label en caps abajo + número
 * grande a la derecha. Sin barras de progreso, sin panel box; el diseño
 * descansa en los números grandes y el icon plano amarillo. AUX
 * representa la stamina (sprint) — entra en estado crítico al depletarse.
 */
export class HealthArmorHUD {
  readonly element = document.createElement("section");

  private readonly healthValue: HTMLSpanElement;
  private readonly armorValue: HTMLSpanElement;
  private readonly auxValue: HTMLSpanElement;
  private readonly armorBlock: HTMLDivElement;
  private readonly auxBlock: HTMLDivElement;

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

    this.auxBlock = buildAuxBlock();
    this.auxValue = this.auxBlock.querySelector<HTMLSpanElement>(
      ".hl-vital__value",
    ) as HTMLSpanElement;
    this.element.append(this.auxBlock);

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

  setAux(value: HUDValue, depleted: boolean): void {
    const percent = value.max > 0 ? (value.current / value.max) * 100 : 0;
    this.auxValue.textContent = `${Math.ceil(percent)}`;
    this.auxBlock.classList.toggle("is-depleted", depleted);
    this.auxBlock.classList.toggle("is-low", !depleted && percent <= 25);
  }
}

function buildAuxBlock(): HTMLDivElement {
  const block = document.createElement("div");
  block.className = "hl-vital hl-vital--aux";

  const pictogram = document.createElement("div");
  pictogram.className = "hl-vital__pictogram";

  const icon = document.createElement("div");
  icon.className = "hl-vital__icon";
  const iconNode = parseSvg(AuxIcon);
  if (iconNode) icon.append(iconNode);

  const label = document.createElement("div");
  label.className = "hl-vital__label";
  label.textContent = "AUX";

  pictogram.append(icon, label);

  const value = document.createElement("div");
  value.className = "hl-vital__value";
  value.textContent = "100";

  block.append(pictogram, value);
  return block;
}

function parseSvg(markup: string): SVGElement | null {
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  const svg = doc.documentElement;
  if (svg instanceof SVGElement) return svg;
  return null;
}
