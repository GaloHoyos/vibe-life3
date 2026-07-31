import type { Vector3 } from "three";

export type WeaponHandedness = "none" | "oneHanded" | "twoHanded";

/**
 * Gestos procedurales nombrados que una secuencia guionada puede disparar.
 * `point`/`wave`/`talk` los rinde `GestureLayer` (brazos/torso); `crouch` lo
 * mapea el bridge a `setCrouch` (el `PostureLayer` hace la flexión real).
 */
export type GestureId = "point" | "wave" | "talk" | "crouch";

/** Qué están haciendo los brazos del personaje. Determina qué layer manda. */
export type AnimationActivity =
  | "none"
  | "reloading"
  | "meleeWindup"
  | "meleeStrike";

export interface AnimationLocomotion {
  /** Velocity world-space. Usado por VelocityLeanLayer. */
  worldVelocity: Vector3;
  /**
   * Velocity rotada al frame local del personaje:
   *   +Z = forward, +X = right.
   * Permite que las capas diferencien strafe vs avance vs retroceso.
   */
  localVelocity: Vector3;
  isGrounded: boolean;
}

export interface AnimationPosture {
  /** 0 = parado, 1 = agachado completo. */
  crouch: number;
  /** -1 = lean izquierda, 0 = recto, 1 = lean derecha. */
  lean: number;
  /** 0 = parado, 1 = sentado (muslos al frente, rodillas en L). */
  seated: number;
  /**
   * Dentro de `seated`: 0 = brazos apoyados, 1 = manos a los controles
   * (volante, cíclico). El aim pisa los brazos si está activo.
   */
  seatedControls: number;
}

export interface AnimationAim {
  active: boolean;
  /**
   * Peso 0..1 — el bridge lo lerpea cuando aim cambia de estado para que
   * los brazos no salten a la pose de aim instantáneamente.
   */
  weight: number;
  /**
   * Dirección unitaria al target, en frame local del personaje
   * (+Z forward, +X right). Calculada por el bridge a partir del target
   * world-space, eye position y bodyYaw del motor.
   */
  localDirection: Vector3;
  /** Define la pose de manos: oneHanded (pistol) / twoHanded (rifle) / none. */
  weaponPose: WeaponHandedness;
}

export interface AnimationEvents {
  /** Disparado este frame: produce un pulse de recoil corto en el AttackLayer. */
  shotJustFired: boolean;
}

export interface AnimationInput {
  deltaTime: number;
  time: number;
  locomotion: AnimationLocomotion;
  posture: AnimationPosture;
  aim: AnimationAim;
  activity: AnimationActivity;
  events: AnimationEvents;
  /**
   * Dirección a la que querría mirar el personaje (head + cuello). Si está
   * apuntando con arma, esto suele coincidir con `aim.target - eye`.
   */
  lookDirection?: Vector3;
  /** Si el NPC murió. Suspende todas las capas; sólo corre el ragdoll. */
  isDead: boolean;
  /** Override de `desiredDirection` para el VelocityLean. */
  desiredDirection: Vector3;
}
