import type { Vector3 } from "three";
import type { Disposable } from "@shared/types/lifecycle";
import type { GameEventBus } from "@game/GameEvents";

export interface DebugSnapshot {
  fps: number;
  playerPosition: Vector3;
  physicsBodies: number;
  npcStates: string[];
}

export class DebugOverlay implements Disposable {
  readonly element: HTMLDivElement;

  private enabled = false;

  constructor(
    container: HTMLElement,
    private readonly eventBus: GameEventBus,
  ) {
    this.element = document.createElement("div");
    this.element.className = "debug-overlay is-hidden";
    container.append(this.element);
  }

  toggle(): void {
    this.enabled = !this.enabled;
    this.element.classList.toggle("is-hidden", !this.enabled);
    this.eventBus.emit("debug.toggle", { enabled: this.enabled });
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      return;
    }

    this.enabled = enabled;
    this.element.classList.toggle("is-hidden", !this.enabled);
    this.eventBus.emit("debug.toggle", { enabled: this.enabled });
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  update(snapshot: DebugSnapshot): void {
    if (!this.enabled) {
      return;
    }

    const p = snapshot.playerPosition;
    this.element.textContent = [
      `FPS: ${snapshot.fps.toFixed(0)}`,
      `Player: ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`,
      `Physics bodies: ${snapshot.physicsBodies}`,
      `NPCs: ${snapshot.npcStates.join(", ") || "none"}`,
    ].join("\n");
  }

  dispose(): void {
    this.element.remove();
  }
}
