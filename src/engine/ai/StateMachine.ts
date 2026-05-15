export type StateHandler<TState extends string> = {
  enter?: () => void;
  update?: (delta: number) => void;
  exit?: () => void;
};

export class StateMachine<TState extends string> {
  private readonly states = new Map<TState, StateHandler<TState>>();
  private activeState: TState;

  constructor(initialState: TState) {
    this.activeState = initialState;
  }

  addState(state: TState, handler: StateHandler<TState>): void {
    this.states.set(state, handler);
  }

  setState(state: TState): void {
    if (state === this.activeState) {
      return;
    }

    this.states.get(this.activeState)?.exit?.();
    this.activeState = state;
    this.states.get(this.activeState)?.enter?.();
  }

  update(delta: number): void {
    this.states.get(this.activeState)?.update?.(delta);
  }

  getState(): TState {
    return this.activeState;
  }
}
