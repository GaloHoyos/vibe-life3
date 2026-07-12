import type { Vector3 } from 'three';
import type { ConditionMask } from '@engine/ai/brain/Condition';
import { NO_CONDITIONS, add, has } from '@engine/ai/brain/Condition';
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
  /** Cooldown de re-flinch cumplido (presets sin cooldown: siempre true). */
  flinchReady: boolean;
  /** El acumulador de deteccion paso el umbral de sospecha sin ver pleno. */
  enemySuspected: boolean;
  /** Cuerpo volcado de lado (motor dinamico): activa `Tipped`. False en motores cinematicos. */
  tipped: boolean;
  alliesNear: boolean;
  anchorFar: boolean;
  coverAvailable: boolean;
  coverBlown: boolean;
  squadFlankAvailable: boolean;
  squadOnPoint: boolean;
  /** Tiene uno de los slots de ataque limitados de su squad (SquadSlotBoard). */
  hasAttackSlot: boolean;
  /** El slot de overwatch de su squad esta libre (o ya es suyo). */
  overwatchFree: boolean;
  /** Ventana de granada valida (cooldown + LKP oculta en banda + slot libre). */
  grenadeReady: boolean;
  /** (medic) Hay un aliado herido en rango y el cooldown de curacion expiro. */
  allyNeedsHealing: boolean;
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
  let mask = NO_CONDITIONS;
  if (!inputs.self.isAlive) {
    return add(mask, Cond.IsDead);
  }
  if (inputs.self.health / inputs.self.maxHealth < inputs.lowHealthRatio) {
    mask = add(mask, Cond.LowHealth);
  }
  if (inputs.justHit) mask = add(mask, Cond.JustHit);
  if (inputs.flinchReady) mask = add(mask, Cond.FlinchReady);
  if (inputs.tipped) mask = add(mask, Cond.Tipped);

  if (inputs.perception.visibleNow && inputs.threat?.isAlive) {
    mask = add(mask, Cond.SeeEnemy);
  } else if (inputs.perception.hasMemory && inputs.threat?.isAlive) {
    mask = add(mask, Cond.LostEnemy);
  }
  if (inputs.enemySuspected) mask = add(mask, Cond.EnemySuspected);

  if (inputs.threat && !inputs.threat.isAlive) {
    mask = add(mask, Cond.EnemyDead);
  }

  if (inputs.threat?.isAlive) {
    const dist = planarDistance(inputs.self.position, inputs.threat.position);
    // La memoria puede conservar un threat al otro lado de una pared. Sin
    // visión real no debe congelar al NPC en melee ni habilitar un salto.
    if (inputs.perception.visibleNow && dist <= inputs.meleeRange) {
      mask = add(mask, Cond.EnemyInMeleeRange);
    }
    if (
      inputs.perception.visibleNow &&
      dist > inputs.meleeRange &&
      dist <= inputs.leapRange
    ) {
      mask = add(mask, Cond.EnemyInLeapRange);
    }
    if (dist <= inputs.tooCloseRange) mask = add(mask, Cond.EnemyTooClose);
    // Solo con el enemigo a la vista: fuera del rango util del arma hay que
    // acercarse (closeDistance), no tirotear al aire.
    if (has(mask, Cond.SeeEnemy) && dist > inputs.combat.effectiveRange()) {
      mask = add(mask, Cond.TooFarToShoot);
    }
  }

  if (inputs.combat.magazineEmpty()) mask = add(mask, Cond.MagazineEmpty);
  if (inputs.locomotion.isStuck()) mask = add(mask, Cond.Stuck);

  if (inputs.noise.combat) mask = add(mask, Cond.HeardCombat);
  if (inputs.noise.suspicious) mask = add(mask, Cond.HeardSuspicious);
  if (inputs.alliesNear) mask = add(mask, Cond.AlliesNear);
  if (inputs.anchorFar) mask = add(mask, Cond.AnchorFar);
  if (inputs.coverAvailable) mask = add(mask, Cond.CoverAvailable);
  if (inputs.coverBlown) mask = add(mask, Cond.CoverBlown);
  if (inputs.squadFlankAvailable) mask = add(mask, Cond.SquadFlankAvailable);
  if (inputs.squadOnPoint) mask = add(mask, Cond.SquadOnPoint);
  if (inputs.hasAttackSlot) mask = add(mask, Cond.HasAttackSlot);
  if (inputs.overwatchFree) mask = add(mask, Cond.OverwatchFree);
  if (inputs.grenadeReady) mask = add(mask, Cond.GrenadeReady);
  if (inputs.allyNeedsHealing) mask = add(mask, Cond.AllyNeedsHealing);

  if (inputs.threatBuildingId && inputs.threatBuildingId !== inputs.selfBuildingId) {
    mask = add(mask, Cond.EnemyInBuilding);
  }
  if (inputs.selfBuildingId) mask = add(mask, Cond.SelfInBuilding);
  if (
    inputs.threatRoomId &&
    inputs.selfRoomId &&
    inputs.threatRoomId === inputs.selfRoomId &&
    inputs.threatBuildingId === inputs.selfBuildingId
  ) {
    mask = add(mask, Cond.SameRoomAsEnemy);
  }

  return mask;
}

function planarDistance(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}
