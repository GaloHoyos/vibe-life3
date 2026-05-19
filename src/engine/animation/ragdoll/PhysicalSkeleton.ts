import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import type { Damageable } from '@shared/types/lifecycle';
import type { PhysicsWorld } from '@engine/physics/PhysicsWorld';
import type { BoneMapper } from '@engine/animation/pose/BoneMapper';
import type { PhysicalBone } from './PhysicalBone';
import {
  DefaultRagdollConfig,
  DefaultRagdollDefinition,
  type RagdollConfig,
  type RagdollPartDefinition,
} from './RagdollDefinition';
import { getBoneWorldTransform } from './PhysicsBoneLink';

export interface PhysicalSkeletonOptions {
  id: string;
  mapper: BoneMapper;
  physics: PhysicsWorld;
  config?: Partial<RagdollConfig>;
  owner?: Damageable;
}

/**
 * Live physical skeleton used as a stable Phase-B fallback.
 * Bodies are kinematic sensors and never drive the visual skeleton while alive.
 */
export class PhysicalSkeleton {
  private readonly config: RagdollConfig;
  private readonly bones: PhysicalBone[] = [];
  private enabled = true;

  constructor(private readonly options: PhysicalSkeletonOptions) {
    this.config = { ...DefaultRagdollConfig, ...options.config };
    this.buildSensorBodies();
  }

  updateFromVisualPose(): void {
    if (!this.enabled) {
      return;
    }

    this.bones.forEach((part) => {
      const transform = getBoneWorldTransform(part.bone);
      const offset = DefaultRagdollDefinition.find((definition) => definition.id === part.name)?.localOffset;
      const position = transform.position.clone().add((offset ?? new Vector3()).clone().applyQuaternion(transform.rotation));
      part.rigidBody.setNextKinematicTranslation({ x: position.x, y: Math.max(position.y, 0.08), z: position.z });
      part.rigidBody.setNextKinematicRotation(toRapierRotation(transform.rotation));
    });
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.bones.forEach((part) => {
      part.collider.setEnabled(enabled);
      part.rigidBody.setEnabled(enabled);
    });
  }

  getBones(): PhysicalBone[] {
    return [...this.bones];
  }

  getBodyCount(): number {
    return this.bones.length;
  }

  private buildSensorBodies(): void {
    DefaultRagdollDefinition.forEach((definition) => {
      const bone = this.options.mapper.get(definition.bone);
      if (!bone) {
        return;
      }

      const transform = getBoneWorldTransform(bone);
      const position = transform.position.clone().add(definition.localOffset.clone().applyQuaternion(transform.rotation));
      const body = this.options.physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(position.x, Math.max(position.y, 0.08), position.z)
          .setRotation(toRapierRotation(transform.rotation)),
      );
      const collider = this.options.physics.world.createCollider(this.createCollider(definition), body);
      collider.setSensor(true);
      this.options.physics.registerCollider(collider, {
        id: `${this.options.id}-live-part-${definition.id}`,
        kind: 'ragdoll',
        damageable: this.options.owner,
        bodyPart: {
          name: definition.id,
          damageMultiplier: definition.damageMultiplier,
        },
      });

      this.bones.push({
        name: definition.id,
        boneName: definition.bone,
        bone,
        rigidBody: body,
        collider,
        parentName: definition.parentPartName,
        mass: definition.mass,
        damping: this.config.bodyPartDamping,
        damageMultiplier: definition.damageMultiplier,
      });
    });
  }

  private createCollider(part: RagdollPartDefinition): RAPIER.ColliderDesc {
    const size = part.size.clone().multiplyScalar(this.config.colliderScale);
    const density = this.config.density * part.mass;

    if (part.shape === 'sphere') {
      return RAPIER.ColliderDesc.ball(Math.max(size.x, size.y, size.z)).setDensity(density);
    }

    if (part.shape === 'capsule') {
      return RAPIER.ColliderDesc.capsule(size.y * 0.5, Math.max(size.x, size.z) * 0.5).setDensity(density);
    }

    return RAPIER.ColliderDesc.cuboid(size.x * 0.5, size.y * 0.5, size.z * 0.5).setDensity(density);
  }
}

function toRapierRotation(quaternion: Quaternion): { x: number; y: number; z: number; w: number } {
  return {
    x: quaternion.x,
    y: quaternion.y,
    z: quaternion.z,
    w: quaternion.w,
  };
}
