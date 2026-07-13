import type { ScheduleDefinition } from '@engine/ai/brain/Task';
import type { NpcBrainContext } from '@game/npc/brain/NpcBrainContext';
import { condMask } from '@game/npc/brain/NpcConditions';
import { BlobConfig } from '@game/config/blob.config';
import { createMoveToThreatTask, createWaitTask } from '@game/npc/brain/tasks/CoreTasks';
import {
  deadSchedule,
  idleSchedule,
  investigateCombatSchedule,
  investigateSuspiciousSchedule,
  searchLastKnownSchedule,
} from './commonSchedules';
import type { NpcPreset } from './NpcPreset';

/**
 * Preset del blob (npc_blob de HL2:Ep3): masa amorfa de metaballs que persigue
 * al enemigo y lo envuelve. El daño NO sale de un schedule: `BlobContactCombat`
 * lo aplica por contacto continuo en su `tick` — `envelop` solo mete el
 * centroide adentro del target y lo mantiene cubierto. Sin `hitSchedule`: una
 * masa amorfa no flinchea (y así no se stun-lockea a tiros).
 */
export function buildBlobPreset(): NpcPreset {
  const schedules: ScheduleDefinition<NpcBrainContext>[] = [
    deadSchedule(),
    {
      id: 'envelop',
      priority: 720,
      required: condMask('EnemyInMeleeRange'),
      blockedBy: condMask('IsDead'),
      interrupts: condMask('EnemyDead'),
      tasks: [createMoveToThreatTask(0.4, 'walk'), createWaitTask(0.3)],
    },
    {
      id: 'chase',
      priority: 600,
      required: condMask('SeeEnemy'),
      blockedBy: condMask('IsDead', 'EnemyInMeleeRange'),
      interrupts: condMask('EnemyInMeleeRange', 'LostEnemy', 'EnemyDead'),
      tasks: [createMoveToThreatTask(0.9, 'sprint')],
    },
    searchLastKnownSchedule(0.8),
    investigateCombatSchedule(0.8),
    investigateSuspiciousSchedule(1.2),
    idleSchedule(1.2),
  ];

  return {
    id: 'blob',
    usesCover: false,
    usesSquad: false,
    perception: {
      visionRange: 18,
      // Sensor casi omnidireccional: el blob no tiene ojos, percibe la masa.
      visionConeRadians: Math.PI * 1.9,
      hearingRadius: 22,
      memoryTime: 8,
      eyeHeight: 0.35,
    },
    maxHealth: BlobConfig.core.maxHealth,
    radius: 0.3,
    meleeRange: BlobConfig.contact.baseRange,
    tooCloseRange: 0,
    lowHealthRatio: 0,
    weaponAim: 'none',
    movement: {
      walkSpeed: 2.6,
      sprintSpeed: 3.4,
      acceleration: 14,
      // Turn alto: el facing nunca traba la locomoción de una masa sin frente.
      turnSpeed: 12,
      stepOffset: 0.4,
      snapToGround: 0.45,
      // Jump links del navmesh headcrab: la masa puede fluir sobre muros bajos.
      canJump: true,
    },
    schedules,
  };
}
