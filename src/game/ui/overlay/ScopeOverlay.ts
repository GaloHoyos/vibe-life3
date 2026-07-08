import type { GameEventBus } from "@game/GameEvents";
import type { Disposable } from "@shared/types/lifecycle";

/**
 * Viñeteado de mira telescópica del crossbow. Se muestra mientras el arma
 * está scoped (`weapon.scope.changed`): oscurece los bordes y dibuja un anillo,
 * dejando el centro despejado para que el crosshair del HUD sirva de punto de
 * mira. Sin lógica de juego: solo reacciona al evento.
 */
export class ScopeOverlay implements Disposable {
  private readonly element = document.createElement("div");
  private readonly unsubscribe: () => void;

  constructor(
    private readonly root: HTMLElement,
    eventBus: GameEventBus,
  ) {
    this.element.style.cssText = [
      "position:absolute",
      "inset:0",
      "pointer-events:none",
      "opacity:0",
      "transition:opacity 0.12s ease",
      "z-index:30",
      // Borde oscuro radial: centro transparente, esquinas casi negras.
      "background:radial-gradient(circle at 50% 50%," +
        "transparent 0%,transparent 22%,rgba(0,0,0,0.55) 42%,rgba(0,0,0,0.96) 70%)",
    ].join(";");

    const ring = document.createElement("div");
    ring.style.cssText = [
      "position:absolute",
      "top:50%",
      "left:50%",
      "width:46vh",
      "height:46vh",
      "transform:translate(-50%,-50%)",
      "border:1px solid rgba(180,210,230,0.35)",
      "border-radius:50%",
      "box-shadow:0 0 0 1px rgba(0,0,0,0.6) inset",
    ].join(";");
    this.element.appendChild(ring);

    this.root.appendChild(this.element);

    this.unsubscribe = eventBus.on("weapon.scope.changed", ({ active }) => {
      this.element.style.opacity = active ? "1" : "0";
    });
  }

  dispose(): void {
    this.unsubscribe();
    this.element.remove();
  }
}
