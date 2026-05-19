import RAPIER from "@dimforge/rapier3d-compat";
import { MathUtils, Quaternion, Vector3 } from "three";
import {
  KinematicCharacterBase,
  type KinematicCharacterBaseOptions,
} from "./KinematicCharacterBase";
import type { PhysicsMetadata, PhysicsWorld } from "@engine/physics/PhysicsWorld";

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
  debug?: boolean;
  metadata: PhysicsMetadata;
}

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
 * Motor cinemÃ¡tico para NPCs: locomociÃ³n con yaw, target-facing y
 * desaceleraciÃ³n suave. Hereda el manejo de cÃ¡psula / step / snap-to-ground
 * de `KinematicCharacterBase`.
 */
const Y_AXIS = new Vector3(0, 1, 0);

export class CharacterMotor extends KinematicCharacterBase {
  private readonly actualVelocity = new Vector3();
  private readonly horizontalVelocity = new Vector3();
  private readonly desiredVelocity = new Vector3();
  private readonly forward = new Vector3(0, 0, 1);
  private readonly tmpDirection = new Vector3();
  private readonly tmpRotation = new Quaternion();
  private distanceToTarget = Number.POSITIVE_INFINITY;
  private yaw = 0;
  private targetYaw = 0;
  private enabled = true;
  private speedMultiplier = 1;

  constructor(
    physics: PhysicsWorld,
    private readonly config: CharacterMotorConfig,
  ) {
    super(physics, motorBaseOptions(physics, config));
  }

  update(
    delta: number,
    targetPosition: Vector3 | null,
    wantsMove: boolean,
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

    if (
      directionToTarget.lengthSq() >
      this.config.faceTargetDeadzone * this.config.faceTargetDeadzone
    ) {
      directionToTarget.normalize();
      this.targetYaw = Math.atan2(directionToTarget.x, directionToTarget.z);
      const turnLambda =
        this.config.turnSpeed * Math.max(0.15, 1 - this.config.rotationSmoothing);
      this.yaw = dampAngle(this.yaw, this.targetYaw, turnLambda, delta);
    }

    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).normalize();

    if (wantsMove) {
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

    const { corrected } = this.stepMovement(delta, (collider) =>
      this.shouldCollideWith(collider),
    );
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

  disable(): void {
    this.enabled = false;
    this.velocity.set(0, 0, 0);
    this.actualVelocity.set(0, 0, 0);
    this.horizontalVelocity.set(0, 0, 0);
    this.collider.setEnabled(false);
    this.body.setEnabled(false);
  }

  getVelocity(): Vector3 {
    return this.velocity.clone();
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
