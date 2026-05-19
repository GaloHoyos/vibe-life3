import type { Input } from "@engine/input/Input";
import type { Controls } from "@game/gameplay/player/Controls";
import { AimDebugPanel } from "@game/ui/overlay/AimDebugPanel";

/**
 * Sistema de debug para NPCs: orquesta el panel de tuning (aim pose, rest
 * pose, weapon attachment, flags) y los keybinds asociados.
 *
 * Bindings:
 *  - `toggleNpcDebug` (F4 default): muestra/oculta el panel.
 *  - `releaseMouse` (F9 default): suelta el pointer lock para poder
 *    interactuar con los sliders. El user recaptura con click en el canvas.
 *
 * El panel se crea lazy la primera vez que se hace toggle, para no agregar
 * DOM hasta que se necesite.
 */
export class NpcDebugSystem {
  private panel: AimDebugPanel | null = null;
  private debugReleased = false;

  constructor(
    private readonly input: Input,
    private readonly controls: Controls,
  ) {
    document.addEventListener("pointerlockchange", this.handleLockChange);
  }

  update(): void {
    if (this.controls.wasPressed("toggleNpcDebug")) {
      this.togglePanel();
    }
    if (this.controls.wasPressed("releaseMouse")) {
      this.releaseMouse();
    }
  }

  /**
   * `true` mientras el usuario soltÃ³ el cursor con F9 (no con Escape o
   * pÃ©rdida normal del foco). `Game` lo lee para skipear el auto-pause
   * que dispara `pointerlockchange`.
   */
  isDebugMouseRelease(): boolean {
    return this.debugReleased;
  }

  private togglePanel(): void {
    if (!this.panel) {
      this.panel = new AimDebugPanel();
      this.panel.show();
      return;
    }
    this.panel.toggle();
  }

  private releaseMouse(): void {
    if (this.input.isPointerLocked()) {
      this.debugReleased = true;
      document.exitPointerLock();
    }
  }

  private readonly handleLockChange = (): void => {
    if (this.input.isPointerLocked()) {
      this.debugReleased = false;
    }
  };

  dispose(): void {
    document.removeEventListener("pointerlockchange", this.handleLockChange);
    this.panel?.dispose();
    this.panel = null;
  }
}
