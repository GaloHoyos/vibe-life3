/**
 * Constantes de gameplay (Player, interacciones) externalizadas para
 * que sean tuneables sin tocar código.
 */

export const PlayerConfig = {
  /** Cápsula del jugador y offsets de cámara. */
  collider: {
    radius: 0.35,
    standingHalfHeight: 0.7,
    crouchHalfHeight: 0.3,
    standingEyeHeight: 0.62,
    crouchEyeHeight: 0.22,
  },
  /**
   * Movimiento estilo HL2. `walk`/`sprint`/`crouch` son los wishspeeds objetivo
   * según el estado; `groundAccelerate`/`airAccelerate` controlan qué tan rápido
   * la velocidad se aproxima al wishspeed; `friction` frena cuando hay grounded.
   * En aire el wishspeed se capa a `maxAirWishSpeed` para preservar momentum.
   */
  movement: {
    walkSpeed: 6.2,
    sprintSpeed: 9.5,
    crouchSpeed: 2.5,
    jumpSpeed: 9.2,
    groundAccelerate: 14,
    airAccelerate: 14,
    maxAirWishSpeed: 0.7,
    friction: 6,
    stopSpeed: 1.5,
    crouchTransitionTime: 0.18,
  },
  vitals: {
    maxHealth: 100,
    armorMax: 100,
  },
  /**
   * Stamina HL2-style (`AUX power`). Drena solo cuando el sprint está
   * efectivamente activo (sprint key + grounded + moving). Si llega a 0,
   * queda `depleted` y bloquea el sprint hasta que recargue al menos
   * `rechargeUnlockPercent`. La regen empieza después de `regenDelay` sin
   * drenar — así un toque corto de sprint no recarga al instante.
   */
  stamina: {
    max: 100,
    drainPerSecond: 100 / 7,
    regenPerSecond: 100 / 6,
    regenDelay: 0.4,
    rechargeUnlockPercent: 25,
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
