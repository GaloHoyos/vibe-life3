import type { HUDValue } from './HUDState';

export class HealthArmorHUD {
  readonly element = document.createElement('section');

  private readonly healthValue = document.createElement('strong');
  private healthBar = document.createElement('span');
  private readonly armorValue = document.createElement('strong');
  private armorBar = document.createElement('span');
  private armorRow = document.createElement('div');

  constructor() {
    this.element.className = 'hev-panel hev-vitals';
    this.element.innerHTML = `
      <div class="hev-panel__label">AUX POWER</div>
      <div class="hev-readout">
        <span class="hev-readout__tag">HEALTH</span>
      </div>
      <div class="hev-meter"><span></span></div>
      <div class="hev-readout hev-readout--armor">
        <span class="hev-readout__tag">ARMOR</span>
      </div>
      <div class="hev-meter hev-meter--armor"><span></span></div>
    `;

    const readouts = this.element.querySelectorAll('.hev-readout');
    const meters = this.element.querySelectorAll('.hev-meter span');
    readouts[0].append(this.healthValue);
    readouts[1].append(this.armorValue);
    this.healthBar = meters[0] as HTMLSpanElement;
    this.armorBar = meters[1] as HTMLSpanElement;
    this.armorRow = readouts[1] as HTMLDivElement;
  }

  setHealth(value: HUDValue): void {
    this.healthValue.textContent = `${Math.ceil(value.current)}`;
    this.healthBar.style.width = `${getPercent(value)}%`;
    this.element.classList.toggle('is-critical', value.current / value.max <= 0.25);
  }

  setArmor(value: HUDValue, enabled: boolean): void {
    this.armorValue.textContent = enabled ? `${Math.ceil(value.current)}` : '--';
    this.armorBar.style.width = enabled ? `${getPercent(value)}%` : '0%';
    this.armorRow.classList.toggle('is-disabled', !enabled);
  }
}

function getPercent(value: HUDValue): number {
  if (value.max <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, (value.current / value.max) * 100));
}
