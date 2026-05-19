import type RAPIER from '@dimforge/rapier3d-compat';
import { Object3D, Quaternion, Vector3 } from 'three';
import type { PhysicsWorld } from '@engine/physics/PhysicsWorld';
import { PhysicsBoneLink } from './PhysicsBoneLink';
import type { RagdollBodyPart } from './RagdollBodyPart';
import type { RagdollConfig } from './RagdollDefinition';
import { RagdollPoseDriver } from './RagdollPoseDriver';

export class RagdollController {
  private active = true;
  private readonly poseDriver = new RagdollPoseDriver();
  private readonly fallbackRootInitialScale: Vector3;
  private highDampingTimer: number;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly links: PhysicsBoneLink[],
    private readonly parts: RagdollBodyPart[],
    private readonly bodies: RAPIER.RigidBody[],
    private readonly joints: RAPIER.ImpulseJoint[],
    private readonly config: RagdollConfig,
    private readonly fallbackRoot?: Object3D,
    private readonly fallbackBody?: RAPIER.RigidBody,
  ) {
    this.fallbackRootInitialScale = fallbackRoot?.scale.clone() ?? new Vector3(1, 1, 1);
    this.highDampingTimer = config.initialDampingDuration;
  }

  update(delta = 0): void {
    if (!this.active) {
      return;
    }

    if (this.highDampingTimer > 0) {
      this.highDampingTimer = Math.max(0, this.highDampingTimer - delta);
      this.bodies.forEach((body) => {
        body.setLinearDamping(this.config.linearDamping * 1.8);
        body.setAngularDamping(this.config.angularDamping * 1.8);
      });
    }

    this.links.forEach((link) => this.poseDriver.apply(link));
    this.syncFallbackRoot();
  }

  applyImpulse(direction: Vector3, scale: number, partName?: string): void {
    if (direction.lengthSq() <= 0.001) {
      return;
    }

    const impulse = direction.clone().normalize().multiplyScalar(scale);
    const targetParts = partName ? this.parts.filter((part) => part.name === partName) : [];
    const targetBodies = targetParts.length > 0 ? targetParts.map((part) => part.rigidBody) : this.bodies;

    targetBodies.forEach((body) => {
      body.applyImpulse({ x: impulse.x, y: Math.max(0, impulse.y) * 0.15, z: impulse.z }, true);
      clampRigidBodyVelocity(body, this.config.maxDeathLinearVelocity, this.config.maxDeathAngularVelocity);
    });
  }

  clampDeathVelocity(currentVelocity?: Vector3): void {
    const baseVelocity = currentVelocity ? clampVector(currentVelocity, this.config.maxDeathLinearVelocity) : new Vector3();

    this.bodies.forEach((body) => {
      body.setLinvel({ x: baseVelocity.x * 0.35, y: Math.max(baseVelocity.y, 0) * 0.15, z: baseVelocity.z * 0.35 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      clampRigidBodyVelocity(body, this.config.maxDeathLinearVelocity, this.config.maxDeathAngularVelocity);
    });
  }

  isActive(): boolean {
    return this.active;
  }

  setActive(active: boolean): void {
    this.active = active;
    this.bodies.forEach((body) => body.setEnabled(active));
  }

  setPassive(): void {
    this.bodies.forEach((body) => {
      body.setLinearDamping(this.config.linearDamping);
      body.setAngularDamping(this.config.angularDamping);
    });
  }

  getBodyCount(): number {
    return this.bodies.length;
  }

  getPartCount(): number {
    return this.parts.length;
  }

  getJointCount(): number {
    return this.joints.length;
  }

  private syncFallbackRoot(): void {
    if (!this.fallbackRoot || !this.fallbackBody) {
      return;
    }

    const translation = this.fallbackBody.translation();
    const rotation = this.fallbackBody.rotation();
    const quaternion = new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w).normalize();

    const worldPosition = new Vector3(translation.x, translation.y, translation.z);
    const parent = this.fallbackRoot.parent;

    if (parent) {
      parent.updateWorldMatrix(true, false);
      this.fallbackRoot.position.copy(parent.worldToLocal(worldPosition));
      const parentRotation = new Quaternion();
      parent.getWorldQuaternion(parentRotation);
      this.fallbackRoot.quaternion.copy(parentRotation.invert().multiply(quaternion));
    } else {
      this.fallbackRoot.position.copy(worldPosition);
      this.fallbackRoot.quaternion.copy(quaternion);
    }

    this.fallbackRoot.scale.copy(this.fallbackRootInitialScale);
  }
}

function clampVector(vector: Vector3, maxLength: number): Vector3 {
  const result = vector.clone();
  if (result.length() > maxLength) {
    result.setLength(maxLength);
  }

  return result;
}

function clampRigidBodyVelocity(body: RAPIER.RigidBody, maxLinear: number, maxAngular: number): void {
  const linvel = body.linvel();
  const angvel = body.angvel();
  const linear = clampVector(new Vector3(linvel.x, linvel.y, linvel.z), maxLinear);
  const angular = clampVector(new Vector3(angvel.x, angvel.y, angvel.z), maxAngular);

  body.setLinvel({ x: linear.x, y: linear.y, z: linear.z }, true);
  body.setAngvel({ x: angular.x, y: angular.y, z: angular.z }, true);
}
