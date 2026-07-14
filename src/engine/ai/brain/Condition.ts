/**
 * Conjunto de conditions empaquetado en dos int32 (`lo` = indices 0..30,
 * `hi` = indices 31..61). El consumer concreto (`game/npc/brain/NpcConditions.ts`)
 * define la asignacion indice→nombre; este modulo solo provee la maquinaria
 * generica. El bit de signo de cada word se ignora para mantener
 * `(word & flag) !== 0` sin sorpresas → 62 bits utiles.
 */
export interface ConditionMask {
  readonly lo: number;
  readonly hi: number;
}

export const NO_CONDITIONS: ConditionMask = { lo: 0, hi: 0 };

/** Mascara de un solo bit para el indice 0..61 (31..61 van al word alto). */
export function conditionBit(index: number): ConditionMask {
  if (!Number.isInteger(index) || index < 0 || index > 61) {
    throw new RangeError(`condition bit index out of range: ${index}`);
  }
  if (index < 31) return { lo: (1 << index) >>> 0, hi: 0 };
  return { lo: 0, hi: (1 << (index - 31)) >>> 0 };
}

export function maskOf(...flags: ConditionMask[]): ConditionMask {
  let lo = 0;
  let hi = 0;
  for (const f of flags) {
    lo |= f.lo;
    hi |= f.hi;
  }
  return { lo: lo >>> 0, hi: hi >>> 0 };
}

export function has(mask: ConditionMask, flag: ConditionMask): boolean {
  return (mask.lo & flag.lo) !== 0 || (mask.hi & flag.hi) !== 0;
}

export function hasAll(mask: ConditionMask, required: ConditionMask): boolean {
  return (mask.lo & required.lo) === required.lo && (mask.hi & required.hi) === required.hi;
}

export function hasAny(mask: ConditionMask, anyOf: ConditionMask): boolean {
  return (mask.lo & anyOf.lo) !== 0 || (mask.hi & anyOf.hi) !== 0;
}

export function add(mask: ConditionMask, flag: ConditionMask): ConditionMask {
  return { lo: (mask.lo | flag.lo) >>> 0, hi: (mask.hi | flag.hi) >>> 0 };
}

export function remove(mask: ConditionMask, flag: ConditionMask): ConditionMask {
  return { lo: (mask.lo & ~flag.lo) >>> 0, hi: (mask.hi & ~flag.hi) >>> 0 };
}
