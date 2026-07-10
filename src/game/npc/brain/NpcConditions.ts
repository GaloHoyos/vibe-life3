import type { ConditionMask } from '@engine/ai/brain/Condition';
import { maskOf } from '@engine/ai/brain/Condition';

/**
 * Catalogo de bits de condition consumidos por los schedules de NPCs. Hasta
 * 31 bits utiles (bit 31 reservado para mantener `>>> 0` predecible). Queda
 * UN solo bit libre (30): el proximo flag nuevo dispara la migracion a dos
 * words (`hi/lo`) sin tocar los schedules existentes.
 */
export const Cond = {
  /** Vital. Bit 0 reservado para `IsDead` por costumbre de fija. */
  IsDead: 1 << 0,
  JustHit: 1 << 1,
  LowHealth: 1 << 2,

  /** Percepcion del threat principal. */
  SeeEnemy: 1 << 3,
  LostEnemy: 1 << 4,
  EnemyDead: 1 << 5,
  HeardCombat: 1 << 6,
  HeardSuspicious: 1 << 7,
  /** Deteccion parcial: el acumulador de awareness paso el umbral de sospecha sin llegar a ver pleno. */
  EnemySuspected: 1 << 18,

  /** Distancia/posicion respecto al threat. */
  EnemyInMeleeRange: 1 << 8,
  EnemyTooClose: 1 << 9,
  /** Threat visible pero mas alla del rango util del arma: acercarse en vez de tirar al aire. */
  TooFarToShoot: 1 << 10,

  /** Estado de armas. */
  MagazineEmpty: 1 << 11,

  /** Squad slots estilo HL2 (SquadSlotBoard): gatean quien dispara / granadea / vigila. */
  HasAttackSlot: 1 << 12,
  GrenadeReady: 1 << 14,
  OverwatchFree: 1 << 16,

  /** Tactical / cover. */
  CoverAvailable: 1 << 13,
  CoverBlown: 1 << 15,

  /** Pathing / locomotion. */
  Stuck: 1 << 17,

  /** Building awareness (consumido por schedules de Fase 4). */
  EnemyInBuilding: 1 << 19,
  SelfInBuilding: 1 << 20,
  SameRoomAsEnemy: 1 << 21,

  /** Squad. */
  SquadFlankAvailable: 1 << 22,
  SquadOnPoint: 1 << 23,

  /** Social: hay aliados vivos cerca → ser mas agresivo. */
  AlliesNear: 1 << 24,
  /** El anchor (player u orden de squad para allies) quedo demasiado lejos → regroup. */
  AnchorFar: 1 << 25,

  /** Threat en la banda de salto (entre melee y `leapRange`): el headcrab brinca. */
  EnemyInLeapRange: 1 << 26,

  /** Cuerpo volcado de lado (up-vector lejos de la vertical): la torreta queda inutil. */
  Tipped: 1 << 27,

  /** (medic) Aliado o player bajo el umbral de curacion, en rango y con cooldown listo. */
  AllyNeedsHealing: 1 << 28,
  /** Cooldown de re-flinch cumplido: sin esto `hit` no re-entra (anti-stunlock). */
  FlinchReady: 1 << 29,
} as const;

export type CondKey = keyof typeof Cond;

export function condMask(...keys: CondKey[]): ConditionMask {
  return maskOf(...keys.map((k) => Cond[k]));
}
