import type { Object3D } from 'three';
import type { GameEventBus } from '../../engine/GameEvents';
import type { Interactable } from './Interactable';
import type { SlidingDoor } from './SlidingDoor';

export class DoorButton implements Interactable {
  readonly maxDistance = 3;

  constructor(
    readonly id: string,
    readonly label: string,
    readonly object: Object3D,
    private readonly door: SlidingDoor,
    private readonly eventBus: GameEventBus,
  ) {}

  interact(): void {
    const open = this.door.toggle();
    this.eventBus.emit('door.opened', {
      id: this.door.id,
      open,
    });
    this.eventBus.emit('dialogue.show', {
      speaker: 'Sistema',
      text: open ? 'Puerta de laboratorio abierta.' : 'Puerta de laboratorio cerrada.',
      duration: 2.2,
    });
  }
}
