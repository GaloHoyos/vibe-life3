import type { BindingMap } from "../../engine/KeyBindings";

export type GameAction =
  | "moveForward"
  | "moveBack"
  | "moveLeft"
  | "moveRight"
  | "jump"
  | "sprint"
  | "crouch"
  | "interact"
  | "reload"
  | "weaponSlot1"
  | "weaponSlot2"
  | "weaponSlot3"
  | "weaponSlot4"
  | "weaponSlot5"
  | "toggleDebug"
  | "toggleNpcDebug"
  | "releaseMouse"
  | "pause";

export const DefaultBindings: BindingMap<GameAction> = {
  moveForward: ["KeyW"],
  moveBack: ["KeyS"],
  moveLeft: ["KeyA"],
  moveRight: ["KeyD"],
  jump: ["Space"],
  sprint: ["ShiftLeft", "ShiftRight"],
  crouch: ["ControlLeft", "ControlRight"],
  interact: ["KeyE"],
  reload: ["KeyR"],
  weaponSlot1: ["Digit1"],
  weaponSlot2: ["Digit2"],
  weaponSlot3: ["Digit3"],
  weaponSlot4: ["Digit4"],
  weaponSlot5: ["Digit5"],
  toggleDebug: ["F3"],
  toggleNpcDebug: ["F4"],
  releaseMouse: ["F9"],
  pause: ["Escape"],
};

export const ActionLabels: Record<GameAction, string> = {
  moveForward: "Avanzar",
  moveBack: "Retroceder",
  moveLeft: "Lateral izquierda",
  moveRight: "Lateral derecha",
  jump: "Saltar",
  sprint: "Correr",
  crouch: "Agacharse",
  interact: "Interactuar / Usar",
  reload: "Recargar",
  weaponSlot1: "Arma 1",
  weaponSlot2: "Arma 2",
  weaponSlot3: "Arma 3",
  weaponSlot4: "Arma 4",
  weaponSlot5: "Arma 5",
  toggleDebug: "Mostrar / ocultar debug",
  toggleNpcDebug: "Panel debug de NPCs",
  releaseMouse: "Liberar cursor",
  pause: "Pausa",
};

export const ActionOrder: readonly GameAction[] = [
  "moveForward",
  "moveBack",
  "moveLeft",
  "moveRight",
  "jump",
  "sprint",
  "crouch",
  "interact",
  "reload",
  "weaponSlot1",
  "weaponSlot2",
  "weaponSlot3",
  "weaponSlot4",
  "weaponSlot5",
  "toggleDebug",
  "toggleNpcDebug",
  "releaseMouse",
  "pause",
];

/**
 * Pausa usa `Escape`, que el navegador reserva como salida de pointer lock
 * y de fullscreen. Aunque cambiemos el binding, el navegador igual va a
 * procesar Escape — exponer el rebind sería engañoso.
 */
export const NonRebindableActions: ReadonlySet<GameAction> = new Set([
  "pause",
]);
