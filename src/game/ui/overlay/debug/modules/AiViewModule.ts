import type { Scene } from "three";
import { NpcAiDebugOverlay } from "@game/debug/NpcAiDebugOverlay";
import type { Raycast } from "@engine/physics/Raycast";
import type { DebugFrame, DebugModule } from "../DebugModule";
import { buildSection, buildSelect } from "../widgets";

const NAVIGATION_PROFILES = new Map([
  ["Humanoide ágil (Combine)", "humanoid"],
  ["Humanoide limitado (zombie)", "humanoid-limited"],
  ["Headcrab", "headcrab"],
  ["Strider", "strider"],
]);

/**
 * Wrapper del `NpcAiDebugOverlay` (NavSpace + grafo de paths/threats por
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
  private readonly abort = new AbortController();

  constructor(scene: Scene, raycast: Raycast) {
    this.overlay = new NpcAiDebugOverlay(scene, raycast);
  }

  mount(container: HTMLElement): void {
    const section = buildSection("Visualizacion IA", "#84e9ff");
    const desc = document.createElement("p");
    desc.className = "debug-help";
    desc.textContent =
      "La superficie celeste marca el navmesh transitable para NPCs humanoides; los huecos quedan fuera de navegación. También dibuja conexiones especiales, rutas, objetivos y amenazas. Costoso: usar para diagnosticar movimiento.";
    section.appendChild(desc);

    const profileRow = document.createElement("div");
    profileRow.className = "debug-row";
    const profileLabel = document.createElement("span");
    profileLabel.textContent = "Perfil de navegación";
    profileRow.appendChild(profileLabel);
    profileRow.appendChild(buildSelect(
      [...NAVIGATION_PROFILES.keys()],
      (label) => this.overlay.setNavigationProfile(
        NAVIGATION_PROFILES.get(label) ?? "humanoid",
      ),
      this.abort.signal,
    ));
    section.appendChild(profileRow);

    this.status = document.createElement("div");
    this.status.className = "debug-status";
    this.status.textContent = "Estado: off";
    section.appendChild(this.status);

    container.appendChild(section);
  }

  update(frame: DebugFrame): void {
    this.overlay.update(frame.delta, {
      playerPosition: frame.playerPosition ?? undefined,
      navigation: frame.navigation,
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
    this.abort.abort();
    this.overlay.dispose();
  }
}
