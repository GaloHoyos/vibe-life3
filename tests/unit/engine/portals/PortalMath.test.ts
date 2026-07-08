import { describe, expect, it } from "vitest";
import { Euler, Quaternion, Vector3 } from "three";
import type { PortalFrame } from "@engine/portals/PortalFrame";
import { PortalPairState } from "@engine/portals/PortalFrame";
import {
  intersectRayPortal,
  lookDirectionToYawPitch,
  portalDeltaQuaternion,
  portalNormal,
  segmentCrossesPortal,
  transformDirectionThroughPortal,
  transformPointThroughPortal,
  transformQuaternionThroughPortal,
} from "@engine/portals/PortalMath";

function frame(
  position: Vector3,
  quaternion: Quaternion,
  halfWidth = 0.5,
  halfHeight = 0.9,
): PortalFrame {
  return { position, quaternion, halfWidth, halfHeight };
}

/** Wall portal at origin, outward normal +Z. */
const wallA = () => frame(new Vector3(0, 1, 0), new Quaternion());
/** Wall portal at x=10, outward normal +X (rotY 90°). */
const wallB = () =>
  frame(
    new Vector3(10, 1, 0),
    new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0)),
  );
/** Floor portal at origin, outward normal +Y (rotX -90° maps +Z to +Y). */
const floorA = () =>
  frame(
    new Vector3(0, 0, 5),
    new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0)),
  );

describe("PortalMath — transforms", () => {
  it("point round-trip A→B→A is identity", () => {
    const a = wallA();
    const b = wallB();
    const p = new Vector3(0.2, 1.3, 0.7);
    const through = transformPointThroughPortal(p, a, b);
    const back = transformPointThroughPortal(through, b, a);
    expect(back.distanceTo(p)).toBeLessThan(1e-10);
  });

  it("direction round-trip A→B→A is identity and preserves length", () => {
    const a = wallA();
    const b = wallB();
    const d = new Vector3(1, 2, -3);
    const through = transformDirectionThroughPortal(d, a, b);
    expect(through.length()).toBeCloseTo(d.length(), 10);
    const back = transformDirectionThroughPortal(through, b, a);
    expect(back.distanceTo(d)).toBeLessThan(1e-10);
  });

  it("quaternion round-trip A→B→A is identity", () => {
    const a = wallA();
    const b = wallB();
    const q = new Quaternion().setFromEuler(new Euler(0.3, 1.1, -0.4, "YXZ"));
    const through = transformQuaternionThroughPortal(q, a, b);
    const back = transformQuaternionThroughPortal(through, b, a);
    // q and -q represent the same rotation.
    expect(Math.abs(back.dot(q))).toBeCloseTo(1, 10);
  });

  it("quaternion transform is alias-safe when out === input", () => {
    // teleportDynamicBody passes the body's rotation as both input and out
    // (one scratch quaternion). Aliasing must not collapse the result to delta²
    // — that is the bug where a dynamic object loses its rotation on crossing.
    const a = wallA();
    const b = floorA();
    const tilt = () =>
      new Quaternion().setFromEuler(new Euler(0.4, 0.2, -1.1, "YXZ"));
    const expected = transformQuaternionThroughPortal(tilt(), a, b);
    const aliased = tilt();
    transformQuaternionThroughPortal(aliased, a, b, aliased);
    expect(Math.abs(aliased.dot(expected))).toBeCloseTo(1, 10);
  });

  it("preserves a fallen object's tilt (no upright reset) through a wall pair", () => {
    const a = wallA();
    const b = wallB();
    // Object lying on its side: local up (+Y) rotated to horizontal.
    const fallen = new Quaternion().setFromEuler(new Euler(0, 0, -Math.PI / 2));
    const localUp = new Vector3(0, 1, 0);
    const upBefore = localUp.clone().applyQuaternion(fallen);
    expect(Math.abs(upBefore.y)).toBeLessThan(1e-10); // horizontal, i.e. fallen

    const through = transformQuaternionThroughPortal(fallen, a, b);
    const upAfter = localUp.clone().applyQuaternion(through);
    // The tilt is carried through (equals the direction transform of the up
    // axis), not snapped upright.
    const expectedUp = transformDirectionThroughPortal(upBefore, a, b);
    expect(upAfter.distanceTo(expectedUp)).toBeLessThan(1e-10);
    // Both wall portals share world-up, so a fallen object stays fallen.
    expect(Math.abs(upAfter.y)).toBeLessThan(1e-10);
  });

  it("entry velocity into a wall portal exits along the paired portal's normal", () => {
    const a = wallA();
    const b = wallB();
    const velocity = new Vector3(0, 0, -5);
    const out = transformDirectionThroughPortal(velocity, a, b);
    expect(out.x).toBeCloseTo(5, 10);
    expect(out.y).toBeCloseTo(0, 10);
    expect(out.z).toBeCloseTo(0, 10);
  });

  it("floor→wall fling: falling velocity exits horizontally at the same speed", () => {
    const entry = floorA();
    const exit = wallA();
    const falling = new Vector3(0, -10, 0);
    const out = transformDirectionThroughPortal(falling, entry, exit);
    expect(out.length()).toBeCloseTo(10, 10);
    expect(out.z).toBeCloseTo(10, 10);
    expect(out.y).toBeCloseTo(0, 10);
  });

  it("point at entry center maps to exit center", () => {
    const a = wallA();
    const b = wallB();
    const out = transformPointThroughPortal(a.position.clone(), a, b);
    expect(out.distanceTo(b.position)).toBeLessThan(1e-10);
  });

  it("delta quaternion equals the direction transform", () => {
    const a = floorA();
    const b = wallB();
    const d = new Vector3(0.3, -1, 0.2).normalize();
    const viaDelta = d.clone().applyQuaternion(portalDeltaQuaternion(a, b));
    const viaTransform = transformDirectionThroughPortal(d, a, b);
    expect(viaDelta.distanceTo(viaTransform)).toBeLessThan(1e-10);
  });
});

describe("PortalMath — intersectRayPortal", () => {
  it("hits inside the ellipse from the front", () => {
    const a = wallA();
    const t = intersectRayPortal(
      new Vector3(0.2, 1.2, 5),
      new Vector3(0, 0, -1),
      100,
      a,
    );
    expect(t).toBeCloseTo(5, 10);
  });

  it("misses outside the ellipse even on the same plane", () => {
    const a = wallA();
    // x=0.49, y offset 0.89: inside the bounding box but outside the ellipse.
    const t = intersectRayPortal(
      new Vector3(0.49, 1.89, 5),
      new Vector3(0, 0, -1),
      100,
      a,
    );
    expect(t).toBeNull();
  });

  it("misses when approaching from behind", () => {
    const a = wallA();
    const t = intersectRayPortal(
      new Vector3(0, 1, -5),
      new Vector3(0, 0, 1),
      100,
      a,
    );
    expect(t).toBeNull();
  });

  it("misses beyond maxDistance", () => {
    const a = wallA();
    const t = intersectRayPortal(
      new Vector3(0, 1, 5),
      new Vector3(0, 0, -1),
      4.9,
      a,
    );
    expect(t).toBeNull();
  });

  it("respects the frame orientation (floor portal hit from above)", () => {
    const f = floorA();
    const t = intersectRayPortal(
      new Vector3(0, 3, 5),
      new Vector3(0, -1, 0),
      100,
      f,
    );
    expect(t).toBeCloseTo(3, 10);
  });
});

describe("PortalMath — segmentCrossesPortal", () => {
  it("detects a front-to-back crossing inside the ellipse", () => {
    const a = wallA();
    expect(
      segmentCrossesPortal(new Vector3(0, 1, 0.5), new Vector3(0, 1, -0.5), a),
    ).toBe(true);
  });

  it("ignores back-to-front crossings", () => {
    const a = wallA();
    expect(
      segmentCrossesPortal(new Vector3(0, 1, -0.5), new Vector3(0, 1, 0.5), a),
    ).toBe(false);
  });

  it("ignores crossings outside the ellipse", () => {
    const a = wallA();
    expect(
      segmentCrossesPortal(new Vector3(2, 1, 0.5), new Vector3(2, 1, -0.5), a),
    ).toBe(false);
  });

  it("catches tunneling: a huge displacement still registers", () => {
    const a = wallA();
    expect(
      segmentCrossesPortal(new Vector3(0, 1, 40), new Vector3(0, 1, -40), a),
    ).toBe(true);
  });

  it("ellipseMargin widens the accepted footprint", () => {
    const a = wallA();
    const from = new Vector3(0.6, 1, 0.5);
    const to = new Vector3(0.6, 1, -0.5);
    expect(segmentCrossesPortal(from, to, a)).toBe(false);
    expect(segmentCrossesPortal(from, to, a, 1.3)).toBe(true);
  });

  it("ignores segments fully on one side", () => {
    const a = wallA();
    expect(
      segmentCrossesPortal(new Vector3(0, 1, 2), new Vector3(0, 1, 1), a),
    ).toBe(false);
  });
});

describe("PortalMath — lookDirectionToYawPitch", () => {
  it("recovers yaw/pitch for a grid of camera orientations ('YXZ')", () => {
    for (let yi = -3; yi <= 3; yi++) {
      for (let pi = -4; pi <= 4; pi++) {
        const yaw = yi * 0.9;
        const pitch = pi * 0.35;
        const q = new Quaternion().setFromEuler(new Euler(pitch, yaw, 0, "YXZ"));
        const forward = new Vector3(0, 0, -1).applyQuaternion(q);
        const result = lookDirectionToYawPitch(forward);
        expect(result.pitch).toBeCloseTo(pitch, 6);
        // Compare wrapped yaw via direction reconstruction.
        const rq = new Quaternion().setFromEuler(
          new Euler(result.pitch, result.yaw, 0, "YXZ"),
        );
        const rebuilt = new Vector3(0, 0, -1).applyQuaternion(rq);
        expect(rebuilt.distanceTo(forward)).toBeLessThan(1e-6);
      }
    }
  });

  it("derives yaw from up when looking straight down", () => {
    const yaw = 1.2;
    const q = new Quaternion().setFromEuler(
      new Euler(-Math.PI / 2, yaw, 0, "YXZ"),
    );
    const forward = new Vector3(0, 0, -1).applyQuaternion(q);
    const up = new Vector3(0, 1, 0).applyQuaternion(q);
    const result = lookDirectionToYawPitch(forward, up);
    expect(result.pitch).toBeCloseTo(-Math.PI / 2, 6);
    expect(Math.atan2(Math.sin(result.yaw - yaw), Math.cos(result.yaw - yaw))).toBeCloseTo(0, 6);
  });

  it("derives yaw from up when looking straight up", () => {
    const yaw = -0.7;
    const q = new Quaternion().setFromEuler(
      new Euler(Math.PI / 2, yaw, 0, "YXZ"),
    );
    const forward = new Vector3(0, 0, -1).applyQuaternion(q);
    const up = new Vector3(0, 1, 0).applyQuaternion(q);
    const result = lookDirectionToYawPitch(forward, up);
    expect(result.pitch).toBeCloseTo(Math.PI / 2, 6);
    expect(Math.atan2(Math.sin(result.yaw - yaw), Math.cos(result.yaw - yaw))).toBeCloseTo(0, 6);
  });
});

describe("PortalPairState", () => {
  it("links only when both portals exist and resolves the exit frame", () => {
    const state = new PortalPairState();
    expect(state.linked).toBe(false);
    const a = wallA();
    state.set("a", a);
    expect(state.linked).toBe(false);
    expect(state.exitFor("a")).toBeNull();
    const b = wallB();
    state.set("b", b);
    expect(state.linked).toBe(true);
    expect(state.exitFor("a")).toBe(b);
    expect(state.exitFor("b")).toBe(a);
    state.clear();
    expect(state.linked).toBe(false);
  });
});
