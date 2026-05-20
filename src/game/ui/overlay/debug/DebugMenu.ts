import type { Input } from "@engine/input/Input";
import type { GameEventBus } from "@game/GameEvents";
import type { Controls } from "@game/gameplay/player/Controls";
import type { Disposable } from "@shared/types/lifecycle";
import type { DebugFrame, DebugModule } from "./DebugModule";
import { DebugMenuView } from "./DebugMenuView";

/**
 * Orquestador unificado de debug. Reemplaza al viejo dueto F3/F4 + paneles
 * sueltos. Un solo overlay con pestanias, una por modulo (Stats, Player,
 * Armas, NPCs, IA visual, IA trace, Escena). Cada modulo decide su costo
 * runtime via `setActive(boolean)`; los modulos pesados arrancan inactivos
 * para no degradar el FPS solo por abrir el menu.
 *
 * Bindings:
 *  - `toggleDebug` (F3): muestra/oculta el menu.
 *  - `releaseMouse` (F9): suelta el pointer lock para interactuar con
 *    sliders. El usuario recaptura con click en el canvas.
 */
export class DebugMenu implements Disposable {
  private readonly view: DebugMenuView;
  private readonly modules: DebugModule[] = [];
  private debugReleased = false;
  private menuVisible = false;

  constructor(
    container: HTMLElement,
    private readonly input: Input,
    private readonly controls: Controls,
    private readonly eventBus: GameEventBus,
  ) {
    this.view = new DebugMenuView({
      onModuleActiveChange: (id, active) => this.toggleModule(id, active),
      onTabChange: () => {},
      onClose: () => this.setVisible(false),
    });
    this.view.attachTo(container);
    document.addEventListener("pointerlockchange", this.handleLockChange);
  }

  /**
   * Registrar un modulo. Si el modulo no es pesado se activa de inmediato
   * (default checkbox marcado). Los modulos pesados quedan inactivos hasta
   * que el usuario los prenda manualmente.
   */
  register(module: DebugModule): void {
    const body = this.view.addModule(module);
    module.mount(body);
    this.modules.push(module);
    if (!module.heavy) {
      module.setActive(true);
    }
    this.view.refreshTabState(module.id);
  }

  /**
   * Tick por frame. El componente principal del juego lo invoca siempre,
   * incluso si el menu esta oculto, asi los modulos cheap (Stats) pueden
   * acumular datos. En la practica los modulos consultan `isActive()` o
   * `menuVisible` antes de hacer trabajo costoso.
   */
  update(frame: DebugFrame): void {
    this.pumpKeybinds();
    if (!this.menuVisible) {
      return;
    }
    for (const module of this.modules) {
      if (!module.isActive() || !module.update) continue;
      module.update(frame);
    }
  }

  /**
   * `true` mientras el usuario solto el cursor con F9 (no con Escape o
   * perdida normal de foco). `Game` lo lee para skipear el auto-pause
   * que dispara `pointerlockchange`.
   */
  isDebugMouseRelease(): boolean {
    return this.debugReleased;
  }

  setVisible(visible: boolean): void {
    if (this.menuVisible === visible) return;
    this.menuVisible = visible;
    if (visible) {
      this.view.show();
    } else {
      this.view.hide();
    }
    this.eventBus.emit("debug.toggle", { enabled: visible });
  }

  toggleVisible(): void {
    this.setVisible(!this.menuVisible);
  }

  isVisible(): boolean {
    return this.menuVisible;
  }

  dispose(): void {
    document.removeEventListener("pointerlockchange", this.handleLockChange);
    for (const module of this.modules) {
      module.setActive(false);
      module.dispose();
    }
    this.modules.length = 0;
    this.view.dispose();
  }

  private pumpKeybinds(): void {
    if (this.controls.wasPressed("toggleDebug")) {
      this.toggleVisible();
    }
    if (this.controls.wasPressed("releaseMouse")) {
      this.releaseMouse();
    }
  }

  private toggleModule(moduleId: string, active: boolean): void {
    const module = this.modules.find((m) => m.id === moduleId);
    if (!module) return;
    module.setActive(active);
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
}
