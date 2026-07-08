import type { GameAction } from "@game/config/controls.config";
import type { Controls } from "@game/gameplay/player/Controls";

export interface FakeControlsState {
  pressed: Set<GameAction>;
  down: Set<GameAction>;
}

export function fakeControls(state: Partial<FakeControlsState> = {}): Controls {
  const controlsState: FakeControlsState = {
    pressed: state.pressed ?? new Set<GameAction>(),
    down: state.down ?? new Set<GameAction>(),
  };

  return {
    state: controlsState,
    wasPressed: (action: GameAction) => controlsState.pressed.has(action),
    isDown: (action: GameAction) => controlsState.down.has(action),
  } as unknown as Controls;
}
