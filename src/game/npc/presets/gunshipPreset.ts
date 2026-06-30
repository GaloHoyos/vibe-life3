import type { ScheduleDefinition } from "@engine/ai/brain/Task";
import { NO_CONDITIONS } from "@engine/ai/brain/Condition";
import type { NpcBrainContext } from "@game/npc/brain/NpcBrainContext";
import { condMask } from "@game/npc/brain/NpcConditions";
import { PlayDeathTask } from "@game/npc/brain/tasks/CoreTasks";
import {
  createGunshipEngageTask,
  createGunshipEvadeTask,
  createGunshipPatrolTask,
  createGunshipSearchTask,
  GunshipIdleTask,
} from "@game/npc/brain/tasks/GunshipTasks";
import type { NpcPreset, NpcPresetOptions } from "./NpcPreset";

export function buildGunshipPreset(options: NpcPresetOptions = {}): NpcPreset {
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
      id: "evadeClose",
      priority: 760,
      required: condMask("SeeEnemy", "EnemyTooClose"),
      blockedBy: condMask("IsDead"),
      interrupts: condMask("LostEnemy", "EnemyDead"),
      tasks: [createGunshipEvadeTask()],
    },
    {
      id: "engage",
      priority: 700,
      required: condMask("SeeEnemy"),
      blockedBy: condMask("IsDead"),
      interrupts: condMask("LostEnemy", "EnemyDead", "EnemyTooClose"),
      tasks: [createGunshipEngageTask()],
    },
    {
      id: "searchLastKnown",
      priority: 500,
      required: condMask("LostEnemy"),
      blockedBy: condMask("IsDead", "SeeEnemy"),
      interrupts: condMask("SeeEnemy", "EnemyDead"),
      tasks: [createGunshipSearchTask()],
    },
    {
      id: "idle",
      priority: 100,
      required: NO_CONDITIONS,
      blockedBy: condMask("IsDead", "SeeEnemy", "LostEnemy"),
      interrupts: condMask("SeeEnemy", "LostEnemy"),
      tasks: [GunshipIdleTask],
    },
  ];

  if (options.hasPatrol) {
    schedules.push({
      id: "patrol",
      priority: 150,
      required: NO_CONDITIONS,
      blockedBy: condMask("IsDead", "SeeEnemy", "LostEnemy"),
      interrupts: condMask("SeeEnemy", "LostEnemy"),
      tasks: [createGunshipPatrolTask()],
    });
  }

  return {
    id: "gunship",
    perception: {
      visionRange: 55,
      visionConeRadians: Math.PI,
      hearingRadius: 28,
      memoryTime: 7,
      eyeHeight: 1.35,
    },
    maxHealth: 600,
    radius: 0.95,
    meleeRange: 0,
    tooCloseRange: 16,
    lowHealthRatio: 0,
    weaponAim: "none",
    movement: {
      walkSpeed: 8,
      sprintSpeed: 11,
      acceleration: 3.8,
      turnSpeed: 2.8,
      stepOffset: 0,
      snapToGround: 0,
      canJump: false,
      flying: true,
      hoverHeight: 0,
    },
    schedules,
  };
}
