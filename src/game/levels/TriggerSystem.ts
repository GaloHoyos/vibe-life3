import { Euler, Quaternion, Vector3 } from 'three';
import type { GameEventBus } from "@game/GameEvents";
import { tupleToVector3 } from '@shared/math/VectorTuple';
import type { TriggerAction, TriggerDefinition } from './LevelDefinition';

interface PendingAction {
  action: TriggerAction;
  remaining: number;
}

interface RuntimeTrigger {
  definition: TriggerDefinition;
  center: Vector3;
  halfSize: Vector3;
  inverseRotation: Quaternion;
  actions: readonly TriggerAction[];
  active: boolean;
  /** Estado del frame anterior, para disparar solo al entrar (flanco). */
  inside: boolean;
}

const tmpLocalPoint = new Vector3();

/**
 * Volúmenes invisibles que ejecutan acciones al cruzarlos (diálogo, spawnear
 * NPCs, abrir puertas, acciones de nivel). Cada nivel registra los suyos vía
 * `LevelDefinition.triggers`. Dispara al entrar (no cada frame); si `once`, se
 * desactiva tras el primer disparo. Las acciones con `delay` se encolan y se
 * emiten al cumplirse — eso da el ritmo de un scripted sequence sin código.
 *
 * No conoce la lógica del juego: solo emite `trigger.action` y `Game` la ejecuta.
 */
export class TriggerSystem {
  private readonly triggers: RuntimeTrigger[] = [];
  private readonly pending: Array<{ trigger: RuntimeTrigger } & PendingAction> = [];

  constructor(private readonly eventBus: GameEventBus) {}

  clear(): void {
    this.triggers.length = 0;
    this.pending.length = 0;
  }

  addTrigger(definition: TriggerDefinition): void {
    const position = tupleToVector3(definition.position);
    const size = tupleToVector3(definition.size);
    const halfSize = size.clone().multiplyScalar(0.5);
    const rotation = definition.rotation
      ? new Quaternion().setFromEuler(new Euler(...definition.rotation))
      : new Quaternion();
    this.triggers.push({
      definition,
      center: position,
      halfSize,
      inverseRotation: rotation.invert(),
      actions: normalizeActions(definition),
      active: true,
      inside: false,
    });
  }

  update(playerPosition: Vector3, delta: number): void {
    this.triggers.forEach((trigger) => {
      const inside = trigger.active && containsPoint(trigger, playerPosition);
      if (inside && !trigger.inside) {
        this.fire(trigger);
      }
      trigger.inside = inside;
    });

    this.drainPending(delta);
  }

  private fire(trigger: RuntimeTrigger): void {
    this.eventBus.emit('trigger.entered', { id: trigger.definition.id });
    trigger.actions.forEach((action) => {
      const delay = action.delay ?? 0;
      if (delay > 0) {
        this.pending.push({ trigger, action, remaining: delay });
      } else {
        this.dispatch(trigger, action);
      }
    });

    if (trigger.definition.once) {
      trigger.active = false;
    }
  }

  private drainPending(delta: number): void {
    for (let i = this.pending.length - 1; i >= 0; i -= 1) {
      const entry = this.pending[i];
      entry.remaining -= delta;
      if (entry.remaining <= 0) {
        this.dispatch(entry.trigger, entry.action);
        this.pending.splice(i, 1);
      }
    }
  }

  private dispatch(trigger: RuntimeTrigger, action: TriggerAction): void {
    this.eventBus.emit('trigger.action', {
      triggerId: trigger.definition.id,
      action,
      position: trigger.center.clone(),
    });
  }
}

/** Normaliza la forma legacy (`dialogue`) a la lista de acciones. */
function normalizeActions(definition: TriggerDefinition): readonly TriggerAction[] {
  if (definition.actions && definition.actions.length > 0) {
    return definition.actions;
  }
  if (definition.dialogue) {
    return [{ kind: 'dialogue', ...definition.dialogue }];
  }
  return [];
}

function containsPoint(trigger: RuntimeTrigger, point: Vector3): boolean {
  tmpLocalPoint
    .copy(point)
    .sub(trigger.center)
    .applyQuaternion(trigger.inverseRotation);
  return (
    Math.abs(tmpLocalPoint.x) <= trigger.halfSize.x &&
    Math.abs(tmpLocalPoint.y) <= trigger.halfSize.y &&
    Math.abs(tmpLocalPoint.z) <= trigger.halfSize.z
  );
}
