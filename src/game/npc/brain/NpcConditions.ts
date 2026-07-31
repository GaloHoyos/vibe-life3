import type { ConditionMask } from '@engine/ai/brain/Condition';
import { conditionBit, maskOf } from '@engine/ai/brain/Condition';

/**
 * Catalogo de bits de condition consumidos por los schedules de NPCs. La
 * mascara es de dos words (62 indices utiles, 0..61); los indices 0..29
 * conservan su asignacion historica para que los traces sigan siendo
 * comparables entre sesiones.
 */
export const Cond = {
  /** Vital. Bit 0 reservado para `IsDead` por costumbre de fija. */
  IsDead: conditionBit(0),
  JustHit: conditionBit(1),
  LowHealth: conditionBit(2),

  /** Percepcion del threat principal. */
  SeeEnemy: conditionBit(3),
  LostEnemy: conditionBit(4),
  EnemyDead: conditionBit(5),
  HeardCombat: conditionBit(6),
  HeardSuspicious: conditionBit(7),
  /** Deteccion parcial: el acumulador de awareness paso el umbral de sospecha sin llegar a ver pleno. */
  EnemySuspected: conditionBit(18),

  /** Distancia/posicion respecto al threat. */
  EnemyInMeleeRange: conditionBit(8),
  EnemyTooClose: conditionBit(9),
  /** Threat visible pero mas alla del rango util del arma: acercarse en vez de tirar al aire. */
  TooFarToShoot: conditionBit(10),

  /** Estado de armas. */
  MagazineEmpty: conditionBit(11),

  /** Squad slots estilo HL2 (SquadSlotBoard): gatean quien dispara / granadea / vigila. */
  HasAttackSlot: conditionBit(12),
  GrenadeReady: conditionBit(14),
  OverwatchFree: conditionBit(16),

  /** Tactical / cover. */
  CoverAvailable: conditionBit(13),
  CoverBlown: conditionBit(15),

  /** Pathing / locomotion. */
  Stuck: conditionBit(17),

  /** Building awareness (consumido por schedules de Fase 4). */
  EnemyInBuilding: conditionBit(19),
  SelfInBuilding: conditionBit(20),
  SameRoomAsEnemy: conditionBit(21),

  /** Squad. */
  SquadFlankAvailable: conditionBit(22),
  SquadOnPoint: conditionBit(23),

  /** Social: hay aliados vivos cerca → ser mas agresivo. */
  AlliesNear: conditionBit(24),
  /** El anchor (player u orden de squad para allies) quedo demasiado lejos → regroup. */
  AnchorFar: conditionBit(25),

  /** Threat en la banda de salto (entre melee y `leapRange`): el headcrab brinca. */
  EnemyInLeapRange: conditionBit(26),

  /** Cuerpo volcado de lado (up-vector lejos de la vertical): la torreta queda inutil. */
  Tipped: conditionBit(27),

  /** (medic) Aliado o player bajo el umbral de curacion, en rango y con cooldown listo. */
  AllyNeedsHealing: conditionBit(28),
  /** Cooldown de re-flinch cumplido: sin esto `hit` no re-entra (anti-stunlock). */
  FlinchReady: conditionBit(29),

  /** Hay una orden de secuencia guionada activa para este NPC (scripted_sequence). */
  ScriptActive: conditionBit(30),
  /** La orden guionada es ininterrumpible (override AI): pisa incluso el combate. */
  ScriptUninterruptible: conditionBit(31),

  /** Holds a live reservation and must walk to a vehicle entrance. */
  VehicleApproach: conditionBit(32),
} as const;

export type CondKey = keyof typeof Cond;

export function condMask(...keys: CondKey[]): ConditionMask {
  return maskOf(...keys.map((k) => Cond[k]));
}
