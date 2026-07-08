import type { AudioBusName } from "@engine/audio/core/AudioSystem";
import type { Disposable } from "@shared/types/lifecycle";
import {
  ActionLabels,
  ActionOrder,
  NonRebindableActions,
  type GameAction,
} from "@game/config/controls.config";
import { DifficultyStrings, MenuStrings } from "@game/config/strings";
import {
  DIFFICULTY_ORDER,
  type DifficultyLevel,
} from "@game/config/difficulty.config";
import type { Controls } from "@game/gameplay/player/Controls";

export interface OptionsMenuCallbacks {
  onBack: () => void;
  onToggleDebug: (enabled: boolean) => void;
  onVolumeChange: (bus: AudioBusName, value: number) => void;
  getVolume: (bus: AudioBusName) => number;
  getDifficulty: () => DifficultyLevel;
  onSetDifficulty: (level: DifficultyLevel) => void;
  controls: Controls;
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

export class OptionsMenu implements Disposable {
  readonly element = document.createElement("section");
  private readonly debugToggle: HTMLInputElement;
  private readonly bindingLabels = new Map<GameAction, HTMLElement>();
  private readonly bindingButtons = new Map<GameAction, HTMLButtonElement>();
  private readonly listenerAbort = new AbortController();
  private cancelActiveRebind: (() => void) | null = null;
  private bindingChangeDisposer: (() => void) | null = null;

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
        <button class="hl2-tab" data-tab="controls" type="button">CONTROLES</button>
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
            <span class="hl2-button__label">${MenuStrings.fullscreenEnter}</span>
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
        <label class="hl2-option">
          <span>Dificultad</span>
          <select data-action="difficulty">
            ${DIFFICULTY_ORDER.map(
              (level) =>
                `<option value="${level}">${DifficultyStrings[level].label}</option>`,
            ).join("")}
          </select>
          <strong class="hl2-option__value" data-value="difficulty"></strong>
        </label>
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

    this.appendControlsPanel(callbacks.controls);

    this.wireTabs();
    this.wireAudio(callbacks);
    this.wireSensitivity();
    this.wireQuality();
    this.wireDifficulty(callbacks);
    this.wireFullscreen();
    this.debugToggle = this.wireDebug(callbacks);
    this.wireBack(callbacks);
  }

  setDebugEnabled(enabled: boolean): void {
    this.debugToggle.checked = enabled;
  }

  dispose(): void {
    this.cancelActiveRebind?.();
    this.bindingChangeDisposer?.();
    this.bindingChangeDisposer = null;
    this.listenerAbort.abort();
  }

  private appendControlsPanel(controls: Controls): void {
    const panel = document.createElement("div");
    panel.className = "hl2-options hl2-options--controls is-hidden";
    panel.dataset.panel = "controls";

    const list = document.createElement("div");
    list.className = "hl2-bindings";

    for (const action of ActionOrder) {
      const row = document.createElement("div");
      row.className = "hl2-binding";

      const labelEl = document.createElement("span");
      labelEl.className = "hl2-binding__label";
      labelEl.textContent = ActionLabels[action];

      const button = document.createElement("button");
      button.className = "hl2-binding__key";
      button.type = "button";

      const keyLabel = document.createElement("span");
      keyLabel.className = "hl2-binding__key-label";
      keyLabel.textContent = formatBindings(controls.getCodes(action));
      button.append(keyLabel);

      if (NonRebindableActions.has(action)) {
        button.disabled = true;
        button.classList.add("is-locked");
        button.title = "Reservada por el navegador";
      } else {
        button.addEventListener(
          "click",
          () => {
            this.beginRebind(controls, action);
          },
          { signal: this.listenerAbort.signal },
        );
      }

      row.append(labelEl, button);
      list.append(row);

      this.bindingLabels.set(action, keyLabel);
      this.bindingButtons.set(action, button);
    }

    panel.append(list);

    const footer = document.createElement("div");
    footer.className = "hl2-binding-actions";
    const resetButton = document.createElement("button");
    resetButton.className = "hl2-button";
    resetButton.type = "button";
    const resetMarker = document.createElement("span");
    resetMarker.className = "hl2-button__marker";
    const resetLabel = document.createElement("span");
    resetLabel.className = "hl2-button__label";
    resetLabel.textContent = "RESTAURAR PREDETERMINADOS";
    resetButton.append(resetMarker, resetLabel);
    resetButton.addEventListener(
      "click",
      () => {
        this.cancelActiveRebind?.();
        controls.resetToDefaults();
      },
      { signal: this.listenerAbort.signal },
    );
    footer.append(resetButton);
    panel.append(footer);

    const tabsRow = this.element.querySelector(".hl2-tabs");
    tabsRow?.insertAdjacentElement("afterend", panel);

    this.bindingChangeDisposer = controls.onChange((action) => {
      const label = this.bindingLabels.get(action);
      if (!label) return;
      label.textContent = formatBindings(controls.getCodes(action));
    });
  }

  private beginRebind(controls: Controls, action: GameAction): void {
    this.cancelActiveRebind?.();

    const button = this.bindingButtons.get(action);
    const label = this.bindingLabels.get(action);
    if (!button || !label) return;

    button.classList.add("is-listening");
    label.textContent = "PULSA UNA TECLA...";

    const rebindAbort = new AbortController();
    const cleanup = (): void => {
      if (rebindAbort.signal.aborted) return;
      rebindAbort.abort();
      button.classList.remove("is-listening");
      this.cancelActiveRebind = null;
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopImmediatePropagation();
      cleanup();

      if (event.code === "Escape") {
        label.textContent = formatBindings(controls.getCodes(action));
        return;
      }

      controls.setBinding(action, [event.code]);
    };

    const onMouseDown = (event: MouseEvent): void => {
      if (event.target instanceof Node && button.contains(event.target)) return;
      cleanup();
      label.textContent = formatBindings(controls.getCodes(action));
    };

    window.addEventListener("keydown", onKeyDown, {
      capture: true,
      signal: rebindAbort.signal,
    });
    window.addEventListener("mousedown", onMouseDown, {
      capture: true,
      signal: rebindAbort.signal,
    });
    // Si el menÃº entero se cierra mientras hay un rebind activo, abortamos tambiÃ©n.
    this.listenerAbort.signal.addEventListener("abort", cleanup, {
      once: true,
      signal: rebindAbort.signal,
    });
    this.cancelActiveRebind = cleanup;
  }

  private wireTabs(): void {
    const tabs = this.element.querySelectorAll<HTMLButtonElement>(".hl2-tab");
    const panels = this.element.querySelectorAll<HTMLElement>("[data-panel]");
    tabs.forEach((tab) => {
      tab.addEventListener(
        "click",
        () => {
          const target = tab.dataset.tab;
          if (!target) return;
          this.cancelActiveRebind?.();
          tabs.forEach((t) => t.classList.toggle("is-active", t === tab));
          panels.forEach((panel) => {
            panel.classList.toggle("is-hidden", panel.dataset.panel !== target);
          });
        },
        { signal: this.listenerAbort.signal },
      );
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

      input.addEventListener(
        "input",
        () => {
          const value = Number(input.value);
          label.textContent = String(value);
          callbacks.onVolumeChange(bus, value / 100);
        },
        { signal: this.listenerAbort.signal },
      );
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
    slider.addEventListener(
      "input",
      () => {
        label.textContent = slider.value;
      },
      { signal: this.listenerAbort.signal },
    );
  }

  private wireQuality(): void {
    const select = this.element.querySelector<HTMLSelectElement>(
      'select[data-action="quality"]',
    );
    if (!select) return;
    const label = this.element.querySelector(
      '.hl2-option__value[data-value="quality"]',
    ) as HTMLElement;
    select.addEventListener(
      "change",
      () => {
        label.textContent = select.value;
      },
      { signal: this.listenerAbort.signal },
    );
  }

  private wireDifficulty(callbacks: OptionsMenuCallbacks): void {
    const select = this.element.querySelector<HTMLSelectElement>(
      'select[data-action="difficulty"]',
    );
    if (!select) return;
    const label = this.element.querySelector(
      '.hl2-option__value[data-value="difficulty"]',
    ) as HTMLElement;
    const sync = (level: DifficultyLevel): void => {
      select.value = level;
      label.textContent = DifficultyStrings[level].label;
    };
    sync(callbacks.getDifficulty());
    select.addEventListener(
      "change",
      () => {
        const level = select.value as DifficultyLevel;
        callbacks.onSetDifficulty(level);
        label.textContent = DifficultyStrings[level].label;
      },
      { signal: this.listenerAbort.signal },
    );
  }

  private wireFullscreen(): void {
    const button = this.element.querySelector<HTMLButtonElement>(
      '[data-action="fullscreen"]',
    );
    if (!button) return;
    const label = button.querySelector(".hl2-button__label") as HTMLElement;
    button.addEventListener(
      "click",
      () => {
        if (document.fullscreenElement) {
          void document.exitFullscreen();
          label.textContent = MenuStrings.fullscreenEnter;
          return;
        }
        void document.documentElement.requestFullscreen();
        label.textContent = MenuStrings.fullscreenExit;
      },
      { signal: this.listenerAbort.signal },
    );
  }

  private wireDebug(callbacks: OptionsMenuCallbacks): HTMLInputElement {
    const toggle = this.element.querySelector<HTMLInputElement>(
      '[data-action="debug"]',
    );
    if (!toggle) throw new Error("debug toggle missing");
    toggle.addEventListener(
      "change",
      () => {
        callbacks.onToggleDebug(toggle.checked);
      },
      { signal: this.listenerAbort.signal },
    );
    return toggle;
  }

  private wireBack(callbacks: OptionsMenuCallbacks): void {
    const back = this.element.querySelector<HTMLButtonElement>(
      '[data-action="back"]',
    );
    if (!back) return;
    back.addEventListener(
      "click",
      () => {
        this.cancelActiveRebind?.();
        callbacks.onBack();
      },
      { signal: this.listenerAbort.signal },
    );
  }
}

const KEY_CODE_LABELS: Record<string, string> = {
  Space: "Espacio",
  ShiftLeft: "Shift Izq.",
  ShiftRight: "Shift Der.",
  ControlLeft: "Ctrl Izq.",
  ControlRight: "Ctrl Der.",
  AltLeft: "Alt Izq.",
  AltRight: "Alt Der.",
  Escape: "Esc",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Borrar",
  CapsLock: "Bloq. MayÃºs.",
  ArrowUp: "â†‘",
  ArrowDown: "â†“",
  ArrowLeft: "â†",
  ArrowRight: "â†’",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Comma: ",",
  Period: ".",
  Slash: "/",
};

function formatKeyCode(code: string): string {
  const explicit = KEY_CODE_LABELS[code];
  if (explicit) return explicit;
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  if (/^F\d+$/.test(code)) return code;
  return code;
}

function formatBindings(codes: readonly string[]): string {
  if (codes.length === 0) return "(sin asignar)";
  return codes.map(formatKeyCode).join(" / ");
}
