import type { Vector3 } from "three";
import type { GameEventBus } from "@game/GameEvents";
import type { INpc, NpcAiDebugSnapshot } from "@game/npc/core/INpc";
import type { Disposable } from "@shared/types/lifecycle";

type AnomalyKind = "stuck" | "path-empty" | "waypoint-loop" | "death";
type TraceKind =
  | "transition"
  | "anomaly"
  | "signal"
  | "verbose"
  | "event"
  | "bookmark";

interface TraceEntry {
  /** Elapsed-time relativo al `start()`. */
  t: number;
  npcId: string;
  kind: TraceKind;
  text: string;
}

interface PerNpcState {
  lastState: string | null;
  moveAnchorPosition: { x: number; y: number; z: number } | null;
  lastMoveAt: number;
  lastWaypointIndex: number;
  lastWaypointSignature: string | null;
  lastWaypointDistance: number | null;
  lastWaypointAdvanceAt: number;
  pathEmptySince: number | null;
  activeAnomalies: Set<AnomalyKind>;
  wasAlive: boolean;
  lastThreatId: string | null;
  lastWantsMove: boolean | null;
  lastCoverId: string | null;
  lastCoverPhase: string | null;
  lastPathStatus: string | null;
  lastVisibleNow: boolean | null;
  lastHasMemory: boolean | null;
  lastRole: string | null;
  lastReloading: boolean | null;
  lastFiringBurst: boolean | null;
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
      eventBus.on("npc.alert", ({ id }) => {
        if (!this.recording) return;
        this.pushEntry(this.lastElapsed - this.startElapsed, id, "event", "alert emitted");
      }),
      eventBus.on("npc.attack", ({ id }) => {
        if (!this.recording) return;
        this.pushEntry(this.lastElapsed - this.startElapsed, id, "event", "attack emitted");
      }),
      eventBus.on("npc.threat.spotted", ({ spotterId, threatId }) => {
        if (!this.recording) return;
        this.pushEntry(
          this.lastElapsed - this.startElapsed,
          spotterId,
          "event",
          `spotted ${threatId}`,
        );
      }),
      eventBus.on("world.noise", ({ kind, sourceId, radius, position }) => {
        if (!this.recording) return;
        const owner = sourceId ?? "world";
        this.pushEntry(
          this.lastElapsed - this.startElapsed,
          owner,
          "event",
          `noise ${kind} radius=${radius.toFixed(1)} pos=${formatVec(position)}`,
        );
      }),
      eventBus.on("weapon.fired", ({ weaponName, weaponType, sourceId, sourceKind }) => {
        if (!this.recording) return;
        const owner = sourceId ?? "player";
        this.pushEntry(
          this.lastElapsed - this.startElapsed,
          owner,
          "event",
          `fired ${weaponName} (${weaponType}) source=${sourceKind ?? "unknown"}`,
        );
      }),
      eventBus.on("weapon.alternate.fired", ({ weaponName, sourceId, sourceKind }) => {
        if (!this.recording) return;
        const owner = sourceId ?? "player";
        this.pushEntry(
          this.lastElapsed - this.startElapsed,
          owner,
          "event",
          `alt fired ${weaponName} source=${sourceKind ?? "unknown"}`,
        );
      }),
      eventBus.on("weapon.hit", ({ weaponName, targetId, surfaceKind, damage, sourceId }) => {
        if (!this.recording) return;
        const id = targetId ?? "—";
        const owner = sourceId ?? "unknown";
        this.pushEntry(
          this.lastElapsed - this.startElapsed,
          id,
          "event",
          `hit ${weaponName} by=${owner} → ${surfaceKind ?? "?"} dmg=${damage.toFixed(1)}`,
        );
      }),
      eventBus.on("npc.damaged", ({ id, amount, health }) => {
        if (!this.recording) return;
        this.pushEntry(
          this.lastElapsed - this.startElapsed,
          id,
          "event",
          `daño ${amount.toFixed(1)} (hp restante=${health.toFixed(1)})`,
        );
      }),
      eventBus.on("player.damaged", ({ amount, direction }) => {
        if (!this.recording) return;
        const dirText = direction
          ? ` dir=(${direction.x.toFixed(1)},${direction.y.toFixed(1)},${direction.z.toFixed(1)})`
          : "";
        this.pushEntry(
          this.lastElapsed - this.startElapsed,
          "player",
          "event",
          `player recibió ${amount.toFixed(1)}${dirText}`,
        );
      }),
    );
  }

  /**
   * Marca un punto del trace. Útil para correlacionar "vi algo raro aquí"
   * con lo que el log muestra después. Llamado típicamente desde una
   * hotkey/botón del DebugMenu.
   */
  bookmark(label?: string): void {
    if (!this.recording) return;
    const text = label?.trim() ? label : "marca";
    this.pushEntry(this.lastElapsed - this.startElapsed, "—", "bookmark", text);
  }

  /** Lista de NPCs vistos en este trace (para popular UI in-game). */
  observedNpcIds(): string[] {
    return [...this.states.keys()].sort();
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
      this.detectSignals(t, snap, state);
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
    const signals = this.entries.filter((e) => e.kind === "signal");
    const verbose = this.entries.filter((e) => e.kind === "verbose");
    const events = this.entries.filter((e) => e.kind === "event");
    const bookmarks = this.entries.filter((e) => e.kind === "bookmark");
    const timeline = [...this.entries].sort((a, b) => a.t - b.t);
    const npcsObserved = new Set(this.states.keys());

    lines.push("==== NPC AI Trace ====");
    lines.push(`Generated:   ${new Date().toISOString()}`);
    if (this.firstStartIso) lines.push(`Recording started: ${this.firstStartIso}`);
    lines.push(`Duration:    ${(this.lastElapsed - this.startElapsed).toFixed(2)}s`);
    lines.push(`NPCs seen:   ${npcsObserved.size}`);
    lines.push(`Transitions: ${transitions.length}`);
    lines.push(`Anomalies:   ${anomalies.length}`);
    lines.push(`Signals:     ${signals.length}`);
    lines.push(`Combat ev.:  ${events.length}`);
    lines.push(`Bookmarks:   ${bookmarks.length}`);
    lines.push(`Verbose:     ${[...this.verboseSet].join(", ") || "(none)"}`);
    lines.push("");

    if (timeline.length > 0) {
      lines.push("---- Timeline ----");
      for (const e of timeline) lines.push(formatTimelineLine(e));
      lines.push("");
    }

    if (bookmarks.length > 0) {
      lines.push("---- Bookmarks ----");
      for (const e of bookmarks) lines.push(formatLine(e));
      lines.push("");
    }

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

    if (signals.length > 0) {
      lines.push("---- Signals ----");
      for (const e of signals) lines.push(formatLine(e));
      lines.push("");
    }

    if (events.length > 0) {
      lines.push("---- Combat events ----");
      for (const e of events) lines.push(formatLine(e));
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
        moveAnchorPosition: null,
        lastMoveAt: this.lastElapsed,
        lastWaypointIndex: snap.path.waypointIndex,
        lastWaypointSignature: waypointSignatureOf(snap),
        lastWaypointDistance: distanceToNextWaypoint(snap),
        lastWaypointAdvanceAt: this.lastElapsed,
        pathEmptySince: null,
        activeAnomalies: new Set(),
        wasAlive: snap.isAlive,
        lastThreatId: null,
        lastWantsMove: null,
        lastCoverId: null,
        lastCoverPhase: null,
        lastPathStatus: null,
        lastVisibleNow: null,
        lastHasMemory: null,
        lastRole: null,
        lastReloading: null,
        lastFiringBurst: null,
      };
      this.states.set(snap.id, state);
    }
    return state;
  }

  private detectTransitions(t: number, snap: NpcAiDebugSnapshot, state: PerNpcState): void {
    const stateKey = stateKeyOf(snap);
    if (state.lastState === null) {
      this.pushEntry(t, snap.id, "signal", `observed ${formatSnapshotSummary(snap)}`);
    } else if (state.lastState !== stateKey) {
      const reason = snap.lastTransitionReason
        ? ` · ${snap.lastTransitionReason}`
        : "";
      this.pushEntry(
        t,
        snap.id,
        "transition",
        `${state.lastState} → ${stateKey}` +
          (snap.threatId ? ` (threat=${snap.threatId})` : "") +
          reason,
      );
    }
    state.lastState = stateKey;

    if (state.wasAlive && !snap.isAlive) {
      this.pushEntry(t, snap.id, "transition", `murió en ${formatVec(snap.position)}`);
    }
    state.wasAlive = snap.isAlive;
  }

  /** Últimas N entradas para mostrar como preview en vivo en el panel. */
  recentEntries(limit: number): readonly TraceEntry[] {
    if (this.entries.length <= limit) return this.entries;
    return this.entries.slice(this.entries.length - limit);
  }

  /** Total de entries acumuladas (todas las kinds). */
  entryCount(): number {
    return this.entries.length;
  }

  private detectSignals(t: number, snap: NpcAiDebugSnapshot, state: PerNpcState): void {
    if (state.lastThreatId !== null && state.lastThreatId !== snap.threatId) {
      const text = snap.threatId
        ? `threat switch ${state.lastThreatId} → ${snap.threatId} dist=${formatDistanceTo(snap.position, snap.threatPosition)}`
        : `threat lost ${state.lastThreatId}`;
      this.pushEntry(t, snap.id, "signal", text);
    } else if (state.lastThreatId === null && snap.threatId !== null) {
      this.pushEntry(
        t,
        snap.id,
        "signal",
        `threat acquired ${snap.threatId} dist=${formatDistanceTo(snap.position, snap.threatPosition)}`,
      );
    }
    state.lastThreatId = snap.threatId;

    if (state.lastWantsMove !== null && state.lastWantsMove !== snap.wantsMove) {
      this.pushEntry(
        t,
        snap.id,
        "signal",
        `wantsMove=${snap.wantsMove} target=${snap.target ? formatVec(snap.target) : "—"}`,
      );
    }
    state.lastWantsMove = snap.wantsMove;

    if (state.lastCoverId !== snap.coverId) {
      if (state.lastCoverId !== null || snap.coverId !== null) {
        this.pushEntry(
          t,
          snap.id,
          "signal",
          `cover ${state.lastCoverId ?? "—"} → ${snap.coverId ?? "—"}`,
        );
      }
      state.lastCoverId = snap.coverId;
    }

    const coverPhase = snap.tactical?.coverPhase ?? null;
    if (state.lastCoverPhase !== coverPhase) {
      if (state.lastCoverPhase !== null || coverPhase !== null) {
        this.pushEntry(
          t,
          snap.id,
          "signal",
          `coverPhase ${state.lastCoverPhase ?? "—"} → ${coverPhase ?? "—"}`,
        );
      }
      state.lastCoverPhase = coverPhase;
    }

    const pathStatus = snap.path.lastStatus;
    if (state.lastPathStatus !== pathStatus) {
      if (state.lastPathStatus !== null || pathStatus !== "never") {
        this.pushEntry(
          t,
          snap.id,
          "signal",
          `pathStatus ${state.lastPathStatus ?? "—"} → ${pathStatus} ${formatPathDebug(snap)}`,
        );
      }
      state.lastPathStatus = pathStatus;
    }

    const visibleNow = snap.perception?.visibleNow ?? null;
    if (state.lastVisibleNow !== visibleNow) {
      if (state.lastVisibleNow !== null || visibleNow !== null) {
        this.pushEntry(
          t,
          snap.id,
          "signal",
          `los=${visibleNow ?? "—"} mem=${formatMemory(snap)}`,
        );
      }
      state.lastVisibleNow = visibleNow;
    }

    const hasMemory = snap.perception?.hasMemory ?? null;
    if (state.lastHasMemory !== hasMemory) {
      if (state.lastHasMemory !== null || hasMemory !== null) {
        this.pushEntry(
          t,
          snap.id,
          "signal",
          `memory=${hasMemory ?? "—"} ${formatMemory(snap)}`,
        );
      }
      state.lastHasMemory = hasMemory;
    }

    const role = snap.tactical?.role ?? null;
    if (state.lastRole !== role) {
      if (state.lastRole !== null || role !== null) {
        this.pushEntry(t, snap.id, "signal", `role ${state.lastRole ?? "—"} → ${role ?? "—"}`);
      }
      state.lastRole = role;
    }

    const isReloading = snap.combat?.isReloading ?? null;
    if (state.lastReloading !== isReloading) {
      if (state.lastReloading !== null || isReloading !== null) {
        this.pushEntry(
          t,
          snap.id,
          "signal",
          `reload=${isReloading ?? "—"} ${formatCombat(snap)}`,
        );
      }
      state.lastReloading = isReloading;
    }

    const isFiringBurst = snap.combat?.isFiringBurst ?? null;
    if (state.lastFiringBurst !== isFiringBurst) {
      if (state.lastFiringBurst !== null || isFiringBurst !== null) {
        this.pushEntry(
          t,
          snap.id,
          "signal",
          `burst=${isFiringBurst ?? "—"} ${formatCombat(snap)}`,
        );
      }
      state.lastFiringBurst = isFiringBurst;
    }
  }

  private detectAnomalies(t: number, snap: NpcAiDebugSnapshot, state: PerNpcState): void {
    if (!snap.isAlive) {
      state.activeAnomalies.clear();
      return;
    }

    const elapsed = this.lastElapsed;

    if (state.moveAnchorPosition === null || !snap.wantsMove) {
      state.moveAnchorPosition = {
        x: snap.position.x,
        y: snap.position.y,
        z: snap.position.z,
      };
      state.lastMoveAt = elapsed;
      this.clearAnomaly(state, "stuck");
    } else {
      const dx = snap.position.x - state.moveAnchorPosition.x;
      const dz = snap.position.z - state.moveAnchorPosition.z;
      const moved = Math.hypot(dx, dz);
      if (moved > this.config.stuckDistance) {
        state.moveAnchorPosition = {
          x: snap.position.x,
          y: snap.position.y,
          z: snap.position.z,
        };
        state.lastMoveAt = elapsed;
        this.clearAnomaly(state, "stuck");
      }
    }

    if (snap.wantsMove && !isUnreachablePathStatus(snap.path.lastStatus)) {
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
            `${formatLocomotion(snap)} · ` +
            `${formatNavigation(snap)} · ` +
            (next
              ? `próximo waypoint a ${dist.toFixed(2)}m`
              : "sin waypoint próximo") +
            ` · ${formatPathDebug(snap)}` +
            (snap.threatId ? ` · threat=${snap.threatId}` : ""),
        );
        state.activeAnomalies.add("stuck");
      }
    } else if (!snap.wantsMove) {
      state.lastMoveAt = elapsed;
      this.clearAnomaly(state, "stuck");
    }

    const hasThreat = snap.threatId !== null;
    const pathEmpty = snap.path.path.length === 0;
    if (
      hasThreat &&
      pathEmpty &&
      (snap.wantsMove || isUnreachablePathStatus(snap.path.lastStatus))
    ) {
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
          `path vacío ${dt.toFixed(1)}s con threat (${snap.threatId} a ${dist.toFixed(1)}m) · ${formatPathDebug(snap)}`,
        );
        state.activeAnomalies.add("path-empty");
      }
    } else {
      state.pathEmptySince = null;
      this.clearAnomaly(state, "path-empty");
    }

    const waypointSignature = waypointSignatureOf(snap);
    const waypointDistance = distanceToNextWaypoint(snap);
    const progressedTowardWaypoint =
      waypointDistance !== null &&
      state.lastWaypointDistance !== null &&
      waypointDistance < state.lastWaypointDistance - 0.35;

    if (
      snap.path.waypointIndex !== state.lastWaypointIndex ||
      waypointSignature !== state.lastWaypointSignature ||
      progressedTowardWaypoint
    ) {
      state.lastWaypointIndex = snap.path.waypointIndex;
      state.lastWaypointSignature = waypointSignature;
      state.lastWaypointDistance = waypointDistance;
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
          `idx=${snap.path.waypointIndex}/${snap.path.path.length - 1} · ` +
          `${formatLocomotion(snap)} · ${formatNavigation(snap)} · ` +
          `${formatPathDebug(snap)} · estado=${snap.state}`,
      );
      state.activeAnomalies.add("waypoint-loop");
    } else if (waypointDistance !== null) {
      state.lastWaypointDistance =
        state.lastWaypointDistance === null
          ? waypointDistance
          : Math.min(state.lastWaypointDistance, waypointDistance);
    }
  }

  private dumpVerboseIfDue(t: number, snap: NpcAiDebugSnapshot): void {
    const last = this.verboseLastDump.get(snap.id) ?? -Infinity;
    if (this.lastElapsed - last < this.config.verboseInterval) return;
    this.verboseLastDump.set(snap.id, this.lastElapsed);
    this.pushEntry(
      t,
      snap.id,
      "verbose",
      formatSnapshotSummary(snap),
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

function formatTimelineLine(entry: TraceEntry): string {
  return `${formatTimestamp(entry.t)} [${entry.kind}] ${entry.npcId}: ${entry.text}`;
}

function formatVec(v: Vector3 | { x: number; y: number; z: number }): string {
  return `(${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)})`;
}

function stateKeyOf(snap: NpcAiDebugSnapshot): string {
  return snap.stateKey ?? snap.state;
}

function waypointSignatureOf(snap: NpcAiDebugSnapshot): string {
  const next = snap.path.nextWaypoint;
  const requested = snap.path.requestedDestination;
  return [
    snap.path.lastStatus,
    snap.path.path.length,
    snap.path.startNodeId ?? "-",
    snap.path.goalNodeId ?? "-",
    snap.path.startComponentId ?? "-",
    snap.path.goalComponentId ?? "-",
    next ? quantizedVec(next, 0.5) : "-",
    requested ? quantizedVec(requested, 1) : "-",
  ].join("|");
}

function distanceToNextWaypoint(snap: NpcAiDebugSnapshot): number | null {
  const next = snap.path.nextWaypoint;
  if (!next) return null;
  return Math.hypot(next.x - snap.position.x, next.z - snap.position.z);
}

function quantizedVec(
  v: Vector3 | { x: number; y: number; z: number },
  gridSize: number,
): string {
  const q = (value: number) => Math.round(value / gridSize) * gridSize;
  return `${q(v.x).toFixed(1)},${q(v.y).toFixed(1)},${q(v.z).toFixed(1)}`;
}

function formatSnapshotSummary(snap: NpcAiDebugSnapshot): string {
  const parts = [
    `state=${snap.state}`,
    `hp=${snap.health.toFixed(1)}/${snap.maxHealth.toFixed(1)}`,
    `pos=${formatVec(snap.position)}`,
    `wantsMove=${snap.wantsMove}`,
    `target=${snap.target ? formatVec(snap.target) : "—"}`,
    `threat=${snap.threatId ?? "—"}`,
    `cover=${snap.coverId ?? "—"}`,
    formatPathDebug(snap),
    formatLocomotion(snap),
    formatNavigation(snap),
    formatMemory(snap),
    formatCombat(snap),
    formatTactical(snap),
  ];
  return parts.filter((p) => p.length > 0).join(" ");
}

function formatPathDebug(snap: NpcAiDebugSnapshot): string {
  const next = snap.path.nextWaypoint;
  const pathTarget = snap.path.pathTarget;
  const requested = snap.path.requestedDestination;
  const lastIndex = Math.max(snap.path.path.length - 1, 0);
  const nodes =
    snap.path.startNodeId !== null || snap.path.goalNodeId !== null
      ? ` nodes=${snap.path.startNodeId ?? "—"}→${snap.path.goalNodeId ?? "—"}`
      : "";
  const components =
    snap.path.startComponentId !== null || snap.path.goalComponentId !== null
      ? ` comps=${snap.path.startComponentId ?? "—"}→${snap.path.goalComponentId ?? "—"}`
      : "";
  const nodePositions = isUnreachablePathStatus(snap.path.lastStatus)
    ? ` nodePos=${snap.path.startNodePosition ? formatVec(snap.path.startNodePosition) : "—"}→${snap.path.goalNodePosition ? formatVec(snap.path.goalNodePosition) : "—"}`
    : "";
  const reason = snap.path.lastRepathReason
    ? ` repath=${snap.path.lastRepathReason}`
    : "";
  const targetDistance =
    snap.path.distanceToRequested !== null
      ? ` dist=${formatFinite(snap.path.distanceToRequested, 1)}` +
        ` h=${formatFinite(snap.path.horizontalDistanceToRequested ?? Infinity, 1)}` +
        ` dy=${formatFinite(snap.path.verticalDeltaToRequested ?? Infinity, 1)}`
      : "";
  return (
    `path=${snap.path.waypointIndex}/${lastIndex} status=${snap.path.lastStatus}` +
    ` use=${snap.path.pathUseReason}${snap.path.pathUsed ? "*" : ""}` +
    reason +
    nodes +
    components +
    nodePositions +
    ` next=${next ? formatVec(next) : "—"}` +
    ` pathTarget=${pathTarget ? formatVec(pathTarget) : "—"}` +
    targetDistance +
    ` req=${requested ? formatVec(requested) : "—"}`
  );
}

function formatLocomotion(snap: NpcAiDebugSnapshot): string {
  const locomotion = snap.locomotion;
  if (!locomotion) return "";
  return (
    `speed=${locomotion.speed.toFixed(2)}` +
    ` desired=${locomotion.desiredSpeed.toFixed(2)}` +
    ` grounded=${locomotion.grounded ? "1" : "0"}` +
    ` distTarget=${formatFinite(locomotion.distanceToTarget, 1)}`
  );
}

function formatNavigation(snap: NpcAiDebugSnapshot): string {
  const navigation = snap.navigation;
  if (!navigation) return "";
  return `motorTarget=${navigation.motorTarget ? formatVec(navigation.motorTarget) : "—"}`;
}

function formatMemory(snap: NpcAiDebugSnapshot): string {
  const perception = snap.perception;
  if (!perception) return "";
  return (
    `los=${perception.visibleNow ? "1" : "0"}` +
    ` mem=${perception.hasMemory ? "1" : "0"}` +
    ` memAge=${formatFinite(perception.memoryAge, 1)}` +
    ` lkp=${perception.lastKnownPosition ? formatVec(perception.lastKnownPosition) : "—"}` +
    (perception.timeSinceLastSeen !== undefined
      ? ` unseen=${formatFinite(perception.timeSinceLastSeen, 1)}`
      : "") +
    (perception.candidateId !== undefined
      ? ` cand=${perception.candidateId ?? "—"}`
      : "") +
    (perception.candidateDistance !== undefined
      ? ` candDist=${formatFinite(perception.candidateDistance, 1)}`
      : "") +
    (perception.detectionRange !== undefined
      ? ` detect=${formatFinite(perception.detectionRange, 1)}`
      : "")
  );
}

function formatCombat(snap: NpcAiDebugSnapshot): string {
  const combat = snap.combat;
  if (!combat) return "";
  const parts: string[] = [];
  if (combat.magazine !== undefined) {
    parts.push(`mag=${combat.magazine}`);
  }
  if (combat.reserve !== undefined) {
    parts.push(`reserve=${combat.reserve}`);
  }
  if (combat.isReloading !== undefined) {
    parts.push(`reload=${combat.isReloading ? "1" : "0"}`);
  }
  if (combat.reloadRemaining !== undefined) {
    parts.push(`reloadIn=${formatFinite(combat.reloadRemaining, 1)}`);
  }
  if (combat.isFiringBurst !== undefined) {
    parts.push(`burst=${combat.isFiringBurst ? "1" : "0"}`);
  }
  if (combat.burstShotsLeft !== undefined) {
    parts.push(`burstLeft=${combat.burstShotsLeft}`);
  }
  if (combat.canStartBurst !== undefined) {
    parts.push(`canBurst=${combat.canStartBurst ? "1" : "0"}`);
  }
  if (combat.cooldownRemaining !== undefined) {
    parts.push(`cd=${formatFinite(combat.cooldownRemaining, 1)}`);
  }
  if (combat.aimSettleProgress !== undefined) {
    parts.push(`aim=${formatFinite(combat.aimSettleProgress, 2)}`);
  }
  if (combat.aimRequired !== undefined) {
    parts.push(`aimReq=${formatFinite(combat.aimRequired, 2)}`);
  }
  if (combat.meleeReady !== undefined) {
    parts.push(`meleeReady=${combat.meleeReady ? "1" : "0"}`);
  }
  if (combat.meleeAttacking !== undefined) {
    parts.push(`meleeAttack=${combat.meleeAttacking ? "1" : "0"}`);
  }
  return parts.join(" ");
}

function formatTactical(snap: NpcAiDebugSnapshot): string {
  const tactical = snap.tactical;
  if (!tactical) return "";
  const parts: string[] = [];
  if (tactical.role) parts.push(`role=${tactical.role}`);
  if (tactical.flankSide !== undefined) parts.push(`flank=${tactical.flankSide}`);
  if (tactical.suppressionLevel !== undefined) {
    parts.push(`supr=${formatFinite(tactical.suppressionLevel, 2)}`);
  }
  if (tactical.lastDamageAgo !== undefined) {
    parts.push(`lastDmgAgo=${formatFinite(tactical.lastDamageAgo, 1)}`);
  }
  if (tactical.coverPhase) parts.push(`coverPhase=${tactical.coverPhase}`);
  if (tactical.coverPhaseRemaining !== undefined) {
    parts.push(`coverPhaseIn=${formatFinite(tactical.coverPhaseRemaining, 1)}`);
  }
  if (tactical.coverSearchCooldownRemaining !== undefined) {
    parts.push(`coverCd=${formatFinite(tactical.coverSearchCooldownRemaining, 1)}`);
  }
  return parts.join(" ");
}

function formatDistanceTo(
  from: Vector3 | { x: number; y: number; z: number },
  to: Vector3 | { x: number; y: number; z: number } | null,
): string {
  if (!to) return "—";
  return Math.hypot(to.x - from.x, to.z - from.z).toFixed(1);
}

function formatFinite(value: number, digits: number): string {
  if (!Number.isFinite(value)) return "∞";
  return value.toFixed(digits);
}

function isUnreachablePathStatus(status: string): boolean {
  return status === "empty-goal-missing" || status === "empty-no-route";
}
