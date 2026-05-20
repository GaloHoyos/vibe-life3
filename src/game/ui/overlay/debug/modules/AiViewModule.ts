import type { Scene } from "three";
import { NpcAiDebugOverlay } from "@game/debug/NpcAiDebugOverlay";
import type { DebugFrame, DebugModule } from "../DebugModule";
import { buildSection } from "../widgets";

/**
 * Wrapper del `NpcAiDebugOverlay` (NavGraph + grafo de paths/threats por
 * NPC). Marcada como `heavy` -- arranca inactiva para no degradar FPS por
 * el simple hecho de abrir el menu. El usuario tiene que prenderla
 * explicitamente con el checkbox de la pestania.
 */
export class AiViewModule implements DebugModule {
  readonly id = "ai-view";
  readonly label = "IA visual";
  readonly heavy = true;
  private overlay: NpcAiDebugOverlay;
  private active = false;
  private status: HTMLDivElement | null = null;

  constructor(scene: Scene) {
    this.overlay = new NpcAiDebugOverlay(scene);
  }

  mount(container: HTMLElement): void {
    const section = buildSection("Visualizacion IA", "#84e9ff");
    const desc = document.createElement("p");
    desc.className = "debug-help";
    desc.textContent =
      "Dibuja el grafo de navegacion local, los waypoints de cada NPC, las lineas hacia el threat y los markers de cover en la escena. Costoso: solo encender para diagnosticar movimiento.";
    section.appendChild(desc);

    this.status = document.createElement("div");
    this.status.className = "debug-status";
    this.status.textContent = "Estado: off";
    section.appendChild(this.status);

    container.appendChild(section);
  }

  update(frame: DebugFrame): void {
    this.overlay.update(frame.delta, {
      playerPosition: frame.playerPosition ?? undefined,
      navGraph: frame.navGraph,
      npcs: frame.npcs,
    });
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.overlay.setEnabled(active);
    if (this.status) {
      this.status.textContent = `Estado: ${active ? "ON" : "off"}`;
      this.status.classList.toggle("is-on", active);
    }
  }

  isActive(): boolean {
    return this.active;
  }

  dispose(): void {
    this.overlay.dispose();
  }
}
