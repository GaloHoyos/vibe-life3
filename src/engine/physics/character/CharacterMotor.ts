import RAPIER from "@dimforge/rapier3d-compat";
import { MathUtils, Quaternion, Vector3 } from "three";
import {
  KinematicCharacterBase,
  type KinematicCharacterBaseOptions,
} from "./KinematicCharacterBase";
import type { CharacterMotorSnapshot, NpcMotor, SliceHit } from "./NpcMotor";
import type { PhysicsMetadata, PhysicsWorld } from "@engine/physics/PhysicsWorld";

export type { CharacterMotorSnapshot } from "./NpcMotor";

export interface CharacterMotorConfig {
  id: string;
  position: Vector3;
  height: number;
  radius: number;
  mass: number;
  maxSpeed: number;
  acceleration: number;
  turnSpeed: number;
  rotationSmoothing: number;
  faceTargetDeadzone: number;
  turnBeforeMoveAngle: number;
  minMoveFacingDot: number;
  gravity: number;
  stepOffset: number;
  snapToGround: number;
  /** Altura total de la cápsula agachada. Omitida = no puede agacharse. */
  crouchHeight?: number;
  debug?: boolean;
  metadata: PhysicsMetadata;
}

/**
 * Motor cinemÃ¡tico para NPCs: locomociÃ³n con yaw, target-facing y
 * desaceleraciÃ³n suave. Hereda el manejo de cÃ¡psula / step / snap-to-ground
 * de `KinematicCharacterBase`. Para voladores fisicos ver `DynamicFlyerMotor`.
 */
const Y_AXIS = new Vector3(0, 1, 0);
/** Corte de seguridad de un leap que nunca aterriza (atascado contra geometria). */
const MAX_LEAP_DURATION = 1.5;

export class CharacterMotor extends KinematicCharacterBase implements NpcMotor {
  private readonly actualVelocity = new Vector3();
  private readonly horizontalVelocity = new Vector3();
  private readonly desiredVelocity = new Vector3();
  private readonly forward = new Vector3(0, 0, 1);
  private readonly tmpDirection = new Vector3();
  private readonly tmpFacing = new Vector3();
  private readonly tmpRotation = new Quaternion();
  private distanceToTarget = Number.POSITIVE_INFINITY;
  private yaw = 0;
  private targetYaw = 0;
  private enabled = true;
  private speedMultiplier = 1;
  private leaping = false;
  private leapAirborne = false;
  private leapTimer = 0;
  private portalExclusions: ReadonlySet<number> | null = null;
  private crouched = false;

  constructor(
    physics: PhysicsWorld,
    private readonly config: CharacterMotorConfig,
  ) {
    super(physics, motorBaseOptions(physics, config));
  }

  /**
   * @param facingTarget Si se provee, el body apunta el yaw hacia este punto
   * y la velocidad se computa directamente hacia `targetPosition` (strafe).
   * Si es null, el body mira hacia donde camina (comportamiento por defecto).
   */
  update(
    delta: number,
    targetPosition: Vector3 | null,
    wantsMove: boolean,
    facingTarget: Vector3 | null = null,
  ): void {
    if (!this.enabled) {
      return;
    }

    const position = this.getPosition();
    const directionToTarget = this.tmpDirection;
    if (targetPosition) {
      directionToTarget.copy(targetPosition).sub(position);
    } else {
      directionToTarget.set(0, 0, 0);
    }
    directionToTarget.y = 0;
    this.distanceToTarget = directionToTarget.length();

    const directionToFace = this.tmpFacing;
    if (facingTarget) {
      directionToFace.copy(facingTarget).sub(position);
      directionToFace.y = 0;
    } else {
      directionToFace.copy(directionToTarget);
    }

    if (
      directionToFace.lengthSq() >
      this.config.faceTargetDeadzone * this.config.faceTargetDeadzone
    ) {
      directionToFace.normalize();
      this.targetYaw = Math.atan2(directionToFace.x, directionToFace.z);
      const turnLambda =
        this.config.turnSpeed * Math.max(0.15, 1 - this.config.rotationSmoothing);
      this.yaw = dampAngle(this.yaw, this.targetYaw, turnLambda, delta);
    }

    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).normalize();

    if (this.leaping) {
      // Vuelo balistico: gravedad sobre la velocidad lanzada, sin steering. El
      // x/z se conserva (momentum); collide-and-slide igual frena en paredes.
      this.velocity.y += -this.config.gravity * delta;
    } else {
      if (wantsMove) {
        if (facingTarget && directionToTarget.lengthSq() > 0.0001) {
          directionToTarget.normalize();
          this.desiredVelocity
            .copy(directionToTarget)
            .multiplyScalar(this.config.maxSpeed * this.speedMultiplier);
        } else {
          if (directionToTarget.lengthSq() > 0.0001) {
            directionToTarget.normalize();
          }
          const facingDot = targetPosition
            ? MathUtils.clamp(this.forward.dot(directionToTarget), -1, 1)
            : 1;
          const angleToTarget = Math.acos(facingDot);
          const facingSpeedFactor = MathUtils.smoothstep(
            facingDot,
            this.config.minMoveFacingDot,
            1,
          );
          const turnSlowdown =
            angleToTarget > this.config.turnBeforeMoveAngle ? 0.35 : 1;
          this.desiredVelocity
            .copy(this.forward)
            .multiplyScalar(
              this.config.maxSpeed *
                this.speedMultiplier *
                facingSpeedFactor *
                turnSlowdown,
            );
        }
      } else {
        this.desiredVelocity.set(0, 0, 0);
      }

      this.horizontalVelocity.x = MathUtils.damp(
        this.horizontalVelocity.x,
        this.desiredVelocity.x,
        this.config.acceleration,
        delta,
      );
      this.horizontalVelocity.z = MathUtils.damp(
        this.horizontalVelocity.z,
        this.desiredVelocity.z,
        this.config.acceleration,
        delta,
      );
      this.velocity.x = this.horizontalVelocity.x;
      this.velocity.z = this.horizontalVelocity.z;
      this.velocity.y += -this.config.gravity * delta;
    }

    const { corrected } = this.stepMovement(delta, (collider) =>
      this.shouldCollideWith(collider),
    );
    if (this.leaping) {
      this.tickLeapLanding(delta);
    }
    const invDelta = delta > 0 ? 1 / delta : 0;
    this.actualVelocity.set(
      corrected.x * invDelta,
      corrected.y * invDelta,
      corrected.z * invDelta,
    );
    this.body.setNextKinematicRotation(
      this.tmpRotation.setFromAxisAngle(Y_AXIS, this.yaw),
    );
  }

  /**
   * Lanza el cuerpo en una parabola hacia `target`: elige la velocidad
   * horizontal para cubrir la distancia planar en el tiempo de vuelo que dicta
   * `upSpeed` (apex = upSpeed²/2g), clampeada a `maxForwardSpeed`. La gravedad
   * la pone el `update`. Para creatures que saltan (headcrab); no-op si vuela.
   */
  leapTo(target: Vector3, upSpeed: number, maxForwardSpeed: number): void {
    if (!this.enabled) return;
    const pos = this.getPosition();
    const dx = target.x - pos.x;
    const dz = target.z - pos.z;
    const planarDist = Math.hypot(dx, dz);
    const flightTime = this.config.gravity > 0 ? (2 * upSpeed) / this.config.gravity : 0;
    const needed = flightTime > 0 ? planarDist / flightTime : maxForwardSpeed;
    const forwardSpeed = Math.min(needed, maxForwardSpeed);
    const dirX = planarDist > 1e-4 ? dx / planarDist : this.forward.x;
    const dirZ = planarDist > 1e-4 ? dz / planarDist : this.forward.z;
    this.launch(dirX * forwardSpeed, upSpeed, dirZ * forwardSpeed);
  }

  /** Inicia el leap con una velocidad explicita. Desactiva el snap-to-ground. */
  private launch(vx: number, vy: number, vz: number): void {
    this.velocity.set(vx, vy, vz);
    this.horizontalVelocity.set(vx, 0, vz);
    this.leaping = true;
    this.leapAirborne = false;
    this.leapTimer = 0;
    this.controller.disableSnapToGround();
  }

  isLeaping(): boolean {
    return this.leaping;
  }

  setCrouched(crouched: boolean): void {
    if (this.config.crouchHeight === undefined || this.crouched === crouched) return;
    const standingHalfHeight = getCapsuleHalfHeight(this.config.height, this.config.radius);
    const crouchHalfHeight = getCapsuleHalfHeight(this.config.crouchHeight, this.config.radius);
    const nextHalfHeight = crouched ? crouchHalfHeight : standingHalfHeight;
    const currentHalfHeight = this.crouched ? crouchHalfHeight : standingHalfHeight;
    const delta = nextHalfHeight - currentHalfHeight;
    this.collider.setHalfHeight(nextHalfHeight);
    const position = this.body.translation();
    this.body.setTranslation(
      { x: position.x, y: position.y + delta, z: position.z },
      true,
    );
    this.body.setNextKinematicTranslation(
      { x: position.x, y: position.y + delta, z: position.z },
    );
    this.crouched = crouched;
  }

  isCrouched(): boolean { return this.crouched; }

  /**
   * Detecta el aterrizaje: una vez que el cuerpo dejo el piso (`leapAirborne`),
   * el primer frame que vuelve a estar grounded cierra el leap. Corte duro por
   * tiempo si nunca despega (atascado contra una pared).
   */
  private tickLeapLanding(delta: number): void {
    this.leapTimer += delta;
    if (!this.grounded) {
      this.leapAirborne = true;
    }
    if ((this.leapAirborne && this.grounded) || this.leapTimer >= MAX_LEAP_DURATION) {
      this.leaping = false;
      this.leapAirborne = false;
      this.controller.enableSnapToGround(this.config.snapToGround);
      this.horizontalVelocity.set(this.velocity.x, 0, this.velocity.z);
    }
  }

  syncFromPhysics(): CharacterMotorSnapshot {
    return {
      position: this.getPosition(),
      velocity: this.actualVelocity.clone(),
      desiredVelocity: this.desiredVelocity.clone(),
      forward: this.forward.clone(),
      grounded: this.grounded,
      yaw: this.yaw,
      targetYaw: this.targetYaw,
      distanceToTarget: this.distanceToTarget,
    };
  }

  getRotation(): Quaternion {
    return new Quaternion().setFromAxisAngle(Y_AXIS, this.yaw);
  }

  /** Terrestre: nunca queda fuera del control de la IA por fisica. */
  isIncapacitated(): boolean {
    return false;
  }

  consumeImpactDamage(): number {
    return 0;
  }

  // Terrestres: no se descontrolan ni cortan por contacto.
  reactToHit(): void {}

  consumeSliceHits(): SliceHit[] {
    return [];
  }

  disable(): void {
    this.enabled = false;
    this.setCrouched(false);
    if (this.leaping) {
      this.leaping = false;
      this.controller.enableSnapToGround(this.config.snapToGround);
    }
    this.velocity.set(0, 0, 0);
    this.actualVelocity.set(0, 0, 0);
    this.horizontalVelocity.set(0, 0, 0);
    this.collider.setEnabled(false);
    this.body.setEnabled(false);
  }

  override getVelocity(): Vector3 {
    return this.velocity.clone();
  }

  /**
   * Colliders que el collide-and-slide debe ignorar mientras el NPC transita
   * un portal (la pared que respalda el disco). Null = sin exclusiones.
   */
  setPortalExclusions(handles: ReadonlySet<number> | null): void {
    this.portalExclusions = handles;
  }

  /** Reorienta el yaw de golpe (salida de portal): sin damping ni giro visible. */
  snapYaw(yaw: number): void {
    this.yaw = yaw;
    this.targetYaw = yaw;
    this.body.setNextKinematicRotation(
      this.tmpRotation.setFromAxisAngle(Y_AXIS, yaw),
    );
  }

  override teleport(position: Vector3, velocity: Vector3): void {
    super.teleport(position, velocity);
    // El damping de horizontalVelocity pisaría la velocidad nueva un frame
    // después; sincronizarla mantiene el momentum de salida.
    this.horizontalVelocity.set(velocity.x, 0, velocity.z);
  }

  setSpeedMultiplier(multiplier: number): void {
    this.speedMultiplier = Math.max(0, multiplier);
  }

  getYaw(): number {
    return this.yaw;
  }

  private shouldCollideWith(collider: RAPIER.Collider): boolean {
    if (collider.handle === this.collider.handle || collider.isSensor()) {
      return false;
    }
    if (this.portalExclusions?.has(collider.handle)) {
      return false;
    }

    const metadata = this.physics.getColliderMetadata(collider);
    return metadata?.damageable !== this.config.metadata.damageable;
  }
}

function motorBaseOptions(
  physics: PhysicsWorld,
  config: CharacterMotorConfig,
): KinematicCharacterBaseOptions {
  return {
    physics,
    position: config.position,
    radius: config.radius,
    halfHeight: getCapsuleHalfHeight(config.height, config.radius),
    metadata: config.metadata,
    stepOffset: config.stepOffset,
    snapToGround: config.snapToGround,
  };
}

function getCapsuleHalfHeight(height: number, radius: number): number {
  return Math.max((height - radius * 2) / 2, 0.05);
}

function dampAngle(
  current: number,
  target: number,
  lambda: number,
  delta: number,
): number {
  const deltaAngle = Math.atan2(
    Math.sin(target - current),
    Math.cos(target - current),
  );
  return current + deltaAngle * (1 - Math.exp(-lambda * delta));
}
