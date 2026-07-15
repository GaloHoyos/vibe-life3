import RAPIER from "@dimforge/rapier3d-compat";
import { Euler, Quaternion, Vector3 } from "three";
import type {
  PhysicsMetadata,
  PhysicsWorld,
} from "@engine/physics/PhysicsWorld";
import type {
  CharacterMotorSnapshot,
  NpcMotor,
  SliceHit,
} from "./NpcMotor";

export interface BlobDynamicMotorConfig {
  id: string;
  position: Vector3;
  radius: number;
  mass: number;
  maxSpeed: number;
  acceleration: number;
  gravityScale: number;
  linearDamping: number;
  angularDamping: number;
  metadata: PhysicsMetadata;
}

const Y_AXIS = new Vector3(0, 1, 0);
const APPROACH_GAIN = 2.2;
const MAX_CONTROL_STEP = 1 / 20;

/**
 * Motor fisico del cuerpo principal del Blob. El planner entrega un waypoint,
 * pero el motor no teletransporta ni reemplaza la velocidad del rigid body:
 * aplica un impulso horizontal limitado al cerebro y deja que este arrastre la
 * red de gel mediante sus resortes. Gravedad, caidas, golpes y momentum externo
 * siguen perteneciendo al solver de Rapier.
 */
export class BlobDynamicMotor implements NpcMotor {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;

  private enabled = true;
  private disposed = false;
  private speedMultiplier = 1;
  private yaw = 0;
  private targetYaw = 0;
  private distanceToTarget = Number.POSITIVE_INFINITY;

  private readonly desiredVelocity = new Vector3();
  private readonly appliedVelocityDelta = new Vector3();
  private readonly forward = new Vector3(0, 0, 1);
  private readonly tmpQuaternion = new Quaternion();
  private readonly tmpEuler = new Euler(0, 0, 0, "YXZ");

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly config: BlobDynamicMotorConfig,
  ) {
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(config.position.x, config.position.y, config.position.z)
        .setGravityScale(config.gravityScale)
        .setLinearDamping(config.linearDamping)
        .setAngularDamping(config.angularDamping)
        .setCcdEnabled(true),
    );
    const volume = Math.max((4 / 3) * Math.PI * config.radius ** 3, 0.001);
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.ball(config.radius)
        .setDensity(config.mass / volume)
        .setFriction(0.9)
        .setRestitution(0.08),
      this.body,
    );
    physics.registerCollider(this.collider, config.metadata);
  }

  update(
    delta: number,
    targetPosition: Vector3 | null,
    wantsMove: boolean,
  ): void {
    if (!this.enabled || this.disposed || !this.body.isValid()) return;
    this.syncOrientationFromBody();

    const position = this.body.translation();
    if (targetPosition) {
      const dx = targetPosition.x - position.x;
      const dz = targetPosition.z - position.z;
      this.distanceToTarget = Math.hypot(dx, dz);
      if (this.distanceToTarget > 1e-5) {
        this.targetYaw = Math.atan2(dx, dz);
      }
    } else {
      this.distanceToTarget = Number.POSITIVE_INFINITY;
    }

    // La Gravity Gun u otro sistema externo es el unico dueño mientras lo
    // sostiene o cambia el body a kinematic. No frenar ni pelear su impulso.
    if (
      !this.body.isDynamic() ||
      this.physics.isHeldBody(this.body.handle)
    ) {
      this.desiredVelocity.set(0, 0, 0);
      this.appliedVelocityDelta.set(0, 0, 0);
      return;
    }

    const elapsed = finiteControlElapsed(delta);
    if (elapsed <= 0) return;
    this.computeDesiredVelocity(position, targetPosition, wantsMove);

    const velocity = this.body.linvel();
    this.appliedVelocityDelta.set(
      this.desiredVelocity.x - velocity.x,
      0,
      this.desiredVelocity.z - velocity.z,
    );
    const maxVelocityDelta = Math.max(0, this.config.acceleration) * elapsed;
    if (
      maxVelocityDelta > 0 &&
      this.appliedVelocityDelta.lengthSq() > maxVelocityDelta ** 2
    ) {
      this.appliedVelocityDelta.setLength(maxVelocityDelta);
    }
    if (maxVelocityDelta <= 0 || this.appliedVelocityDelta.lengthSq() <= 1e-10) {
      return;
    }

    this.body.applyImpulse(
      {
        x: this.appliedVelocityDelta.x * this.body.mass(),
        y: 0,
        z: this.appliedVelocityDelta.z * this.body.mass(),
      },
      true,
    );
  }

  getPosition(): Vector3 {
    const position = this.body.translation();
    return new Vector3(position.x, position.y, position.z);
  }

  getYaw(): number {
    return this.yaw;
  }

  getRotation(): Quaternion {
    const rotation = this.body.rotation();
    return new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
  }

  getVelocity(): Vector3 {
    const velocity = this.body.linvel();
    return new Vector3(velocity.x, velocity.y, velocity.z);
  }

  syncFromPhysics(): CharacterMotorSnapshot {
    this.syncOrientationFromBody();
    const velocity = this.getVelocity();
    return {
      position: this.getPosition(),
      velocity,
      desiredVelocity: this.desiredVelocity.clone(),
      forward: this.forward.clone(),
      // El soporte real lo aporta la cubierta; el motor conserva este campo
      // solo para debug/animacion y nunca lo usa para anular la gravedad.
      grounded: false,
      yaw: this.yaw,
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
    return (
      !this.body.isValid() ||
      !this.body.isDynamic() ||
      this.physics.isHeldBody(this.body.handle)
    );
  }

  consumeImpactDamage(): number {
    return 0;
  }

  // Los impactos ya llegan como impulsos fisicos al core/cubierta.
  reactToHit(): void {}

  consumeSliceHits(): SliceHit[] {
    return [];
  }

  disable(): void {
    this.enabled = false;
    this.desiredVelocity.set(0, 0, 0);
    this.appliedVelocityDelta.set(0, 0, 0);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    if (this.body.isValid()) this.physics.removeBody(this.body);
  }

  private computeDesiredVelocity(
    position: { x: number; y: number; z: number },
    targetPosition: Vector3 | null,
    wantsMove: boolean,
  ): void {
    if (!wantsMove || !targetPosition) {
      this.desiredVelocity.set(0, 0, 0);
      return;
    }
    const dx = targetPosition.x - position.x;
    const dz = targetPosition.z - position.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 1e-5) {
      this.desiredVelocity.set(0, 0, 0);
      return;
    }
    const maxSpeed = Math.max(0, this.config.maxSpeed * this.speedMultiplier);
    const speed = Math.min(maxSpeed, distance * APPROACH_GAIN);
    this.desiredVelocity.set((dx / distance) * speed, 0, (dz / distance) * speed);
  }

  private syncOrientationFromBody(): void {
    const rotation = this.body.rotation();
    this.tmpQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    this.tmpEuler.setFromQuaternion(this.tmpQuaternion);
    this.yaw = this.tmpEuler.y;
    this.forward.set(0, 0, 1).applyAxisAngle(Y_AXIS, this.yaw);
  }
}

function finiteControlElapsed(delta: number): number {
  return Number.isFinite(delta)
    ? Math.min(Math.max(0, delta), MAX_CONTROL_STEP)
    : 0;
}
