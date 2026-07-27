import type { ConditionMask } from './Condition';
import { hasAll, hasAny } from './Condition';
import type { ScheduleDefinition, Task } from './Task';

export interface BrainSnapshot {
  schedule: string | null;
  previousSchedule: string | null;
  task: string | null;
  taskIndex: number;
  scheduleElapsed: number;
}

/**
 * Runner generico de schedules para un NPC. El generico `C` es el context
 * concreto que la capa game define (`NpcBrainContext`).
 *
 * Algoritmo por tick:
 *  1. Selecciona schedule candidato: priority desc, con `required` activas y
 *     ningun bit de `blockedBy` puesto.
 *  2. Si hay schedule activo:
 *     - Si el candidato es de prioridad ESTRICTAMENTE mayor → reemplaza (con
 *       abort del task corriendo).
 *     - Si los `interrupts` del activo se activaron → reemplaza.
 *     - Caso contrario, persiste (histeresis: empates de prioridad no
 *       oscilan).
 *  3. Ejecuta el task actual. Si devuelve `success`, avanza al siguiente.
 *     Si era el ultimo, marca el schedule como completado (sin schedule
 *     activo; el siguiente tick reelige). Si devuelve `failure`, fuerza
 *     reseleccion.
 *
 * El runner NO computa conditions — el caller (NpcRuntime) las arma antes
 * de invocar `update(ctx, mask)`. Esto mantiene engine agnostico del
 * dominio de game.
 */
export class Brain<C> {
  private readonly schedules: ReadonlyArray<ScheduleDefinition<C>>;
  private current: ScheduleDefinition<C> | null = null;
  private previousId: string | null = null;
  private taskIndex = 0;
  private taskInitialized = false;
  private scheduleElapsed = 0;

  constructor(schedules: ReadonlyArray<ScheduleDefinition<C>>) {
    const sorted = [...schedules].sort((a, b) => b.priority - a.priority);
    this.schedules = sorted;
  }

  snapshot(): BrainSnapshot {
    return {
      schedule: this.current?.id ?? null,
      previousSchedule: this.previousId,
      task: this.currentTask()?.id ?? null,
      taskIndex: this.taskIndex,
      scheduleElapsed: this.scheduleElapsed,
    };
  }

  /**
   * Reanuda la posición lógica de un schedule sin ejecutar callbacks durante
   * la carga. El task se inicializa normalmente en el próximo `update`.
   */
  restoreSnapshot(snapshot: Readonly<BrainSnapshot>): void {
    const current = snapshot.schedule
      ? this.schedules.find((schedule) => schedule.id === snapshot.schedule) ?? null
      : null;
    this.current = current;
    this.previousId = snapshot.previousSchedule;
    this.taskIndex = current
      ? Math.max(0, Math.min(current.tasks.length - 1, snapshot.taskIndex))
      : 0;
    this.taskInitialized = false;
    this.scheduleElapsed = Number.isFinite(snapshot.scheduleElapsed)
      ? Math.max(0, snapshot.scheduleElapsed)
      : 0;
  }

  update(ctx: C, delta: number, conditions: ConditionMask): void {
    this.scheduleElapsed += delta;
    const candidate = this.pick(conditions);
    if (this.shouldSwap(candidate, conditions)) {
      this.swapTo(candidate, ctx);
    }
    if (!this.current) return;
    const task = this.currentTask();
    if (!task) {
      this.finishSchedule();
      return;
    }
    if (!this.taskInitialized) {
      task.init(ctx);
      this.taskInitialized = true;
    }
    const status = task.tick(ctx);
    if (status === 'running') return;
    if (status === 'success') {
      this.taskIndex += 1;
      this.taskInitialized = false;
      if (this.taskIndex >= this.current.tasks.length) {
        this.finishSchedule();
      }
      return;
    }
    this.abortCurrent(ctx);
  }

  private currentTask(): Task<C> | null {
    if (!this.current) return null;
    if (this.taskIndex < 0 || this.taskIndex >= this.current.tasks.length) return null;
    return this.current.tasks[this.taskIndex];
  }

  private pick(conditions: ConditionMask): ScheduleDefinition<C> | null {
    for (const schedule of this.schedules) {
      if (!hasAll(conditions, schedule.required)) continue;
      if (hasAny(conditions, schedule.blockedBy)) continue;
      return schedule;
    }
    return null;
  }

  private shouldSwap(candidate: ScheduleDefinition<C> | null, conditions: ConditionMask): boolean {
    if (!this.current) return candidate !== null;
    if (!candidate) return true;
    if (candidate.id === this.current.id) return false;
    if (candidate.priority > this.current.priority) return true;
    if (hasAny(conditions, this.current.interrupts)) return true;
    return false;
  }

  private swapTo(next: ScheduleDefinition<C> | null, ctx: C): void {
    if (this.current) {
      this.abortCurrentInternal(ctx);
      this.previousId = this.current.id;
    }
    this.current = next;
    this.taskIndex = 0;
    this.taskInitialized = false;
    this.scheduleElapsed = 0;
  }

  private finishSchedule(): void {
    if (this.current) this.previousId = this.current.id;
    this.current = null;
    this.taskIndex = 0;
    this.taskInitialized = false;
  }

  private abortCurrent(ctx: C): void {
    this.abortCurrentInternal(ctx);
    this.finishSchedule();
  }

  private abortCurrentInternal(ctx: C): void {
    const task = this.currentTask();
    if (task && this.taskInitialized) {
      task.abort(ctx);
    }
    this.taskInitialized = false;
  }
}
