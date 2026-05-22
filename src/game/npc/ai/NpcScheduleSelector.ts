import type { CharacterAIProfile } from "./CharacterAIProfile";
import type { NpcConditionSet } from "./NpcConditionSet";
import {
  DEFAULT_SCHEDULE_HOLD_SECONDS,
  scheduleCanRun,
  type NpcScheduleDefinition,
  type NpcScheduleId,
} from "./NpcSchedules";

export interface NpcScheduleSelection {
  schedule: NpcScheduleDefinition;
  changed: boolean;
}

export class NpcScheduleSelector {
  constructor(private readonly profile: CharacterAIProfile) {}

  select(
    conditions: NpcConditionSet,
    currentScheduleId: NpcScheduleId,
    timeInSchedule: number,
  ): NpcScheduleSelection {
    const current = this.profile.schedules.find((schedule) => schedule.id === currentScheduleId);
    const holdSeconds = current?.minHoldSeconds ?? DEFAULT_SCHEDULE_HOLD_SECONDS;
    const currentCanRun =
      current !== undefined &&
      scheduleCanRun(current, (condition) => conditions.has(condition));

    let best: NpcScheduleDefinition | null = null;
    for (const schedule of this.profile.schedules) {
      if (!scheduleCanRun(schedule, (condition) => conditions.has(condition))) {
        continue;
      }
      if (!best || schedule.priority > best.priority) {
        best = schedule;
      }
    }

    best ??= this.profile.schedules.find((schedule) => schedule.id === this.profile.defaultSchedule) ?? current ?? this.profile.schedules[0];

    if (
      current &&
      currentCanRun &&
      best.id !== current.id &&
      best.priority <= current.priority + 80 &&
      timeInSchedule < holdSeconds
    ) {
      return { schedule: current, changed: false };
    }

    return { schedule: best, changed: best.id !== currentScheduleId };
  }
}
