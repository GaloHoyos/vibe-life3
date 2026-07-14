import type { Vector3 } from 'three';
import type { GestureId } from '@engine/animation/AnimationInput';

export type ScriptMoveMode = 'walk' | 'run' | 'teleport' | 'none';

/**
 * Paso de secuencia ya resuelto para el runtime: los targets de `face` pasan de
 * nombre a un `Vector3` concreto (o al player) al armar la orden.
 */
export type ResolvedSequenceStep =
  | { kind: 'gesture'; gesture: GestureId; duration: number }
  | { kind: 'wait'; seconds: number }
  | { kind: 'waitForCue' }
  | { kind: 'say'; text: string; speaker?: string; duration: number }
  | { kind: 'face'; target: Vector3 | 'player' };

/**
 * Orden de comportamiento guionado que el `ScriptedSequenceSystem` publica para
 * un NPC y que los `ScriptTasks` consumen: mover a un punto, encarar y ejecutar
 * una lista de pasos. Los callbacks `notify*` cierran el ciclo emitiendo los
 * outputs de la secuencia (`OnArrived`/`OnEnd`/`OnCanceled`).
 */
export interface NpcScriptOrder {
  readonly sequenceName: string;
  readonly moveMode: ScriptMoveMode;
  /** Punto de move-to (o teleport). `null` si `moveMode === 'none'`. */
  readonly movePosition: Vector3 | null;
  /** Yaw final a encarar al llegar, o `null` si no se especificó. */
  readonly faceYaw: number | null;
  readonly steps: readonly ResolvedSequenceStep[];
  /** Ininterrumpible: pisa incluso el combate (override AI). */
  readonly overrideAi: boolean;
  /** Hay una señal `Cue` pendiente que un paso `waitForCue` debe consumir. */
  isCuePending(): boolean;
  consumeCue(): void;
  /** El NPC llegó al punto de move-to. */
  notifyArrived(): void;
  /** La orden terminó (o se abortó): dispara el output correspondiente y se limpia. */
  notifyDone(status: 'completed' | 'canceled' | 'failed'): void;
}
