import type RAPIER from "@dimforge/rapier3d-compat";
import type { Quaternion, Vector3 } from "three";
import type { Damageable } from "@shared/types/lifecycle";

/**
 * Contacto de cuchilla detectado por el sweep del flyer contra un cuerpo vivo
 * (player o NPC terrestre). El motor lo reporta; el `Npc` aplica el daño de slice
 * (policy de juego — el motor no aplica daño).
 */
export interface SliceHit {
  damageable: Damageable;
  /** El blanco es el player (el slice le hace daño aumentado). */
  isPlayer: boolean;
  point: Vector3;
}

/** Estado del motor que consumen animacion y debug. */
export interface CharacterMotorSnapshot {
  position: Vector3;
  velocity: Vector3;
  desiredVelocity: Vector3;
  forward: Vector3;
  grounded: boolean;
  yaw: number;
  targetYaw: number;
  distanceToTarget: number;
}

/**
 * Contrato que el runtime de NPC (`Npc` + `NpcLocomotion`) consume del motor,
 * agnostico de la implementacion fisica. Hay dos:
 *  - `CharacterMotor`  — cinematico (terrestre, con leap). Personajes y creatures.
 *  - `DynamicFlyerMotor` — rigid body dinamico (manhack): vuela por fuerzas,
 *    pero es un objeto fisico real (lo agarra la gravity gun, lo tira una caja,
 *    se rompe contra la pared).
 */
export interface NpcMotor {
  readonly body: RAPIER.RigidBody;
  update(
    delta: number,
    targetPosition: Vector3 | null,
    wantsMove: boolean,
    facingTarget?: Vector3 | null,
  ): void;
  getPosition(): Vector3;
  getYaw(): number;
  /** Rotacion completa del cuerpo (para sincronizar el visual; el flyer tumbea en 3D). */
  getRotation(): Quaternion;
  getVelocity(): Vector3;
  syncFromPhysics(): CharacterMotorSnapshot;
  setSpeedMultiplier(multiplier: number): void;
  disable(): void;
  /**
   * Libera cuerpos y recursos fisicos que pertenecen al motor. Se invoca al
   * destruir el runtime, despues de disponer la animacion y sus joints.
   */
  dispose?(): void;
  /** Salto balistico (creatures terrestres). No-op en voladores. */
  leapTo(target: Vector3, upSpeed: number, maxForwardSpeed: number): void;
  isLeaping(): boolean;
  /** Cambia la postura física para atravesar un área de baja altura. */
  setCrouched?(crouched: boolean): void;
  isCrouched?(): boolean;
  /**
   * Fuera del control de la IA: aturdido por un impacto fisico o sostenido por
   * la gravity gun. El `Npc` suspende combate/brain mientras dura.
   */
  isIncapacitated(): boolean;
  /** Daño acumulado por impactos a alta velocidad (smash). El `Npc` lo consume y aplica. */
  consumeImpactDamage(): number;
  /**
   * Reacción a un golpe externo (arma del player, crowbar): descontrola el motor
   * un instante (stall). El knockback fisico ya lo aplica el impulso del arma.
   * No-op en motores terrestres.
   */
  reactToHit(direction: Vector3, amount: number): void;
  /**
   * Cuchillazos por contacto detectados este frame (manhack). El `Npc` los drena
   * y aplica el daño de slice. Vacio en motores que no cortan.
   */
  consumeSliceHits(): SliceHit[];
}
