/**
 * Triple `enter/update/exit` que define el comportamiento de un estado.
 * Las tres operaciones son opcionales: un estado puramente reactivo a
 * eventos puede dejarlas vacías.
 */
export type StateHandler<TState extends string> = {
  enter?: () => void;
  update?: (delta: number) => void;
  exit?: () => void;
};

/**
 * Máquina de estados genérica indexada por strings.
 *
 * No hace cumplir un grafo de transiciones — cualquiera puede llamar
 * `setState(...)` con cualquier estado registrado. La validez de las
 * transiciones es responsabilidad de los handlers (típicamente sólo
 * `update`/`enter` invocan `setState`).
 *
 * @example
 * ```ts
 * type State = "idle" | "moving";
 * const fsm = new StateMachine<State>("idle");
 * fsm.addState("idle", { update: () => { ... } });
 * fsm.addState("moving", { enter: () => { ... } });
 * fsm.setState("moving");
 * ```
 */
export class StateMachine<TState extends string> {
  private readonly states = new Map<TState, StateHandler<TState>>();
  private activeState: TState;
  private lastTransitionReason: string | null = null;

  constructor(initialState: TState) {
    this.activeState = initialState;
  }

  /** Registra el comportamiento del estado. Sobreescribe si ya existía. */
  addState(state: TState, handler: StateHandler<TState>): void {
    this.states.set(state, handler);
  }

  /**
   * Cambia al estado dado, ejecutando `exit` del actual y `enter` del nuevo.
   * Es no-op si `state === getState()`. `reason` es un texto corto para
   * debugging — queda accesible vía `getLastTransitionReason()` y aparece
   * en el trace recorder; si no se provee, queda en `null` (transición
   * silenciosa).
   */
  setState(state: TState, reason?: string): void {
    if (state === this.activeState) {
      return;
    }

    this.states.get(this.activeState)?.exit?.();
    this.activeState = state;
    this.lastTransitionReason = reason ?? null;
    this.states.get(this.activeState)?.enter?.();
  }

  /** Llama al `update` del estado activo. Pasar `delta` en segundos. */
  update(delta: number): void {
    this.states.get(this.activeState)?.update?.(delta);
  }

  /** Estado actualmente activo. */
  getState(): TState {
    return this.activeState;
  }

  /** Razón pasada al último `setState`, o null si no se especificó. */
  getLastTransitionReason(): string | null {
    return this.lastTransitionReason;
  }
}
