import { Box3, Vector3 } from 'three';
import type { GameEventBus } from '../engine/GameEvents';
import { tupleToVector3 } from '../engine/MathTypes';
import type { TriggerDefinition } from './LevelDefinition';

interface RuntimeTrigger {
  definition: TriggerDefinition;
  bounds: Box3;
  active: boolean;
}

export class TriggerSystem {
  private readonly triggers: RuntimeTrigger[] = [];

  constructor(private readonly eventBus: GameEventBus) {}

  addTrigger(definition: TriggerDefinition): void {
    const position = tupleToVector3(definition.position);
    const size = tupleToVector3(definition.size);
    const halfSize = size.clone().multiplyScalar(0.5);
    this.triggers.push({
      definition,
      bounds: new Box3(position.clone().sub(halfSize), position.clone().add(halfSize)),
      active: true,
    });
  }

  update(playerPosition: Vector3): void {
    this.triggers.forEach((trigger) => {
      if (!trigger.active || !trigger.bounds.containsPoint(playerPosition)) {
        return;
      }

      this.eventBus.emit('trigger.entered', { id: trigger.definition.id });
      this.eventBus.emit('dialogue.show', trigger.definition.dialogue);

      if (trigger.definition.once) {
        trigger.active = false;
      }
    });
  }
}
