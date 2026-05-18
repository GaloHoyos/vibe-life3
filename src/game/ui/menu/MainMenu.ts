import type { Disposable } from "../../../shared/types/lifecycle";
import { MainMenuView } from "./MainMenuView";
import { buildChapters, type GameMenuState } from "./MainMenuState";
import type { AudioBusName } from "../../../engine/audio/AudioSystem";
import type { Controls } from "../../gameplay/Controls";

export interface MainMenuCallbacks {
  onStartChapter: (chapterId: string) => void;
  onResume: () => void;
  onExitToMain: () => void;
  onToggleDebug: (enabled: boolean) => void;
  onVolumeChange: (bus: AudioBusName, value: number) => void;
  onGetVolume: (bus: AudioBusName) => number;
  controls: Controls;
}

/**
 * Componente del menú principal y de pausa (patrón Component+View con
 * `MainMenuView`). Maneja transiciones entre estados (`mainMenu`,
 * `newGameMenu`, `paused`, `options`, `loading`, etc.) y propaga acciones
 * del usuario vía callbacks (`onStartChapter`, `onResume`, `onExitToMain`).
 *
 * El flag `pauseFlow` distingue si los submenús (options/controls/etc.)
 * se abrieron desde el menú principal o desde la pausa; el botón "Volver"
 * regresa al contexto correcto y se evita exponer el nav principal —y por
 * tanto el botón "Nueva Partida"— mientras hay un nivel cargado.
 */
export class MainMenu implements Disposable {
  readonly element: HTMLDivElement;
  private state: GameMenuState = "mainMenu";
  private pauseFlow = false;
  private readonly view: MainMenuView;

  constructor(container: HTMLElement, callbacks: MainMenuCallbacks) {
    this.view = new MainMenuView(buildChapters(), {
      onStartChapter: callbacks.onStartChapter,
      onOpenState: (state) => this.setState(state),
      onBack: () => this.setState(this.pauseFlow ? "paused" : "mainMenu"),
      onResume: callbacks.onResume,
      onExitToMain: callbacks.onExitToMain,
      onToggleDebug: callbacks.onToggleDebug,
      onVolumeChange: callbacks.onVolumeChange,
      onGetVolume: callbacks.onGetVolume,
      controls: callbacks.controls,
    });
    this.element = this.view.element as HTMLDivElement;
    container.append(this.element);
  }

  setState(state: GameMenuState): void {
    if (state === "paused") {
      this.pauseFlow = true;
    } else if (state === "mainMenu" || state === "playing") {
      this.pauseFlow = false;
    }
    this.state = state;
    this.view.setState(state, this.pauseFlow);
    this.view.setVisible(state !== "playing");
  }

  getState(): GameMenuState {
    return this.state;
  }

  showMain(): void {
    this.setState("mainMenu");
  }

  showPause(): void {
    this.setState("paused");
  }

  showLoading(message?: string): void {
    if (message) {
      this.view.setLoadingMessage(message);
    }
    this.setState("loading");
  }

  hide(): void {
    this.setState("playing");
  }

  setStatus(message: string): void {
    this.view.setStatus(message);
  }

  setDebugEnabled(enabled: boolean): void {
    this.view.setDebugEnabled(enabled);
  }

  dispose(): void {
    this.view.dispose();
    this.element.remove();
  }
}
