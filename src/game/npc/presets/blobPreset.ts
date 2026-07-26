import type { ScheduleDefinition } from "@engine/ai/brain/Task";
import { BlobConfig } from "@game/config/blob.config";
import type { NpcBrainContext } from "@game/npc/brain/NpcBrainContext";
import { deadSchedule, hitSchedule, idleSchedule } from "./commonSchedules";
import type { NpcPreset } from "./NpcPreset";

/**
 * Esqueleto de IA del blob: es hostil por facción, pero no navega ni ataca.
 * Sólo espera, reacciona a impactos sobre el core y entra en muerte.
 */
export function buildBlobPreset(): NpcPreset {
  const schedules: ScheduleDefinition<NpcBrainContext>[] = [
    deadSchedule(),
    hitSchedule(0.2),
    idleSchedule(1, ["JustHit"]),
  ];

  return {
    id: "blob",
    usesCover: false,
    usesSquad: false,
    perception: {
      visionRange: 18,
      visionConeRadians: Math.PI,
      hearingRadius: 10,
      memoryTime: 2,
      eyeHeight: 0,
    },
    maxHealth: BlobConfig.core.maxHealth,
    radius: BlobConfig.armor.aggregateRadius,
    meleeRange: 0,
    tooCloseRange: 0,
    lowHealthRatio: 0,
    weaponAim: "none",
    movement: {
      // Valores nominales sanos para el runtime; el perfil de navegación
      // El motor fisico se propulsa con impulsos limitados.
      walkSpeed: BlobConfig.predator.moveSpeed,
      sprintSpeed: BlobConfig.predator.moveSpeed,
      acceleration: BlobConfig.predator.movementAcceleration,
      turnSpeed: 2,
      stepOffset: 0,
      snapToGround: 0,
      goalReachRadius: BlobConfig.predator.navigationGoalReachRadius,
      canJump: false,
    },
    schedules,
  };
}
