import type { Scene } from "three";
import { installSceneInspector } from "@game/debug/SceneInspector";
import type { DebugModule } from "../DebugModule";
import { buildButton, buildSection } from "../widgets";

/**
 * Botones one-shot para diagnostico de escena. `installSceneInspector` ya
 * deja `window.__inspectScene` disponible para la consola; aqui agregamos
 * un atajo grafico que abre la consola con un dump de los meshes mas
 * pesados.
 */
export class SceneModule implements DebugModule {
  readonly id = "scene";
  readonly label = "Escena";
  private active = false;
  private uninstallInspector: (() => void) | null = null;

  constructor(private readonly scene: Scene) {}

  mount(container: HTMLElement): void {
    this.uninstallInspector = installSceneInspector(this.scene);

    const section = buildSection("Inspector", "#c7ffd1");

    const desc = document.createElement("p");
    desc.className = "debug-help";
    desc.textContent =
      "Vuelca a la consola los meshes mas pesados (triangulos, vertices, jerarquia). Tambien disponible como window.__inspectScene(topN).";
    section.appendChild(desc);

    const row = document.createElement("div");
    row.className = "debug-row";
    row.appendChild(
      buildButton("Top 20", () => window.__inspectScene?.(20)),
    );
    row.appendChild(
      buildButton("Top 50", () => window.__inspectScene?.(50)),
    );
    section.appendChild(row);

    container.appendChild(section);
  }

  setActive(active: boolean): void {
    this.active = active;
  }

  isActive(): boolean {
    return this.active;
  }

  dispose(): void {
    this.uninstallInspector?.();
    this.uninstallInspector = null;
  }
}
