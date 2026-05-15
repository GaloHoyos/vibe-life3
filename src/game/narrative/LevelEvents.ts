import { Dialogue, Objectives } from "../config/strings";
import type { GameEventBus } from "../GameEvents";

export class LevelEvents {
  constructor(private readonly eventBus: GameEventBus) {}

  announceLevel(title: string): void {
    this.eventBus.emit("dialogue.show", Dialogue.levelLoading(title));
    this.eventBus.emit("objective.updated", {
      text: Objectives.exploreFacility,
    });
  }
}
