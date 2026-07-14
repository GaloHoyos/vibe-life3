import { NO_CONDITIONS } from '@engine/ai/brain/Condition';
import type { ScheduleDefinition } from '@engine/ai/brain/Task';
import type { NpcBrainContext } from '@game/npc/brain/NpcBrainContext';
import { condMask, type CondKey } from '@game/npc/brain/NpcConditions';
import {
  createFaceSuspicionTask,
  createFlinchTask,
  createWaitTask,
  PlayDeathTask,
  ReloadWeaponTask,
} from '@game/npc/brain/tasks/CoreTasks';
import {
  createInvestigateTask,
  createMoveToCoverTask,
  createPatrolTask,
  createSearchSweepTask,
} from '@game/npc/brain/tasks/TacticalTasks';
import { createScriptMoveTask, createScriptStepsTask } from '@game/npc/brain/tasks/ScriptTasks';

type NpcSchedule = ScheduleDefinition<NpcBrainContext>;

/**
 * Bloques de schedule compartidos entre presets. Un cambio de prioridad o de
 * condiciones de estos ciclos (muerte, flinch, recarga, busqueda, idle) se
 * hace UNA vez aca; los presets solo componen y aportan lo que los distingue.
 */

/** Señales que sacan a un NPC de idle/patrol. */
export const DEFAULT_ALERT_CONDS: readonly CondKey[] = [
  'SeeEnemy',
  'LostEnemy',
  'JustHit',
  'HeardCombat',
  'HeardSuspicious',
];

/**
 * Secuencias guionadas (scripted_sequence). `scriptedOverride` (2000) es
 * ininterrumpible durante combate, pero la muerte siempre la cancela;
 * `scripted` (900) cede ante `SeeEnemy`/`JustHit`. Los mismos bits figuran en
 * `blockedBy` e `interrupts`: el Brain actual necesita elegir otro candidato
 * antes de poder ejecutar el interrupt del schedule activo.
 * Se insertan en los presets humanoides que pueden ser dirigidos por script.
 */
export function scriptedSchedules(): NpcSchedule[] {
  return [
    {
      id: 'scriptedOverride',
      priority: 2000,
      required: condMask('ScriptActive', 'ScriptUninterruptible'),
      blockedBy: condMask('IsDead'),
      interrupts: condMask('IsDead'),
      tasks: [createScriptMoveTask(), createScriptStepsTask()],
    },
    {
      id: 'scripted',
      priority: 900,
      required: condMask('ScriptActive'),
      blockedBy: condMask('IsDead', 'ScriptUninterruptible', 'SeeEnemy', 'JustHit'),
      interrupts: condMask('IsDead', 'SeeEnemy', 'JustHit'),
      tasks: [createScriptMoveTask(), createScriptStepsTask()],
    },
  ];
}

export function deadSchedule(): NpcSchedule {
  return {
    id: 'dead',
    priority: 1000,
    required: condMask('IsDead'),
    blockedBy: NO_CONDITIONS,
    interrupts: NO_CONDITIONS,
    tasks: [PlayDeathTask],
  };
}

/**
 * Flinch al recibir daño. `id` distingue el matiz en traces ('hit' vs
 * 'stagger' zombie). `FlinchReady` gatea la re-entrada: presets con
 * `flinch.cooldown` no quedan en stunlock bajo fuego sostenido (los que no lo
 * definen tienen el bit siempre activo).
 */
export function hitSchedule(flinchDuration: number, id: 'hit' | 'stagger' = 'hit'): NpcSchedule {
  return {
    id,
    priority: 900,
    required: condMask('JustHit', 'FlinchReady'),
    blockedBy: condMask('IsDead'),
    interrupts: NO_CONDITIONS,
    tasks: [createFlinchTask(flinchDuration)],
  };
}

/** Par recarga: cubierto si hay cover reclamable (810), parado si no (800). */
export function reloadSchedules(options: { blockInMelee?: boolean } = {}): NpcSchedule[] {
  const blockedBy = options.blockInMelee
    ? condMask('IsDead', 'EnemyInMeleeRange')
    : condMask('IsDead');
  return [
    {
      id: 'reloadInCover',
      priority: 810,
      required: condMask('MagazineEmpty', 'CoverAvailable'),
      blockedBy,
      interrupts: NO_CONDITIONS,
      tasks: [createMoveToCoverTask(), ReloadWeaponTask],
    },
    {
      id: 'reload',
      priority: 800,
      required: condMask('MagazineEmpty'),
      blockedBy,
      interrupts: NO_CONDITIONS,
      tasks: [ReloadWeaponTask],
    },
  ];
}

export function searchLastKnownSchedule(wait: number): NpcSchedule {
  return {
    id: 'searchLastKnown',
    priority: 500,
    required: condMask('LostEnemy'),
    blockedBy: condMask('IsDead', 'SeeEnemy'),
    interrupts: condMask('SeeEnemy', 'EnemyDead'),
    tasks: [createSearchSweepTask(), createWaitTask(wait)],
  };
}

export function investigateCombatSchedule(wait: number): NpcSchedule {
  return {
    id: 'investigateCombat',
    priority: 320,
    required: condMask('HeardCombat'),
    blockedBy: condMask('IsDead', 'SeeEnemy', 'LostEnemy'),
    interrupts: condMask('SeeEnemy', 'LostEnemy'),
    tasks: [createInvestigateTask(), createWaitTask(wait)],
  };
}

/**
 * "Algo vi": el acumulador de deteccion paso el umbral de sospecha. El NPC
 * frena y encara el punto antes de la deteccion plena (ventana de reaccion
 * del jugador). Requiere `detection` en la percepcion del preset.
 */
export function noticeSuspicionSchedule(): NpcSchedule {
  return {
    id: 'noticeSuspicion',
    priority: 310,
    required: condMask('EnemySuspected'),
    blockedBy: condMask('IsDead', 'SeeEnemy', 'LostEnemy', 'HeardCombat'),
    interrupts: condMask('SeeEnemy', 'LostEnemy', 'HeardCombat'),
    tasks: [createFaceSuspicionTask()],
  };
}

export function investigateSuspiciousSchedule(wait: number): NpcSchedule {
  return {
    id: 'investigateSuspicious',
    priority: 300,
    required: condMask('HeardSuspicious'),
    blockedBy: condMask('IsDead', 'SeeEnemy', 'LostEnemy', 'HeardCombat'),
    interrupts: condMask('SeeEnemy', 'LostEnemy', 'HeardCombat'),
    tasks: [createInvestigateTask(), createWaitTask(wait)],
  };
}

export function idleSchedule(
  wait: number,
  alertConds: readonly CondKey[] = DEFAULT_ALERT_CONDS,
): NpcSchedule {
  return {
    id: 'idle',
    priority: 100,
    required: NO_CONDITIONS,
    blockedBy: condMask('IsDead', ...alertConds),
    interrupts: condMask(...alertConds),
    tasks: [createWaitTask(wait)],
  };
}

export function patrolSchedule(alertConds: readonly CondKey[] = DEFAULT_ALERT_CONDS): NpcSchedule {
  return {
    id: 'patrol',
    priority: 150,
    required: NO_CONDITIONS,
    blockedBy: condMask('IsDead', ...alertConds),
    interrupts: condMask(...alertConds),
    tasks: [createPatrolTask()],
  };
}
