import type { BindingContextMap, BindingMap } from "@engine/input/KeyBindings";

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
  | "squadCommand"
  | "vehicleHandbrake"
  | "vehicleHorn"
  | "vehicleLights"
  | "quickSave"
  | "quickLoad"
  | "toggleDebug"
  | "releaseMouse"
  | "spawnDebugCombine"
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
  squadCommand: ["KeyC"],
  vehicleHandbrake: ["Space"],
  vehicleHorn: ["KeyH"],
  vehicleLights: ["KeyL"],
  quickSave: ["F6"],
  quickLoad: ["F8"],
  toggleDebug: ["F3"],
  releaseMouse: ["F9"],
  spawnDebugCombine: ["KeyN"],
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
  squadCommand: "Orden de escuadrón",
  vehicleHandbrake: "Freno de mano",
  vehicleHorn: "Bocina",
  vehicleLights: "Luces del vehículo",
  quickSave: "Guardado rápido",
  quickLoad: "Carga rápida",
  toggleDebug: "Menu debug",
  releaseMouse: "Liberar cursor",
  spawnDebugCombine: "Spawn Combine (debug)",
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
  "squadCommand",
  "vehicleHandbrake",
  "vehicleHorn",
  "vehicleLights",
  "quickSave",
  "quickLoad",
  "toggleDebug",
  "releaseMouse",
  "spawnDebugCombine",
  "pause",
];

/**
 * El freno de mano comparte Espacio con saltar a propósito, igual que en
 * Half-Life 2. Declararlo en otro contexto evita que rebindear uno deje al
 * otro sin tecla: nunca se está a pie y conduciendo al mismo tiempo.
 */
export const ActionContexts: BindingContextMap<GameAction> = {
  vehicleHandbrake: "vehicle",
  vehicleHorn: "vehicle",
  vehicleLights: "vehicle",
};

/**
 * Pausa usa `Escape`, que el navegador reserva como salida de pointer lock
 * y de fullscreen. Aunque cambiemos el binding, el navegador igual va a
 * procesar Escape -- exponer el rebind seria engañoso.
 */
export const NonRebindableActions: ReadonlySet<GameAction> = new Set([
  "pause",
]);
