import type { ScheduleDefinition } from '@engine/ai/brain/Task';
import type { NpcBrainContext } from '@game/npc/brain/NpcBrainContext';
import { condMask } from '@game/npc/brain/NpcConditions';
import {
  createMoveToThreatTask,
  createWaitTask,
  FaceThreatTask,
  FireBurstTask,
} from '@game/npc/brain/tasks/CoreTasks';
import { createLeapTask } from '@game/npc/brain/tasks/CreatureTasks';
import {
  deadSchedule,
  hitSchedule,
  idleSchedule,
  investigateCombatSchedule,
  investigateSuspiciousSchedule,
  searchLastKnownSchedule,
} from './commonSchedules';
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
    deadSchedule(),
    hitSchedule(0.25, 'stagger'),
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
    searchLastKnownSchedule(0.8),
    investigateCombatSchedule(0.8),
    investigateSuspiciousSchedule(1.2),
    idleSchedule(1.0),
  ];

  return {
    id: 'headcrab',
    usesCover: false,
    usesSquad: false,
    perception: {
      visionRange: 16,
      visionConeRadians: (120 * Math.PI) / 180,
      hearingRadius: 20,
      memoryTime: 6,
      eyeHeight: 0.4,
    },
    maxHealth: 10,
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
