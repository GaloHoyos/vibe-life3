import type { AudioBusName } from "../../../engine/audio/AudioSystem";

export interface OptionsMenuCallbacks {
  onBack: () => void;
  onToggleDebug: (enabled: boolean) => void;
  onVolumeChange: (bus: AudioBusName, value: number) => void;
  getVolume: (bus: AudioBusName) => number;
}

interface VolumeRow {
  bus: AudioBusName;
  label: string;
  defaultValue: number;
}

const AUDIO_BUSES: VolumeRow[] = [
  { bus: "master", label: "Volumen general", defaultValue: 100 },
  { bus: "music", label: "Volumen musica", defaultValue: 65 },
  { bus: "ambience", label: "Volumen ambiente", defaultValue: 75 },
  { bus: "sfx", label: "Volumen efectos", defaultValue: 85 },
  { bus: "dialogue", label: "Volumen dialogo", defaultValue: 80 },
];

export class OptionsMenu {
  readonly element = document.createElement("section");
  private readonly debugToggle: HTMLInputElement;

  constructor(callbacks: OptionsMenuCallbacks) {
    this.element.className = "hl2-panel hl2-panel--content";
    this.element.innerHTML = `
      <div class="hl2-panel__header">
        <h2>OPCIONES</h2>
        <p>Ajustes del simulador.</p>
      </div>
      <div class="hl2-tabs" role="tablist">
        <button class="hl2-tab is-active" data-tab="audio" type="button">AUDIO</button>
        <button class="hl2-tab" data-tab="video" type="button">VIDEO</button>
        <button class="hl2-tab" data-tab="mouse" type="button">MOUSE</button>
        <button class="hl2-tab" data-tab="game" type="button">JUEGO</button>
      </div>
      <div class="hl2-options" data-panel="audio">
        ${AUDIO_BUSES.map(
          (row) => `
            <label class="hl2-option">
              <span>${row.label}</span>
              <input type="range" min="0" max="100" value="${row.defaultValue}" data-bus="${row.bus}" />
              <strong class="hl2-option__value" data-value="${row.bus}">${row.defaultValue}</strong>
            </label>
          `,
        ).join("")}
      </div>
      <div class="hl2-options is-hidden" data-panel="video">
        <label class="hl2-option">
          <span>Calidad grafica</span>
          <select data-action="quality">
            <option>Baja</option>
            <option selected>Media</option>
            <option>Alta</option>
          </select>
          <strong class="hl2-option__value" data-value="quality">Media</strong>
        </label>
        <div class="hl2-option hl2-option--toggle">
          <span>Pantalla completa</span>
          <button class="hl2-button" type="button" data-action="fullscreen">
            <span class="hl2-button__marker"></span>
            <span class="hl2-button__label">ACTIVAR</span>
          </button>
        </div>
      </div>
      <div class="hl2-options is-hidden" data-panel="mouse">
        <label class="hl2-option">
          <span>Sensibilidad del mouse</span>
          <input type="range" min="1" max="100" value="45" data-action="sensitivity" />
          <strong class="hl2-option__value" data-value="sensitivity">45</strong>
        </label>
        <label class="hl2-option hl2-option--toggle">
          <span>Invertir eje Y</span>
          <input type="checkbox" data-action="invertY" />
        </label>
      </div>
      <div class="hl2-options is-hidden" data-panel="game">
        <label class="hl2-option hl2-option--toggle">
          <span>Mostrar FPS / debug</span>
          <input type="checkbox" data-action="debug" />
        </label>
      </div>
      <div class="hl2-actions">
        <button class="hl2-button" type="button" data-action="back">
          <span class="hl2-button__marker"></span>
          <span class="hl2-button__label">VOLVER</span>
        </button>
      </div>
    `;

    this.wireTabs();
    this.wireAudio(callbacks);
    this.wireSensitivity();
    this.wireQuality();
    this.wireFullscreen();
    this.debugToggle = this.wireDebug(callbacks);
    this.wireBack(callbacks);
  }

  setDebugEnabled(enabled: boolean): void {
    this.debugToggle.checked = enabled;
  }

  private wireTabs(): void {
    const tabs = this.element.querySelectorAll<HTMLButtonElement>(".hl2-tab");
    const panels = this.element.querySelectorAll<HTMLElement>("[data-panel]");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const target = tab.dataset.tab;
        if (!target) return;
        tabs.forEach((t) => t.classList.toggle("is-active", t === tab));
        panels.forEach((panel) => {
          panel.classList.toggle("is-hidden", panel.dataset.panel !== target);
        });
      });
    });
  }

  private wireAudio(callbacks: OptionsMenuCallbacks): void {
    const inputs =
      this.element.querySelectorAll<HTMLInputElement>("input[data-bus]");
    inputs.forEach((input) => {
      const bus = (input.dataset.bus ?? "master") as AudioBusName;
      const label = this.element.querySelector(
        `.hl2-option__value[data-value="${bus}"]`,
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
  }

  private wireSensitivity(): void {
    const slider = this.element.querySelector<HTMLInputElement>(
      'input[data-action="sensitivity"]',
    );
    if (!slider) return;
    const label = this.element.querySelector(
      '.hl2-option__value[data-value="sensitivity"]',
    ) as HTMLElement;
    slider.addEventListener("input", () => {
      label.textContent = slider.value;
    });
  }

  private wireQuality(): void {
    const select = this.element.querySelector<HTMLSelectElement>(
      'select[data-action="quality"]',
    );
    if (!select) return;
    const label = this.element.querySelector(
      '.hl2-option__value[data-value="quality"]',
    ) as HTMLElement;
    select.addEventListener("change", () => {
      label.textContent = select.value;
    });
  }

  private wireFullscreen(): void {
    const button = this.element.querySelector<HTMLButtonElement>(
      '[data-action="fullscreen"]',
    );
    if (!button) return;
    const label = button.querySelector(".hl2-button__label") as HTMLElement;
    button.addEventListener("click", () => {
      if (document.fullscreenElement) {
        void document.exitFullscreen();
        label.textContent = "ACTIVAR";
        return;
      }
      void document.documentElement.requestFullscreen();
      label.textContent = "SALIR";
    });
  }

  private wireDebug(callbacks: OptionsMenuCallbacks): HTMLInputElement {
    const toggle = this.element.querySelector<HTMLInputElement>(
      '[data-action="debug"]',
    );
    if (!toggle) throw new Error("debug toggle missing");
    toggle.addEventListener("change", () => {
      callbacks.onToggleDebug(toggle.checked);
    });
    return toggle;
  }

  private wireBack(callbacks: OptionsMenuCallbacks): void {
    const back = this.element.querySelector<HTMLButtonElement>(
      '[data-action="back"]',
    );
    if (!back) return;
    back.addEventListener("click", callbacks.onBack);
  }
}
