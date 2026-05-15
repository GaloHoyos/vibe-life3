/**
 * Constantes de gameplay (Player, interacciones) externalizadas para
 * que sean tuneables sin tocar código.
 */

export const PlayerConfig = {
  /** Cápsula del jugador y movimiento. */
  collider: {
    radius: 0.35,
    halfHeight: 0.7,
    eyeHeight: 0.62,
  },
  movement: {
    speed: 6.2,
    jumpSpeed: 9.2,
  },
  vitals: {
    maxHealth: 100,
    armorMax: 0,
  },
} as const;

export const PlayerHealthConfig = {
  /** Fracción del daño que la armadura absorbe (0 = nada, 1 = todo). */
  armorAbsorptionRatio: 0.35,
} as const;

export const InteractionsConfig = {
  /** Distancia máxima (m) a la que un botón es interactuable. */
  doorButtonRange: 3,
} as const;
