import { MainMenuView } from "./MainMenuView";
import { DefaultChapters, type GameMenuState } from "./MainMenuState";
import type { AudioBusName } from "../../../engine/audio/AudioSystem";

export interface MainMenuCallbacks {
  onStartChapter: (chapterId: string) => void;
  onResume: () => void;
  onReturnToMain: () => void;
  onToggleDebug: (enabled: boolean) => void;
  onVolumeChange: (bus: AudioBusName, value: number) => void;
  onGetVolume: (bus: AudioBusName) => number;
}

export class MainMenu {
  readonly element: HTMLDivElement;
  private state: GameMenuState = "mainMenu";
  private backTarget: GameMenuState = "mainMenu";
  private readonly view: MainMenuView;

  constructor(container: HTMLElement, callbacks: MainMenuCallbacks) {
    this.view = new MainMenuView(DefaultChapters, {
      onStartChapter: callbacks.onStartChapter,
      onOpenState: (state) => this.setState(state),
      onBackToMain: () => this.setState("mainMenu"),
      onBackToPause: () => this.setState("paused"),
      onResume: callbacks.onResume,
      onToggleDebug: callbacks.onToggleDebug,
      onVolumeChange: callbacks.onVolumeChange,
      onGetVolume: callbacks.onGetVolume,
    });
    this.element = this.view.element as HTMLDivElement;
    container.append(this.element);
  }

  setState(state: GameMenuState): void {
    if (
      state === "options" ||
      state === "controls" ||
      state === "credits" ||
      state === "loadGame" ||
      state === "newGameMenu"
    ) {
      this.backTarget = this.state === "paused" ? "paused" : "mainMenu";
      this.view.setBackHandler(() => this.setState(this.backTarget));
    }

    this.state = state;
    this.view.setState(state);
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

  hide(): void {
    this.setState("playing");
  }

  setStatus(message: string): void {
    this.view.setStatus(message);
  }

  setDebugEnabled(enabled: boolean): void {
    this.view.setDebugEnabled(enabled);
  }
}
