import RAPIER from "@dimforge/rapier3d-compat";
import { Euler, Quaternion, Vector3 } from "three";
import { createCapsuleCollider } from "@engine/physics/Colliders";
import { ACTOR_COLLISION_GROUPS } from "@engine/physics/CollisionGroups";
import {
  PHYSICS_FIXED_TIMESTEP,
  type PhysicsMetadata,
  type PhysicsWorld,
} from "@engine/physics/PhysicsWorld";
import type { CharacterMotorSnapshot, NpcMotor, SliceHit } from "./NpcMotor";
import {
  applyCharacterContactDamping,
  isPassThroughCharacterContact,
  sampleCharacterMedium,
} from "./CharacterContactMedium";
import { PendingKinematicTarget } from "./PendingKinematicTarget";

/** Margen del clamp anti-desync del objetivo pendiente. */
const PENDING_SAFETY_MARGIN = 0.5;

export interface KinematicFlyerConfig {
  id: string;
  position: Vector3;
  height: number;
  radius: number;
  mass: number;
  maxSpeed: number;
  acceleration: number;
  turnSpeed: number;
  metadata: PhysicsMetadata;
}

const Y_AXIS = new Vector3(0, 1, 0);
const tmpQuat = new Quaternion();
const tmpEuler = new Euler(0, 0, 0, "YXZ");

/**
 * Motor aereo cinematico para bosses grandes. A diferencia del manhack, no es
 * un cuerpo dinamico mientras vive, por lo que la gravity gun no lo puede
 * agarrar. Al morir pasa a dinamico con gravedad para caer como wreckage.
 */
export class KinematicFlyerMotor implements NpcMotor {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;

  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly velocity = new Vector3();
  private readonly desiredVelocity = new Vector3();
  private readonly actualVelocity = new Vector3();
  private readonly forward = new Vector3(0, 0, 1);
  private readonly tmpDirection = new Vector3();
  private readonly tmpFacing = new Vector3();
  private readonly tmpRotation = new Quaternion();
  private readonly tmpNext = new Vector3();
  private readonly pending: PendingKinematicTarget;

  private enabled = true;
  private alive = true;
  private speedMultiplier = 1;
  private contactSpeedMultiplier = 1;
  private yaw = 0;
  private targetYaw = 0;
  private distanceToTarget = Number.POSITIVE_INFINITY;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly config: KinematicFlyerConfig,
  ) {
    const halfHeight = Math.max((config.height - config.radius * 2) / 2, 0.05);
    const volume = Math.max(Math.PI * config.radius * config.radius * config.height, 0.001);
    const density = config.mass / volume;

    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(config.position.x, config.position.y, config.position.z)
        .setCcdEnabled(true),
    );
    this.collider = physics.world.createCollider(
      createCapsuleCollider(config.radius, halfHeight)
        .setDensity(density)
        .setFriction(0.7)
        .setRestitution(0.12)
        .setCollisionGroups(ACTOR_COLLISION_GROUPS),
      this.body,
    );
    physics.registerCollider(this.collider, config.metadata);
    this.controller = physics.createCharacterController(0.04);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(config.mass);
    this.pending = new PendingKinematicTarget(config.position);
  }

  update(
    delta: number,
    targetPosition: Vector3 | null,
    wantsMove: boolean,
    facingTarget: Vector3 | null = null,
  ): void {
    if (!this.enabled || !this.alive) return;

    const position = this.getPosition();
    const directionToTarget = this.tmpDirection;
    if (targetPosition) {
      directionToTarget.copy(targetPosition).sub(position);
    } else {
      directionToTarget.set(0, 0, 0);
    }
    this.distanceToTarget = directionToTarget.length();

    const directionToFace = this.tmpFacing;
    if (facingTarget) {
      directionToFace.copy(facingTarget).sub(position);
    } else {
      directionToFace.copy(directionToTarget);
    }
    directionToFace.y = 0;
    if (directionToFace.lengthSq() > 0.0025) {
      directionToFace.normalize();
      this.targetYaw = Math.atan2(directionToFace.x, directionToFace.z);
      this.yaw = dampAngle(this.yaw, this.targetYaw, this.config.turnSpeed, delta);
    }
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).normalize();

    if (wantsMove && directionToTarget.lengthSq() > 0.0001) {
      const d = directionToTarget.length();
      directionToTarget.divideScalar(d);
      const max =
        this.config.maxSpeed *
        this.speedMultiplier *
        this.contactSpeedMultiplier;
      const arriveSpeed = Math.min(max, d * 1.8);
      this.desiredVelocity.copy(directionToTarget).multiplyScalar(arriveSpeed);
    } else {
      this.desiredVelocity.set(0, 0, 0);
    }

    const blend = 1 - Math.exp(-this.config.acceleration * delta);
    this.velocity.lerp(this.desiredVelocity, blend);

    const current = this.body.translation();
    // Objetivo pendiente: la física corre a paso fijo y el commit del cuerpo
    // sólo ocurre dentro de `world.step()` (ver PendingKinematicTarget).
    const desiredMove = this.pending.computeDesired(
      current,
      this.velocity,
      delta,
      this.velocity.length() * PHYSICS_FIXED_TIMESTEP + PENDING_SAFETY_MARGIN,
    );
    // filterGroups explícito: sin esto la query ignora los collision groups
    // del collider movido (ver KinematicCharacterBase.stepMovement).
    this.controller.computeColliderMovement(
      this.collider,
      desiredMove,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      this.collider.collisionGroups(),
      (collider) => this.shouldCollideWith(collider),
    );
    const frameDisplacement = this.pending.commit(
      current,
      this.controller.computedMovement(),
    );
    const next = this.pending.read(this.tmpNext);
    this.body.setNextKinematicTranslation(next);
    const medium = sampleCharacterMedium({
      physics: this.physics,
      collider: this.collider,
      position: next,
      rotation: this.body.rotation(),
      velocity: this.velocity,
      delta,
      characterMass: this.config.mass,
    });
    this.contactSpeedMultiplier = medium?.speedScale ?? 1;
    applyCharacterContactDamping(this.velocity, medium, delta);
    this.body.setNextKinematicRotation(this.tmpRotation.setFromAxisAngle(Y_AXIS, this.yaw));

    const invDelta = delta > 0 ? 1 / delta : 0;
    this.actualVelocity.set(
      frameDisplacement.x * invDelta,
      frameDisplacement.y * invDelta,
      frameDisplacement.z * invDelta,
    );
  }

  getPosition(): Vector3 {
    // Al morir el cuerpo pasa a dinámico y el objetivo pendiente deja de tener
    // sentido: la pose la manda el solver.
    if (!this.body.isKinematic()) {
      const p = this.body.translation();
      return new Vector3(p.x, p.y, p.z);
    }
    return this.pending.read(new Vector3());
  }

  resyncPendingFromBody(): void {
    this.pending.reset(this.body.translation());
  }

  getYaw(): number {
    if (!this.alive) this.syncYawFromBody();
    return this.yaw;
  }

  getRotation(): Quaternion {
    const r = this.body.rotation();
    return new Quaternion(r.x, r.y, r.z, r.w);
  }

  getVelocity(): Vector3 {
    if (this.body.isDynamic()) {
      const v = this.body.linvel();
      return new Vector3(v.x, v.y, v.z);
    }
    return this.actualVelocity.clone();
  }

  syncFromPhysics(): CharacterMotorSnapshot {
    const velocity = this.getVelocity();
    return {
      position: this.getPosition(),
      velocity,
      desiredVelocity: this.desiredVelocity.clone(),
      forward: this.forward.clone(),
      grounded: false,
      yaw: this.getYaw(),
      targetYaw: this.targetYaw,
      distanceToTarget: this.distanceToTarget,
    };
  }

  setSpeedMultiplier(multiplier: number): void {
    this.speedMultiplier = Math.max(0, multiplier);
  }

  leapTo(): void {}

  isLeaping(): boolean {
    return false;
  }

  isIncapacitated(): boolean {
    return !this.alive;
  }

  consumeImpactDamage(): number {
    return 0;
  }

  reactToHit(direction: Vector3, amount: number): void {
    if (!this.alive) return;
    const knock = Math.min(amount * 0.025, 1.2);
    this.velocity.addScaledVector(direction, knock);
  }

  consumeSliceHits(): SliceHit[] {
    return [];
  }

  disable(): void {
    if (!this.enabled || !this.alive) return;
    this.alive = false;
    this.enabled = false;
    this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.body.setGravityScale(1, true);
    this.body.setLinvel(
      {
        x: this.actualVelocity.x * 0.45,
        y: Math.min(this.actualVelocity.y, -4.5),
        z: this.actualVelocity.z * 0.45,
      },
      true,
    );
    this.body.setAngvel(
      {
        x: (Math.random() * 2 - 1) * 2.4,
        y: (Math.random() * 2 - 1) * 1.5,
        z: (Math.random() * 2 - 1) * 3.2,
      },
      true,
    );
  }

  private shouldCollideWith(collider: RAPIER.Collider): boolean {
    if (collider.handle === this.collider.handle || collider.isSensor()) return false;
    if (isPassThroughCharacterContact(this.physics, collider)) return false;
    const metadata = this.physics.getColliderMetadata(collider);
    return metadata?.damageable !== this.config.metadata.damageable;
  }

  private syncYawFromBody(): void {
    const r = this.body.rotation();
    tmpQuat.set(r.x, r.y, r.z, r.w);
    tmpEuler.setFromQuaternion(tmpQuat);
    this.yaw = tmpEuler.y;
  }
}

function dampAngle(current: number, target: number, lambda: number, delta: number): number {
  const deltaAngle = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + deltaAngle * (1 - Math.exp(-lambda * delta));
}
