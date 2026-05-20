import type { GameEventBus } from "@game/GameEvents";
import type { Disposable } from "@shared/types/lifecycle";
import type { NpcAiTraceRecorder } from "./NpcAiTraceRecorder";

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
 * Mini-panel DOM con botones para iniciar/detener+exportar el trace de IA.
 * Se muestra junto al `DebugOverlay` (F3) y se oculta con el mismo toggle.
 *
 * El recorder en sí (`NpcAiTraceRecorder`) no toca DOM — este panel solo lo
 * comanda. También expone `window.__aiTrace` para controlarlo desde la
 * consola del browser, lo cual es la forma práctica de agregar NPCs al modo
 * verbose sin meter un input al panel.
 */
export class NpcAiTracePanel implements Disposable {
  private readonly element: HTMLDivElement;
  private readonly toggleBtn: HTMLButtonElement;
  private readonly statusLine: HTMLDivElement;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    container: HTMLElement,
    private readonly recorder: NpcAiTraceRecorder,
    eventBus: GameEventBus,
  ) {
    this.element = document.createElement("div");
    this.element.className = "npc-ai-trace-panel is-hidden";
    Object.assign(this.element.style, {
      position: "fixed",
      top: "16px",
      left: "16px",
      transform: "translateY(140px)",
      padding: "8px 10px",
      background: "rgba(4, 10, 14, 0.78)",
      border: "1px solid #2a9dc8",
      borderRadius: "4px",
      color: "#d8edf4",
      font: "12px monospace",
      zIndex: "40",
      display: "flex",
      flexDirection: "column",
      gap: "6px",
      minWidth: "220px",
      pointerEvents: "auto",
    } satisfies Partial<CSSStyleDeclaration>);

    const title = document.createElement("div");
    title.textContent = "AI Trace";
    title.style.color = "#84e9ff";
    title.style.fontWeight = "bold";
    this.element.appendChild(title);

    this.statusLine = document.createElement("div");
    this.statusLine.textContent = "Listo. Toca Iniciar para grabar.";
    this.statusLine.style.fontSize = "11px";
    this.statusLine.style.opacity = "0.85";
    this.element.appendChild(this.statusLine);

    const buttonRow = document.createElement("div");
    buttonRow.style.display = "flex";
    buttonRow.style.gap = "6px";
    this.element.appendChild(buttonRow);

    this.toggleBtn = this.makeButton("Iniciar", () => this.handleToggle());
    buttonRow.appendChild(this.toggleBtn);

    const exportBtn = this.makeButton("Exportar", () => {
      this.recorder.stopAndExportFile();
      this.refresh();
    });
    buttonRow.appendChild(exportBtn);

    const hint = document.createElement("div");
    hint.style.fontSize = "10px";
    hint.style.opacity = "0.6";
    hint.textContent = "Modo verbose: __aiTrace.watch('npc-id')";
    this.element.appendChild(hint);

    container.appendChild(this.element);

    this.unsubscribers.push(
      eventBus.on("debug.toggle", ({ enabled }) => {
        this.element.classList.toggle("is-hidden", !enabled);
        this.element.style.display = enabled ? "flex" : "none";
        if (enabled) this.refresh();
      }),
    );
    this.element.style.display = "none";

    window.__aiTrace = {
      start: () => this.startRecording(),
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

  refresh(): void {
    const watched = this.recorder.watchedIds();
    if (this.recorder.isRecording()) {
      this.toggleBtn.textContent = "Detener";
      this.statusLine.textContent = `Grabando · verbose: ${watched.length || "ninguno"}`;
    } else {
      this.toggleBtn.textContent = "Iniciar";
      this.statusLine.textContent =
        watched.length > 0
          ? `Listo · verbose: ${watched.join(", ")}`
          : "Listo. Toca Iniciar para grabar.";
    }
  }

  dispose(): void {
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers.length = 0;
    this.element.remove();
    if (window.__aiTrace) {
      delete window.__aiTrace;
    }
  }

  private handleToggle(): void {
    if (this.recorder.isRecording()) {
      this.recorder.stopAndExportFile();
    } else {
      this.startRecording();
    }
    this.refresh();
  }

  private startRecording(): void {
    this.recorder.start();
    this.refresh();
  }

  private makeButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    Object.assign(btn.style, {
      background: "#143242",
      border: "1px solid #2a9dc8",
      color: "#d8edf4",
      padding: "4px 10px",
      cursor: "pointer",
      font: "12px monospace",
      borderRadius: "3px",
    } satisfies Partial<CSSStyleDeclaration>);
    btn.addEventListener("click", onClick);
    return btn;
  }
}
