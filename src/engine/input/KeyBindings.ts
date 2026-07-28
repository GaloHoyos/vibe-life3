import type { Input } from "./Input";

export interface ActionInput<TAction extends string> {
  isDown(action: TAction): boolean;
  wasPressed(action: TAction): boolean;
}

export type BindingMap<TAction extends string> = Record<TAction, readonly string[]>;

/**
 * Contexto en el que una acción puede dispararse. Dos acciones de contextos
 * distintos nunca están activas a la vez, así que pueden compartir tecla.
 */
export type BindingContextMap<TAction extends string> = Partial<
  Record<TAction, string>
>;

const DEFAULT_CONTEXT = "default";

/**
 * Indirección entre acciones del juego y `KeyboardEvent.code`. Una acción
 * puede tener N teclas asociadas (ej. `["ShiftLeft", "ShiftRight"]` para
 * sprint). Las consultas iteran y usan `Input` como fuente de verdad de
 * estado de teclado.
 *
 * `setBinding` evicta el mismo código de otras acciones para evitar que
 * la misma tecla dispare dos acciones simultáneamente — comportamiento
 * estándar en menús de controles tipo Half-Life 2. La excepción son las
 * acciones de otro contexto: saltar y el freno de mano comparten Espacio
 * porque nunca se puede estar a pie y conduciendo al mismo tiempo.
 */
export class KeyBindings<TAction extends string> implements ActionInput<TAction> {
  private readonly bindings = new Map<TAction, string[]>();
  private readonly contexts: BindingContextMap<TAction>;
  private readonly listeners = new Set<(action: TAction) => void>();

  constructor(
    private readonly input: Input,
    defaults: BindingMap<TAction>,
    contexts: BindingContextMap<TAction> = {},
  ) {
    this.contexts = contexts;
    for (const action of Object.keys(defaults) as TAction[]) {
      this.bindings.set(action, [...defaults[action]]);
    }
  }

  isDown(action: TAction): boolean {
    const codes = this.bindings.get(action);
    if (!codes) return false;
    for (const code of codes) {
      if (this.input.isKeyDown(code)) return true;
    }
    return false;
  }

  wasPressed(action: TAction): boolean {
    const codes = this.bindings.get(action);
    if (!codes) return false;
    for (const code of codes) {
      if (this.input.wasKeyPressed(code)) return true;
    }
    return false;
  }

  setBinding(action: TAction, codes: readonly string[]): void {
    const evicted = new Set<TAction>();
    const context = this.contexts[action] ?? DEFAULT_CONTEXT;
    for (const code of codes) {
      for (const other of this.bindings.keys()) {
        if (other === action) continue;
        if ((this.contexts[other] ?? DEFAULT_CONTEXT) !== context) continue;
        const otherCodes = this.bindings.get(other);
        if (!otherCodes) continue;
        const idx = otherCodes.indexOf(code);
        if (idx !== -1) {
          otherCodes.splice(idx, 1);
          evicted.add(other);
        }
      }
    }
    this.bindings.set(action, [...codes]);
    for (const action of evicted) {
      this.notify(action);
    }
    this.notify(action);
  }

  resetTo(defaults: BindingMap<TAction>): void {
    for (const action of Object.keys(defaults) as TAction[]) {
      this.bindings.set(action, [...defaults[action]]);
      this.notify(action);
    }
  }

  getCodes(action: TAction): readonly string[] {
    return this.bindings.get(action) ?? [];
  }

  getAllActions(): TAction[] {
    return Array.from(this.bindings.keys());
  }

  onChange(listener: (action: TAction) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(action: TAction): void {
    for (const listener of this.listeners) {
      listener(action);
    }
  }
}
