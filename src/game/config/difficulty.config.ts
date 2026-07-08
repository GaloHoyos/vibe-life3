/**
 * Dificultad estilo Half-Life 2. Tres niveles que escalan el combate por
 * multiplicadores; `normal` es la linea base (todos los mults = 1).
 *
 * - `incomingPlayerDamageMult`: cuanto te pegan los enemigos (lever principal de HL2).
 * - `enemyHealthMult`: dureza enemiga; horneado al spawnear. Tambien controla los
 *   cohetes para tumbar jefes (gunship/strider base 500 / trozo 100 → 3/5/7).
 * - `playerWeaponDamageMult`: tu daño de salida contra NPCs.
 */
export type DifficultyLevel = "facil" | "normal" | "dificil";

export interface DifficultyModifiers {
  incomingPlayerDamageMult: number;
  enemyHealthMult: number;
  playerWeaponDamageMult: number;
}

/** Contrato de consumo: lo implementa `DifficultyService` y lo leen los sistemas de combate. */
export interface DifficultyProvider {
  getModifiers(): DifficultyModifiers;
}

export const DifficultyTable: Record<DifficultyLevel, DifficultyModifiers> = {
  facil: {
    incomingPlayerDamageMult: 0.5,
    enemyHealthMult: 0.6,
    playerWeaponDamageMult: 1.25,
  },
  normal: {
    incomingPlayerDamageMult: 1.0,
    enemyHealthMult: 1.0,
    playerWeaponDamageMult: 1.0,
  },
  dificil: {
    incomingPlayerDamageMult: 1.6,
    enemyHealthMult: 1.4,
    playerWeaponDamageMult: 0.85,
  },
};

export const DEFAULT_DIFFICULTY: DifficultyLevel = "normal";

/** Orden de presentacion en menus (facil → dificil). */
export const DIFFICULTY_ORDER: readonly DifficultyLevel[] = [
  "facil",
  "normal",
  "dificil",
];

export function isDifficultyLevel(value: unknown): value is DifficultyLevel {
  return value === "facil" || value === "normal" || value === "dificil";
}
