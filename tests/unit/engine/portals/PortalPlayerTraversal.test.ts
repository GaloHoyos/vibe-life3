import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import type { PortalFrame } from "@engine/portals/PortalFrame";
import { segmentCrossesPortal } from "@engine/portals/PortalMath";
import {
  constrainPlayerPortalPosition,
  isInsidePlayerPortalFootprint,
  type PortalPlayerTraversalTuning,
} from "@engine/portals/PortalPlayerTraversal";

const TUNING: PortalPlayerTraversalTuning = {
  radius: 0.35,
  radiusForgiveness: 0.12,
  passThroughProximity: 1.5,
  funnelDepth: 0.75,
  funnelStrength: 0.9,
};

function wallPortal(): PortalFrame {
  return {
    position: new Vector3(0, 1, 0),
    quaternion: new Quaternion(),
    halfWidth: 0.65,
    halfHeight: 1.1,
  };
}

describe("PortalPlayerTraversal", () => {
  it("widens the wall pass-through footprint for player entry forgiveness", () => {
    const portal = wallPortal();

    expect(
      isInsidePlayerPortalFootprint(new Vector3(1.08, 1, 0.2), portal, TUNING),
    ).toBe(true);
    expect(
      isInsidePlayerPortalFootprint(new Vector3(1.2, 1, 0.2), portal, TUNING),
    ).toBe(false);
  });

  it("starts funneling a wall entry before the capsule reaches the portal plane", () => {
    const portal = wallPortal();
    const position = new Vector3(0.82, 1, 0.8);
    const out = new Vector3();

    expect(constrainPlayerPortalPosition(position, portal, TUNING, out)).toBe(true);
    expect(out.x).toBeLessThan(position.x);
    expect(out.x).toBeGreaterThan(0.42);
    expect(out.z).toBeCloseTo(position.z, 6);
  });

  it("constrains a near-edge crossing into the portal trigger footprint", () => {
    const portal = wallPortal();
    const from = new Vector3(0.82, 1, 0.4);
    const to = new Vector3(0.82, 1, -0.1);
    const constrained = new Vector3();

    expect(segmentCrossesPortal(from, to, portal, 1.15)).toBe(false);
    expect(constrainPlayerPortalPosition(to, portal, TUNING, constrained)).toBe(true);
    expect(constrained.x).toBeCloseTo(0.42, 6);
    expect(segmentCrossesPortal(from, constrained, portal, 1.15)).toBe(true);
  });
});
