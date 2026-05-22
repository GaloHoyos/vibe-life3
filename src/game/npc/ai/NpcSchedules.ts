import type { NpcCondition } from "./NpcConditionSet";

export type NpcScheduleId =
  | "Idle"
  | "Patrol"
  | "Alert"
  | "InvestigateSound"
  | "InvestigateLastKnown"
  | "CombatStand"
  | "TakeCover"
  | "CoverFire"
  | "Suppress"
  | "Flank"
  | "Advance"
  | "Retreat"
  | "Reload"
  | "ThrowGrenade"
  | "MeleeChase"
  | "MeleeAttack"
  | "FollowPlayer"
  | "Regroup"
  | "AvoidBlockingPlayer"
  | "CombatSupport"
  | "RecoverFromStumble"
  | "Dead";

export type NpcTaskId =
  | "Wait"
  | "FaceThreat"
  | "MoveToTarget"
  | "MoveToCover"
  | "MoveToFlank"
  | "MoveToRetreat"
  | "Aim"
  | "FireBurst"
  | "SuppressFire"
  | "ReloadWeapon"
  | "ThrowGrenade"
  | "MeleeWindup"
  | "MeleeStrike"
  | "Scan"
  | "FollowLeader"
  | "Recover";

export interface NpcScheduleDefinition {
  id: NpcScheduleId;
  priority: number;
  tasks: NpcTaskId[];
  required?: NpcCondition[];
  blockedBy?: NpcCondition[];
  minHoldSeconds?: number;
}

export const DEFAULT_SCHEDULE_HOLD_SECONDS = 0.35;

export function scheduleCanRun(
  schedule: NpcScheduleDefinition,
  hasCondition: (condition: NpcCondition) => boolean,
): boolean {
  for (const condition of schedule.required ?? []) {
    if (!hasCondition(condition)) return false;
  }
  for (const condition of schedule.blockedBy ?? []) {
    if (hasCondition(condition)) return false;
  }
  return true;
}
