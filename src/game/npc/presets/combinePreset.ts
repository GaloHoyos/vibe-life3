import type { ScheduleDefinition } from '@engine/ai/brain/Task';
import { NO_CONDITIONS } from '@engine/ai/brain/Condition';
import type { NpcBrainContext } from '@game/npc/brain/NpcBrainContext';
import { condMask } from '@game/npc/brain/NpcConditions';
import {
  createAimTask,
  createFlinchTask,
  createWaitTask,
  FaceThreatTask,
  FireBurstTask,
  PlayDeathTask,
  ReloadWeaponTask,
} from '@game/npc/brain/tasks/CoreTasks';
import {
  createFlankTask,
  createInvestigateTask,
  createMoveToCoverTask,
  createPatrolTask,
  createPeekFireCycleTask,
  createRepositionTask,
  createRetreatTask,
  createSearchSweepTask,
} from '@game/npc/brain/tasks/TacticalTasks';
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
export function buildCombinePreset(options: NpcPresetOptions = {}): NpcPreset {
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
      id: 'hit',
      priority: 900,
      required: condMask('JustHit'),
      blockedBy: condMask('IsDead'),
      interrupts: NO_CONDITIONS,
      tasks: [createFlinchTask(0.18)],
    },
    {
      id: 'retreat',
      priority: 850,
      required: condMask('LowHealth', 'SeeEnemy'),
      blockedBy: condMask('IsDead', 'AlliesNear'),
      interrupts: condMask('EnemyDead'),
      tasks: [createRetreatTask(), createWaitTask(0.4)],
    },
    {
      // Con cover a mano, recargar cubierto en vez de parado a la vista.
      id: 'reloadInCover',
      priority: 810,
      required: condMask('MagazineEmpty', 'CoverAvailable'),
      blockedBy: condMask('IsDead', 'EnemyInMeleeRange'),
      interrupts: NO_CONDITIONS,
      tasks: [createMoveToCoverTask(), ReloadWeaponTask],
    },
    {
      id: 'reload',
      priority: 800,
      required: condMask('MagazineEmpty'),
      blockedBy: condMask('IsDead', 'EnemyInMeleeRange'),
      interrupts: NO_CONDITIONS,
      tasks: [ReloadWeaponTask],
    },
    {
      // El ciclo cubrirse → asomarse → rafaga. `SquadOnPoint` lo bloquea:
      // los roles de empuje del squad pelean en el abierto via engage.
      id: 'takeCover',
      priority: 640,
      required: condMask('SeeEnemy', 'CoverAvailable'),
      blockedBy: condMask(
        'IsDead',
        'MagazineEmpty',
        'SquadOnPoint',
        'SquadFlankAvailable',
        'EnemyInMeleeRange',
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
      required: condMask('SeeEnemy'),
      blockedBy: condMask('IsDead', 'MagazineEmpty'),
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
      id: 'searchLastKnown',
      priority: 500,
      required: condMask('LostEnemy'),
      blockedBy: condMask('IsDead', 'SeeEnemy'),
      interrupts: condMask('SeeEnemy', 'EnemyDead'),
      tasks: [createSearchSweepTask(), createWaitTask(0.5)],
    },
    {
      id: 'investigateCombat',
      priority: 320,
      required: condMask('HeardCombat'),
      blockedBy: condMask('IsDead', 'SeeEnemy', 'LostEnemy'),
      interrupts: condMask('SeeEnemy', 'LostEnemy'),
      tasks: [createInvestigateTask(), createWaitTask(0.5)],
    },
    {
      id: 'investigateSuspicious',
      priority: 300,
      required: condMask('HeardSuspicious'),
      blockedBy: condMask('IsDead', 'SeeEnemy', 'LostEnemy', 'HeardCombat'),
      interrupts: condMask('SeeEnemy', 'LostEnemy', 'HeardCombat'),
      tasks: [createInvestigateTask(), createWaitTask(0.8)],
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
        'MagazineEmpty',
        'HeardCombat',
        'HeardSuspicious',
      ),
      interrupts: condMask('SeeEnemy', 'LostEnemy', 'JustHit', 'HeardCombat', 'HeardSuspicious'),
      tasks: [createWaitTask(1.0)],
    },
  ];

  if (options.hasPatrol) {
    schedules.push({
      id: 'patrol',
      priority: 150,
      required: NO_CONDITIONS,
      blockedBy: condMask(
        'IsDead',
        'SeeEnemy',
        'LostEnemy',
        'JustHit',
        'MagazineEmpty',
        'HeardCombat',
        'HeardSuspicious',
      ),
      interrupts: condMask('SeeEnemy', 'LostEnemy', 'JustHit', 'HeardCombat', 'HeardSuspicious'),
      tasks: [createPatrolTask()],
    });
  }

  return {
    id: 'combine',
    perception: {
      visionRange: 32,
      visionConeRadians: (160 * Math.PI) / 180,
      hearingRadius: 18,
      memoryTime: 8,
      eyeHeight: 1.6,
    },
    maxHealth: 100,
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
