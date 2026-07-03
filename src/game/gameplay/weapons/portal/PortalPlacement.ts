import type RAPIER from "@dimforge/rapier3d-compat";
import { Matrix4, Quaternion, Vector3 } from "three";
import type { Raycast } from "@engine/physics/Raycast";
import type { PortalFrame } from "@engine/portals/PortalFrame";
import { PortalConfig } from "@game/config/portal.config";

export interface PortalPlacementOptions {
  range: number;
  halfWidth: number;
  halfHeight: number;
  /** Player planar forward; orients the "up" of floor/ceiling portals. */
  planarForward: Vector3;
  /**
   * Shooter collider id to exclude. The placement ray starts at the eye,
   * INSIDE the shooter's capsule: without this the solid raycast returns the
   * capsule itself at toi 0 and every placement fails.
   */
  excludeId?: string;
}

export interface PortalPlacementResult {
  frame: PortalFrame;
  /**
   * Static colliders backing the portal footprint (surface hit + fit probes).
   * Traversal excludes them from the character controller while transiting.
   */
  backingColliders: RAPIER.Collider[];
}

const WORLD_UP = new Vector3(0, 1, 0);
const WORLD_X = new Vector3(1, 0, 0);

/**
 * Validates a portal shot: surface must be static, and the whole ellipse
 * footprint must lie on flat coplanar static geometry (8 perimeter probes).
 * Returns null when the placement is invalid.
 */
export function computePortalPlacement(
  raycast: Raycast,
  origin: Vector3,
  direction: Vector3,
  options: PortalPlacementOptions,
): PortalPlacementResult | null {
  const hit = raycast.cast(
    origin,
    direction,
    options.range,
    undefined,
    options.excludeId,
  );
  if (!hit || hit.metadata?.kind !== "static" || !hit.normal) {
    return null;
  }

  const normal = hit.normal.clone().normalize();
  const up = computePortalUp(normal, options.planarForward);
  const right = new Vector3().crossVectors(up, normal).normalize();
  const quaternion = new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(right, up, normal),
  );
  const frame: PortalFrame = {
    position: hit.point.clone(),
    quaternion,
    halfWidth: options.halfWidth,
    halfHeight: options.halfHeight,
  };

  const backing = probeFootprint(
    raycast,
    frame,
    normal,
    hit.collider,
    options.excludeId,
  );
  if (!backing) {
    return null;
  }
  return { frame, backingColliders: backing };
}

function computePortalUp(normal: Vector3, planarForward: Vector3): Vector3 {
  if (Math.abs(normal.y) < PortalConfig.placement.wallNormalYMax) {
    return WORLD_UP.clone().addScaledVector(normal, -normal.y).normalize();
  }
  const up = planarForward
    .clone()
    .addScaledVector(normal, -planarForward.dot(normal));
  if (up.lengthSq() < 1e-6) {
    up.copy(WORLD_X).addScaledVector(normal, -normal.x);
  }
  return up.normalize();
}

function probeFootprint(
  raycast: Raycast,
  frame: PortalFrame,
  normal: Vector3,
  surfaceCollider: RAPIER.Collider,
  excludeId?: string,
): RAPIER.Collider[] | null {
  const cfg = PortalConfig.placement;
  const colliders: RAPIER.Collider[] = [surfaceCollider];
  const probeDirection = normal.clone().negate();
  const local = new Vector3();
  const probeOrigin = new Vector3();

  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    local.set(
      frame.halfWidth * Math.cos(angle),
      frame.halfHeight * Math.sin(angle),
      0,
    );
    probeOrigin
      .copy(local)
      .applyQuaternion(frame.quaternion)
      .add(frame.position)
      .addScaledVector(normal, cfg.probeLift);

    // También acá: colocando a los pies, la cápsula del tirador puede quedar
    // dentro del recorrido del probe.
    const probe = raycast.cast(
      probeOrigin,
      probeDirection,
      cfg.probeMaxDistance,
      undefined,
      excludeId,
    );
    if (
      !probe ||
      probe.metadata?.kind !== "static" ||
      probe.toi < cfg.probeToiMin ||
      probe.toi > cfg.probeToiMax ||
      !probe.normal ||
      probe.normal.dot(normal) < cfg.normalAlignMin
    ) {
      return null;
    }
    if (!colliders.some((c) => c.handle === probe.collider.handle)) {
      colliders.push(probe.collider);
    }
  }
  return colliders;
}

/** True when both frames sit on near-coplanar planes with overlapping footprints. */
export function portalsOverlap(a: PortalFrame, b: PortalFrame): boolean {
  const normalA = new Vector3(0, 0, 1).applyQuaternion(a.quaternion);
  const normalB = new Vector3(0, 0, 1).applyQuaternion(b.quaternion);
  if (normalA.dot(normalB) < 0.9) {
    return false;
  }
  const offset = new Vector3().subVectors(b.position, a.position);
  if (Math.abs(offset.dot(normalA)) > 0.1) {
    return false;
  }
  // Coarse bounding-circle test with the larger semi-axis of each ellipse.
  const minSeparation =
    Math.max(a.halfWidth, a.halfHeight) + Math.max(b.halfWidth, b.halfHeight);
  return offset.lengthSq() < minSeparation * minSeparation;
}
