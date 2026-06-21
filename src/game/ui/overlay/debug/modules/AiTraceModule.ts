import { Vector3 } from "three";
import { NpcAiTraceRecorder } from "@game/debug/NpcAiTraceRecorder";
import type { NavSpace } from "@engine/ai/nav/NavSpace";
import type { GameEventBus } from "@game/GameEvents";
import type { INpc } from "@game/npc/core/INpc";
import type { DebugFrame, DebugModule } from "../DebugModule";
import { buildButton, buildOutput, buildSection } from "../widgets";

declare global {
  interface Window {
    /**
     * API global para controlar el recorder desde la consola del browser.
     * Mantenida por compatibilidad: el panel del DebugMenu hace todo esto
     * gráficamente (lista de NPCs, bookmark, tail en vivo).
     */
    __aiTrace?: {
      start: () => void;
      stop: () => void;
      export: () => string;
      download: () => void;
      watch: (npcId: string) => void;
      unwatch: (npcId: string) => void;
      watched: () => string[];
      bookmark: (label?: string) => void;
      navSpace: () => string;
      downloadNavSpace: () => void;
      /** Celdas del NavSpace cerca de (x, z): centro, surface, room, componente y edges. */
      cellsNear: (x: number, z: number, radius?: number) => string;
      /** Prueba un findPath crudo entre dos puntos world. Reporta celdas resueltas y resultado. */
      tryPath: (fx: number, fy: number, fz: number, tx: number, ty: number, tz: number) => string;
    };
  }
}

const UI_REFRESH_INTERVAL = 0.25;
const TAIL_LIMIT = 8;

/**
 * Panel del recorder de IA. Encapsula todo el control desde el DebugMenu:
 *  - Start/Stop con downloadable .txt.
 *  - Botón de bookmark (marca el log con un timestamp + texto opcional).
 *  - Lista de NPCs del nivel: checkbox por NPC para alternar verbose.
 *  - "Live tail" con las últimas N entradas (transiciones, anomalías,
 *    eventos de combate, bookmarks).
 *
 * `window.__aiTrace` queda mounted como acceso secundario para power-users,
 * pero el panel cubre todos los casos sin consola.
 */
export class AiTraceModule implements DebugModule {
  readonly id = "ai-trace";
  readonly label = "IA trace";
  readonly heavy = true;
  readonly updateWhenHidden = true;
  private readonly recorder: NpcAiTraceRecorder;
  private active = false;
  private statusLine: HTMLDivElement | null = null;
  private toggleButton: HTMLButtonElement | null = null;
  private bookmarkButton: HTMLButtonElement | null = null;
  private npcsListHost: HTMLDivElement | null = null;
  private tailHost: HTMLPreElement | null = null;
  private uiRefreshTimer = 0;
  private lastNpcsKey = "";
  private currentNpcIds: string[] = [];
  private currentNavSpace: NavSpace | null = null;

  constructor(eventBus: GameEventBus) {
    this.recorder = new NpcAiTraceRecorder(eventBus);
  }

  mount(container: HTMLElement): void {
    const section = buildSection("IA trace recorder", "#84e9ff");

    const desc = document.createElement("p");
    desc.className = "debug-help";
    desc.textContent =
      "Graba transiciones de IA (con razón), anomalías heurísticas y eventos de combate. Marcá bookmarks para correlar con lo que ves en pantalla.";
    section.appendChild(desc);

    this.statusLine = document.createElement("div");
    this.statusLine.className = "debug-status";
    this.statusLine.textContent = "Listo";
    section.appendChild(this.statusLine);

    const row = document.createElement("div");
    row.className = "debug-row";
    this.toggleButton = buildButton("Iniciar", () => this.handleToggle());
    row.appendChild(this.toggleButton);
    this.bookmarkButton = buildButton("Bookmark", () => this.handleBookmark());
    this.bookmarkButton.disabled = true;
    row.appendChild(this.bookmarkButton);
    row.appendChild(
      buildButton("Exportar", () => {
        this.recorder.stopAndExportFile();
        this.refresh();
      }),
    );
    row.appendChild(buildButton("NavSpace", () => this.handleNavSpaceExport()));
    section.appendChild(row);

    const npcsHeader = document.createElement("div");
    npcsHeader.className = "debug-help debug-help--dim";
    npcsHeader.textContent = "NPCs del nivel (marcá para verbose snapshot):";
    section.appendChild(npcsHeader);

    this.npcsListHost = document.createElement("div");
    this.npcsListHost.className = "debug-row debug-row--column";
    section.appendChild(this.npcsListHost);

    const tailHeader = document.createElement("div");
    tailHeader.className = "debug-help debug-help--dim";
    tailHeader.textContent = `Últimas ${TAIL_LIMIT} entradas:`;
    section.appendChild(tailHeader);

    this.tailHost = buildOutput();
    this.tailHost.textContent = "(arrancar grabación)";
    section.appendChild(this.tailHost);

    container.appendChild(section);

    window.__aiTrace = {
      start: () => {
        this.active = true;
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
      bookmark: (label) => {
        this.recorder.bookmark(label);
        this.refresh();
      },
      navSpace: () =>
        this.currentNavSpace ? exportNavSpaceText(this.currentNavSpace) : "(navSpace no disponible)",
      downloadNavSpace: () => this.handleNavSpaceExport(),
      cellsNear: (x, z, radius = 3) =>
        this.currentNavSpace
          ? exportCellsNear(this.currentNavSpace, x, z, radius)
          : "(navSpace no disponible)",
      tryPath: (fx, fy, fz, tx, ty, tz) =>
        this.currentNavSpace
          ? exportTryPath(this.currentNavSpace, fx, fy, fz, tx, ty, tz)
          : "(navSpace no disponible)",
    };
  }

  update(frame: DebugFrame): void {
    this.currentNavSpace = frame.navSpace;
    this.recorder.update(frame.elapsed, frame.npcs);
    this.uiRefreshTimer -= frame.delta;
    if (this.uiRefreshTimer <= 0) {
      this.uiRefreshTimer = UI_REFRESH_INTERVAL;
      this.syncNpcsList(frame.npcs);
      this.refresh();
    }
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
      this.active = true;
      this.recorder.start();
    }
    this.refresh();
  }

  private handleBookmark(): void {
    const label = window.prompt("Etiqueta del bookmark (opcional):") ?? "";
    this.recorder.bookmark(label);
    this.refresh();
  }

  private handleNavSpaceExport(): void {
    if (!this.currentNavSpace) {
      if (this.statusLine) {
        this.statusLine.textContent = "NavSpace no disponible todavía";
      }
      return;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadTextFile(`navspace-debug-${stamp}.txt`, exportNavSpaceText(this.currentNavSpace));
  }

  private syncNpcsList(npcs: readonly INpc[]): void {
    if (!this.npcsListHost) return;
    const ids = npcs.map((n) => n.id).sort();
    const key = ids.join("|");
    if (key === this.lastNpcsKey) return;
    this.lastNpcsKey = key;
    this.currentNpcIds = ids;

    this.npcsListHost.innerHTML = "";
    if (ids.length === 0) {
      const empty = document.createElement("div");
      empty.className = "debug-help debug-help--dim";
      empty.textContent = "(sin NPCs en escena)";
      this.npcsListHost.appendChild(empty);
      return;
    }

    const watched = new Set(this.recorder.watchedIds());
    for (const id of ids) {
      const label = document.createElement("label");
      label.className = "debug-checkbox";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = watched.has(id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) this.recorder.watch(id);
        else this.recorder.unwatch(id);
        this.refresh();
      });
      label.appendChild(checkbox);
      const span = document.createElement("span");
      span.textContent = id;
      label.appendChild(span);
      this.npcsListHost.appendChild(label);
    }
  }

  private refresh(): void {
    if (this.statusLine && this.toggleButton && this.bookmarkButton) {
      const watched = this.recorder.watchedIds();
      const recording = this.recorder.isRecording();
      const count = this.recorder.entryCount();
      if (recording) {
        this.toggleButton.textContent = "Detener";
        this.statusLine.textContent = `Grabando · ${count} entradas · verbose: ${watched.length ? watched.join(", ") : "ninguno"}`;
        this.statusLine.classList.add("is-on");
        this.bookmarkButton.disabled = false;
      } else {
        this.toggleButton.textContent = "Iniciar";
        this.statusLine.textContent = this.active
          ? `Listo${watched.length ? ` · verbose: ${watched.join(", ")}` : ""}`
          : "Inactivo (encender módulo para grabar)";
        this.statusLine.classList.remove("is-on");
        this.bookmarkButton.disabled = true;
      }
    }

    if (this.tailHost) {
      const tail = this.recorder.recentEntries(TAIL_LIMIT);
      if (tail.length === 0) {
        this.tailHost.textContent = this.recorder.isRecording()
          ? "(sin eventos todavía)"
          : "(arrancar grabación)";
      } else {
        this.tailHost.textContent = tail
          .map((e) => {
            const tag =
              e.kind === "anomaly"
                ? "!"
                : e.kind === "bookmark"
                  ? "★"
                  : e.kind === "event"
                    ? "•"
                    : e.kind === "signal"
                      ? "~"
                      : e.kind === "verbose"
                        ? "·"
                        : "→";
            return `${formatTime(e.t)} ${tag} ${e.npcId}: ${e.text}`;
          })
          .join("\n");
      }
    }
  }
}

function formatTime(t: number): string {
  const min = Math.floor(t / 60);
  const sec = t - min * 60;
  return `${String(min).padStart(2, "0")}:${sec.toFixed(2).padStart(5, "0")}`;
}

interface ComponentStats {
  count: number;
  byZone: Map<string, number>;
  sample: [number, number, number];
  minY: number;
  maxY: number;
}

/** Dump legible del NavSpace: resumen por componente (zona/surface/altura) + portales. */
function exportNavSpaceText(navSpace: NavSpace): string {
  const cells = navSpace.getCells();
  const portals = navSpace.getPortals();
  const byComponent = new Map<number, ComponentStats>();
  let orphans = 0;
  for (const cell of cells) {
    let stats = byComponent.get(cell.componentId);
    if (!stats) {
      stats = { count: 0, byZone: new Map(), sample: cell.center, minY: Infinity, maxY: -Infinity };
      byComponent.set(cell.componentId, stats);
    }
    stats.count += 1;
    const zone = `${cell.buildingId ?? "exterior"}/${cell.roomId ?? "-"}/${cell.surface}`;
    stats.byZone.set(zone, (stats.byZone.get(zone) ?? 0) + 1);
    stats.minY = Math.min(stats.minY, cell.center[1]);
    stats.maxY = Math.max(stats.maxY, cell.center[1]);
    if (cell.edgeCount === 0) orphans += 1;
  }
  const lines: string[] = [
    `NavSpace: ${cells.length} celdas, ${portals.length} portales, ${byComponent.size} componentes, ${orphans} huerfanas`,
    "",
    "Componentes:",
  ];
  for (const [componentId, stats] of [...byComponent.entries()].sort((a, b) => b[1].count - a[1].count)) {
    const [sx, sy, sz] = stats.sample;
    lines.push(
      `  #${componentId}: ${stats.count} celdas, y=[${stats.minY.toFixed(1)}, ${stats.maxY.toFixed(1)}], sample=(${sx.toFixed(1)}, ${sy.toFixed(1)}, ${sz.toFixed(1)})`,
    );
    const zones = [...stats.byZone.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    for (const [zone, count] of zones) {
      lines.push(`      ${zone}: ${count}`);
    }
  }
  lines.push("", "Portales:");
  for (const portal of portals) {
    const [x, y, z] = portal.position;
    lines.push(
      `  ${portal.id} kind=${portal.kind} w=${portal.width.toFixed(2)} pos=(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})${portal.doorId ? ` door=${portal.doorId}` : ""}`,
    );
  }
  return lines.join("\n");
}

/** Listado crudo de celdas dentro del radio XZ, con sus edges. Para depurar conectividad local. */
function exportCellsNear(navSpace: NavSpace, x: number, z: number, radius: number): string {
  const cells = navSpace.getCells();
  const edges = navSpace.getEdges();
  const lines: string[] = [];
  for (const cell of cells) {
    const dx = cell.center[0] - x;
    const dz = cell.center[2] - z;
    if (dx * dx + dz * dz > radius * radius) continue;
    const targets: string[] = [];
    for (let i = cell.edgeStart; i < cell.edgeStart + cell.edgeCount; i += 1) {
      const to = cells[edges[i].toCell];
      targets.push(`${edges[i].toCell}(${to.center[0].toFixed(1)},${to.center[1].toFixed(1)},${to.center[2].toFixed(1)})`);
    }
    lines.push(
      `#${cell.index} (${cell.center[0].toFixed(2)}, ${cell.center[1].toFixed(2)}, ${cell.center[2].toFixed(2)}) ` +
        `${cell.surface} room=${cell.roomId ?? "-"} comp=${cell.componentId} → [${targets.join(", ")}]`,
    );
  }
  return lines.length > 0 ? lines.join("\n") : "(sin celdas en el radio)";
}

function exportTryPath(
  navSpace: NavSpace,
  fx: number,
  fy: number,
  fz: number,
  tx: number,
  ty: number,
  tz: number,
): string {
  const start = navSpace.cellAtRaw(fx, fy, fz);
  const goal = navSpace.cellAtRaw(tx, ty, tz);
  const fmt = (c: typeof start) =>
    c
      ? `#${c.index} (${c.center[0].toFixed(1)}, ${c.center[1].toFixed(1)}, ${c.center[2].toFixed(1)}) comp=${c.componentId}`
      : "null";
  if (!start || !goal) return `start=${fmt(start)} goal=${fmt(goal)} → sin celdas`;
  const path = navSpace.findPath(new Vector3(fx, fy, fz), new Vector3(tx, ty, tz));
  return (
    `start=${fmt(start)} goal=${fmt(goal)} → ` +
    (path ? `path de ${path.cells.length} celdas, ${path.length.toFixed(1)} m` : "PATH NULL")
  );
}

function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
