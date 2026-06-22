import { Dialogue } from "@game/config/strings";
import type { GameEventBus } from "@game/GameEvents";

export class LevelEvents {
  constructor(private readonly eventBus: GameEventBus) {}

  announceLevel(title: string): void {
    this.eventBus.emit("dialogue.show", Dialogue.levelLoading(title));
  }
}
