import type { Vector3 } from 'three';
import type { ConditionMask } from '@engine/ai/brain/Condition';
import type { PerceptionSnapshot } from '@engine/ai/perception/PerceptionSystem';
import type { ActorSnapshot } from '@game/npc/core/INpc';
import type { NpcCombatHandle, NpcLocomotionHandle, NpcSelfSnapshot } from './NpcBrainContext';
import type { NoiseSnapshot } from './NpcNoiseSensor';
import { Cond } from './NpcConditions';

export interface SensorInputs {
  self: NpcSelfSnapshot;
  threat: ActorSnapshot | null;
  perception: PerceptionSnapshot;
  combat: NpcCombatHandle;
  locomotion: NpcLocomotionHandle;
  noise: NoiseSnapshot;
  meleeRange: number;
  /** Banda de salto: threat dentro de `(meleeRange, leapRange]` activa `EnemyInLeapRange`. 0 = sin salto. */
  leapRange: number;
  tooCloseRange: number;
  lowHealthRatio: number;
  justHit: boolean;
  /** Cuerpo volcado de lado (motor dinamico): activa `Tipped`. False en motores cinematicos. */
  tipped: boolean;
  alliesNear: boolean;
  anchorFar: boolean;
  coverAvailable: boolean;
  coverBlown: boolean;
  squadFlankAvailable: boolean;
  squadOnPoint: boolean;
  selfBuildingId: string | null;
  threatBuildingId: string | null;
  threatRoomId: string | null;
  selfRoomId: string | null;
}

/**
 * Compone el `ConditionMask` que el brain va a evaluar este frame. Es una
 * funcion pura: dado el snapshot completo, devuelve los bits prendidos. El
 * caller (`Npc.update`) la invoca una vez por tick antes de pasar al brain.
 */
export function computeNpcConditions(inputs: SensorInputs): ConditionMask {
  let mask = 0;
  if (!inputs.self.isAlive) {
    mask |= Cond.IsDead;
    return mask >>> 0;
  }
  if (inputs.self.health / inputs.self.maxHealth < inputs.lowHealthRatio) {
    mask |= Cond.LowHealth;
  }
  if (inputs.justHit) mask |= Cond.JustHit;
  if (inputs.tipped) mask |= Cond.Tipped;

  if (inputs.perception.visibleNow && inputs.threat?.isAlive) {
    mask |= Cond.SeeEnemy;
  } else if (inputs.perception.hasMemory && inputs.threat?.isAlive) {
    mask |= Cond.LostEnemy;
  }

  if (inputs.threat && !inputs.threat.isAlive) {
    mask |= Cond.EnemyDead;
  }

  if (inputs.threat?.isAlive) {
    const dist = planarDistance(inputs.self.position, inputs.threat.position);
    if (dist <= inputs.meleeRange) mask |= Cond.EnemyInMeleeRange;
    if (dist > inputs.meleeRange && dist <= inputs.leapRange) mask |= Cond.EnemyInLeapRange;
    if (dist <= inputs.tooCloseRange) mask |= Cond.EnemyTooClose;
  }

  if (inputs.combat.magazineEmpty()) mask |= Cond.MagazineEmpty;
  if (inputs.locomotion.isStuck()) mask |= Cond.Stuck;

  if (inputs.noise.combat) mask |= Cond.HeardCombat;
  if (inputs.noise.suspicious) mask |= Cond.HeardSuspicious;
  if (inputs.alliesNear) mask |= Cond.AlliesNear;
  if (inputs.anchorFar) mask |= Cond.AnchorFar;
  if (inputs.coverAvailable) mask |= Cond.CoverAvailable;
  if (inputs.coverBlown) mask |= Cond.CoverBlown;
  if (inputs.squadFlankAvailable) mask |= Cond.SquadFlankAvailable;
  if (inputs.squadOnPoint) mask |= Cond.SquadOnPoint;

  if (inputs.threatBuildingId && inputs.threatBuildingId !== inputs.selfBuildingId) {
    mask |= Cond.EnemyInBuilding;
  }
  if (inputs.selfBuildingId) mask |= Cond.SelfInBuilding;
  if (
    inputs.threatRoomId &&
    inputs.selfRoomId &&
    inputs.threatRoomId === inputs.selfRoomId &&
    inputs.threatBuildingId === inputs.selfBuildingId
  ) {
    mask |= Cond.SameRoomAsEnemy;
  }

  return mask >>> 0;
}

function planarDistance(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}
