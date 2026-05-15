import type { GameEventBus } from "../GameEvents";
import type { SoundManager } from "./SoundManager";

export class DialogueAudioSystem {
  constructor(
    eventBus: GameEventBus,
    private readonly sounds: SoundManager,
  ) {
    eventBus.on("dialogue.show", () => {
      if (this.sounds.hasSound("dialogue.line")) {
        this.sounds.play("dialogue.line", { bus: "dialogue" });
      }
    });
  }
}
