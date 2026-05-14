import type { GameEventBus } from '../engine/GameEvents';

export class LevelEvents {
  constructor(private readonly eventBus: GameEventBus) {}

  announceLevel(title: string): void {
    this.eventBus.emit('dialogue.show', {
      speaker: 'Sistema',
      text: `Cargando ${title}.`,
      duration: 2.5,
    });
  }
}
