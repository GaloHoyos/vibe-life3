import type { ScheduleDefinition } from '@engine/ai/brain/Task';
import type { NpcBrainContext } from '@game/npc/brain/NpcBrainContext';
import { deadSchedule, hitSchedule, idleSchedule, scriptedSchedules } from './commonSchedules';
import type { NpcPreset } from './NpcPreset';

/**
 * Humanoide pasivo (civil desarmado): no combate, no persigue, no investiga.
 * Existia el `aiProfileId: 'passiveHumanoid'` pero sin case en la factory caia
 * al preset combine (soldado completo).
 */
export function buildPassivePreset(): NpcPreset {
  const schedules: ScheduleDefinition<NpcBrainContext>[] = [
    deadSchedule(),
    ...scriptedSchedules(),
    hitSchedule(0.3),
    idleSchedule(1.0, ['JustHit']),
  ];

  return {
    id: 'passive',
    usesCover: false,
    usesSquad: false,
    perception: {
      visionRange: 20,
      visionConeRadians: (140 * Math.PI) / 180,
      hearingRadius: 14,
      memoryTime: 5,
      eyeHeight: 0.62,
    },
    maxHealth: 40,
    radius: 0.35,
    meleeRange: 0,
    tooCloseRange: 0,
    lowHealthRatio: 0,
    weaponAim: 'none',
    movement: {
      walkSpeed: 2.6,
      sprintSpeed: 4.5,
      acceleration: 10,
      turnSpeed: 6,
      stepOffset: 0.4,
      snapToGround: 0.45,
      canJump: false,
    },
    schedules,
  };
}
