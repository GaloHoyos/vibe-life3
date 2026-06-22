import type { ConditionMask } from './Condition';

export type TaskStatus = 'running' | 'success' | 'failure';

/**
 * Accion atomica que un schedule ejecuta. El generico `C` es el context del
 * juego (en este proyecto: `NpcBrainContext` de `game/npc/brain/`). Engine no
 * conoce los tipos concretos — solo el contrato.
 *
 * Ciclo de vida:
 *  - `init(ctx)` se llama cuando el task arranca (primer tick del schedule
 *    o cuando el task anterior termina con `success`).
 *  - `tick(ctx)` se invoca cada update del brain hasta devolver `success` o
 *    `failure`.
 *  - `abort(ctx)` se llama si un interrupt cambio el schedule activo
 *    mientras este task estaba `running`. Debe liberar recursos (path
 *    requests pendientes, claims de cover, etc.).
 */
export interface Task<C> {
  readonly id: string;
  init(ctx: C): void;
  tick(ctx: C): TaskStatus;
  abort(ctx: C): void;
}

/**
 * Builder helper para tasks stateless: el caller pasa solo el `tick` y
 * recibe un `Task` con `init`/`abort` vacios. Util para Wait, FaceTarget,
 * etc. donde no hay estado per-instancia.
 */
export function task<C>(id: string, tick: (ctx: C) => TaskStatus): Task<C> {
  return {
    id,
    init: () => {},
    tick,
    abort: () => {},
  };
}

export interface ScheduleDefinition<C> {
  id: string;
  priority: number;
  /** Todas estas conditions deben estar activas para que aplique el schedule. */
  required: ConditionMask;
  /** Si alguna de estas conditions esta activa, el schedule queda bloqueado. */
  blockedBy: ConditionMask;
  /**
   * Conditions que abortan este schedule si pasan a activarse mientras
   * corre. Tipicamente: `SeeEnemy` interrumpe `Patrol`, `EnemyDead`
   * interrumpe `CoverFire`, etc.
   */
  interrupts: ConditionMask;
  /** Lista ordenada de tasks que se ejecutan secuencialmente. */
  tasks: Task<C>[];
}
