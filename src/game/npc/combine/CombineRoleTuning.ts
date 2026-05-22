import type { SquadRole } from "@game/npc/ai/SquadDirector";

export interface CombineRoleTuning {
  /** Vida fraccional (0..1) bajo la que el NPC empieza a querer cover. */
  coverHealthThreshold: number;
  /**
   * Multiplicador del range nominal del arma para decidir cuándo dejar de
   * avanzar. < 1 = más agresivo (se acerca más); >= 1 = se queda lejos.
   */
  chargeFactor: number;
  /** Roles agresivos: nunca buscan cover, siempre engage. */
  preferOpenCombat: boolean;
}

/**
 * Tuning por rol del squad. Editar acá para balance, no en `CombineNpc`.
 *
 * Roles vienen de `SquadDirector.SquadRole`. Si se agrega un rol nuevo,
 * TS forzará a sumar entrada acá.
 */
export const COMBINE_ROLE_TUNING: Record<SquadRole, CombineRoleTuning> = {
  leader:     { coverHealthThreshold: 0.7,  chargeFactor: 0.9,  preferOpenCombat: false },
  suppressor: { coverHealthThreshold: 0.85, chargeFactor: 0.9,  preferOpenCombat: false },
  flanker:    { coverHealthThreshold: 0.45, chargeFactor: 0.9,  preferOpenCombat: true  },
  cover:      { coverHealthThreshold: 0.7,  chargeFactor: 0.9,  preferOpenCombat: false },
  assault:    { coverHealthThreshold: 0.3,  chargeFactor: 0.45, preferOpenCombat: true  },
  grenadier:  { coverHealthThreshold: 0.55, chargeFactor: 0.75, preferOpenCombat: true  },
  searcher:   { coverHealthThreshold: 0.65, chargeFactor: 0.85, preferOpenCombat: false },
};

/** Vida sobre la que un NPC en cover empieza a tener chance de salir. */
export const COVER_LEAVE_HEALTH_THRESHOLD = 0.85;

/** Probabilidad por frame de salir de cover cuando se cumple el threshold. */
export const COVER_LEAVE_PROBABILITY = 0.004;

/** Duración inicial (s) en fase "hide" antes del primer peek. */
export const COVER_HIDE_DURATION_MIN = 0.8;
export const COVER_HIDE_DURATION_VAR = 0.6;

/** Duración (s) de cada peek antes de volver a hide. */
export const COVER_PEEK_DURATION = 1.0;

/** Hide entre peeks: base + jitter. */
export const COVER_HIDE_BETWEEN_PEEKS_MIN = 1.0;
export const COVER_HIDE_BETWEEN_PEEKS_VAR = 0.6;
