import type RAPIER from '@dimforge/rapier3d-compat';
import { Object3D, Quaternion, Vector3 } from 'three';
import type { PhysicsWorld } from '@engine/physics/PhysicsWorld';
import { PhysicsBoneLink } from './PhysicsBoneLink';
import type { RagdollBodyPart } from './RagdollBodyPart';
import type { RagdollConfig } from './RagdollDefinition';
import { RagdollPoseDriver } from './RagdollPoseDriver';

export class RagdollController {
  private active = true;
  private cleanedUp = false;
  private corpseTimer = 0;
  private readonly poseDriver = new RagdollPoseDriver();
  private readonly fallbackRootInitialScale: Vector3;

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
  }

  update(delta = 0): void {
    if (!this.active || this.cleanedUp) {
      return;
    }

    if (this.bodies.length > 0 && this.bodies.every((body) => body.isSleeping())) {
      // Sleeping corpse: simulation is free and the last synced pose stays
      // valid. External impulses (gravity gun) wake the bodies and the sync
      // resumes on its own.
      this.corpseTimer += delta;
      if (this.config.corpseCleanupDelay > 0 && this.corpseTimer >= this.config.corpseCleanupDelay) {
        this.cleanup();
      }
      return;
    }
    this.corpseTimer = 0;

    this.links.forEach((link) => this.poseDriver.apply(link));
    this.syncFallbackRoot();
  }

  /**
   * Death impulse: applied to the part that took the killing hit (chest as
   * fallback) and propagated naturally through the joints — never spread over
   * all bodies, which reads as the whole corpse drifting.
   */
  applyImpulse(direction: Vector3, magnitude: number, partName?: string): void {
    if (this.cleanedUp || direction.lengthSq() <= 0.001) {
      return;
    }

    const target = this.findImpulseTarget(partName);
    if (!target) {
      return;
    }

    const impulse = direction.clone().normalize().multiplyScalar(magnitude);
    target.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
    clampRigidBodyVelocity(target, this.config.maxPartLinearVelocity, this.config.maxPartAngularVelocity);
  }

  /** Carries the motor velocity into every body so momentum survives death. */
  inheritVelocity(currentVelocity?: Vector3): void {
    if (this.cleanedUp || !currentVelocity) {
      return;
    }

    const velocity = clampVector(currentVelocity, this.config.maxDeathLinearVelocity);
    this.bodies.forEach((body) => {
      body.setLinvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);
      clampRigidBodyVelocity(body, this.config.maxDeathLinearVelocity, this.config.maxDeathAngularVelocity);
    });
  }

  isActive(): boolean {
    return this.active;
  }

  setActive(active: boolean): void {
    this.active = active;
    if (this.cleanedUp) {
      return;
    }
    this.bodies.forEach((body) => body.setEnabled(active));
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

  private findImpulseTarget(partName?: string): RAPIER.RigidBody | null {
    if (partName) {
      const part = this.parts.find((candidate) => candidate.name === partName);
      if (part) {
        return part.rigidBody;
      }
    }
    const chest = this.parts.find((candidate) => candidate.name === 'chest');
    return chest?.rigidBody ?? this.bodies[0] ?? null;
  }

  private cleanup(): void {
    this.cleanedUp = true;
    // Bodies/joints may already be gone after PhysicsWorld.reset() on level change.
    this.joints.forEach((joint) => {
      if (joint.isValid()) {
        this.physics.world.removeImpulseJoint(joint, false);
      }
    });
    this.bodies.forEach((body) => {
      if (body.isValid()) {
        this.physics.removeBody(body);
      }
    });
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
