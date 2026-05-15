import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import { createCapsuleCollider } from './Colliders';
import type { PhysicsWorld, PhysicsMetadata } from './PhysicsWorld';

export interface CharacterColliderConfig {
  id: string;
  position: Vector3;
  height: number;
  radius: number;
  mass: number;
  metadata: PhysicsMetadata;
}

export interface CharacterCollider {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

export function createCharacterCollider(physics: PhysicsWorld, config: CharacterColliderConfig): CharacterCollider {
  const body = physics.world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      config.position.x,
      config.position.y,
      config.position.z,
    ),
  );
  const collider = physics.world.createCollider(
    createCapsuleCollider(config.radius, getCapsuleHalfHeight(config.height, config.radius)),
    body,
  );
  physics.registerCollider(collider, config.metadata);

  return { body, collider };
}

function getCapsuleHalfHeight(height: number, radius: number): number {
  return Math.max((height - radius * 2) / 2, 0.05);
}
