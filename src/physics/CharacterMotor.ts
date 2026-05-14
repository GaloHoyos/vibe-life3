import RAPIER from '@dimforge/rapier3d-compat';
import { MathUtils, Quaternion, Vector3 } from 'three';
import { createCharacterCollider } from './CharacterCollider';
import type { PhysicsWorld, PhysicsMetadata } from './PhysicsWorld';

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
  gravity: number;
  stepOffset: number;
  snapToGround: number;
  metadata: PhysicsMetadata;
}

export interface CharacterMotorSnapshot {
  position: Vector3;
  velocity: Vector3;
  forward: Vector3;
  grounded: boolean;
  yaw: number;
  targetYaw: number;
}

export class CharacterMotor {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;

  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly velocity = new Vector3();
  private readonly horizontalVelocity = new Vector3();
  private readonly desiredVelocity = new Vector3();
  private readonly forward = new Vector3(0, 0, 1);
  private yaw = 0;
  private targetYaw = 0;
  private grounded = false;
  private enabled = true;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly config: CharacterMotorConfig,
  ) {
    const character = createCharacterCollider(physics, {
      id: config.id,
      position: config.position,
      height: config.height,
      radius: config.radius,
      mass: config.mass,
      metadata: config.metadata,
    });
    this.body = character.body;
    this.collider = character.collider;
    this.controller = physics.createCharacterController(0.03);
    this.controller.enableAutostep(config.stepOffset, config.radius * 0.65, true);
    this.controller.enableSnapToGround(config.snapToGround);
  }

  update(delta: number, targetPosition: Vector3 | null, wantsMove: boolean): void {
    if (!this.enabled) {
      return;
    }

    const position = this.getPosition();
    const directionToTarget = targetPosition ? targetPosition.clone().sub(position) : new Vector3();
    directionToTarget.y = 0;

    if (directionToTarget.lengthSq() > this.config.faceTargetDeadzone * this.config.faceTargetDeadzone) {
      directionToTarget.normalize();
      this.targetYaw = Math.atan2(directionToTarget.x, directionToTarget.z);
      const turnLambda = this.config.turnSpeed * Math.max(0.15, 1 - this.config.rotationSmoothing);
      this.yaw = dampAngle(this.yaw, this.targetYaw, turnLambda, delta);
    }

    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).normalize();

    if (wantsMove) {
      this.desiredVelocity.copy(this.forward).multiplyScalar(this.config.maxSpeed);
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

    const desiredMovement = this.velocity.clone().multiplyScalar(delta);
    this.controller.computeColliderMovement(this.collider, desiredMovement);
    const corrected = this.controller.computedMovement();
    const current = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: current.x + corrected.x,
      y: current.y + corrected.y,
      z: current.z + corrected.z,
    });
    this.body.setNextKinematicRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), this.yaw));
    this.grounded = this.controller.computedGrounded();

    if (this.grounded && this.velocity.y < 0) {
      this.velocity.y = 0;
    }
  }

  syncFromPhysics(): CharacterMotorSnapshot {
    const position = this.getPosition();
    return {
      position,
      velocity: this.velocity.clone(),
      forward: this.forward.clone(),
      grounded: this.grounded,
      yaw: this.yaw,
      targetYaw: this.targetYaw,
    };
  }

  disable(): void {
    this.enabled = false;
    this.velocity.set(0, 0, 0);
    this.horizontalVelocity.set(0, 0, 0);
    this.collider.setEnabled(false);
    this.body.setEnabled(false);
  }

  getPosition(): Vector3 {
    const position = this.body.translation();
    return new Vector3(position.x, position.y, position.z);
  }

  getVelocity(): Vector3 {
    return this.velocity.clone();
  }

  getYaw(): number {
    return this.yaw;
  }
}

function dampAngle(current: number, target: number, lambda: number, delta: number): number {
  const deltaAngle = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + deltaAngle * (1 - Math.exp(-lambda * delta));
}
