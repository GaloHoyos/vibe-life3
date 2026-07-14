import type RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import type { Raycast, RaycastHit } from "@engine/physics/Raycast";
import type { PhysicsMetadata } from '@engine/physics/PhysicsWorld';
import type { PortalPairState, PortalSlot } from "./PortalFrame";
import {
  intersectRayPortal,
  portalNormal,
  transformDirectionThroughPortal,
  transformPointThroughPortal,
} from "./PortalMath";

export interface PortalRaySegment {
  origin: Vector3;
  end: Vector3;
}

export interface PortalRaycastResult {
  hit: RaycastHit | null;
  /** One segment per traversed stretch; >1 means the ray jumped portals. */
  segments: PortalRaySegment[];
}

const MAX_JUMPS = 2;
// The portal disc is coplanar with the wall backing it: the portal wins ties
// against a hit within this epsilon so rays enter instead of hitting the wall.
const COPLANAR_EPSILON = 0.01;
// Re-emitted rays start slightly off the exit plane to avoid re-hitting it.
const EXIT_OFFSET = 0.03;

/**
 * Raycast that continues through the linked portal pair. Same `cast` contract
 * as `Raycast`, so it can be injected wherever a straight ray is used today
 * (NPC line of sight, hitscan weapons, projectile stepping).
 */
export class PortalRaycast {
  constructor(
    private readonly raycast: Raycast,
    private readonly pair: PortalPairState,
  ) {}

  cast(
    origin: Vector3,
    direction: Vector3,
    maxDistance: number,
    excludeBody?: RAPIER.RigidBody,
    excludeId?: string,
    filter?: (metadata: PhysicsMetadata | undefined, collider: RAPIER.Collider) => boolean,
  ): RaycastHit | null {
    return this.castSegments(origin, direction, maxDistance, excludeBody, excludeId, filter)
      .hit;
  }

  castSegments(
    origin: Vector3,
    direction: Vector3,
    maxDistance: number,
    excludeBody?: RAPIER.RigidBody,
    excludeId?: string,
    filter?: (metadata: PhysicsMetadata | undefined, collider: RAPIER.Collider) => boolean,
  ): PortalRaycastResult {
    const segments: PortalRaySegment[] = [];
    const currentOrigin = origin.clone();
    const currentDirection = direction.clone().normalize();
    let remaining = maxDistance;

    for (let jump = 0; jump <= MAX_JUMPS; jump++) {
      const hit = this.raycast.cast(
        currentOrigin,
        currentDirection,
        remaining,
        excludeBody,
        excludeId,
        filter,
      );

      const entry = this.pair.linked
        ? this.nearestPortalEntry(currentOrigin, currentDirection, remaining)
        : null;
      const portalBeatsHit =
        entry !== null &&
        (hit === null || entry.t <= hit.toi + COPLANAR_EPSILON) &&
        jump < MAX_JUMPS;

      if (!portalBeatsHit) {
        segments.push({
          origin: currentOrigin.clone(),
          end: hit
            ? hit.point.clone()
            : currentOrigin
                .clone()
                .addScaledVector(currentDirection, remaining),
        });
        return { hit, segments };
      }

      const crossing = currentOrigin
        .clone()
        .addScaledVector(currentDirection, entry.t);
      segments.push({ origin: currentOrigin.clone(), end: crossing });

      const entryFrame = this.pair.get(entry.slot);
      const exitFrame = this.pair.exitFor(entry.slot);
      if (!entryFrame || !exitFrame) {
        return { hit, segments };
      }

      transformPointThroughPortal(crossing, entryFrame, exitFrame, currentOrigin);
      transformDirectionThroughPortal(
        currentDirection,
        entryFrame,
        exitFrame,
        currentDirection,
      );
      const exitNormal = portalNormal(exitFrame);
      currentOrigin.addScaledVector(exitNormal, EXIT_OFFSET);
      remaining -= entry.t;
      if (remaining <= EXIT_OFFSET) {
        return { hit: null, segments };
      }
    }

    return { hit: null, segments };
  }

  /**
   * Projectile hook: when the swept step `position → position + direction *
   * distance` enters a portal (and no solid hit lands clearly before it),
   * mutates `position` and `direction` to the exit side and returns the
   * leftover distance to travel this frame. Returns null when nothing crosses.
   */
  projectileStep(
    position: Vector3,
    direction: Vector3,
    distance: number,
    hitToi?: number | null,
  ): number | null {
    if (!this.pair.linked) {
      return null;
    }
    const entry = this.nearestPortalEntry(position, direction, distance);
    if (!entry) {
      return null;
    }
    if (hitToi !== null && hitToi !== undefined && hitToi + COPLANAR_EPSILON < entry.t) {
      return null;
    }
    const entryFrame = this.pair.get(entry.slot);
    const exitFrame = this.pair.exitFor(entry.slot);
    if (!entryFrame || !exitFrame) {
      return null;
    }

    position.addScaledVector(direction, entry.t);
    transformPointThroughPortal(position, entryFrame, exitFrame, position);
    transformDirectionThroughPortal(direction, entryFrame, exitFrame, direction);
    position.addScaledVector(portalNormal(exitFrame), EXIT_OFFSET);
    return Math.max(0, distance - entry.t);
  }

  private nearestPortalEntry(
    origin: Vector3,
    direction: Vector3,
    maxDistance: number,
  ): { slot: PortalSlot; t: number } | null {
    let best: { slot: PortalSlot; t: number } | null = null;
    for (const slot of ["a", "b"] as const) {
      const frame = this.pair.get(slot);
      if (!frame) {
        continue;
      }
      const t = intersectRayPortal(origin, direction, maxDistance, frame);
      if (t !== null && (best === null || t < best.t)) {
        best = { slot, t };
      }
    }
    return best;
  }
}
