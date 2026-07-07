/**
 * Constantes de gameplay (Player, interacciones) externalizadas para
 * que sean tuneables sin tocar código.
 */

export const PlayerConfig = {
  /**
   * Cápsula del jugador y offsets de cámara. Altura normalizada a escala humana
   * como los NPCs (el humanoide mide 1.75 m): capsule = 2·(halfHeight+radius) =
   * 2·(0.55+0.35) = 1.80 m. Los `eyeHeight` son offsets desde el CENTRO de la
   * cápsula (`getEyePosition` = center + eyeOffset), calibrados para dejar el
   * ojo en ~1.65 m (center 0.90 + 0.75).
   */
  collider: {
    radius: 0.35,
    standingHalfHeight: 0.55,
    crouchHalfHeight: 0.3,
    standingEyeHeight: 0.75,
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
   * Daño por caída estilo HL2. Por debajo de `safeSpeed` (m/s de impacto) no
   * hay daño — un salto normal aterriza a ~9.2 m/s. Entre `safeSpeed` y
   * `fatalSpeed` el daño escala lineal hasta `fatalDamage`; arriba de
   * `fatalSpeed` se capea a `fatalDamage`. ~10 m de caída ≈ 24 m/s.
   */
  fallDamage: {
    safeSpeed: 12,
    fatalSpeed: 26,
    fatalDamage: 100,
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

/**
 * Daño por impacto físico de props contra NPCs. Global: aplica a cualquier
 * prop dinámico rápido sin importar la causa (punt/throw de la gravity gun,
 * empuje del carry, salida de un portal a velocidad, explosión).
 * `damage = clamp(speed × (1 + mass × massWeight) × speedFactor, min, max) × bodyPartMul`.
 */
export const PropImpactConfig = {
  /** Velocidad mínima para considerar al prop dañino. */
  minDangerousSpeed: 5,
  speedFactor: 1.8,
  massWeight: 0.5,
  damageMin: 15,
  damageMax: 150,
  /** Tiempo (s) que un prop lanzado conserva la atribución de su atacante. */
  attributionDuration: 3,
  /** Anti-duplicado: silencio (s) por prop después de cada impacto dañino. */
  hitCooldown: 0.4,
} as const;

/**
 * Carry con E (+USE de HL2): versión débil del agarre de la gravity gun.
 * Solo objetos livianos, carry corto, sin punt ni pull; LMB empuja suave.
 */
export const CarryConfig = {
  /** Masa máxima que se puede levantar con las manos. */
  maxMass: 35,
  /** Alcance del raycast de adquisición. */
  range: 2.4,
  /** Si el cuerpo queda más lejos del jugador que esto, se suelta. */
  maxCarryPlayerDistance: 3.2,
  /** Velocidad del empuje suave con click izquierdo. */
  softPushSpeed: 7,
  softPushLift: 1,
  hold: {
    holdDistance: 1.5,
    minHoldDistance: 0.8,
    wallClampMargin: 0.25,
    maxLinearSpeed: 7,
    linearGain: 10,
    maxAngularSpeed: 10,
    angularGain: 8,
    dropErrorDistance: 0.7,
    dropErrorTime: 0.35,
    teleportGraceSeconds: 0.3,
  },
} as const;
