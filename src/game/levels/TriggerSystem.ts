import { Euler, Quaternion, Vector3 } from 'three';
import type { GameEventBus } from "@game/GameEvents";
import { tupleToVector3 } from '@shared/math/VectorTuple';
import type { TriggerDefinition } from './LevelDefinition';

interface RuntimeTrigger {
  definition: TriggerDefinition;
  center: Vector3;
  halfSize: Vector3;
  inverseRotation: Quaternion;
  /** El volumen puede emitir (no consumido por `once` ni deshabilitado). */
  active: boolean;
  /** Estado del frame anterior, para disparar solo al cruzar el borde (flanco). */
  inside: boolean;
  /** Un trigger_once consumido no puede reactivarse por I/O. */
  consumed: boolean;
  /** StartTouch emitido para el solapamiento actual. */
  touching: boolean;
  /**
   * Tiempo hasta que puede aceptarse otro StartTouch. Si el jugador reentra
   * durante esta ventana, `inside` registra el solapamiento físico pero
   * `touching` permanece false; al vencer el cooldown se acepta esa entrada sin
   * obligarlo a salir y volver a entrar.
   */
  cooldownRemaining: number;
}

const tmpLocalPoint = new Vector3();

/**
 * Volúmenes invisibles que emiten outputs de entity I/O al cruzarlos:
 * `trigger.entered` (→ `OnStartTouch`) al entrar y `trigger.exited` (→
 * `OnEndTouch`) al salir. La lógica (qué pasa al entrar) vive en las conexiones
 * del grafo de I/O; este sistema solo detecta flancos sobre la posición del
 * jugador. Si `once`, se desactiva tras el primer `OnStartTouch`.
 */
export class TriggerSystem {
  private readonly triggers: RuntimeTrigger[] = [];

  constructor(private readonly eventBus: GameEventBus) {}

  clear(): void {
    this.triggers.length = 0;
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
      active: !definition.startDisabled,
      inside: false,
      consumed: false,
      touching: false,
      cooldownRemaining: 0,
    });
  }

  /** Habilita/deshabilita un trigger por id (inputs `Enable`/`Disable` del I/O). */
  setEnabled(triggerId: string, enabled: boolean): void {
    const trigger = this.triggers.find((t) => t.definition.id === triggerId);
    if (!trigger) return;
    if (trigger.consumed) return;
    if (trigger.active === enabled) return;
    trigger.active = enabled;
    if (!enabled) this.endTouch(trigger);
  }

  toggleEnabled(triggerId: string): void {
    const trigger = this.triggers.find((t) => t.definition.id === triggerId);
    if (!trigger || trigger.consumed) return;
    this.setEnabled(triggerId, !trigger.active);
  }

  isEnabled(triggerId: string): boolean {
    return this.triggers.find((t) => t.definition.id === triggerId)?.active ?? false;
  }

  update(playerPosition: Vector3, delta: number): void {
    this.triggers.forEach((trigger) => {
      trigger.cooldownRemaining = Math.max(0, trigger.cooldownRemaining - Math.max(0, delta));
      const contains = containsPoint(trigger, playerPosition);
      const wasInside = trigger.inside;
      // `inside` sigue el volumen físico. `touching` sólo es true después de un
      // StartTouch aceptado, por lo que una reentrada durante `wait` puede
      // quedar pendiente hasta que venza el cooldown.
      if (trigger.active) {
        if (contains && !trigger.touching && trigger.cooldownRemaining <= 0) {
          // Marcar antes de emitir hace robusto el estado ante un Disable
          // reentrante disparado por las propias conexiones de OnStartTouch.
          trigger.touching = true;
          trigger.cooldownRemaining = Math.max(0, trigger.definition.wait ?? 0);
          if (trigger.definition.once) {
            trigger.active = false;
            trigger.consumed = true;
          }
          this.eventBus.emit('trigger.entered', { id: trigger.definition.id });
        } else if (!contains && wasInside) {
          this.endTouch(trigger);
        }
      }
      trigger.inside = contains;
    });
  }

  /** Cierra un touch aceptado exactamente una vez, incluso ante reentrancia. */
  private endTouch(trigger: RuntimeTrigger): void {
    if (!trigger.touching) return;
    trigger.touching = false;
    this.eventBus.emit('trigger.exited', { id: trigger.definition.id });
  }
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
