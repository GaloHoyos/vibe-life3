import { Quaternion, Vector3 } from "three";
import type { PortalFrame } from "@engine/portals/PortalFrame";
import { portalNormal } from "@engine/portals/PortalMath";

export interface PortalPlayerTraversalTuning {
  radius: number;
  radiusForgiveness: number;
  passThroughProximity: number;
  funnelDepth: number;
  funnelStrength: number;
}

const HARD_ENTRY_EPSILON = 0.05;

const TMP_DELTA = new Vector3();
const TMP_LOCAL = new Vector3();
const TMP_NORMAL = new Vector3();
const TMP_INV_Q = new Quaternion();

export function playerPortalPassThroughMargin(
  tuning: PortalPlayerTraversalTuning,
): number {
  return tuning.radius + Math.max(0, tuning.radiusForgiveness);
}

export function playerPortalFitRadius(
  tuning: PortalPlayerTraversalTuning,
): number {
  return Math.max(0.05, tuning.radius - Math.max(0, tuning.radiusForgiveness));
}

export function isInsidePlayerPortalFootprint(
  position: Vector3,
  frame: PortalFrame,
  tuning: PortalPlayerTraversalTuning,
): boolean {
  TMP_DELTA.copy(position).sub(frame.position);
  if (TMP_DELTA.lengthSq() > tuning.passThroughProximity ** 2) {
    return false;
  }
  TMP_INV_Q.copy(frame.quaternion).invert();
  TMP_LOCAL.copy(TMP_DELTA).applyQuaternion(TMP_INV_Q);
  const margin = playerPortalPassThroughMargin(tuning);
  const ex = TMP_LOCAL.x / (frame.halfWidth + margin);
  const ey = TMP_LOCAL.y / (frame.halfHeight + margin);
  return ex * ex + ey * ey <= 1;
}

export function constrainPlayerPortalPosition(
  position: Vector3,
  frame: PortalFrame,
  tuning: PortalPlayerTraversalTuning,
  out = new Vector3(),
): boolean {
  out.copy(position);
  TMP_DELTA.copy(position).sub(frame.position);
  if (TMP_DELTA.lengthSq() > tuning.passThroughProximity ** 2) {
    return false;
  }

  portalNormal(frame, TMP_NORMAL);
  const depth = TMP_DELTA.dot(TMP_NORMAL);
  const vertical = Math.abs(TMP_NORMAL.y) > 0.7;
  const hardDepth = tuning.radius - HARD_ENTRY_EPSILON;
  const funnelStart = hardDepth + (vertical ? 0 : Math.max(0, tuning.funnelDepth));
  if (depth > funnelStart) {
    return false;
  }

  TMP_INV_Q.copy(frame.quaternion).invert();
  TMP_LOCAL.copy(TMP_DELTA).applyQuaternion(TMP_INV_Q);
  const margin = playerPortalPassThroughMargin(tuning);
  const fx = TMP_LOCAL.x / (frame.halfWidth + margin);
  const fy = TMP_LOCAL.y / (frame.halfHeight + margin);
  if (fx * fx + fy * fy > 1) {
    return false;
  }

  const fitRadius = playerPortalFitRadius(tuning);
  const holeHalfWidth = Math.max(frame.halfWidth - fitRadius, 0.05);
  let clampedX = clamp(TMP_LOCAL.x, -holeHalfWidth, holeHalfWidth);
  let clampedY = TMP_LOCAL.y;

  if (vertical) {
    const holeHalfHeight = Math.max(frame.halfHeight - fitRadius, 0.05);
    const overflow =
      (TMP_LOCAL.x / holeHalfWidth) ** 2 +
      (TMP_LOCAL.y / holeHalfHeight) ** 2;
    if (overflow > 1) {
      const scale = 1 / Math.sqrt(overflow);
      clampedX = TMP_LOCAL.x * scale;
      clampedY = TMP_LOCAL.y * scale;
    } else {
      clampedX = TMP_LOCAL.x;
    }
  } else if (depth > hardDepth) {
    const span = Math.max(funnelStart - hardDepth, 0.001);
    const t = clamp((funnelStart - depth) / span, 0, 1);
    const eased = t * t * (3 - 2 * t);
    const pull = clamp(tuning.funnelStrength, 0, 1) * eased;
    clampedX = lerp(TMP_LOCAL.x, clampedX, pull);
  }

  if (
    Math.abs(clampedX - TMP_LOCAL.x) < 1e-6 &&
    Math.abs(clampedY - TMP_LOCAL.y) < 1e-6
  ) {
    return false;
  }

  TMP_LOCAL.x = clampedX;
  TMP_LOCAL.y = clampedY;
  TMP_LOCAL.applyQuaternion(frame.quaternion).add(frame.position);
  out.copy(TMP_LOCAL);
  return true;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
