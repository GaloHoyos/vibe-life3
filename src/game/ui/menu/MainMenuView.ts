import { CreditsMenu } from "./CreditsMenu";
import { CustomMapsMenu } from "./CustomMapsMenu";
import { NewGameMenu } from "./NewGameMenu";
import { OptionsMenu } from "./OptionsMenu";
import {
  buildCustomMaps,
  type CustomMapEntry,
  type GameMenuState,
  type MenuChapter,
} from "./MainMenuState";
import type { AudioBusName } from "@engine/audio/core/AudioSystem";
import type { Controls } from "@game/gameplay/player/Controls";

export interface MainMenuViewCallbacks {
  onStartChapter: (chapterId: string) => void;
  onStartCustomMap: (entry: CustomMapEntry) => void;
  onEditCustomMap: (entry: CustomMapEntry) => void;
  onDeleteLibraryMap: (id: string) => void;
  onImportCustomMap: () => void;
  onOpenState: (state: GameMenuState) => void;
  onBack: () => void;
  onResume: () => void;
  onExitToMain: () => void;
  onOpenEditor: () => void;
  onToggleDebug: (enabled: boolean) => void;
  onVolumeChange: (bus: AudioBusName, value: number) => void;
  onGetVolume: (bus: AudioBusName) => number;
  controls: Controls;
}

export class MainMenuView {
  readonly element = document.createElement("div");
  private readonly mainNav = document.createElement("section");
  private readonly pauseNav = document.createElement("section");
  private readonly contentPanel = document.createElement("section");
  private readonly statusLine = document.createElement("p");
  private readonly loadingOverlay: HTMLDivElement;
  private readonly loadingMessage: HTMLParagraphElement;
  private readonly optionsMenu: OptionsMenu;
  private readonly newGameMenu: NewGameMenu;
  private readonly creditsMenu: CreditsMenu;
  private readonly loadPanel = document.createElement("section");
  private readonly callbacks: MainMenuViewCallbacks;

  constructor(chapters: MenuChapter[], callbacks: MainMenuViewCallbacks) {
    this.callbacks = callbacks;
    this.element.className = "hl2-menu";
    this.element.innerHTML = `
      <div class="hl2-menu__backdrop"></div>
      <div class="hl2-menu__scanlines"></div>
      <div class="hl2-menu__frame">
        <header class="hl2-brand">
          <div class="hl2-brand__lambda" aria-hidden="true">
            <span class="hl2-brand__lambda-glyph">&#955;</span>
          </div>
          <div class="hl2-brand__text">
            <span class="hl2-brand__sub">FAN PROJECT</span>
            <h1>HALF-LIFE <span>3</span></h1>
            <span class="hl2-brand__tag">CASCADIA LABS</span>
          </div>
        </header>
      </div>
      <div class="hl2-menu__loading">
        <div class="hl2-loading">
          <div class="hl2-loading__lambda" aria-hidden="true">&#955;</div>
          <p class="hl2-loading__text">CARGANDO<span class="hl2-loading__dots"></span></p>
          <p class="hl2-loading__hint">Inicializando sistemas del traje HEV...</p>
        </div>
      </div>
    `;

    const frame = this.element.querySelector(".hl2-menu__frame") as HTMLElement;

    this.mainNav.className = "hl2-panel hl2-panel--nav";
    this.mainNav.innerHTML = `
      <nav class="hl2-nav">
        <button class="hl2-button" data-state="newGameMenu" type="button">
          <span class="hl2-button__marker"></span>
          <span class="hl2-button__label">NUEVA PARTIDA</span>
        </button>
        <button class="hl2-button" data-state="customMaps" type="button">
          <span class="hl2-button__marker"></span>
          <span class="hl2-button__label">MAPAS PERSONALIZADOS</span>
        </button>
        <button class="hl2-button" data-state="loadGame" type="button">
          <span class="hl2-button__marker"></span>
          <span class="hl2-button__label">CARGAR PARTIDA</span>
        </button>
        <button class="hl2-button" data-state="options" type="button">
          <span class="hl2-button__marker"></span>
          <span class="hl2-button__label">OPCIONES</span>
        </button>
        <button class="hl2-button" data-state="credits" type="button">
          <span class="hl2-button__marker"></span>
          <span class="hl2-button__label">CREDITOS</span>
        </button>
        <button class="hl2-button" data-action="editor" type="button">
          <span class="hl2-button__marker"></span>
          <span class="hl2-button__label">EDITOR DE NIVELES</span>
        </button>
        <button class="hl2-button" data-action="exit" type="button">
          <span class="hl2-button__marker"></span>
          <span class="hl2-button__label">SALIR</span>
        </button>
      </nav>
    `;

    this.pauseNav.className = "hl2-panel hl2-panel--nav is-hidden";
    this.pauseNav.innerHTML = `
      <p class="hl2-pause-label">PAUSA</p>
      <nav class="hl2-nav">
        <button class="hl2-button hl2-button--primary" data-action="resume" type="button">
          <span class="hl2-button__marker"></span>
          <span class="hl2-button__label">CONTINUAR</span>
        </button>
        <button class="hl2-button" data-state="options" type="button">
          <span class="hl2-button__marker"></span>
          <span class="hl2-button__label">OPCIONES</span>
        </button>
        <button class="hl2-button" data-action="exitToMain" type="button">
          <span class="hl2-button__marker"></span>
          <span class="hl2-button__label">SALIR AL MENU PRINCIPAL</span>
        </button>
      </nav>
    `;

    this.contentPanel.className = "hl2-panel hl2-panel--content is-hidden";

    this.statusLine.className = "hl2-status";
    this.statusLine.textContent = "Selecciona una opcion.";

    frame.append(this.mainNav, this.pauseNav, this.contentPanel, this.statusLine);

    this.loadingOverlay = this.element.querySelector(
      ".hl2-menu__loading",
    ) as HTMLDivElement;
    this.loadingMessage = this.loadingOverlay.querySelector(
      ".hl2-loading__hint",
    ) as HTMLParagraphElement;

    this.newGameMenu = new NewGameMenu(
      chapters,
      callbacks.onStartChapter,
      callbacks.onBack,
    );
    this.optionsMenu = new OptionsMenu({
      onBack: callbacks.onBack,
      onToggleDebug: callbacks.onToggleDebug,
      onVolumeChange: callbacks.onVolumeChange,
      getVolume: callbacks.onGetVolume,
      controls: callbacks.controls,
    });
    this.creditsMenu = new CreditsMenu(callbacks.onBack);

    this.loadPanel.className = "hl2-panel hl2-panel--content";
    this.loadPanel.innerHTML = `
      <div class="hl2-panel__header">
        <h2>CARGAR PARTIDA</h2>
        <p>Sistema de guardado todavia no implementado.</p>
      </div>
      <div class="hl2-actions">
        <button class="hl2-button" type="button" data-action="back">
          <span class="hl2-button__marker"></span>
          <span class="hl2-button__label">VOLVER</span>
        </button>
      </div>
    `;
    (
      this.loadPanel.querySelector('[data-action="back"]') as HTMLButtonElement
    ).addEventListener("click", callbacks.onBack);

    this.element
      .querySelectorAll<HTMLButtonElement>("[data-state]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const state = button.dataset.state as GameMenuState;
          if (state) {
            callbacks.onOpenState(state);
          }
        });
      });

    const exitButton = this.mainNav.querySelector(
      '[data-action="exit"]',
    ) as HTMLButtonElement;
    exitButton.addEventListener("click", () => {
      this.setStatus("No disponible en navegador.");
    });

    const editorButton = this.mainNav.querySelector(
      '[data-action="editor"]',
    ) as HTMLButtonElement;
    editorButton.addEventListener("click", callbacks.onOpenEditor);

    const resumeButton = this.pauseNav.querySelector(
      '[data-action="resume"]',
    ) as HTMLButtonElement;
    resumeButton.addEventListener("click", callbacks.onResume);

    const exitToMainButton = this.pauseNav.querySelector(
      '[data-action="exitToMain"]',
    ) as HTMLButtonElement;
    exitToMainButton.addEventListener("click", callbacks.onExitToMain);
  }

  setState(state: GameMenuState, pauseFlow: boolean): void {
    this.element.dataset.state = state;
    const isLoading = state === "loading";
    const isSubMenu =
      state === "newGameMenu" ||
      state === "customMaps" ||
      state === "options" ||
      state === "credits" ||
      state === "loadGame";

    this.loadingOverlay.classList.toggle("is-visible", isLoading);
    this.mainNav.classList.toggle("is-hidden", isLoading || pauseFlow);
    this.pauseNav.classList.toggle("is-hidden", isLoading || !pauseFlow);
    this.contentPanel.classList.toggle("is-hidden", !isSubMenu);

    this.contentPanel.replaceChildren();
    if (state === "newGameMenu") {
      this.contentPanel.append(this.newGameMenu.element);
    } else if (state === "customMaps") {
      this.contentPanel.append(this.buildCustomMapsMenu().element);
    } else if (state === "options") {
      this.contentPanel.append(this.optionsMenu.element);
    } else if (state === "credits") {
      this.contentPanel.append(this.creditsMenu.element);
    } else if (state === "loadGame") {
      this.contentPanel.append(this.loadPanel);
    }
  }

  /** Reconstruido cada vez: la biblioteca local cambia (importar/borrar). */
  private buildCustomMapsMenu(): CustomMapsMenu {
    return new CustomMapsMenu(buildCustomMaps(), {
      onPlay: this.callbacks.onStartCustomMap,
      onEdit: this.callbacks.onEditCustomMap,
      onDelete: this.callbacks.onDeleteLibraryMap,
      onImport: this.callbacks.onImportCustomMap,
      onBack: this.callbacks.onBack,
    });
  }

  dispose(): void {
    this.optionsMenu.dispose();
  }

  setVisible(visible: boolean): void {
    this.element.classList.toggle("is-hidden", !visible);
  }

  setStatus(message: string): void {
    this.statusLine.textContent = message;
  }

  setLoadingMessage(message: string): void {
    this.loadingMessage.textContent = message;
  }

  setDebugEnabled(enabled: boolean): void {
    this.optionsMenu.setDebugEnabled(enabled);
  }
}
