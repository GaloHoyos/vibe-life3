import type { ScheduleDefinition } from '@engine/ai/brain/Task';
import type { NpcBrainContext } from '@game/npc/brain/NpcBrainContext';
import { condMask, type CondKey } from '@game/npc/brain/NpcConditions';
import { createFlyerPursuitTask } from '@game/npc/brain/tasks/CreatureTasks';
import {
  deadSchedule,
  idleSchedule,
  investigateCombatSchedule,
  searchLastKnownSchedule,
} from './commonSchedules';
import type { NpcPreset } from './NpcPreset';

/**
 * Preset del manhack: cuchilla voladora poseida por la IA, estilo HL2. No frena
 * nunca: persigue al player en linea directa (`flyerPursuit`) y el `DynamicFlyerMotor`
 * lo maneja como cuerpo fisico — se estrella contra paredes/props/otros manhacks,
 * rebota torpe (bump) y vuelve, y corta por contacto (slice). El daño es del
 * motor, no del combat del brain. Fragil, sin flinch. Usa el `CreatureAnimator`.
 */
const MANHACK_ALERT_CONDS: readonly CondKey[] = ['SeeEnemy', 'LostEnemy', 'HeardCombat'];

export function buildManhackPreset(): NpcPreset {
  const schedules: ScheduleDefinition<NpcBrainContext>[] = [
    deadSchedule(),
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
    searchLastKnownSchedule(0.8),
    investigateCombatSchedule(0.8),
    idleSchedule(1.0, MANHACK_ALERT_CONDS),
  ];

  return {
    id: 'manhack',
    usesCover: false,
    usesSquad: false,
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
