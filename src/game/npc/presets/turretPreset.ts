import type { ScheduleDefinition } from "@engine/ai/brain/Task";
import { NO_CONDITIONS } from "@engine/ai/brain/Condition";
import type { NpcBrainContext } from "@game/npc/brain/NpcBrainContext";
import { condMask } from "@game/npc/brain/NpcConditions";
import { createWaitTask, PlayDeathTask } from "@game/npc/brain/tasks/CoreTasks";
import {
  createTurretEngageTask,
  createTurretScanTask,
  TurretTippedTask,
} from "@game/npc/brain/tasks/TurretTasks";
import type { NpcPreset } from "./NpcPreset";

/**
 * Preset de la torreta de piso estilo HL2 (`npc_turret_floor`). No navega ni
 * decide táctica: es un sensor + ametralladora montada sobre un trípode físico.
 * El estado dormida/deploy/active/retract y el thrash al volcarse los maneja el
 * `TurretCombat` + el `StationaryDynamicMotor`; el brain sólo selecciona entre
 * engage (ve al threat), scan (lo perdió → barre buscando unos segundos sin
 * disparar y luego se desactiva), tipped (volcada) e idle (dormida). Cono de
 * visión angosto: se la puede flanquear.
 */
export function buildTurretPreset(): NpcPreset {
  const schedules: ScheduleDefinition<NpcBrainContext>[] = [
    {
      id: "dead",
      priority: 1000,
      required: condMask("IsDead"),
      blockedBy: NO_CONDITIONS,
      interrupts: NO_CONDITIONS,
      tasks: [PlayDeathTask],
    },
    {
      id: "tipped",
      priority: 950,
      required: condMask("Tipped"),
      blockedBy: condMask("IsDead"),
      interrupts: NO_CONDITIONS,
      tasks: [TurretTippedTask],
    },
    {
      id: "engage",
      priority: 600,
      required: condMask("SeeEnemy"),
      blockedBy: condMask("IsDead", "Tipped"),
      interrupts: condMask("LostEnemy", "EnemyDead", "Tipped"),
      tasks: [createTurretEngageTask()],
    },
    {
      id: "scan",
      priority: 500,
      required: condMask("LostEnemy"),
      blockedBy: condMask("IsDead", "Tipped", "SeeEnemy"),
      interrupts: condMask("SeeEnemy", "EnemyDead", "Tipped"),
      tasks: [createTurretScanTask()],
    },
    {
      id: "idle",
      priority: 100,
      required: NO_CONDITIONS,
      blockedBy: condMask("IsDead", "Tipped", "SeeEnemy", "LostEnemy"),
      interrupts: condMask("SeeEnemy", "LostEnemy", "Tipped"),
      tasks: [createWaitTask(1.0)],
    },
  ];

  return {
    id: "floorTurret",
    usesCover: false,
    usesSquad: false,
    perception: {
      visionRange: 28,
      visionConeRadians: (75 * Math.PI) / 180,
      hearingRadius: 0,
      memoryTime: 3,
      // Debe quedar fuera del collider (box ~1.2 alto, semialto 0.6): el LOS de
      // perception es un raycast solid sin exclusión del self → origen adentro se
      // auto-impacta (mismo gotcha del manhack). El cañon real dispara desde más
      // abajo, pero ese raycast sí excluye el propio cuerpo.
      eyeHeight: 0.7,
    },
    maxHealth: 100000, // balas casi inefectivas — la derrota es física (tumbarla)
    radius: 0.3,
    meleeRange: 0,
    tooCloseRange: 0,
    lowHealthRatio: 0,
    weaponAim: "none",
    movement: {
      // Estacionaria: el motor ignora estos valores (no se auto-propulsa). Se dejan
      // en 1 para no dividir por cero en `applyGait` si algún día se la moviera.
      walkSpeed: 1,
      sprintSpeed: 1,
      acceleration: 0,
      turnSpeed: 0,
      stepOffset: 0,
      snapToGround: 0,
      canJump: false,
    },
    schedules,
  };
}
