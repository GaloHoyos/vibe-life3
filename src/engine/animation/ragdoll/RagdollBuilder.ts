import RAPIER from '@dimforge/rapier3d-compat';
import { Object3D, Quaternion, Vector3 } from 'three';
import type { Damageable } from '@shared/types/lifecycle';
import type { CharacterId } from '@engine/characters/CharacterDefinition';
import type { PhysicsWorld } from '@engine/physics/PhysicsWorld';
import { RAGDOLL_COLLISION_GROUPS } from '@engine/physics/CollisionGroups';
import type { BoneMapper, NormalizedBoneName } from '@engine/animation/pose/BoneMapper';
import { getBoneWorldTransform, PhysicsBoneLink } from './PhysicsBoneLink';
import type { RagdollBodyPart } from './RagdollBodyPart';
import { DefaultRagdollConfig, DefaultRagdollDefinition, type RagdollConfig } from './RagdollDefinition';
import { createPartCollider } from './RagdollGeometry';
import { RagdollController } from './RagdollController';
import { RagdollJointManager } from './RagdollJointManager';
import type { RagdollRestPose } from './RagdollRestPose';

export interface RagdollBuildOptions {
  id: string;
  root: Object3D;
  mapper: BoneMapper;
  physics: PhysicsWorld;
  config?: Partial<RagdollConfig>;
  characterId?: CharacterId;
  owner?: Damageable;
  restPose?: RagdollRestPose | null;
}

export class RagdollBuilder {
  build(options: RagdollBuildOptions): RagdollController {
    const config = { ...DefaultRagdollConfig, ...options.config };
    const links: PhysicsBoneLink[] = [];
    const bodies: RAPIER.RigidBody[] = [];
    const parts: RagdollBodyPart[] = [];

    const bonePositionCache = new Map<NormalizedBoneName, Vector3 | null>();
    const getBoneWorldPosition = (name: NormalizedBoneName): Vector3 | null => {
      const cached = bonePositionCache.get(name);
      if (cached !== undefined) {
        return cached ? cached.clone() : null;
      }
      const bone = options.mapper.get(name);
      const position = bone ? getBoneWorldTransform(bone).position : null;
      bonePositionCache.set(name, position);
      return position ? position.clone() : null;
    };

    DefaultRagdollDefinition.forEach((part) => {
      const bone = options.mapper.get(part.bone);
      if (!bone) {
        return;
      }

      const transform = getBoneWorldTransform(bone);
      const restRel = options.restPose?.boneRotRelRoot.get(part.bone) ?? null;
      // Canonical frame: with `bodyRotation = qBoneNow * restRel^-1` every body
      // shares one world orientation whenever the pose matches the bind pose,
      // so joint zero = bind pose and joint limits use character-space axes.
      const bodyRotation = restRel
        ? transform.rotation.clone().multiply(restRel.clone().invert())
        : transform.rotation.clone();

      const body = options.physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(transform.position.x, transform.position.y, transform.position.z)
          .setRotation({ x: bodyRotation.x, y: bodyRotation.y, z: bodyRotation.z, w: bodyRotation.w })
          .setLinearDamping(config.linearDamping)
          .setAngularDamping(config.angularDamping)
          .setCcdEnabled(true),
      );

      const colliderDesc = createPartCollider(part, {
        bodyRotation,
        boneRotation: transform.rotation,
        bonePosition: transform.position,
        getBoneWorldPosition,
        config,
      })
        .setMass(part.mass)
        .setFriction(config.friction)
        .setCollisionGroups(RAGDOLL_COLLISION_GROUPS);
      const collider = options.physics.world.createCollider(colliderDesc, body);
      options.physics.registerCollider(collider, {
        id: `${options.id}-ragdoll-${part.id}`,
        ownerId: options.id,
        kind: 'ragdoll',
        damageable: options.owner,
        characterId: options.characterId,
        bodyPart: {
          name: part.id,
          damageMultiplier: part.damageMultiplier,
        },
      });

      bodies.push(body);
      parts.push({
        name: part.id,
        boneName: part.bone,
        bone,
        rigidBody: body,
        collider,
        parentPartName: part.parentPartName,
        damageMultiplier: part.damageMultiplier,
      });
      links.push(new PhysicsBoneLink(bone, body, restRel ?? new Quaternion()));
    });

    if (links.length === 0) {
      const fallbackBody = this.createFallbackBody(options, config, `${options.id}-fallback`);
      return new RagdollController(options.physics, [], [], [fallbackBody], [], config, options.root, fallbackBody);
    }

    const joints = config.enableJoints
      ? new RagdollJointManager(options.physics).connect(parts, options.restPose ?? null)
      : [];
    return new RagdollController(options.physics, links, parts, bodies, joints, config);
  }

  private createFallbackBody(
    options: RagdollBuildOptions,
    config: RagdollConfig,
    id: string,
  ): RAPIER.RigidBody {
    const worldPosition = new Vector3();
    const worldRotation = new Quaternion();
    options.root.getWorldPosition(worldPosition);
    options.root.getWorldQuaternion(worldRotation);

    const body = options.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(worldPosition.x, worldPosition.y, worldPosition.z)
        .setRotation({ x: worldRotation.x, y: worldRotation.y, z: worldRotation.z, w: worldRotation.w })
        .setLinearDamping(config.linearDamping)
        .setAngularDamping(config.angularDamping)
        .setCcdEnabled(true),
    );
    const collider = options.physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.55, 0.3)
        .setMass(60)
        .setFriction(config.friction)
        .setCollisionGroups(RAGDOLL_COLLISION_GROUPS),
      body,
    );
    options.physics.registerCollider(collider, {
      id,
      ownerId: options.id,
      kind: 'ragdoll',
      damageable: options.owner,
      characterId: options.characterId,
    });
    return body;
  }
}
