import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import type { PhysicsMetadata, PhysicsWorld } from './PhysicsWorld';

export interface RaycastHit {
  collider: RAPIER.Collider;
  metadata?: PhysicsMetadata;
  point: Vector3;
  normal?: Vector3;
  toi: number;
}

export class Raycast {
  constructor(private readonly physics: PhysicsWorld) {}

  cast(origin: Vector3, direction: Vector3, maxDistance: number): RaycastHit | null {
    const normalizedDirection = direction.clone().normalize();
    const ray = new RAPIER.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: normalizedDirection.x, y: normalizedDirection.y, z: normalizedDirection.z },
    );
    const hit = this.physics.world.castRay(ray, maxDistance, true);

    if (!hit) {
      return null;
    }

    const point = origin.clone().addScaledVector(normalizedDirection, hit.timeOfImpact);

    return {
      collider: hit.collider,
      metadata: this.physics.getColliderMetadata(hit.collider),
      point,
      toi: hit.timeOfImpact,
    };
  }
}
