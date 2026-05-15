import type { AudioBusName } from "../../../engine/audio/AudioSystem";

export interface OptionsMenuCallbacks {
  onBack: () => void;
  onToggleDebug: (enabled: boolean) => void;
  onVolumeChange: (bus: AudioBusName, value: number) => void;
  getVolume: (bus: AudioBusName) => number;
}

export class OptionsMenu {
  readonly element = document.createElement("section");
  private readonly sensitivityValue: HTMLElement;
  private readonly qualityValue: HTMLElement;
  private readonly debugToggle: HTMLInputElement;

  constructor(callbacks: OptionsMenuCallbacks) {
    this.element.className = "hl3-panel hl3-panel--content";
    this.element.innerHTML = `
      <div class="hl3-panel__header">
        <h2>Opciones</h2>
        <p>Configuracion basica. TODO: conectar al motor.</p>
      </div>
      <div class="hl3-options">
        <label class="hl3-option">
          <span>Volumen general</span>
          <input type="range" min="0" max="100" value="100" data-bus="master" />
          <strong class="hl3-option__value" data-value="master">100</strong>
        </label>
        <label class="hl3-option">
          <span>Volumen musica</span>
          <input type="range" min="0" max="100" value="65" data-bus="music" />
          <strong class="hl3-option__value" data-value="music">65</strong>
        </label>
        <label class="hl3-option">
          <span>Volumen ambiente</span>
          <input type="range" min="0" max="100" value="75" data-bus="ambience" />
          <strong class="hl3-option__value" data-value="ambience">75</strong>
        </label>
        <label class="hl3-option">
          <span>Volumen efectos</span>
          <input type="range" min="0" max="100" value="85" data-bus="sfx" />
          <strong class="hl3-option__value" data-value="sfx">85</strong>
        </label>
        <label class="hl3-option">
          <span>Volumen dialogo</span>
          <input type="range" min="0" max="100" value="80" data-bus="dialogue" />
          <strong class="hl3-option__value" data-value="dialogue">80</strong>
        </label>
        <label class="hl3-option">
          <span>Sensibilidad del mouse</span>
          <input type="range" min="1" max="100" value="45" />
          <strong class="hl3-option__value" data-value="sensitivity">45</strong>
        </label>
        <label class="hl3-option">
          <span>Calidad grafica</span>
          <select>
            <option>Baja</option>
            <option selected>Media</option>
            <option>Alta</option>
          </select>
          <strong class="hl3-option__value" data-value="quality">Media</strong>
        </label>
        <div class="hl3-option hl3-option--toggle">
          <span>Pantalla completa</span>
          <button class="hl3-button" type="button" data-action="fullscreen">Activar</button>
        </div>
        <label class="hl3-option hl3-option--toggle">
          <span>Mostrar FPS / debug</span>
          <input type="checkbox" data-action="debug" />
        </label>
      </div>
      <div class="hl3-actions">
        <button class="hl3-button" type="button" data-action="back">Volver</button>
      </div>
    `;

    const volumeInputs =
      this.element.querySelectorAll<HTMLInputElement>("input[data-bus]");
    volumeInputs.forEach((input) => {
      const bus = (input.dataset.bus ?? "master") as AudioBusName;
      const label = this.element.querySelector(
        `.hl3-option__value[data-value="${bus}"]`,
      ) as HTMLElement;
      const currentValue = Math.round(callbacks.getVolume(bus) * 100);
      input.value = String(currentValue);
      label.textContent = String(currentValue);

      input.addEventListener("input", () => {
        const value = Number(input.value);
        label.textContent = String(value);
        callbacks.onVolumeChange(bus, value / 100);
      });
    });

    const sliders = this.element.querySelectorAll<HTMLInputElement>(
      'input[type="range"]:not([data-bus])',
    );
    this.sensitivityValue = this.element.querySelector(
      '.hl3-option__value[data-value="sensitivity"]',
    ) as HTMLElement;
    this.qualityValue = this.element.querySelector(
      '.hl3-option__value[data-value="quality"]',
    ) as HTMLElement;

    sliders[0]?.addEventListener("input", (event) => {
      const value = (event.target as HTMLInputElement).value;
      this.sensitivityValue.textContent = value;
    });

    const select = this.element.querySelector("select") as HTMLSelectElement;
    select?.addEventListener("change", () => {
      this.qualityValue.textContent = select.value;
    });

    const fullscreenButton = this.element.querySelector(
      '[data-action="fullscreen"]',
    ) as HTMLButtonElement;
    fullscreenButton.addEventListener("click", () => {
      if (document.fullscreenElement) {
        void document.exitFullscreen();
        fullscreenButton.textContent = "Activar";
        return;
      }

      void document.documentElement.requestFullscreen();
      fullscreenButton.textContent = "Salir";
    });

    this.debugToggle = this.element.querySelector(
      '[data-action="debug"]',
    ) as HTMLInputElement;
    this.debugToggle.addEventListener("change", () => {
      callbacks.onToggleDebug(this.debugToggle.checked);
    });

    const backButton = this.element.querySelector(
      '[data-action="back"]',
    ) as HTMLButtonElement;
    backButton.addEventListener("click", callbacks.onBack);
  }

  setDebugEnabled(enabled: boolean): void {
    this.debugToggle.checked = enabled;
  }
}
