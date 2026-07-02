import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import type { Damageable } from '@shared/types/lifecycle';
import type { CharacterId } from '@engine/characters/CharacterDefinition';
import type { PhysicsWorld } from '@engine/physics/PhysicsWorld';
import type { BoneMapper, NormalizedBoneName } from '@engine/animation/pose/BoneMapper';
import type { PhysicalBone } from './PhysicalBone';
import { DefaultRagdollConfig, DefaultRagdollDefinition, type RagdollConfig } from './RagdollDefinition';
import { createPartCollider } from './RagdollGeometry';
import { getBoneWorldTransform } from './PhysicsBoneLink';

export interface PhysicalSkeletonOptions {
  id: string;
  mapper: BoneMapper;
  physics: PhysicsWorld;
  config?: Partial<RagdollConfig>;
  characterId?: CharacterId;
  owner?: Damageable;
}

/**
 * Live hit-detection skeleton: kinematic sensor bodies following each bone.
 * They never drive the visual skeleton nor affect the simulation while alive.
 * Sensors use the bone frame directly (they mirror the bone transform each
 * frame), unlike the passive ragdoll which uses canonical frames.
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
      part.rigidBody.setNextKinematicTranslation({
        x: transform.position.x,
        y: transform.position.y,
        z: transform.position.z,
      });
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
    const bonePositionCache = new Map<NormalizedBoneName, Vector3 | null>();
    const getBoneWorldPosition = (name: NormalizedBoneName): Vector3 | null => {
      const cached = bonePositionCache.get(name);
      if (cached !== undefined) {
        return cached ? cached.clone() : null;
      }
      const bone = this.options.mapper.get(name);
      const position = bone ? getBoneWorldTransform(bone).position : null;
      bonePositionCache.set(name, position);
      return position ? position.clone() : null;
    };

    DefaultRagdollDefinition.forEach((definition) => {
      const bone = this.options.mapper.get(definition.bone);
      if (!bone) {
        return;
      }

      const transform = getBoneWorldTransform(bone);
      const body = this.options.physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(transform.position.x, transform.position.y, transform.position.z)
          .setRotation(toRapierRotation(transform.rotation)),
      );
      const colliderDesc = createPartCollider(definition, {
        bodyRotation: transform.rotation,
        boneRotation: transform.rotation,
        bonePosition: transform.position,
        getBoneWorldPosition,
        config: this.config,
      });
      const collider = this.options.physics.world.createCollider(colliderDesc, body);
      collider.setSensor(true);
      this.options.physics.registerCollider(collider, {
        id: `${this.options.id}-live-part-${definition.id}`,
        ownerId: this.options.id,
        kind: 'ragdoll',
        damageable: this.options.owner,
        characterId: this.options.characterId,
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
        damageMultiplier: definition.damageMultiplier,
      });
    });
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
