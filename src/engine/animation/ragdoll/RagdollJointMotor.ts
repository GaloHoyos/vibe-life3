import type RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';

export interface RagdollJointMotorConfig {
  stiffness: number;
  damping: number;
  maxTorque: number;
}

/**
 * Minimal PD-style helper kept isolated so physical active ragdoll motors can be
 * enabled later without coupling them to NPC or animation code.
 */
export class RagdollJointMotor {
  constructor(private readonly config: RagdollJointMotorConfig) {}

  applyUprightTorque(body: RAPIER.RigidBody, upError: Vector3): void {
    if (upError.lengthSq() <= 0.0001) {
      return;
    }

    const angvel = body.angvel();
    const damping = new Vector3(angvel.x, angvel.y, angvel.z).multiplyScalar(this.config.damping);
    const torque = upError.multiplyScalar(this.config.stiffness).sub(damping);
    if (torque.length() > this.config.maxTorque) {
      torque.setLength(this.config.maxTorque);
    }

    body.applyTorqueImpulse({ x: torque.x, y: torque.y, z: torque.z }, true);
  }
}
