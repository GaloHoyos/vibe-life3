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
import { createHealAllyTask } from '@game/npc/brain/tasks/SupportTasks';
import {
  deadSchedule,
  hitSchedule,
  noticeSuspicionSchedule,
  reloadSchedules,
} from './commonSchedules';
import type { NpcMedicProfile, NpcPreset, NpcPresetOptions } from './NpcPreset';

const FOLLOW_DISTANCE = 5;
const REGROUP_DISTANCE = 16;

const MEDIC_PROFILE: NpcMedicProfile = {
  healThreshold: 0.6,
  healAmount: 40,
  castTime: 1.2,
  cooldown: 8,
  range: 18,
};

export interface RebelPresetOptions extends NpcPresetOptions {
  /** Variante medic: prioriza curar aliados (schedule `heal`). */
  medic?: boolean;
}

/**
 * Preset del rebelde aliado (citizen de HL2): el anchor manda — sigue al
 * player (o al punto ordenado por el squad del jugador) y pelea alrededor.
 * Como Alyx no caza (sin searchLastKnown/investigate), pero a diferencia de
 * ella respeta la disciplina de slots de ataque de su faccion: con varios
 * rebeldes solo dos disparan a la vez, el resto reposiciona cubriendo. Fuera
 * del rango del arma sostiene la mira sin gastar municion (guard del
 * FireBurstTask) en vez de perseguir lejos del player.
 */
export function buildRebelPreset(options: RebelPresetOptions = {}): NpcPreset {
  const flinch = options.flinch ?? { duration: 0.18, cooldown: 1.2 };
  const schedules: ScheduleDefinition<NpcBrainContext>[] = [
    deadSchedule(),
    hitSchedule(flinch.duration),
    ...reloadSchedules(),
    {
      id: 'regroup',
      priority: 750,
      required: condMask('AnchorFar'),
      blockedBy: condMask('IsDead'),
      interrupts: NO_CONDITIONS,
      tasks: [createRegroupTask(FOLLOW_DISTANCE)],
    },
    ...(options.medic
      ? [
          {
            // Curar manda sobre pelear (700 > engage 600): el medic corre al
            // aliado herido incluso bajo fuego; solo el regroup (750) lo pisa.
            id: 'heal',
            priority: 700,
            required: condMask('AllyNeedsHealing'),
            blockedBy: condMask('IsDead', 'EnemyInMeleeRange'),
            interrupts: condMask('EnemyInMeleeRange'),
            tasks: [createHealAllyTask(MEDIC_PROFILE.castTime), createWaitTask(0.4)],
          } satisfies ScheduleDefinition<NpcBrainContext>,
        ]
      : []),
    {
      id: 'takeCover',
      priority: 640,
      required: condMask('LowHealth', 'SeeEnemy', 'CoverAvailable', 'HasAttackSlot'),
      blockedBy: condMask('IsDead', 'MagazineEmpty'),
      interrupts: condMask('CoverBlown', 'EnemyDead', 'MagazineEmpty', 'AnchorFar'),
      tasks: [createMoveToCoverTask(), createPeekFireCycleTask(2)],
    },
    {
      id: 'engage',
      priority: 600,
      required: condMask('SeeEnemy', 'HasAttackSlot'),
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
    {
      // Sin slot de ataque: presencia activa — reposiciona encarando mientras
      // los dos con slot disparan.
      id: 'standby',
      priority: 580,
      required: condMask('SeeEnemy'),
      blockedBy: condMask('IsDead', 'HasAttackSlot', 'MagazineEmpty', 'EnemyInMeleeRange'),
      interrupts: condMask('LostEnemy', 'EnemyDead', 'MagazineEmpty', 'AnchorFar'),
      tasks: [createRepositionTask(3.0, 2.0), FaceThreatTask, createWaitTask(0.4)],
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
    id: options.medic ? 'rebelMedic' : 'rebel',
    attackSlot: true,
    playerSquad: true,
    flinch,
    ...(options.medic ? { medic: MEDIC_PROFILE } : {}),
    perception: {
      visionRange: 26,
      visionConeRadians: (130 * Math.PI) / 180,
      hearingRadius: 16,
      memoryTime: 5,
      eyeHeight: 0.62,
    },
    maxHealth: 60,
    radius: 0.35,
    meleeRange: 1.5,
    tooCloseRange: 2.0,
    lowHealthRatio: 0.35,
    weaponAim: 'twoHanded',
    anchor: {
      followDistance: FOLLOW_DISTANCE,
      regroupDistance: REGROUP_DISTANCE,
    },
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
