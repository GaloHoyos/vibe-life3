import type { ScheduleDefinition } from '@engine/ai/brain/Task';
import { NO_CONDITIONS } from '@engine/ai/brain/Condition';
import type { NpcBrainContext } from '@game/npc/brain/NpcBrainContext';
import { condMask } from '@game/npc/brain/NpcConditions';
import {
  createFlinchTask,
  createMoveToThreatTask,
  createWaitTask,
  FaceThreatTask,
  FireBurstTask,
  PlayDeathTask,
} from '@game/npc/brain/tasks/CoreTasks';
import {
  createInvestigateTask,
  createSearchSweepTask,
} from '@game/npc/brain/tasks/TacticalTasks';
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
    {
      id: 'dead',
      priority: 1000,
      required: condMask('IsDead'),
      blockedBy: NO_CONDITIONS,
      interrupts: NO_CONDITIONS,
      tasks: [PlayDeathTask],
    },
    {
      // Flinch largo: cada impacto corta el avance, el ritmo HL2 de frenar
      // zombies a tiros.
      id: 'stagger',
      priority: 900,
      required: condMask('JustHit'),
      blockedBy: condMask('IsDead'),
      interrupts: NO_CONDITIONS,
      tasks: [createFlinchTask(0.45)],
    },
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
    {
      id: 'searchLastKnown',
      priority: 500,
      required: condMask('LostEnemy'),
      blockedBy: condMask('IsDead', 'SeeEnemy'),
      interrupts: condMask('SeeEnemy', 'EnemyDead'),
      tasks: [createSearchSweepTask(), createWaitTask(1.0)],
    },
    {
      id: 'investigateCombat',
      priority: 320,
      required: condMask('HeardCombat'),
      blockedBy: condMask('IsDead', 'SeeEnemy', 'LostEnemy'),
      interrupts: condMask('SeeEnemy', 'LostEnemy'),
      tasks: [createInvestigateTask(), createWaitTask(1.0)],
    },
    {
      id: 'investigateSuspicious',
      priority: 300,
      required: condMask('HeardSuspicious'),
      blockedBy: condMask('IsDead', 'SeeEnemy', 'LostEnemy', 'HeardCombat'),
      interrupts: condMask('SeeEnemy', 'LostEnemy', 'HeardCombat'),
      tasks: [createInvestigateTask(), createWaitTask(1.5)],
    },
    {
      id: 'idle',
      priority: 100,
      required: NO_CONDITIONS,
      blockedBy: condMask(
        'IsDead',
        'SeeEnemy',
        'LostEnemy',
        'JustHit',
        'HeardCombat',
        'HeardSuspicious',
      ),
      interrupts: condMask('SeeEnemy', 'LostEnemy', 'JustHit', 'HeardCombat', 'HeardSuspicious'),
      tasks: [createWaitTask(1.4)],
    },
  ];

  return {
    id: 'zombie',
    perception: {
      visionRange: 14,
      visionConeRadians: (100 * Math.PI) / 180,
      hearingRadius: 25,
      memoryTime: 10,
      eyeHeight: 1.55,
    },
    maxHealth: 100,
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
