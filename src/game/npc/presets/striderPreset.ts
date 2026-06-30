import type { ScheduleDefinition } from "@engine/ai/brain/Task";
import { NO_CONDITIONS } from "@engine/ai/brain/Condition";
import type { NpcBrainContext } from "@game/npc/brain/NpcBrainContext";
import { condMask } from "@game/npc/brain/NpcConditions";
import { PlayDeathTask } from "@game/npc/brain/tasks/CoreTasks";
import {
  createStriderCloseTask,
  createStriderEngageTask,
  createStriderPatrolTask,
  createStriderSearchTask,
  StriderIdleTask,
} from "@game/npc/brain/tasks/StriderTasks";
import type { NpcPreset, NpcPresetOptions } from "./NpcPreset";

export function buildStriderPreset(options: NpcPresetOptions = {}): NpcPreset {
  const schedules: ScheduleDefinition<NpcBrainContext>[] = [
    {
      id: "dead",
      priority: 1000,
      required: condMask("IsDead"),
      blockedBy: NO_CONDITIONS,
      interrupts: NO_CONDITIONS,
      tasks: [PlayDeathTask],
    },
    {
      id: "stompClose",
      priority: 780,
      required: condMask("SeeEnemy", "EnemyTooClose"),
      blockedBy: condMask("IsDead"),
      interrupts: condMask("LostEnemy", "EnemyDead"),
      tasks: [createStriderCloseTask()],
    },
    {
      id: "engage",
      priority: 700,
      required: condMask("SeeEnemy"),
      blockedBy: condMask("IsDead"),
      interrupts: condMask("LostEnemy", "EnemyDead", "EnemyTooClose"),
      tasks: [createStriderEngageTask()],
    },
    {
      id: "searchLastKnown",
      priority: 500,
      required: condMask("LostEnemy"),
      blockedBy: condMask("IsDead", "SeeEnemy"),
      interrupts: condMask("SeeEnemy", "EnemyDead"),
      tasks: [createStriderSearchTask()],
    },
    {
      id: "idle",
      priority: 100,
      required: NO_CONDITIONS,
      blockedBy: condMask("IsDead", "SeeEnemy", "LostEnemy"),
      interrupts: condMask("SeeEnemy", "LostEnemy"),
      tasks: [StriderIdleTask],
    },
  ];

  if (options.hasPatrol) {
    schedules.push({
      id: "patrol",
      priority: 150,
      required: NO_CONDITIONS,
      blockedBy: condMask("IsDead", "SeeEnemy", "LostEnemy"),
      interrupts: condMask("SeeEnemy", "LostEnemy"),
      tasks: [createStriderPatrolTask()],
    });
  }

  return {
    id: "strider",
    perception: {
      visionRange: 85,
      visionConeRadians: Math.PI,
      hearingRadius: 38,
      memoryTime: 8,
      eyeHeight: 1.6,
    },
    maxHealth: 1500,
    radius: 1.35,
    meleeRange: 6,
    tooCloseRange: 6,
    lowHealthRatio: 0,
    weaponAim: "none",
    movement: {
      walkSpeed: 4.6,
      sprintSpeed: 6.2,
      acceleration: 3.2,
      turnSpeed: 1.45,
      stepOffset: 0,
      snapToGround: 0,
      canJump: false,
      directGround: true,
    },
    schedules,
  };
}
