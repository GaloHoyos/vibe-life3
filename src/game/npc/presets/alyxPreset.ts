import type { ScheduleDefinition } from '@engine/ai/brain/Task';
import { NO_CONDITIONS } from '@engine/ai/brain/Condition';
import type { NpcBrainContext } from '@game/npc/brain/NpcBrainContext';
import { condMask } from '@game/npc/brain/NpcConditions';
import {
  createAimTask,
  createWaitTask,
  FaceThreatTask,
  FireBurstTask,
} from '@game/npc/brain/tasks/CoreTasks';
import {
  createFollowAnchorTask,
  createMoveToCoverTask,
  createPeekFireCycleTask,
  createRegroupTask,
  createRepositionTask,
} from '@game/npc/brain/tasks/TacticalTasks';
import {
  deadSchedule,
  hitSchedule,
  noticeSuspicionSchedule,
  reloadSchedules,
  scriptedSchedules,
  tacticalOrderSchedule,
  vehicleApproachSchedule,
  vehicleSeekSchedule,
} from './commonSchedules';
import type { NpcPreset } from './NpcPreset';

const FOLLOW_DISTANCE = 6;
const REGROUP_DISTANCE = 14;

/**
 * Preset de Alyx (ally): el anchor manda. Regroup (AnchorFar) pisa al
 * combate — si el player se va, ella lo sigue aunque haya tiros. No
 * persigue threats fuera de vista (sin searchLastKnown): su trabajo es
 * cubrir al player, no cazar. El guard de fuego amigo del combat handle
 * evita que dispare a traves del player.
 */
export function buildAlyxPreset(): NpcPreset {
  const schedules: ScheduleDefinition<NpcBrainContext>[] = [
    deadSchedule(),
    ...scriptedSchedules(),
    hitSchedule(0.18),
    vehicleApproachSchedule(),
    tacticalOrderSchedule(),
    vehicleSeekSchedule(),
    ...reloadSchedules(),
    {
      id: 'regroup',
      priority: 750,
      required: condMask('AnchorFar'),
      blockedBy: condMask('IsDead'),
      interrupts: NO_CONDITIONS,
      tasks: [createRegroupTask(FOLLOW_DISTANCE)],
    },
    {
      id: 'takeCover',
      priority: 640,
      required: condMask('LowHealth', 'SeeEnemy', 'CoverAvailable'),
      blockedBy: condMask('IsDead', 'MagazineEmpty'),
      interrupts: condMask('CoverBlown', 'EnemyDead', 'MagazineEmpty', 'AnchorFar'),
      tasks: [createMoveToCoverTask(), createPeekFireCycleTask(2)],
    },
    {
      id: 'engage',
      priority: 600,
      required: condMask('SeeEnemy'),
      blockedBy: condMask('IsDead', 'MagazineEmpty'),
      interrupts: condMask('LostEnemy', 'EnemyDead', 'MagazineEmpty', 'AnchorFar'),
      tasks: [
        FaceThreatTask,
        createAimTask(0.2),
        FireBurstTask,
        createRepositionTask(2.0),
        createWaitTask(0.2),
      ],
    },
    noticeSuspicionSchedule(),
    {
      id: 'follow',
      priority: 200,
      required: NO_CONDITIONS,
      blockedBy: condMask('IsDead', 'SeeEnemy', 'JustHit', 'MagazineEmpty', 'AnchorFar'),
      interrupts: condMask('SeeEnemy', 'JustHit', 'AnchorFar'),
      tasks: [createFollowAnchorTask(FOLLOW_DISTANCE)],
    },
    {
      id: 'idle',
      priority: 100,
      required: NO_CONDITIONS,
      blockedBy: condMask('IsDead'),
      interrupts: condMask('SeeEnemy', 'JustHit', 'AnchorFar'),
      tasks: [createWaitTask(1.0)],
    },
  ];

  return {
    id: 'alyx',
    perception: {
      visionRange: 28,
      visionConeRadians: (130 * Math.PI) / 180,
      hearingRadius: 16,
      memoryTime: 5,
      eyeHeight: 0.62,
    },
    maxHealth: 120,
    radius: 0.35,
    meleeRange: 1.5,
    tooCloseRange: 2.0,
    lowHealthRatio: 0.35,
    weaponAim: 'oneHanded',
    anchor: {
      followDistance: FOLLOW_DISTANCE,
      regroupDistance: REGROUP_DISTANCE,
    },
    companion: { displayName: 'Alyx' },
    vehicle: { canDrive: true },
    movement: {
      walkSpeed: 3.4,
      sprintSpeed: 6.0,
      acceleration: 16,
      turnSpeed: 10,
      stepOffset: 0.4,
      snapToGround: 0.45,
      canJump: true,
    },
    schedules,
  };
}
