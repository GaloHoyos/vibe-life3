import { Vector3 } from "three";
import type { NpcCondition } from "./NpcConditionSet";
import type { NpcScheduleId } from "./NpcSchedules";
import type { SquadRole } from "./SquadDirector";

export interface NpcThreatMemory {
  id: string | null;
  lastKnownPosition: Vector3 | null;
  visibleNow: boolean;
  age: number;
}

export interface NpcTacticalMemory {
  coverId: string | null;
  tacticalTarget: Vector3 | null;
  lastNoCoverAt: number;
  noCoverUntil: number;
  lastPathFailureAt: number;
  stuckReason: string | null;
}

export interface NpcBrainBlackboard {
  schedule: NpcScheduleId;
  previousSchedule: NpcScheduleId | null;
  scheduleSince: number;
  taskIndex: number;
  activeConditions: NpcCondition[];
  threat: NpcThreatMemory;
  squadRole: SquadRole | null;
  tactical: NpcTacticalMemory;
}

export function createNpcBrainBlackboard(initialSchedule: NpcScheduleId): NpcBrainBlackboard {
  return {
    schedule: initialSchedule,
    previousSchedule: null,
    scheduleSince: 0,
    taskIndex: 0,
    activeConditions: [],
    threat: {
      id: null,
      lastKnownPosition: null,
      visibleNow: false,
      age: Infinity,
    },
    squadRole: null,
    tactical: {
      coverId: null,
      tacticalTarget: null,
      lastNoCoverAt: -Infinity,
      noCoverUntil: -Infinity,
      lastPathFailureAt: -Infinity,
      stuckReason: null,
    },
  };
}
