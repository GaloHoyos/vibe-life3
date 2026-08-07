import type RAPIER from "@dimforge/rapier3d-compat";
import type { PhysicsMetadata } from "@engine/physics/PhysicsWorld";
import type { RaycastHit } from "@engine/physics/Raycast";

export type GrabbableKind = "prop" | "ragdoll" | "flyer";

export interface GrabbableHit {
  body: RAPIER.RigidBody;
  kind: GrabbableKind;
}

/**
 * Clasifica un impacto de raycast como objetivo de agarre:
 * - `prop`: cuerpo dinámico común (`kind: 'prop'`, `kind: 'dynamic'`, sin
 *   metadata, o un pickup — armas/munición/items son cuerpos dinámicos
 *   agarrables, como los suministros que se atraen con la physcannon en HL2).
 *   Un prop del sistema de props puede vetarse a sí mismo con
 *   `grabbable: false` en su arquetipo, que se refleja en `grabExcluded`.
 * - `ragdoll`: parte de cadáver (kind `ragdoll` NO sensor; las hitboxes vivas
 *   de un NPC también son kind `ragdoll` pero sensores — usar
 *   `grabRayFilter` en el cast para que el rayo las atraviese).
 * - `flyer`: NPC volador vivo (kind `npc` con cuerpo dinámico; los NPCs
 *   terrestres son cápsulas kinemáticas y quedan excluidos por `isDynamic`).
 */
export function resolveGrabbable(hit: RaycastHit): GrabbableHit | null {
  const body = hit.collider.parent();
  if (!body || !body.isDynamic()) {
    return null;
  }
  const kind = hit.metadata?.kind;
  if (kind === "prop") {
    return hit.metadata?.grabExcluded ? null : { body, kind: "prop" };
  }
  if (kind === undefined || kind === "dynamic" || kind === "weaponPickup") {
    return { body, kind: "prop" };
  }
  if (kind === "ragdoll" && !hit.collider.isSensor()) {
    return { body, kind: "ragdoll" };
  }
  if (kind === "npc") {
    return { body, kind: "flyer" };
  }
  return null;
}

/**
 * Filtro para los raycasts de adquisición de agarre: atraviesa las hitboxes
 * sensor (partes vivas de NPCs) para pegar al cuerpo sólido de atrás.
 */
export function grabRayFilter(
  _metadata: PhysicsMetadata | undefined,
  collider: RAPIER.Collider,
): boolean {
  return !collider.isSensor();
}
