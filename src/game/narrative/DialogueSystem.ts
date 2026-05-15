import type { Disposable } from '../../shared/types/lifecycle';
import type { GameEventBus } from "../GameEvents";
import type { Subtitles } from '../ui/Subtitles';

export class DialogueSystem implements Disposable {
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    eventBus: GameEventBus,
    private readonly subtitles: Subtitles,
  ) {
    this.unsubscribers.push(
      eventBus.on('dialogue.show', (payload) => {
        this.subtitles.show(payload.text, payload.duration, payload.speaker);
      }),
      eventBus.on('subtitle.show', (payload) => {
        this.subtitles.show(payload.text, payload.duration, payload.speaker);
      }),
    );
  }

  dispose(): void {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
  }
}
