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
    /**
     * Descarta todo collider cuyo `metadata.id` coincida. Necesario para los
     * NPCs multi-collider (el strider tiene capsula raiz + 11 followers, todos
     * con el mismo id): `excludeBody` solo saca un rigid body; esto los saca a
     * todos. Sin esto, el LOS de un cuerpo gigante choca consigo mismo.
     */
    excludeId?: string,
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
      excludeId
        ? (collider) => {
            const meta = this.physics.getColliderMetadata(collider);
            // Por ownerId (la cápsula y sus hitboxes lo comparten), con fallback
            // a id para colliders sin ownerId.
            return (meta?.ownerId ?? meta?.id) !== excludeId;
          }
        : undefined,
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
