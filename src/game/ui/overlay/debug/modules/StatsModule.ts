import type { DebugFrame, DebugModule } from "../DebugModule";

/**
 * Pestania default: FPS, posicion del player, contadores del renderer,
 * estado de cada NPC. Costo despreciable.
 */
export class StatsModule implements DebugModule {
  readonly id = "stats";
  readonly label = "Stats";
  private active = false;
  private statsEl: HTMLPreElement | null = null;

  mount(container: HTMLElement): void {
    this.statsEl = document.createElement("pre");
    this.statsEl.className = "debug-stats";
    container.appendChild(this.statsEl);
  }

  update(frame: DebugFrame): void {
    if (!this.statsEl) return;
    const lines: string[] = [
      `FPS: ${frame.fps.toFixed(0)}`,
    ];
    if (frame.playerPosition) {
      const p = frame.playerPosition;
      lines.push(`Player: ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`);
    }
    lines.push(`Physics bodies: ${frame.physicsBodies}`);
    const r = frame.rendererInfo;
    lines.push(
      `Draw calls: ${r.render.calls}  tri: ${r.render.triangles.toLocaleString()}`,
      `Geos: ${r.memory.geometries}  tex: ${r.memory.textures}  prog: ${r.programs?.length ?? 0}`,
    );
    const npcSummary = frame.npcs.map((n) => `${n.id}:${n.getState()}`);
    lines.push(`NPCs: ${npcSummary.join(", ") || "ninguno"}`);
    this.statsEl.textContent = lines.join("\n");
  }

  setActive(active: boolean): void {
    this.active = active;
    if (this.statsEl) {
      this.statsEl.style.display = active ? "block" : "none";
    }
  }

  isActive(): boolean {
    return this.active;
  }

  dispose(): void {
    this.statsEl?.remove();
    this.statsEl = null;
  }
}
