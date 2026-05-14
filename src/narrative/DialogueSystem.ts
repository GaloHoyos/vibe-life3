import type { Disposable } from '../engine/GameObject';
import type { GameEventBus } from '../engine/GameEvents';
import type { Subtitles } from '../ui/Subtitles';

export class DialogueSystem implements Disposable {
  private readonly unsubscribe: () => void;

  constructor(
    eventBus: GameEventBus,
    private readonly subtitles: Subtitles,
  ) {
    this.unsubscribe = eventBus.on('dialogue.show', (payload) => {
      this.subtitles.show(payload.text, payload.duration, payload.speaker);
    });
  }

  dispose(): void {
    this.unsubscribe();
  }
}
