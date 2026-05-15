import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { RagdollBodyPart } from './RagdollBodyPart';
import { getBoneWorldTransform } from './PhysicsBoneLink';

export class RagdollJointManager {
  private readonly joints: RAPIER.ImpulseJoint[] = [];

  constructor(private readonly physics: PhysicsWorld) {}

  connect(parts: RagdollBodyPart[]): RAPIER.ImpulseJoint[] {
    const partByName = new Map(parts.map((part) => [part.name, part]));

    parts.forEach((part) => {
      if (!part.parentPartName) {
        return;
      }

      const parent = partByName.get(part.parentPartName);
      if (!parent) {
        return;
      }

      const anchorWorld = getBoneWorldTransform(part.bone).position;
      const joint = this.physics.world.createImpulseJoint(
        RAPIER.JointData.spherical(
          worldPointToLocalBodyPoint(parent.rigidBody, anchorWorld),
          worldPointToLocalBodyPoint(part.rigidBody, anchorWorld),
        ),
        parent.rigidBody,
        part.rigidBody,
        true,
      );
      joint.setContactsEnabled(false);
      this.joints.push(joint);
    });

    return [...this.joints];
  }
}

function worldPointToLocalBodyPoint(body: RAPIER.RigidBody, worldPoint: Vector3): Vector3 {
  const translation = body.translation();
  const rotation = body.rotation();
  const inverse = new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w).invert();
  return worldPoint.clone().sub(new Vector3(translation.x, translation.y, translation.z)).applyQuaternion(inverse);
}
