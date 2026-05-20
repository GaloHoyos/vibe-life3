import type { Vector3 } from "three";
import type { GameEventBus } from "@game/GameEvents";
import type { INpc, NpcAiDebugSnapshot } from "@game/npc/core/INpc";
import type { Disposable } from "@shared/types/lifecycle";

type AnomalyKind = "stuck" | "path-empty" | "waypoint-loop" | "death";

interface TraceEntry {
  /** Elapsed-time relativo al `start()`. */
  t: number;
  npcId: string;
  kind: "transition" | "anomaly" | "verbose";
  text: string;
}

interface PerNpcState {
  lastState: string | null;
  lastPosition: { x: number; y: number; z: number } | null;
  lastMoveAt: number;
  lastWaypointIndex: number;
  lastWaypointAdvanceAt: number;
  pathEmptySince: number | null;
  activeAnomalies: Set<AnomalyKind>;
  wasAlive: boolean;
}

export interface TraceRecorderConfig {
  /** Intervalo entre snapshots verbose, en segundos. */
  verboseInterval: number;
  /** Si un NPC con wantsMove=true no se mueve > stuckDistance en stuckTime, anomalía. */
  stuckTime: number;
  stuckDistance: number;
  /** Si threat visible pero path vacío más de este tiempo, anomalía. */
  pathEmptyTime: number;
  /** Si el waypointIndex no avanza más de este tiempo (estando con path), anomalía. */
  waypointLoopTime: number;
  /** Máximo de entradas en buffer; evita memory blow-up en sesiones largas. */
  maxEntries: number;
}

const DEFAULT_CONFIG: TraceRecorderConfig = {
  verboseInterval: 0.25,
  stuckTime: 2.0,
  stuckDistance: 0.4,
  pathEmptyTime: 1.0,
  waypointLoopTime: 3.0,
  maxEntries: 20000,
};

/**
 * Captura el comportamiento de IA de los NPCs durante una sesión para
 * diagnosticar offline. No depende del DOM ni del bus de eventos para grabar
 * — solo del `getAiDebugSnapshot()` que cada NPC ya expone.
 *
 * Modos:
 *  - Por defecto loguea **transiciones** (cambios de state) y **anomalías**
 *    detectadas heurísticamente (stuck, path vacío con threat, waypoint loop,
 *    muerte). Compacto y legible.
 *  - `watch(npcId)` agrega el NPC al set verbose: cada `verboseInterval`
 *    segundos vuelca su snapshot completo. Útil cuando ya identificaste un
 *    sospechoso y querés ver la traza fina.
 *
 * Llamar `start()` para empezar a grabar, `stopAndExportFile()` para parar y
 * descargar el `.txt`. `exportText()` devuelve el log como string (útil para
 * pegarlo en una conversación).
 */
export class NpcAiTraceRecorder implements Disposable {
  private readonly config: TraceRecorderConfig;
  private readonly entries: TraceEntry[] = [];
  private readonly states = new Map<string, PerNpcState>();
  private readonly verboseSet = new Set<string>();
  private readonly verboseLastDump = new Map<string, number>();
  private recording = false;
  private startElapsed = 0;
  private lastElapsed = 0;
  private firstStartIso = "";
  private readonly unsubscribers: Array<() => void> = [];

  constructor(eventBus: GameEventBus, config: Partial<TraceRecorderConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.unsubscribers.push(
      eventBus.on("npc.killed", ({ id }) => {
        if (!this.recording) return;
        this.pushEntry(this.lastElapsed - this.startElapsed, id, "transition", "muerto");
      }),
    );
  }

  isRecording(): boolean {
    return this.recording;
  }

  watchedIds(): string[] {
    return [...this.verboseSet];
  }

  watch(npcId: string): void {
    this.verboseSet.add(npcId);
  }

  unwatch(npcId: string): void {
    this.verboseSet.delete(npcId);
    this.verboseLastDump.delete(npcId);
  }

  start(): void {
    this.recording = true;
    this.startElapsed = this.lastElapsed;
    this.entries.length = 0;
    this.states.clear();
    this.verboseLastDump.clear();
    this.firstStartIso = new Date().toISOString();
  }

  stop(): void {
    this.recording = false;
  }

  clear(): void {
    this.entries.length = 0;
    this.states.clear();
    this.verboseLastDump.clear();
  }

  update(elapsed: number, npcs: readonly INpc[]): void {
    this.lastElapsed = elapsed;
    if (!this.recording) return;

    const t = elapsed - this.startElapsed;
    for (const npc of npcs) {
      const snap = npc.getAiDebugSnapshot();
      const state = this.getOrCreateState(snap);
      this.detectTransitions(t, snap, state);
      this.detectAnomalies(t, snap, state);
      if (this.verboseSet.has(snap.id)) {
        this.dumpVerboseIfDue(t, snap);
      }
    }
  }

  exportText(): string {
    const lines: string[] = [];
    const transitions = this.entries.filter((e) => e.kind === "transition");
    const anomalies = this.entries.filter((e) => e.kind === "anomaly");
    const verbose = this.entries.filter((e) => e.kind === "verbose");
    const npcsObserved = new Set(this.entries.map((e) => e.npcId));

    lines.push("==== NPC AI Trace ====");
    lines.push(`Generated:   ${new Date().toISOString()}`);
    if (this.firstStartIso) lines.push(`Recording started: ${this.firstStartIso}`);
    lines.push(`Duration:    ${(this.lastElapsed - this.startElapsed).toFixed(2)}s`);
    lines.push(`NPCs seen:   ${npcsObserved.size}`);
    lines.push(`Transitions: ${transitions.length}`);
    lines.push(`Anomalies:   ${anomalies.length}`);
    lines.push(`Verbose:     ${[...this.verboseSet].join(", ") || "(none)"}`);
    lines.push("");

    if (anomalies.length > 0) {
      lines.push("---- Anomalies (likely problems) ----");
      for (const e of anomalies) lines.push(formatLine(e));
      lines.push("");
    }

    if (transitions.length > 0) {
      lines.push("---- State transitions ----");
      for (const e of transitions) lines.push(formatLine(e));
      lines.push("");
    }

    if (verbose.length > 0) {
      lines.push("---- Verbose snapshots ----");
      const byNpc = new Map<string, TraceEntry[]>();
      for (const e of verbose) {
        const arr = byNpc.get(e.npcId) ?? [];
        arr.push(e);
        byNpc.set(e.npcId, arr);
      }
      for (const [id, arr] of byNpc) {
        lines.push(`[${id}]`);
        for (const e of arr) lines.push(`  ${formatTimestamp(e.t)} ${e.text}`);
        lines.push("");
      }
    }

    if (this.entries.length === 0) {
      lines.push("(no events captured — start the recorder while the level is running)");
    }

    return lines.join("\n");
  }

  stopAndExportFile(): void {
    this.recording = false;
    const text = this.exportText();
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = url;
    a.download = `npc-ai-trace-${stamp}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  dispose(): void {
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers.length = 0;
    this.entries.length = 0;
    this.states.clear();
    this.verboseSet.clear();
    this.verboseLastDump.clear();
  }

  private getOrCreateState(snap: NpcAiDebugSnapshot): PerNpcState {
    let state = this.states.get(snap.id);
    if (!state) {
      state = {
        lastState: null,
        lastPosition: null,
        lastMoveAt: this.lastElapsed,
        lastWaypointIndex: snap.path.waypointIndex,
        lastWaypointAdvanceAt: this.lastElapsed,
        pathEmptySince: null,
        activeAnomalies: new Set(),
        wasAlive: snap.isAlive,
      };
      this.states.set(snap.id, state);
    }
    return state;
  }

  private detectTransitions(t: number, snap: NpcAiDebugSnapshot, state: PerNpcState): void {
    if (state.lastState !== null && state.lastState !== snap.state) {
      this.pushEntry(
        t,
        snap.id,
        "transition",
        `${state.lastState} → ${snap.state}` +
          (snap.threatId ? ` (threat=${snap.threatId})` : ""),
      );
    }
    state.lastState = snap.state;

    if (state.wasAlive && !snap.isAlive) {
      this.pushEntry(t, snap.id, "transition", `murió en ${formatVec(snap.position)}`);
    }
    state.wasAlive = snap.isAlive;
  }

  private detectAnomalies(t: number, snap: NpcAiDebugSnapshot, state: PerNpcState): void {
    if (!snap.isAlive) {
      state.activeAnomalies.clear();
      return;
    }

    const elapsed = this.lastElapsed;

    if (state.lastPosition !== null) {
      const dx = snap.position.x - state.lastPosition.x;
      const dz = snap.position.z - state.lastPosition.z;
      const moved = Math.hypot(dx, dz);
      if (moved > this.config.stuckDistance) {
        state.lastMoveAt = elapsed;
        this.clearAnomaly(state, "stuck");
      }
    }
    state.lastPosition = { x: snap.position.x, y: snap.position.y, z: snap.position.z };

    if (snap.wantsMove) {
      const idleTime = elapsed - state.lastMoveAt;
      if (
        idleTime > this.config.stuckTime &&
        !state.activeAnomalies.has("stuck")
      ) {
        const next = snap.path.nextWaypoint;
        const dist = next
          ? Math.hypot(next.x - snap.position.x, next.z - snap.position.z)
          : Number.NaN;
        this.pushEntry(
          t,
          snap.id,
          "anomaly",
          `stuck ${idleTime.toFixed(1)}s con wantsMove=true · estado=${snap.state} · ` +
            (next
              ? `próximo waypoint a ${dist.toFixed(2)}m`
              : "sin waypoint próximo") +
            (snap.threatId ? ` · threat=${snap.threatId}` : ""),
        );
        state.activeAnomalies.add("stuck");
      }
    } else {
      state.lastMoveAt = elapsed;
      this.clearAnomaly(state, "stuck");
    }

    const hasThreat = snap.threatId !== null;
    const pathEmpty = snap.path.path.length === 0;
    if (hasThreat && pathEmpty && snap.wantsMove) {
      if (state.pathEmptySince === null) state.pathEmptySince = elapsed;
      const dt = elapsed - state.pathEmptySince;
      if (dt > this.config.pathEmptyTime && !state.activeAnomalies.has("path-empty")) {
        const threatPos = snap.threatPosition;
        const dist = threatPos
          ? Math.hypot(threatPos.x - snap.position.x, threatPos.z - snap.position.z)
          : Number.NaN;
        this.pushEntry(
          t,
          snap.id,
          "anomaly",
          `path vacío ${dt.toFixed(1)}s con threat visible (${snap.threatId} a ${dist.toFixed(1)}m)`,
        );
        state.activeAnomalies.add("path-empty");
      }
    } else {
      state.pathEmptySince = null;
      this.clearAnomaly(state, "path-empty");
    }

    if (snap.path.waypointIndex !== state.lastWaypointIndex) {
      state.lastWaypointIndex = snap.path.waypointIndex;
      state.lastWaypointAdvanceAt = elapsed;
      this.clearAnomaly(state, "waypoint-loop");
    } else if (
      snap.path.path.length > 1 &&
      snap.wantsMove &&
      elapsed - state.lastWaypointAdvanceAt > this.config.waypointLoopTime &&
      !state.activeAnomalies.has("waypoint-loop")
    ) {
      this.pushEntry(
        t,
        snap.id,
        "anomaly",
        `no avanza waypoint ${(elapsed - state.lastWaypointAdvanceAt).toFixed(1)}s · ` +
          `idx=${snap.path.waypointIndex}/${snap.path.path.length - 1} · estado=${snap.state}`,
      );
      state.activeAnomalies.add("waypoint-loop");
    }
  }

  private dumpVerboseIfDue(t: number, snap: NpcAiDebugSnapshot): void {
    const last = this.verboseLastDump.get(snap.id) ?? -Infinity;
    if (this.lastElapsed - last < this.config.verboseInterval) return;
    this.verboseLastDump.set(snap.id, this.lastElapsed);
    const next = snap.path.nextWaypoint;
    const target = snap.target;
    this.pushEntry(
      t,
      snap.id,
      "verbose",
      `state=${snap.state} pos=${formatVec(snap.position)} wantsMove=${snap.wantsMove} ` +
        `path=${snap.path.waypointIndex}/${Math.max(snap.path.path.length - 1, 0)} ` +
        `next=${next ? formatVec(next) : "—"} ` +
        `target=${target ? formatVec(target) : "—"} ` +
        `threat=${snap.threatId ?? "—"} ` +
        `cover=${snap.coverId ?? "—"}`,
    );
  }

  private clearAnomaly(state: PerNpcState, kind: AnomalyKind): void {
    state.activeAnomalies.delete(kind);
  }

  private pushEntry(
    t: number,
    npcId: string,
    kind: TraceEntry["kind"],
    text: string,
  ): void {
    if (this.entries.length >= this.config.maxEntries) {
      this.entries.shift();
    }
    this.entries.push({ t, npcId, kind, text });
  }
}

function formatTimestamp(t: number): string {
  const min = Math.floor(t / 60);
  const sec = t - min * 60;
  return `${String(min).padStart(2, "0")}:${sec.toFixed(2).padStart(5, "0")}`;
}

function formatLine(entry: TraceEntry): string {
  return `${formatTimestamp(entry.t)} ${entry.npcId}: ${entry.text}`;
}

function formatVec(v: Vector3 | { x: number; y: number; z: number }): string {
  return `(${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)})`;
}
