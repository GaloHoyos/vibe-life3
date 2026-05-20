import { NpcAiTraceRecorder } from "@game/debug/NpcAiTraceRecorder";
import type { GameEventBus } from "@game/GameEvents";
import type { DebugFrame, DebugModule } from "../DebugModule";
import { buildButton, buildSection } from "../widgets";

declare global {
  interface Window {
    /**
     * API global para controlar el recorder desde la consola del browser.
     * Ej: `__aiTrace.watch('sfw-zombie-trench-1')`, `__aiTrace.start()`,
     * `__aiTrace.stop()`, `__aiTrace.export()` (devuelve string).
     */
    __aiTrace?: {
      start: () => void;
      stop: () => void;
      export: () => string;
      download: () => void;
      watch: (npcId: string) => void;
      unwatch: (npcId: string) => void;
      watched: () => string[];
    };
  }
}

/**
 * Grabador offline de IA + panel para controlarlo. "Activo" significa que
 * el `update` se llama por frame; la grabacion real se controla con el
 * boton Iniciar/Detener (puede estar mounted-y-activo pero sin grabar).
 *
 * Tambien expone `window.__aiTrace` para manejar verbose watches desde la
 * consola del browser.
 */
export class AiTraceModule implements DebugModule {
  readonly id = "ai-trace";
  readonly label = "IA trace";
  readonly heavy = true;
  private readonly recorder: NpcAiTraceRecorder;
  private active = false;
  private statusLine: HTMLDivElement | null = null;
  private toggleButton: HTMLButtonElement | null = null;

  constructor(eventBus: GameEventBus) {
    this.recorder = new NpcAiTraceRecorder(eventBus);
  }

  mount(container: HTMLElement): void {
    const section = buildSection("IA trace recorder", "#84e9ff");

    const desc = document.createElement("p");
    desc.className = "debug-help";
    desc.textContent =
      "Graba transiciones de IA y anomalias (stuck, path vacio, loop de waypoint). Encender modulo + Iniciar; Detener descarga el txt.";
    section.appendChild(desc);

    this.statusLine = document.createElement("div");
    this.statusLine.className = "debug-status";
    this.statusLine.textContent = "Listo";
    section.appendChild(this.statusLine);

    const row = document.createElement("div");
    row.className = "debug-row";
    this.toggleButton = buildButton("Iniciar", () => this.handleToggle());
    row.appendChild(this.toggleButton);
    row.appendChild(
      buildButton("Exportar", () => {
        this.recorder.stopAndExportFile();
        this.refresh();
      }),
    );
    section.appendChild(row);

    const hint = document.createElement("div");
    hint.className = "debug-help debug-help--dim";
    hint.textContent = "Verbose por NPC: __aiTrace.watch('npc-id') en consola.";
    section.appendChild(hint);

    container.appendChild(section);

    window.__aiTrace = {
      start: () => {
        this.recorder.start();
        this.refresh();
      },
      stop: () => {
        this.recorder.stop();
        this.refresh();
      },
      export: () => this.recorder.exportText(),
      download: () => {
        this.recorder.stopAndExportFile();
        this.refresh();
      },
      watch: (id) => {
        this.recorder.watch(id);
        this.refresh();
      },
      unwatch: (id) => {
        this.recorder.unwatch(id);
        this.refresh();
      },
      watched: () => this.recorder.watchedIds(),
    };
  }

  update(frame: DebugFrame): void {
    this.recorder.update(frame.elapsed, frame.npcs);
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (!active && this.recorder.isRecording()) {
      this.recorder.stop();
    }
    this.refresh();
  }

  isActive(): boolean {
    return this.active;
  }

  dispose(): void {
    this.recorder.dispose();
    if (window.__aiTrace) {
      delete window.__aiTrace;
    }
  }

  private handleToggle(): void {
    if (this.recorder.isRecording()) {
      this.recorder.stopAndExportFile();
    } else {
      this.recorder.start();
    }
    this.refresh();
  }

  private refresh(): void {
    if (!this.statusLine || !this.toggleButton) return;
    const watched = this.recorder.watchedIds();
    if (this.recorder.isRecording()) {
      this.toggleButton.textContent = "Detener";
      this.statusLine.textContent = `Grabando | verbose: ${watched.length ? watched.join(", ") : "ninguno"}`;
      this.statusLine.classList.add("is-on");
    } else {
      this.toggleButton.textContent = "Iniciar";
      this.statusLine.textContent = this.active
        ? `Listo${watched.length ? ` | verbose: ${watched.join(", ")}` : ""}`
        : "Inactivo (encender modulo para grabar)";
      this.statusLine.classList.remove("is-on");
    }
  }
}
