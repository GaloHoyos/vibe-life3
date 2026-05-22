import type { NpcTaskId } from "./NpcSchedules";

export type NpcTaskStatus = "running" | "success" | "failed";

export interface NpcTaskRuntimeSnapshot {
  task: NpcTaskId | null;
  taskIndex: number;
  taskElapsed: number;
}

export class NpcTaskRunner {
  private taskIndex = 0;
  private taskElapsed = 0;
  private activeTask: NpcTaskId | null = null;

  reset(tasks: readonly NpcTaskId[]): void {
    this.taskIndex = 0;
    this.taskElapsed = 0;
    this.activeTask = tasks[0] ?? null;
  }

  tick(delta: number, tasks: readonly NpcTaskId[]): NpcTaskRuntimeSnapshot {
    if (this.activeTask !== tasks[this.taskIndex]) {
      this.activeTask = tasks[this.taskIndex] ?? null;
      this.taskElapsed = 0;
    } else {
      this.taskElapsed += delta;
    }
    return this.snapshot();
  }

  advance(tasks: readonly NpcTaskId[]): void {
    this.taskIndex = Math.min(this.taskIndex + 1, Math.max(0, tasks.length - 1));
    this.activeTask = tasks[this.taskIndex] ?? null;
    this.taskElapsed = 0;
  }

  snapshot(): NpcTaskRuntimeSnapshot {
    return {
      task: this.activeTask,
      taskIndex: this.taskIndex,
      taskElapsed: this.taskElapsed,
    };
  }
}
