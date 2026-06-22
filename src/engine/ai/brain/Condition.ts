/**
 * Conjunto de conditions empaquetadas en una int32. El consumer concreto
 * (`game/npc/brain/NpcConditions.ts`) define la asignacion bit→nombre; este
 * modulo solo provee la maquinaria generica. Maximo 31 bits utiles (el bit
 * de signo se ignora para mantener `(mask & flag) > 0` sin sorpresas).
 */
export type ConditionMask = number;

export const NO_CONDITIONS: ConditionMask = 0;

export function maskOf(...flags: number[]): ConditionMask {
  let m = 0;
  for (const f of flags) m |= f;
  return m >>> 0;
}

export function has(mask: ConditionMask, flag: number): boolean {
  return (mask & flag) !== 0;
}

export function hasAll(mask: ConditionMask, required: ConditionMask): boolean {
  return (mask & required) === required;
}

export function hasAny(mask: ConditionMask, anyOf: ConditionMask): boolean {
  return (mask & anyOf) !== 0;
}

export function add(mask: ConditionMask, flag: number): ConditionMask {
  return (mask | flag) >>> 0;
}

export function remove(mask: ConditionMask, flag: number): ConditionMask {
  return (mask & ~flag) >>> 0;
}
