import type { ScheduleDefinition } from '@engine/ai/brain/Task';
import { NO_CONDITIONS } from '@engine/ai/brain/Condition';
import type { NpcBrainContext } from '@game/npc/brain/NpcBrainContext';
import { condMask } from '@game/npc/brain/NpcConditions';
import {
  createWaitTask,
  PlayDeathTask,
} from '@game/npc/brain/tasks/CoreTasks';
import { createFlyerPursuitTask } from '@game/npc/brain/tasks/CreatureTasks';
import {
  createInvestigateTask,
  createSearchSweepTask,
} from '@game/npc/brain/tasks/TacticalTasks';
import type { NpcPreset } from './NpcPreset';

/**
 * Preset del manhack: cuchilla voladora poseida por la IA, estilo HL2. No frena
 * nunca: persigue al player en linea directa (`flyerPursuit`) y el `DynamicFlyerMotor`
 * lo maneja como cuerpo fisico — se estrella contra paredes/props/otros manhacks,
 * rebota torpe (bump) y vuelve, y corta por contacto (slice). El daño es del
 * motor, no del combat del brain. Fragil, sin flinch. Usa el `CreatureAnimator`.
 */
export function buildManhackPreset(): NpcPreset {
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
      // Persecucion continua: vuela directo al player. El slice por contacto y el
      // bump contra todo lo maneja el motor (no frena, no muerde por brain).
      id: 'chargeAttack',
      priority: 700,
      required: condMask('SeeEnemy'),
      blockedBy: condMask('IsDead'),
      interrupts: condMask('LostEnemy', 'EnemyDead'),
      tasks: [createFlyerPursuitTask('sprint')],
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
      id: 'idle',
      priority: 100,
      required: NO_CONDITIONS,
      blockedBy: condMask('IsDead', 'SeeEnemy', 'LostEnemy', 'HeardCombat'),
      interrupts: condMask('SeeEnemy', 'LostEnemy', 'HeardCombat'),
      tasks: [createWaitTask(1.0)],
    },
  ];

  return {
    id: 'manhack',
    perception: {
      visionRange: 24,
      visionConeRadians: (150 * Math.PI) / 180,
      hearingRadius: 16,
      memoryTime: 6,
      // El "ojo" debe quedar fuera de la capsula (radio 0.3): el LOS es un
      // raycast solid y un origen dentro del propio collider se auto-impacta.
      eyeHeight: 0.45,
    },
    maxHealth: 25,
    radius: 0.3,
    meleeRange: 1.6,
    tooCloseRange: 0,
    lowHealthRatio: 0,
    weaponAim: 'none',
    movement: {
      // maxSpeed del motor (la factory usa walkSpeed). Rapido pero con inercia.
      walkSpeed: 6.5,
      sprintSpeed: 6.5,
      // `acceleration` = lambda del steering. Moderado => arrastra inercia, se
      // pasa de largo y se estrella (torpe). El bump/tumble los maneja el motor.
      acceleration: 5,
      turnSpeed: 6,
      stepOffset: 0,
      snapToGround: 0,
      canJump: false,
      flying: true,
      // Acosa a la altura de la cabeza/torso del player (dentro de la capsula),
      // no flotando por encima — asi la cuchilla conecta de verdad.
      hoverHeight: 0.45,
    },
    schedules,
  };
}
