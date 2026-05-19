import type { Disposable } from '@shared/types/lifecycle';
import type { GameEventBus } from "@game/GameEvents";
import type { Subtitles } from '@game/ui/subtitles/Subtitles';

/**
 * Bridge entre los eventos de diálogo (`dialogue.show` / `subtitle.show`)
 * y el componente `Subtitles`. Limpia sus suscripciones en `dispose()`.
 */
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
