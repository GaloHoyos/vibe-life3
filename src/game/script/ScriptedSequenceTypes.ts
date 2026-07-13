import type { VectorTuple } from '@shared/math/VectorTuple';
import type { GestureId } from '@engine/animation/AnimationInput';
import type { EntityConnection } from './EntityIOTypes';
import type { ScriptMoveMode } from './NpcScriptOrder';

/** Rotacion Euler XYZ en radianes (se usa el componente Y como yaw a encarar). */
type RotationTuple = VectorTuple;

/**
 * Paso serializable de una secuencia guionada (scripted_sequence). Se ejecuta en
 * orden tras llegar al punto de la secuencia.
 */
export type SequenceStep =
  | { kind: 'gesture'; gesture: GestureId; duration?: number }
  | { kind: 'wait'; seconds: number }
  /** Bloquea hasta recibir un input `Cue` en la secuencia. */
  | { kind: 'waitForCue' }
  | { kind: 'say'; text: string; speaker?: string; duration: number }
  /** Encara hacia un marker (por nombre) o `!player`. */
  | { kind: 'face'; target: string };

/**
 * Secuencia guionada de un NPC (equivalente a `scripted_sequence` de Source):
 * mueve al NPC nombrado a un punto, lo encara y ejecuta una lista de pasos.
 * Inputs `Start`/`Cancel`/`Cue`; outputs `OnBegin`/`OnArrived`/`OnEnd`/`OnCanceled`.
 * Un Blob se coreografía sólo con conexiones I/O: `OnBegin -> SetBlobPose`,
 * `OnBlobPoseReached -> Cue` y `OnEnd -> ResetBlobPose`.
 */
export interface ScriptedSequenceDefinition {
  id: string;
  /** targetname de la secuencia (para I/O). */
  name: string;
  /** targetname del NPC que ejecuta la secuencia. */
  targetNpc: string;
  /** Punto de move-to / teleport. */
  position: VectorTuple;
  /** Rotación final; se usa el yaw (Y) para encarar al llegar. */
  rotation?: RotationTuple;
  moveMode: ScriptMoveMode;
  /** Ininterrumpible: pisa el combate mientras corre. */
  overrideAi?: boolean;
  /** Puede recibir `Start` de nuevo tras terminar. */
  repeatable?: boolean;
  steps?: SequenceStep[];
  connections?: EntityConnection[];
}
