import type { ScheduleDefinition } from '@engine/ai/brain/Task';
import type { NpcBrainContext } from '@game/npc/brain/NpcBrainContext';
import { condMask, type CondKey } from '@game/npc/brain/NpcConditions';
import {
  createAimTask,
  createMoveIntoRangeTask,
  createWaitTask,
  FaceThreatTask,
  FireBurstTask,
} from '@game/npc/brain/tasks/CoreTasks';
import {
  createFlankTask,
  createMoveToCoverTask,
  createPeekFireCycleTask,
  createRepositionTask,
  createRetreatTask,
} from '@game/npc/brain/tasks/TacticalTasks';
import { createOverwatchTask, createThrowGrenadeTask } from '@game/npc/brain/tasks/SquadTasks';
import {
  DEFAULT_ALERT_CONDS,
  deadSchedule,
  hitSchedule,
  idleSchedule,
  investigateCombatSchedule,
  investigateSuspiciousSchedule,
  noticeSuspicionSchedule,
  patrolSchedule,
  reloadSchedules,
  scriptedSchedules,
  searchLastKnownSchedule,
  vehicleApproachSchedule,
} from './commonSchedules';
import type { NpcPreset, NpcPresetOptions } from './NpcPreset';

/**
 * Preset del soldado Combine.
 *
 * El "ciclo HL2" emerge de los schedules: engage (face → aim → burst →
 * reposicion lateral) hace que avancen y se muevan mientras disparan;
 * retreat se activa con vida baja SOLO si esta solo (`AlliesNear` lo
 * bloquea → con squad pelean mas agresivo); al perder LOS buscan la LKP y
 * al oir combate lejano van a investigar. Cover y flank se suman en los
 * schedules tacticos (fases cover/squad) sin tocar estos.
 */
const COMBINE_ALERT_CONDS: readonly CondKey[] = [...DEFAULT_ALERT_CONDS, 'MagazineEmpty'];

export function buildCombinePreset(options: NpcPresetOptions = {}): NpcPreset {
  const flinch = options.flinch ?? { duration: 0.18, cooldown: 1.5 };
  const schedules: ScheduleDefinition<NpcBrainContext>[] = [
    deadSchedule(),
    ...scriptedSchedules(),
    hitSchedule(flinch.duration),
    vehicleApproachSchedule(),
    {
      id: 'retreat',
      priority: 850,
      required: condMask('LowHealth', 'SeeEnemy'),
      blockedBy: condMask('IsDead', 'AlliesNear'),
      interrupts: condMask('EnemyDead'),
      tasks: [createRetreatTask(), createWaitTask(0.4)],
    },
    ...reloadSchedules({ blockInMelee: true }),
    {
      // El ciclo cubrirse → asomarse → rafaga. `SquadOnPoint` lo bloquea:
      // los roles de empuje del squad pelean en el abierto via engage.
      id: 'takeCover',
      priority: 640,
      required: condMask('SeeEnemy', 'CoverAvailable', 'HasAttackSlot'),
      blockedBy: condMask(
        'IsDead',
        'MagazineEmpty',
        'SquadOnPoint',
        'SquadFlankAvailable',
        'EnemyInMeleeRange',
        'TooFarToShoot',
      ),
      interrupts: condMask('CoverBlown', 'EnemyTooClose', 'EnemyDead', 'MagazineEmpty'),
      tasks: [createMoveToCoverTask(), createPeekFireCycleTask()],
    },
    {
      // El flanker corre al lateral del threat; al llegar, engage retoma.
      id: 'flank',
      priority: 620,
      required: condMask('SeeEnemy', 'SquadFlankAvailable'),
      blockedBy: condMask('IsDead', 'MagazineEmpty', 'EnemyInMeleeRange', 'LowHealth'),
      interrupts: condMask('EnemyDead', 'MagazineEmpty', 'EnemyTooClose'),
      tasks: [createFlankTask()],
    },
    {
      id: 'engage',
      priority: 600,
      required: condMask('SeeEnemy', 'HasAttackSlot'),
      blockedBy: condMask('IsDead', 'MagazineEmpty', 'TooFarToShoot'),
      interrupts: condMask('LostEnemy', 'EnemyDead', 'EnemyInMeleeRange', 'MagazineEmpty'),
      tasks: [
        FaceThreatTask,
        createAimTask(0.25),
        FireBurstTask,
        createRepositionTask(),
        createWaitTask(0.2),
      ],
    },
    {
      // A la vista pero fuera del rango util del arma: avanzar esprintando
      // hasta posicion de tiro en vez de tirotear al aire (estilo HL2).
      id: 'closeDistance',
      priority: 590,
      required: condMask('SeeEnemy', 'TooFarToShoot'),
      blockedBy: condMask('IsDead', 'MagazineEmpty', 'EnemyInMeleeRange'),
      interrupts: condMask('LostEnemy', 'EnemyDead', 'MagazineEmpty'),
      tasks: [createMoveIntoRangeTask()],
    },
    {
      // Sin slot de ataque (ya hay 2 companeros disparando): presiona sin
      // disparar — reposicion lateral encarando al threat. Cuando un slot se
      // libera, engage (600) lo pisa solo por prioridad.
      id: 'standby',
      priority: 580,
      required: condMask('SeeEnemy'),
      blockedBy: condMask(
        'IsDead',
        'HasAttackSlot',
        'MagazineEmpty',
        'TooFarToShoot',
        'EnemyInMeleeRange',
        'SquadFlankAvailable',
      ),
      interrupts: condMask('LostEnemy', 'EnemyDead', 'MagazineEmpty', 'EnemyInMeleeRange'),
      tasks: [createRepositionTask(3.5, 2.2), FaceThreatTask, createWaitTask(0.4)],
    },
    {
      // El target lleva un rato oculto: granada de flush-out a la LKP, estilo
      // HL2. `GrenadeReady` ya valida cooldown, banda de rango y slot libre.
      id: 'grenadeFlush',
      priority: 570,
      required: condMask('LostEnemy', 'GrenadeReady'),
      blockedBy: condMask('IsDead', 'SeeEnemy', 'EnemyInMeleeRange'),
      interrupts: condMask('SeeEnemy', 'EnemyDead'),
      tasks: [createThrowGrenadeTask(), createWaitTask(0.5)],
    },
    {
      // Un solo miembro sostiene la mira sobre la LKP mientras el resto barre
      // (searchLastKnown): si el enemigo se asoma, overwatch lo castiga.
      id: 'overwatch',
      priority: 560,
      required: condMask('LostEnemy', 'OverwatchFree'),
      blockedBy: condMask('IsDead', 'SeeEnemy', 'MagazineEmpty'),
      interrupts: condMask('SeeEnemy', 'EnemyDead', 'MagazineEmpty'),
      tasks: [createOverwatchTask()],
    },
    searchLastKnownSchedule(0.5),
    investigateCombatSchedule(0.5),
    noticeSuspicionSchedule(),
    investigateSuspiciousSchedule(0.8),
    idleSchedule(1.0, COMBINE_ALERT_CONDS),
  ];

  if (options.hasPatrol) {
    schedules.push(patrolSchedule(COMBINE_ALERT_CONDS));
  }

  return {
    id: 'combine',
    attackSlot: true,
    vehicle: { canDrive: true },
    flinch,
    callouts: {
      bySchedule: {
        flank: 'engaging',
        closeDistance: 'engaging',
        reload: 'coverme',
        reloadInCover: 'coverme',
      },
    },
    perception: {
      visionRange: 32,
      visionConeRadians: (160 * Math.PI) / 180,
      hearingRadius: 18,
      memoryTime: 8,
      eyeHeight: 0.62,
    },
    maxHealth: 50,
    radius: 0.45,
    meleeRange: 1.8,
    tooCloseRange: 3.0,
    lowHealthRatio: 0.3,
    weaponAim: 'twoHanded',
    movement: {
      walkSpeed: 5.5,
      sprintSpeed: 8.5,
      acceleration: 12,
      turnSpeed: 7,
      stepOffset: 0.45,
      snapToGround: 0.5,
      canJump: true,
    },
    schedules,
  };
}
