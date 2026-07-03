import { Quaternion, Vector3 } from "three";
import type { PortalFrame } from "./PortalFrame";

// Entering a portal along its -Z must exit the paired portal along +Z, so the
// through-pair rotation carries a 180° flip around the exit portal's local Y.
const ROT_Y_180 = new Quaternion(0, 1, 0, 0);

const TMP_INV_Q = new Quaternion();
const TMP_DELTA_Q = new Quaternion();
const TMP_NORMAL = new Vector3();
const TMP_TO_PLANE = new Vector3();
const TMP_LOCAL = new Vector3();

export function portalNormal(frame: PortalFrame, out = new Vector3()): Vector3 {
  return out.set(0, 0, 1).applyQuaternion(frame.quaternion);
}

export function portalUp(frame: PortalFrame, out = new Vector3()): Vector3 {
  return out.set(0, 1, 0).applyQuaternion(frame.quaternion);
}

/** Rotation that maps world-space orientations at `entry` to `exit`: `exit.q * rotY(π) * entry.q⁻¹`. */
export function portalDeltaQuaternion(
  entry: PortalFrame,
  exit: PortalFrame,
  out = new Quaternion(),
): Quaternion {
  out.copy(entry.quaternion).invert();
  return out.premultiply(ROT_Y_180).premultiply(exit.quaternion);
}

export function transformPointThroughPortal(
  point: Vector3,
  entry: PortalFrame,
  exit: PortalFrame,
  out = new Vector3(),
): Vector3 {
  TMP_INV_Q.copy(entry.quaternion).invert();
  out.copy(point).sub(entry.position).applyQuaternion(TMP_INV_Q);
  out.x = -out.x;
  out.z = -out.z;
  return out.applyQuaternion(exit.quaternion).add(exit.position);
}

/** Also valid for velocities: the mapping is an isometry, so speed is preserved. */
export function transformDirectionThroughPortal(
  direction: Vector3,
  entry: PortalFrame,
  exit: PortalFrame,
  out = new Vector3(),
): Vector3 {
  portalDeltaQuaternion(entry, exit, TMP_DELTA_Q);
  return out.copy(direction).applyQuaternion(TMP_DELTA_Q);
}

export function transformQuaternionThroughPortal(
  quaternion: Quaternion,
  entry: PortalFrame,
  exit: PortalFrame,
  out = new Quaternion(),
): Quaternion {
  portalDeltaQuaternion(entry, exit, out);
  return out.multiply(quaternion);
}

/**
 * Distance along the ray (assumed normalized `direction`) to the point where
 * it crosses the portal ellipse entering from the front, or null if it
 * misses, exits maxDistance, or approaches from behind/parallel.
 */
export function intersectRayPortal(
  origin: Vector3,
  direction: Vector3,
  maxDistance: number,
  frame: PortalFrame,
): number | null {
  portalNormal(frame, TMP_NORMAL);
  const denom = direction.dot(TMP_NORMAL);
  if (denom >= -1e-6) {
    return null;
  }

  const t = TMP_TO_PLANE.copy(frame.position).sub(origin).dot(TMP_NORMAL) / denom;
  if (t <= 0 || t > maxDistance) {
    return null;
  }

  TMP_INV_Q.copy(frame.quaternion).invert();
  TMP_LOCAL.copy(origin)
    .addScaledVector(direction, t)
    .sub(frame.position)
    .applyQuaternion(TMP_INV_Q);
  const ex = TMP_LOCAL.x / frame.halfWidth;
  const ey = TMP_LOCAL.y / frame.halfHeight;
  return ex * ex + ey * ey <= 1 ? t : null;
}

/**
 * Swept crossing test: true when the segment `from → to` crosses the portal
 * plane front-to-back with the crossing point inside the ellipse scaled by
 * `ellipseMargin`. Immune to tunneling, unlike overlap checks.
 */
export function segmentCrossesPortal(
  from: Vector3,
  to: Vector3,
  frame: PortalFrame,
  ellipseMargin = 1,
): boolean {
  portalNormal(frame, TMP_NORMAL);
  const d0 = TMP_TO_PLANE.copy(from).sub(frame.position).dot(TMP_NORMAL);
  const d1 = TMP_TO_PLANE.copy(to).sub(frame.position).dot(TMP_NORMAL);
  if (d0 < 0 || d1 >= 0) {
    return false;
  }
  const t = d0 / (d0 - d1);
  TMP_INV_Q.copy(frame.quaternion).invert();
  TMP_LOCAL.copy(to)
    .sub(from)
    .multiplyScalar(t)
    .add(from)
    .sub(frame.position)
    .applyQuaternion(TMP_INV_Q);
  const ex = TMP_LOCAL.x / (frame.halfWidth * ellipseMargin);
  const ey = TMP_LOCAL.y / (frame.halfHeight * ellipseMargin);
  return ex * ex + ey * ey <= 1;
}

export interface YawPitch {
  yaw: number;
  pitch: number;
}

/**
 * Decomposes a look direction into the 'YXZ' yaw/pitch convention used by
 * the FPS camera (roll dropped — "nearest valid" orientation after a portal
 * transit). Near-vertical directions are yaw-degenerate; pass the transformed
 * camera `up` so yaw can be recovered from its horizontal projection.
 */
export function lookDirectionToYawPitch(direction: Vector3, up?: Vector3): YawPitch {
  const clampedY = Math.min(1, Math.max(-1, direction.y));
  const pitch = Math.asin(clampedY);
  if (Math.abs(clampedY) > 0.999 && up) {
    // Looking straight down the camera up projects forward; straight up it
    // projects backward — the sign flips between the two poles.
    const yaw =
      clampedY < 0 ? Math.atan2(-up.x, -up.z) : Math.atan2(up.x, up.z);
    return { yaw, pitch };
  }
  return { yaw: Math.atan2(-direction.x, -direction.z), pitch };
}
