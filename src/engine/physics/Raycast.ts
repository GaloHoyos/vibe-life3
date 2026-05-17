import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import type { PhysicsMetadata, PhysicsWorld } from "./PhysicsWorld";

export interface RaycastHit {
  collider: RAPIER.Collider;
  metadata?: PhysicsMetadata;
  point: Vector3;
  normal?: Vector3;
  toi: number;
}

/**
 * Lanza un rayo en el `PhysicsWorld` y devuelve el primer impacto con
 * `metadata` enriquecida (id, kind, body part). Disparos de armas, line
 * of sight de NPCs e interacciones lo usan.
 */
export class Raycast {
  constructor(private readonly physics: PhysicsWorld) {}

  cast(
    origin: Vector3,
    direction: Vector3,
    maxDistance: number,
    excludeBody?: RAPIER.RigidBody,
  ): RaycastHit | null {
    const normalizedDirection = direction.clone().normalize();
    const ray = new RAPIER.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      {
        x: normalizedDirection.x,
        y: normalizedDirection.y,
        z: normalizedDirection.z,
      },
    );
    const hit = this.physics.world.castRayAndGetNormal(
      ray,
      maxDistance,
      true,
      undefined,
      undefined,
      undefined,
      excludeBody,
    );

    if (!hit) {
      return null;
    }

    const point = origin
      .clone()
      .addScaledVector(normalizedDirection, hit.timeOfImpact);

    return {
      collider: hit.collider,
      metadata: this.physics.getColliderMetadata(hit.collider),
      point,
      normal: new Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      toi: hit.timeOfImpact,
    };
  }
}
