import { ControlsMenu } from "./ControlsMenu";
import { CreditsMenu } from "./CreditsMenu";
import { NewGameMenu } from "./NewGameMenu";
import { OptionsMenu } from "./OptionsMenu";
import type { GameMenuState, MenuChapter } from "./MainMenuState";
import type { AudioBusName } from "../../audio/AudioSystem";

export interface MainMenuViewCallbacks {
  onStartChapter: (chapterId: string) => void;
  onOpenState: (state: GameMenuState) => void;
  onBackToMain: () => void;
  onBackToPause: () => void;
  onResume: () => void;
  onToggleDebug: (enabled: boolean) => void;
  onVolumeChange: (bus: AudioBusName, value: number) => void;
  onGetVolume: (bus: AudioBusName) => number;
}

export class MainMenuView {
  readonly element = document.createElement("div");
  private readonly navPanel = document.createElement("section");
  private readonly contentPanel = document.createElement("section");
  private readonly statusLine = document.createElement("p");
  private backHandler: () => void;
  private readonly optionsMenu: OptionsMenu;
  private readonly newGameMenu: NewGameMenu;
  private readonly controlsMenu: ControlsMenu;
  private readonly creditsMenu: CreditsMenu;
  private readonly loadPanel = document.createElement("section");
  private readonly pausePanel = document.createElement("section");

  constructor(chapters: MenuChapter[], callbacks: MainMenuViewCallbacks) {
    this.element.className = "hl3-menu";
    this.element.innerHTML = `
      <div class="hl3-menu__backdrop"></div>
      <div class="hl3-menu__noise"></div>
      <div class="hl3-menu__frame">
        <header class="hl3-title">
          <span class="hl3-title__label">CASCADIA LABS PRESENTA</span>
          <h1>HALF-LIFE <span>3</span></h1>
          <p>PROTOCOLO DE ENTRENAMIENTO // SISTEMA HEV</p>
        </header>
      </div>
    `;

    const frame = this.element.querySelector(".hl3-menu__frame") as HTMLElement;
    this.navPanel.className = "hl3-panel hl3-panel--nav";
    this.navPanel.innerHTML = `
      <nav class="hl3-nav">
        <button class="hl3-button" data-state="newGameMenu" type="button">Nueva Partida</button>
        <button class="hl3-button" data-state="loadGame" type="button">Cargar Partida</button>
        <button class="hl3-button" data-state="options" type="button">Opciones</button>
        <button class="hl3-button" data-state="controls" type="button">Controles</button>
        <button class="hl3-button" data-state="credits" type="button">Creditos</button>
        <button class="hl3-button" data-action="exit" type="button">Salir</button>
      </nav>
    `;

    this.contentPanel.className = "hl3-panel hl3-panel--content is-hidden";

    this.statusLine.className = "hl3-status";
    this.statusLine.textContent = "Selecciona una opcion.";

    frame.append(this.navPanel, this.contentPanel, this.statusLine);

    this.backHandler = callbacks.onBackToMain;
    this.newGameMenu = new NewGameMenu(chapters, callbacks.onStartChapter, () =>
      this.backHandler(),
    );
    this.optionsMenu = new OptionsMenu({
      onBack: () => this.backHandler(),
      onToggleDebug: callbacks.onToggleDebug,
      onVolumeChange: callbacks.onVolumeChange,
      getVolume: callbacks.onGetVolume,
    });
    this.controlsMenu = new ControlsMenu(() => this.backHandler());
    this.creditsMenu = new CreditsMenu(() => this.backHandler());

    this.loadPanel.className = "hl3-panel hl3-panel--content";
    this.loadPanel.innerHTML = `
      <div class="hl3-panel__header">
        <h2>Cargar Partida</h2>
        <p>Sistema de guardado todavia no implementado.</p>
      </div>
      <div class="hl3-actions">
        <button class="hl3-button" type="button" data-action="back">Volver</button>
      </div>
    `;
    (
      this.loadPanel.querySelector('[data-action="back"]') as HTMLButtonElement
    ).addEventListener("click", () => this.backHandler());

    this.pausePanel.className = "hl3-panel hl3-panel--content";
    this.pausePanel.innerHTML = `
      <div class="hl3-panel__header">
        <h2>Pausa</h2>
        <p>Sesion en espera.</p>
      </div>
      <div class="hl3-actions hl3-actions--stack">
        <button class="hl3-button hl3-button--primary" type="button" data-action="resume">Continuar</button>
        <button class="hl3-button" type="button" data-state="options">Opciones</button>
        <button class="hl3-button" type="button" data-state="controls">Controles</button>
        <button class="hl3-button" type="button" data-action="main">Volver al menu principal</button>
      </div>
    `;

    (
      this.pausePanel.querySelector(
        '[data-action="resume"]',
      ) as HTMLButtonElement
    ).addEventListener("click", callbacks.onResume);
    (
      this.pausePanel.querySelector('[data-action="main"]') as HTMLButtonElement
    ).addEventListener("click", callbacks.onBackToMain);

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

    const exitButton = this.element.querySelector(
      '[data-action="exit"]',
    ) as HTMLButtonElement;
    exitButton.addEventListener("click", () => {
      this.setStatus("No disponible en navegador.");
    });

    const pauseOptionsButtons =
      this.pausePanel.querySelectorAll("[data-state]");
    pauseOptionsButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const state = (button as HTMLButtonElement).dataset
          .state as GameMenuState;
        if (state) {
          callbacks.onOpenState(state);
        }
      });
    });
  }

  setState(state: GameMenuState): void {
    this.element.dataset.state = state;
    this.contentPanel.classList.toggle("is-hidden", state === "mainMenu");
    this.navPanel.classList.toggle("is-hidden", state === "paused");

    this.contentPanel.replaceChildren();
    if (state === "newGameMenu") {
      this.contentPanel.append(this.newGameMenu.element);
    } else if (state === "options") {
      this.contentPanel.append(this.optionsMenu.element);
    } else if (state === "controls") {
      this.contentPanel.append(this.controlsMenu.element);
    } else if (state === "credits") {
      this.contentPanel.append(this.creditsMenu.element);
    } else if (state === "loadGame") {
      this.contentPanel.append(this.loadPanel);
    } else if (state === "paused") {
      this.contentPanel.append(this.pausePanel);
    }
  }

  setVisible(visible: boolean): void {
    this.element.classList.toggle("is-hidden", !visible);
  }

  setStatus(message: string): void {
    this.statusLine.textContent = message;
  }

  setDebugEnabled(enabled: boolean): void {
    this.optionsMenu.setDebugEnabled(enabled);
  }

  setBackHandler(handler: () => void): void {
    this.backHandler = handler;
  }
}
