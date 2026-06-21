import type { Vector3, WebGLRenderer } from "three";
import type { NavSpace } from "@engine/ai/nav/NavSpace";
import type { Player } from "@game/gameplay/player/Player";
import type { INpc } from "@game/npc/core/INpc";
import type { Disposable } from "@shared/types/lifecycle";

export interface DebugFrame {
  delta: number;
  elapsed: number;
  fps: number;
  player: Player | null;
  npcs: readonly INpc[];
  navSpace: NavSpace | null;
  rendererInfo: WebGLRenderer["info"];
  physicsBodies: number;
  playerPosition: Vector3 | null;
}

/**
 * Modulo pluggable del DebugMenu. Cada modulo es duenio de una pestania,
 * monta su propio DOM y decide que significa "estar activo" (overlays
 * 3D, grabacion, suscripciones, etc).
 *
 * Contrato:
 *  - `mount(container)` se llama una vez cuando el modulo se registra.
 *  - `update(frame)` solo se llama cuando el menu esta visible **y** el
 *    modulo esta activo (`isActive()` true).
 *  - `setActive(active)` debe ser idempotente y manejar el costo runtime
 *    (encender/apagar overlays, suscripciones, intervalos).
 *  - `dispose()` libera todo (DOM, listeners, recursos GPU).
 *
 * Si `heavy` es `true`, el modulo arranca inactivo y la UI muestra un
 * marcador "(costoso)" para que el usuario lo prenda explicitamente.
 */
export interface DebugModule extends Disposable {
  readonly id: string;
  readonly label: string;
  readonly heavy?: boolean;
  readonly updateWhenHidden?: boolean;
  mount(container: HTMLElement): void;
  update?(frame: DebugFrame): void;
  setActive(active: boolean): void;
  isActive(): boolean;
}
