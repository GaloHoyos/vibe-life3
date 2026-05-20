import type { Vector3 } from "three";
import type { Disposable } from "@shared/types/lifecycle";
import type { GameEventBus } from "@game/GameEvents";
import { WeaponTunerPanel } from "./WeaponTunerPanel";

export interface DebugSnapshot {
  fps: number;
  playerPosition: Vector3;
  physicsBodies: number;
  npcStates: string[];
}

/**
 * Overlay de debug toggleado con F3 (`toggleDebug`).
 *
 * Tiene dos secciones:
 *  - Stats arriba a la izquierda (FPS, posiciÃ³n, body count, NPC states).
 *  - `WeaponTunerPanel` arriba a la derecha con sliders en vivo para
 *    `pickupScale` y los `viewModel*` de cada arma.
 */
export class DebugOverlay implements Disposable {
  readonly element: HTMLDivElement;
  private readonly stats: HTMLDivElement;
  private readonly weaponTuner: WeaponTunerPanel;

  private enabled = false;

  constructor(
    container: HTMLElement,
    private readonly eventBus: GameEventBus,
  ) {
    this.element = document.createElement("div");
    this.element.className = "debug-overlay-root is-hidden";

    this.stats = document.createElement("div");
    this.stats.className = "debug-overlay";
    this.element.appendChild(this.stats);

    this.weaponTuner = new WeaponTunerPanel();
    this.element.appendChild(this.weaponTuner.element);
    this.weaponTuner.setVisible(true);

    container.append(this.element);
  }

  toggle(): void {
    this.setEnabledInternal(!this.enabled);
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      return;
    }
    this.setEnabledInternal(enabled);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  update(snapshot: DebugSnapshot): void {
    if (!this.enabled) {
      return;
    }

    const p = snapshot.playerPosition;
    this.stats.textContent = [
      `FPS: ${snapshot.fps.toFixed(0)}`,
      `Player: ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`,
      `Physics bodies: ${snapshot.physicsBodies}`,
      `NPCs: ${snapshot.npcStates.join(", ") || "none"}`,
    ].join("\n");
  }

  dispose(): void {
    this.weaponTuner.dispose();
    this.element.remove();
  }

  private setEnabledInternal(enabled: boolean): void {
    this.enabled = enabled;
    this.element.classList.toggle("is-hidden", !enabled);
    this.eventBus.emit("debug.toggle", { enabled });
  }
}
