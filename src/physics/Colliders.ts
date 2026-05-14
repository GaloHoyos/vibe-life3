import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';

export function createBoxCollider(size: Vector3): RAPIER.ColliderDesc {
  return RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2);
}

export function createCapsuleCollider(radius: number, halfHeight: number): RAPIER.ColliderDesc {
  return RAPIER.ColliderDesc.capsule(halfHeight, radius);
}
