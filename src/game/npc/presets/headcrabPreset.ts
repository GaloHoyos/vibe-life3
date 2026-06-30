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
import { createLeapTask } from '@game/npc/brain/tasks/CreatureTasks';
import {
  createInvestigateTask,
  createSearchSweepTask,
} from '@game/npc/brain/tasks/TacticalTasks';
import type { NpcLeapProfile, NpcPreset } from './NpcPreset';

/**
 * Salto de pounce: apex ~1.45 m sobre el lanzamiento (apex = upSpeed²/2g, g=28),
 * o sea pico ~1.85 m en mundo — a la altura de la cabeza, como su nombre. Mas
 * tiempo de vuelo => alcance ~4 m por salto.
 */
const HEADCRAB_LEAP: NpcLeapProfile = {
  windup: 0.3,
  upSpeed: 9,
  maxForwardSpeed: 6.5,
  recover: 0.5,
};

/**
 * Preset del headcrab estilo HL2: acecha y se acerca **caminando lento**, y
 * cuando entra en la banda de salto se **abalanza en parabola** sobre el player;
 * el mordisco conecta por contacto durante el vuelo (ver `createLeapTask`).
 * Point-blank muerde sin saltar. Fragil, sin armas ni cover: reusa el combat
 * melee y el `CreatureAnimator` (no es humanoide).
 */
export function buildHeadcrabPreset(): NpcPreset {
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
      id: 'stagger',
      priority: 900,
      required: condMask('JustHit'),
      blockedBy: condMask('IsDead'),
      interrupts: NO_CONDITIONS,
      tasks: [createFlinchTask(0.25)],
    },
    {
      // Prioridad sobre el melee point-blank: una vez en el aire, el salto no se
      // corta aunque el cuerpo cruce a rango melee (el schedule corre hasta
      // aterrizar). El daño igual conecta por la ventana abierta al lanzarse.
      id: 'leapAttack',
      priority: 760,
      required: condMask('SeeEnemy', 'EnemyInLeapRange'),
      blockedBy: condMask('IsDead'),
      interrupts: condMask('EnemyDead'),
      tasks: [createLeapTask(HEADCRAB_LEAP), createWaitTask(HEADCRAB_LEAP.recover)],
    },
    {
      id: 'meleeAttack',
      priority: 720,
      required: condMask('EnemyInMeleeRange'),
      blockedBy: condMask('IsDead'),
      interrupts: condMask('EnemyDead'),
      tasks: [FaceThreatTask, FireBurstTask, createWaitTask(0.45)],
    },
    {
      id: 'chase',
      priority: 600,
      required: condMask('SeeEnemy'),
      blockedBy: condMask('IsDead', 'EnemyInMeleeRange', 'EnemyInLeapRange'),
      interrupts: condMask('EnemyInMeleeRange', 'EnemyInLeapRange', 'LostEnemy', 'EnemyDead'),
      tasks: [createMoveToThreatTask(1.0, 'walk')],
    },
    {
      id: 'searchLastKnown',
      priority: 500,
      required: condMask('LostEnemy'),
      blockedBy: condMask('IsDead', 'SeeEnemy'),
      interrupts: condMask('SeeEnemy', 'EnemyDead'),
      tasks: [createSearchSweepTask(), createWaitTask(0.8)],
    },
    {
      id: 'investigateCombat',
      priority: 320,
      required: condMask('HeardCombat'),
      blockedBy: condMask('IsDead', 'SeeEnemy', 'LostEnemy'),
      interrupts: condMask('SeeEnemy', 'LostEnemy'),
      tasks: [createInvestigateTask(), createWaitTask(0.8)],
    },
    {
      id: 'investigateSuspicious',
      priority: 300,
      required: condMask('HeardSuspicious'),
      blockedBy: condMask('IsDead', 'SeeEnemy', 'LostEnemy', 'HeardCombat'),
      interrupts: condMask('SeeEnemy', 'LostEnemy', 'HeardCombat'),
      tasks: [createInvestigateTask(), createWaitTask(1.2)],
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
      tasks: [createWaitTask(1.0)],
    },
  ];

  return {
    id: 'headcrab',
    perception: {
      visionRange: 16,
      visionConeRadians: (120 * Math.PI) / 180,
      hearingRadius: 20,
      memoryTime: 6,
      eyeHeight: 0.4,
    },
    maxHealth: 30,
    radius: 0.3,
    meleeRange: 1.0,
    leapRange: 4.5,
    leap: HEADCRAB_LEAP,
    tooCloseRange: 0,
    lowHealthRatio: 0,
    weaponAim: 'none',
    movement: {
      // Acercamiento lento (acecho); el salto cubre la distancia, no el caminar.
      walkSpeed: 1.7,
      sprintSpeed: 5.2,
      acceleration: 16,
      turnSpeed: 9,
      stepOffset: 0.4,
      snapToGround: 0.45,
      canJump: false,
    },
    schedules,
  };
}
