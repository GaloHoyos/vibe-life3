import type { Disposable } from "@shared/types/lifecycle";
import type { SaveEnvelopeV1 } from "@game/save";
import {
  SaveGameMenuView,
  type SaveGameMenuAction,
  type SaveGameMenuMode,
} from "./SaveGameMenuView";

type AsyncAction = () => void | Promise<void>;

export interface SaveGameMenuCallbacks {
  listSaves: () => Promise<readonly SaveEnvelopeV1[]>;
  onLoadSave: (id: string) => void | Promise<void>;
  onCreateManualSave: () => void | Promise<void>;
  onOverwriteSave: (id: string) => void | Promise<void>;
  onDeleteSave: (id: string) => void | Promise<void>;
  onBack: () => void;
  onSavesChanged?: (saves: readonly SaveEnvelopeV1[]) => void;
}

export class SaveGameMenu implements Disposable {
  readonly element: HTMLElement;
  private readonly view: SaveGameMenuView;
  private mode: SaveGameMenuMode = "load";
  private requestVersion = 0;
  private disposed = false;
  private operating = false;

  constructor(private readonly callbacks: SaveGameMenuCallbacks) {
    this.view = new SaveGameMenuView({
      onAction: (action) => {
        void this.handleAction(action);
      },
    });
    this.element = this.view.element;
  }

  show(mode: SaveGameMenuMode): void {
    this.mode = mode;
    this.view.setMode(mode);
    void this.refresh();
  }

  async refresh(): Promise<readonly SaveEnvelopeV1[]> {
    const version = ++this.requestVersion;
    this.view.setLoading(true);
    try {
      const saves = await this.callbacks.listSaves();
      if (this.disposed || version !== this.requestVersion) return [];
      this.view.setSaves(saves);
      this.callbacks.onSavesChanged?.(saves);
      return saves;
    } catch (error) {
      if (this.disposed || version !== this.requestVersion) return [];
      this.view.setError(toSpanishError(error, "No se pudieron leer los guardados."));
      return [];
    }
  }

  dispose(): void {
    this.disposed = true;
    this.requestVersion += 1;
    this.view.dispose();
  }

  private async handleAction(action: SaveGameMenuAction): Promise<void> {
    if (action.kind === "back") {
      this.callbacks.onBack();
      return;
    }
    if (action.kind === "retry") {
      await this.refresh();
      return;
    }
    if (this.operating) return;

    switch (action.kind) {
      case "create":
        await this.runOperation(
          "Guardando partida...",
          "Partida guardada.",
          this.callbacks.onCreateManualSave,
        );
        break;
      case "load":
        await this.runOperation(
          "Restaurando partida...",
          "",
          () => this.callbacks.onLoadSave(action.id),
          false,
        );
        break;
      case "overwrite":
        await this.runOperation(
          "Sobrescribiendo guardado...",
          "Guardado actualizado.",
          () => this.callbacks.onOverwriteSave(action.id),
        );
        break;
      case "delete":
        await this.runOperation(
          "Borrando guardado...",
          "Guardado borrado.",
          () => this.callbacks.onDeleteSave(action.id),
        );
        break;
    }
  }

  private async runOperation(
    progress: string,
    success: string,
    operation: AsyncAction,
    refreshAfter = true,
  ): Promise<void> {
    this.operating = true;
    this.view.setBusy(true, progress);
    try {
      await operation();
      if (this.disposed) return;
      if (refreshAfter) {
        const saves = await this.refresh();
        if (!this.disposed && success) {
          this.view.setSaves(saves, success);
        }
      }
    } catch (error) {
      if (!this.disposed) {
        this.view.setError(
          toSpanishError(error, "No se pudo completar la operación."),
        );
      }
    } finally {
      this.operating = false;
    }
  }
}

function toSpanishError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}
