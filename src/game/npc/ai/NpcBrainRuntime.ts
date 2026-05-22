import type { Vector3 } from "three";
import type { CharacterAIProfile } from "./CharacterAIProfile";
import { NpcConditionSet, type NpcCondition } from "./NpcConditionSet";
import {
  createNpcBrainBlackboard,
  type NpcBrainBlackboard,
} from "./NpcBlackboard";
import { NpcScheduleSelector } from "./NpcScheduleSelector";
import { NpcTaskRunner, type NpcTaskRuntimeSnapshot } from "./NpcTaskRunner";
import type { NpcScheduleId } from "./NpcSchedules";
import type { SquadRole } from "./SquadDirector";

export interface NpcBrainUpdateInput {
  delta: number;
  elapsed: number;
  conditions: Iterable<NpcCondition>;
  threatId: string | null;
  threatPosition: Vector3 | null;
  threatVisible: boolean;
  threatMemoryAge: number;
  squadRole: SquadRole | null;
  coverId: string | null;
  tacticalTarget: Vector3 | null;
  stuckReason?: string | null;
}

export interface NpcBrainSnapshot {
  schedule: NpcScheduleId;
  previousSchedule: NpcScheduleId | null;
  scheduleElapsed: number;
  task: NpcTaskRuntimeSnapshot["task"];
  taskIndex: number;
  activeConditions: NpcCondition[];
  threat: {
    id: string | null;
    visibleNow: boolean;
    memoryAge: number;
    lastKnownPosition: Vector3 | null;
  };
  squadRole: SquadRole | null;
  tacticalTarget: Vector3 | null;
  coverId: string | null;
  stuckReason: string | null;
}

export class NpcBrainRuntime {
  private readonly conditions = new NpcConditionSet();
  private readonly selector: NpcScheduleSelector;
  private readonly tasks = new NpcTaskRunner();
  private readonly blackboard: NpcBrainBlackboard;

  constructor(private readonly profile: CharacterAIProfile) {
    this.selector = new NpcScheduleSelector(profile);
    this.blackboard = createNpcBrainBlackboard(profile.defaultSchedule);
    const initial = profile.schedules.find((schedule) => schedule.id === profile.defaultSchedule);
    this.tasks.reset(initial?.tasks ?? []);
  }

  update(input: NpcBrainUpdateInput): NpcBrainSnapshot {
    this.conditions.replace(input.conditions);
    this.blackboard.activeConditions = this.conditions.toArray();
    this.blackboard.threat.id = input.threatId;
    this.blackboard.threat.visibleNow = input.threatVisible;
    this.blackboard.threat.age = input.threatMemoryAge;
    this.blackboard.threat.lastKnownPosition = input.threatPosition?.clone() ?? null;
    this.blackboard.squadRole = input.squadRole;
    this.blackboard.tactical.coverId = input.coverId;
    this.blackboard.tactical.tacticalTarget = input.tacticalTarget?.clone() ?? null;
    this.blackboard.tactical.stuckReason = input.stuckReason ?? null;

    const scheduleElapsed = input.elapsed - this.blackboard.scheduleSince;
    const selection = this.selector.select(
      this.conditions,
      this.blackboard.schedule,
      scheduleElapsed,
    );
    if (selection.changed) {
      this.blackboard.previousSchedule = this.blackboard.schedule;
      this.blackboard.schedule = selection.schedule.id;
      this.blackboard.scheduleSince = input.elapsed;
      this.blackboard.taskIndex = 0;
      this.tasks.reset(selection.schedule.tasks);
    }
    const task = this.tasks.tick(input.delta, selection.schedule.tasks);
    this.blackboard.taskIndex = task.taskIndex;
    return this.snapshot(input.elapsed);
  }

  getSchedule(): NpcScheduleId {
    return this.blackboard.schedule;
  }

  snapshot(elapsed = this.blackboard.scheduleSince): NpcBrainSnapshot {
    const task = this.tasks.snapshot();
    return {
      schedule: this.blackboard.schedule,
      previousSchedule: this.blackboard.previousSchedule,
      scheduleElapsed: Math.max(0, elapsed - this.blackboard.scheduleSince),
      task: task.task,
      taskIndex: task.taskIndex,
      activeConditions: [...this.blackboard.activeConditions],
      threat: {
        id: this.blackboard.threat.id,
        visibleNow: this.blackboard.threat.visibleNow,
        memoryAge: this.blackboard.threat.age,
        lastKnownPosition: this.blackboard.threat.lastKnownPosition?.clone() ?? null,
      },
      squadRole: this.blackboard.squadRole,
      tacticalTarget: this.blackboard.tactical.tacticalTarget?.clone() ?? null,
      coverId: this.blackboard.tactical.coverId,
      stuckReason: this.blackboard.tactical.stuckReason,
    };
  }
}
