import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import type { PhysicsWorld } from '@engine/physics/PhysicsWorld';
import type { RagdollBodyPart } from './RagdollBodyPart';
import {
  DefaultRagdollDefinition,
  DefaultRagdollJoints,
  type RagdollJointDefinition,
  type RagdollPartId,
} from './RagdollDefinition';
import { getBoneWorldTransform } from './PhysicsBoneLink';
import type { RagdollRestPose } from './RagdollRestPose';

// RawJointAxis is not re-exported by rapier3d-compat, but the raw impulse
// joint set is public and Rapier stores every impulse joint as a GenericJoint,
// so per-axis angular limits also work on spherical joints (the typed wrapper
// only exposes setLimits on unit joints). Axis ids: AngX=3, AngY=4, AngZ=5.
type RawImpulseJointSet = RAPIER.World['impulseJoints']['raw'];
type RawAxis = Parameters<RawImpulseJointSet['jointSetLimits']>[1];
const RAW_ANG_X = 3 as RawAxis;
const RAW_ANG_Y = 4 as RawAxis;
const RAW_ANG_Z = 5 as RawAxis;

const MIN_BEND_SIN = 0.05;

export class RagdollJointManager {
  constructor(private readonly physics: PhysicsWorld) {}

  /**
   * Connects each part to its parent with anatomical limits. Anchors and axes
   * are only correct under canonical body frames (both bodies share the same
   * local basis at bind pose): `JointData.revolute` takes a single axis vector
   * used verbatim in both bodies' local spaces, and ball limits are set on the
   * canonical X/Y/Z axes.
   */
  connect(parts: RagdollBodyPart[], restPose: RagdollRestPose | null): RAPIER.ImpulseJoint[] {
    const joints: RAPIER.ImpulseJoint[] = [];
    const partByName = new Map<RagdollPartId, RagdollBodyPart>(parts.map((part) => [part.name, part]));
    const definitionByChild = new Map<RagdollPartId, RagdollJointDefinition>(
      DefaultRagdollJoints.map((joint) => [joint.child, joint]),
    );

    parts.forEach((part) => {
      if (!part.parentPartName) {
        return;
      }
      const parent = partByName.get(part.parentPartName);
      if (!parent) {
        return;
      }

      const definition = definitionByChild.get(part.name);
      const anchorWorld = getBoneWorldTransform(part.bone).position;
      const anchor1 = worldPointToLocalBodyPoint(parent.rigidBody, anchorWorld);
      const anchor2 = worldPointToLocalBodyPoint(part.rigidBody, anchorWorld);

      if (definition?.kind === 'hinge') {
        const axis = resolveHingeAxis(definition, part, parent, restPose);
        const joint = this.physics.world.createImpulseJoint(
          RAPIER.JointData.revolute(anchor1, anchor2, axis),
          parent.rigidBody,
          part.rigidBody,
          true,
        );
        joint.setContactsEnabled(false);
        // Limits must be set at runtime: JointData.intoRaw ignores them for revolute.
        if (definition.limits && joint instanceof RAPIER.RevoluteImpulseJoint) {
          joint.setLimits(definition.limits.min, definition.limits.max);
        }
        joints.push(joint);
        return;
      }

      const joint = this.physics.world.createImpulseJoint(
        RAPIER.JointData.spherical(anchor1, anchor2),
        parent.rigidBody,
        part.rigidBody,
        true,
      );
      joint.setContactsEnabled(false);
      const ballLimits = definition?.ballLimits;
      if (ballLimits) {
        const raw = this.physics.world.impulseJoints.raw;
        if (ballLimits.angX) {
          raw.jointSetLimits(joint.handle, RAW_ANG_X, ballLimits.angX.min, ballLimits.angX.max);
        }
        if (ballLimits.angY) {
          raw.jointSetLimits(joint.handle, RAW_ANG_Y, ballLimits.angY.min, ballLimits.angY.max);
        }
        if (ballLimits.angZ) {
          raw.jointSetLimits(joint.handle, RAW_ANG_Z, ballLimits.angZ.min, ballLimits.angZ.max);
        }
      }
      joints.push(joint);
    });

    return joints;
  }
}

/**
 * Derives the hinge axis from the natural bend present in the bind pose
 * (cross of parent/child segment directions in canonical space), so positive
 * rotation = deeper flexion regardless of the rig. Falls back to the
 * definition axis when the chain is too straight to define a bend plane.
 */
function resolveHingeAxis(
  definition: RagdollJointDefinition,
  part: RagdollBodyPart,
  parent: RagdollBodyPart,
  restPose: RagdollRestPose | null,
): Vector3 {
  const fallback = definition.axis?.clone().normalize() ?? new Vector3(1, 0, 0);
  if (!definition.deriveAxisFromRestBend || !restPose) {
    return fallback;
  }

  const partDefinition = DefaultRagdollDefinition.find((candidate) => candidate.id === part.name);
  const nextBone = partDefinition?.lengthTarget;
  const parentPos = restPose.bonePosRelRoot.get(parent.boneName);
  const childPos = restPose.bonePosRelRoot.get(part.boneName);
  const nextPos = nextBone ? restPose.bonePosRelRoot.get(nextBone) : undefined;
  if (!parentPos || !childPos || !nextPos) {
    return fallback;
  }

  const parentDir = childPos.clone().sub(parentPos).normalize();
  const childDir = nextPos.clone().sub(childPos).normalize();
  const axis = parentDir.cross(childDir);
  if (axis.length() < MIN_BEND_SIN) {
    return fallback;
  }
  return axis.normalize();
}

function worldPointToLocalBodyPoint(body: RAPIER.RigidBody, worldPoint: Vector3): Vector3 {
  const translation = body.translation();
  const rotation = body.rotation();
  const inverse = new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w).invert();
  return worldPoint.clone().sub(new Vector3(translation.x, translation.y, translation.z)).applyQuaternion(inverse);
}
