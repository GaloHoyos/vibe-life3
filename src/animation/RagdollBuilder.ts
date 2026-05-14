import RAPIER from '@dimforge/rapier3d-compat';
import { Bone, Object3D, Quaternion, Vector3 } from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { BoneMapper } from './BoneMapper';
import { getBoneWorldTransform, PhysicsBoneLink } from './PhysicsBoneLink';
import {
  DefaultRagdollConfig,
  DefaultRagdollDefinition,
  type RagdollConfig,
  type RagdollPartDefinition,
} from './RagdollDefinition';
import { RagdollController } from './RagdollController';

export interface RagdollBuildOptions {
  id: string;
  root: Object3D;
  mapper: BoneMapper;
  physics: PhysicsWorld;
  config?: Partial<RagdollConfig>;
  hitDirection?: Vector3;
  currentVelocity?: Vector3;
}

export class RagdollBuilder {
  build(options: RagdollBuildOptions): RagdollController {
    const config = { ...DefaultRagdollConfig, ...options.config };
    const links: PhysicsBoneLink[] = [];
    const bodies: RAPIER.RigidBody[] = [];

    DefaultRagdollDefinition.forEach((part) => {
      const bone = options.mapper.get(part.bone);
      if (!bone) {
        return;
      }

      const body = this.createBodyForBone(options, part, bone, config);
      bodies.push(body);
      links.push(new PhysicsBoneLink(bone, body, part.localOffset));
    });

    if (links.length === 0) {
      const fallbackBody = this.createFallbackBody(options.root, options.physics, config, `${options.id}-fallback`);
      const controller = new RagdollController(options.physics, [], [fallbackBody], config, options.root, fallbackBody);
      controller.clampDeathVelocity(options.currentVelocity);
      controller.applyImpulse(options.hitDirection ?? new Vector3(), config.impulseScale);
      return controller;
    }

    const controller = new RagdollController(options.physics, links, bodies, config);
    controller.clampDeathVelocity(options.currentVelocity);
    controller.applyImpulse(options.hitDirection ?? new Vector3(), config.impulseScale);

    if (config.enableJoints && config.debug) {
      // TODO: Replace the loose-linked ragdoll with tuned impulse joints per limb.
      console.warn('[RagdollBuilder] Joint constraints are reserved for the next ragdoll pass.');
    }

    return controller;
  }

  private createBodyForBone(
    options: RagdollBuildOptions,
    part: RagdollPartDefinition,
    bone: Bone,
    config: RagdollConfig,
  ): RAPIER.RigidBody {
    const transform = getBoneWorldTransform(bone);
    const position = transform.position.clone().add(part.localOffset.clone().applyQuaternion(transform.rotation));
    position.y = Math.max(position.y, 0.18);
    const body = options.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setRotation(toRapierRotation(transform.rotation))
        .setLinearDamping(config.linearDamping)
        .setAngularDamping(config.angularDamping),
    );

    const collider = options.physics.world.createCollider(this.createCollider(part, config), body);
    options.physics.registerCollider(collider, {
      id: `${options.id}-ragdoll-${part.id}`,
      kind: 'ragdoll',
    });

    return body;
  }

  private createFallbackBody(
    root: Object3D,
    physics: PhysicsWorld,
    config: RagdollConfig,
    id: string,
  ): RAPIER.RigidBody {
    const worldPosition = new Vector3();
    const worldRotation = new Quaternion();
    root.getWorldPosition(worldPosition);
    root.getWorldQuaternion(worldRotation);
    worldPosition.y = Math.max(worldPosition.y, 0.5);

    const body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(worldPosition.x, worldPosition.y, worldPosition.z)
        .setRotation(toRapierRotation(worldRotation))
        .setLinearDamping(config.linearDamping)
        .setAngularDamping(config.angularDamping),
    );
    const collider = physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.75, 0.38).setDensity(config.density),
      body,
    );
    physics.registerCollider(collider, { id, kind: 'ragdoll' });
    return body;
  }

  private createCollider(part: RagdollPartDefinition, config: RagdollConfig): RAPIER.ColliderDesc {
    const size = part.size.clone().multiplyScalar(config.colliderScale);

    if (part.shape === 'sphere') {
      return RAPIER.ColliderDesc.ball(Math.max(size.x, size.y, size.z)).setDensity(config.density * part.mass);
    }

    if (part.shape === 'capsule') {
      return RAPIER.ColliderDesc.capsule(size.y * 0.5, Math.max(size.x, size.z) * 0.5).setDensity(
        config.density * part.mass,
      );
    }

    return RAPIER.ColliderDesc.cuboid(size.x * 0.5, size.y * 0.5, size.z * 0.5).setDensity(
      config.density * part.mass,
    );
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
