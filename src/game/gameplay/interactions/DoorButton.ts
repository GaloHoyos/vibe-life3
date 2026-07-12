import type { Object3D } from 'three';
import { InteractionsConfig } from '@game/config/gameplay.config';
import { Dialogue } from '@game/config/strings';
import type { GameEventBus } from "@game/GameEvents";
import type { Interactable } from './Interactable';
import type { SlidingDoor } from './SlidingDoor';

export class DoorButton implements Interactable {
  readonly maxDistance = InteractionsConfig.doorButtonRange;

  constructor(
    readonly id: string,
    readonly label: string,
    readonly object: Object3D,
    private readonly door: SlidingDoor,
    private readonly eventBus: GameEventBus,
  ) {}

  interact(): void {
    const open = this.door.toggle({ kind: 'player' });
    this.eventBus.emit(
      'dialogue.show',
      open ? Dialogue.doorOpened : Dialogue.doorClosed,
    );
  }
}
