import { Vector3 } from "three";

/**
 * Memoria por-NPC compartida entre componentes (perception, FSM, combat,
 * cover system, animator). Es un grab-bag tipado a propósito — los
 * NPCs leen/escriben campos según necesidad sin pasar contexto explícito
 * por cada llamada.
 *
 * Mantenelo flat y serializable (sin clases custom dentro): facilita
 * debug, save/load futuro y testeo.
 */
export interface Blackboard {
  /** Último daño recibido — dirección y tiempo. */
  lastDamageDirection: Vector3;
  lastDamageTime: number;
  /** ID del último que atacó (para retaliation). */
  lastAttackerId: string | null;

  /** Tiempo (s) que lleva el NPC bajo fuego sostenido. Decae con el tiempo. */
  suppressionLevel: number;

  /** Cover point ID asignado actualmente al NPC (null = expuesto). */
  currentCoverId: string | null;
  /** Tiempo (s) que el NPC lleva en su cover actual. */
  timeInCover: number;
  /** Tiempo (s) desde la última vez que se asomó a disparar desde cover. */
  timeSincePeek: number;

  /** Última posición a la que el NPC se movió como objetivo. */
  lastMoveTarget: Vector3 | null;

  /** Tiempo (s) que lleva sin ver al threat. */
  timeSinceLastSeen: number;
}

export function createBlackboard(): Blackboard {
  return {
    lastDamageDirection: new Vector3(0, 0, 1),
    lastDamageTime: -Infinity,
    lastAttackerId: null,
    suppressionLevel: 0,
    currentCoverId: null,
    timeInCover: 0,
    timeSincePeek: 0,
    lastMoveTarget: null,
    timeSinceLastSeen: 0,
  };
}
