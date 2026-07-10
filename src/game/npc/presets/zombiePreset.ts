import type { ScheduleDefinition } from '@engine/ai/brain/Task';
import { NO_CONDITIONS } from '@engine/ai/brain/Condition';
import type { NpcBrainContext } from '@game/npc/brain/NpcBrainContext';
import { condMask } from '@game/npc/brain/NpcConditions';
import {
  createMoveToThreatTask,
  createWaitTask,
  FaceThreatTask,
  FireBurstTask,
} from '@game/npc/brain/tasks/CoreTasks';
import { createWanderTask } from '@game/npc/brain/tasks/TacticalTasks';
import {
  DEFAULT_ALERT_CONDS,
  deadSchedule,
  hitSchedule,
  idleSchedule,
  investigateCombatSchedule,
  investigateSuspiciousSchedule,
  searchLastKnownSchedule,
} from './commonSchedules';
import type { NpcPreset } from './NpcPreset';

/**
 * Preset del zombie: depredador de oido. Vision corta y angosta pero oye
 * todo — el loop tipico es oir un disparo lejano, arrastrarse a investigar,
 * ver al player y cargar. Sin cover, sin retreat, sin armas: el balance FSM
 * del arquetipo viejo se reemplaza por el schedule `stagger` (flinch largo)
 * + las hit reactions del animation bridge.
 */
export function buildZombiePreset(): NpcPreset {
  const schedules: ScheduleDefinition<NpcBrainContext>[] = [
    deadSchedule(),
    // Flinch largo: cada impacto corta el avance, el ritmo HL2 de frenar
    // zombies a tiros.
    hitSchedule(0.45, 'stagger'),
    {
      id: 'meleeAttack',
      priority: 700,
      required: condMask('EnemyInMeleeRange'),
      blockedBy: condMask('IsDead'),
      interrupts: condMask('EnemyDead'),
      tasks: [FaceThreatTask, FireBurstTask, createWaitTask(0.7)],
    },
    {
      id: 'chase',
      priority: 600,
      required: condMask('SeeEnemy'),
      blockedBy: condMask('IsDead', 'EnemyInMeleeRange'),
      interrupts: condMask('EnemyInMeleeRange', 'LostEnemy', 'EnemyDead'),
      tasks: [createMoveToThreatTask(1.4, 'sprint')],
    },
    searchLastKnownSchedule(1.0),
    investigateCombatSchedule(1.0),
    investigateSuspiciousSchedule(1.5),
    {
      // Deambular sin estimulos (no quedarse estatua): siempre gana sobre
      // idle (120 > 100), que queda de fallback puro.
      id: 'wander',
      priority: 120,
      required: NO_CONDITIONS,
      blockedBy: condMask('IsDead', ...DEFAULT_ALERT_CONDS),
      interrupts: condMask(...DEFAULT_ALERT_CONDS),
      tasks: [createWanderTask()],
    },
    idleSchedule(1.4),
  ];

  return {
    id: 'zombie',
    usesCover: false,
    usesSquad: false,
    perception: {
      visionRange: 14,
      visionConeRadians: (100 * Math.PI) / 180,
      hearingRadius: 25,
      memoryTime: 10,
      eyeHeight: 0.62,
    },
    maxHealth: 50,
    radius: 0.35,
    meleeRange: 1.6,
    tooCloseRange: 0,
    lowHealthRatio: 0,
    weaponAim: 'none',
    movement: {
      walkSpeed: 1.4,
      sprintSpeed: 2.8,
      acceleration: 8,
      turnSpeed: 5,
      stepOffset: 0.4,
      snapToGround: 0.45,
      canJump: false,
    },
    schedules,
  };
}
