import { beforeAll, describe, expect, it, vi } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { Raycast } from "@engine/physics/Raycast";
import type { PortalFrame } from "@engine/portals/PortalFrame";
import {
  computePortalPlacement,
  portalsOverlap,
  resolvePortalBackingColliders,
} from "@game/gameplay/weapons/portal/PortalPlacement";
import { PortalGunSystem } from "@game/gameplay/weapons/portal/PortalGunSystem";
import { assertJsonValue } from "@game/save/JsonValue";

beforeAll(async () => {
  await RAPIER.init();
});

const OPTIONS = {
  range: 60,
  halfWidth: 0.55,
  halfHeight: 0.95,
  planarForward: new Vector3(0, 0, -1),
  excludeId: "player",
};

async function worldWithWallAndFloor(): Promise<{
  physics: PhysicsWorld;
  raycast: Raycast;
}> {
  const physics = new PhysicsWorld();
  await physics.init();
  // Wall: front face on z = 0.5, normal +Z, spans x ∈ [-5, 5], y ∈ [0, 10].
  physics.createStaticBox({
    id: "wall",
    position: new Vector3(0, 5, 0),
    size: new Vector3(10, 10, 1),
  });
  // Floor: top face on y = 0.
  physics.createStaticBox({
    id: "floor",
    position: new Vector3(0, -0.5, 20),
    size: new Vector3(20, 1, 20),
  });
  // "Dynamic" surface: static body tagged dynamic to exercise the kind filter.
  physics.createStaticBox({
    id: "crate",
    position: new Vector3(20, 1, 0),
    size: new Vector3(2, 2, 2),
    metadata: { kind: "dynamic" },
  });
  physics.updateQueryPipeline();
  return { physics, raycast: new Raycast(physics) };
}

describe("computePortalPlacement", () => {
  it("places on the middle of a wall with normal and up correct", async () => {
    const { raycast } = await worldWithWallAndFloor();
    const result = computePortalPlacement(
      raycast,
      new Vector3(0, 5, 5),
      new Vector3(0, 0, -1),
      OPTIONS,
    );
    expect(result).not.toBeNull();
    const frame = result!.frame;
    const normal = new Vector3(0, 0, 1).applyQuaternion(frame.quaternion);
    const up = new Vector3(0, 1, 0).applyQuaternion(frame.quaternion);
    expect(normal.z).toBeCloseTo(1, 5);
    expect(up.y).toBeCloseTo(1, 5);
    expect(frame.position.z).toBeCloseTo(0.5, 3);
    expect(result!.backingColliders.length).toBeGreaterThan(0);
  });

  it("bumps a near-edge shot down so the oval fits on the wall", async () => {
    const { raycast } = await worldWithWallAndFloor();
    const result = computePortalPlacement(
      raycast,
      new Vector3(0, 9.8, 5),
      new Vector3(0, 0, -1),
      OPTIONS,
    );
    expect(result).not.toBeNull();
    const frame = result!.frame;
    // Bumped down so the whole oval sits within the wall (top edge at y=10).
    expect(frame.position.y + OPTIONS.halfHeight).toBeLessThanOrEqual(10 + 1e-3);
    // Still on the wall plane and near where it was aimed.
    expect(frame.position.z).toBeCloseTo(0.5, 3);
    expect(frame.position.y).toBeGreaterThan(9.8 - 1.6);
  });

  it("fails on a surface too small for the oval, even with bumping", async () => {
    const { physics, raycast } = await worldWithWallAndFloor();
    // A small isolated pillar face, much smaller than the oval footprint.
    physics.createStaticBox({
      id: "pillar",
      position: new Vector3(30, 5, 0),
      size: new Vector3(0.3, 0.3, 1),
    });
    physics.updateQueryPipeline();
    const result = computePortalPlacement(
      raycast,
      new Vector3(30, 5, 5),
      new Vector3(0, 0, -1),
      OPTIONS,
    );
    expect(result).toBeNull();
  });

  it("places on a floor with up aligned to the player's planar forward", async () => {
    const { raycast } = await worldWithWallAndFloor();
    const result = computePortalPlacement(
      raycast,
      new Vector3(0, 3, 20),
      new Vector3(0, -1, 0),
      OPTIONS,
    );
    expect(result).not.toBeNull();
    const frame = result!.frame;
    const normal = new Vector3(0, 0, 1).applyQuaternion(frame.quaternion);
    const up = new Vector3(0, 1, 0).applyQuaternion(frame.quaternion);
    expect(normal.y).toBeCloseTo(1, 5);
    expect(up.z).toBeCloseTo(-1, 5);
  });

  it("rejects non-static surfaces", async () => {
    const { raycast } = await worldWithWallAndFloor();
    const result = computePortalPlacement(
      raycast,
      new Vector3(20, 1, 5),
      new Vector3(0, 0, -1),
      OPTIONS,
    );
    expect(result).toBeNull();
  });

  it("works with the shooter's own capsule around the ray origin (eye inside player collider)", async () => {
    const { physics, raycast } = await worldWithWallAndFloor();
    // The eye sits inside the player's body: without excludeId the solid
    // raycast returns this collider at toi 0 and every placement fails.
    physics.createKinematicBox({
      id: "player",
      position: new Vector3(0, 5, 5),
      size: new Vector3(0.7, 1.8, 0.7),
      metadata: { kind: "player" },
    });
    physics.updateQueryPipeline();
    const result = computePortalPlacement(
      raycast,
      new Vector3(0, 5, 5),
      new Vector3(0, 0, -1),
      OPTIONS,
    );
    expect(result).not.toBeNull();
    expect(result!.frame.position.z).toBeCloseTo(0.5, 3);
  });

  it("rejects when nothing is hit in range", async () => {
    const { raycast } = await worldWithWallAndFloor();
    const result = computePortalPlacement(
      raycast,
      new Vector3(0, 5, 5),
      new Vector3(0, 0, 1),
      OPTIONS,
    );
    expect(result).toBeNull();
  });

  it("shoots through a prop and lands on the static wall behind it", async () => {
    const { physics, raycast } = await worldWithWallAndFloor();
    // A non-static prop right in front of the wall centre.
    physics.createStaticBox({
      id: "prop",
      position: new Vector3(0, 5, 2),
      size: new Vector3(1.2, 1.2, 1.2),
      metadata: { kind: "dynamic" },
    });
    physics.updateQueryPipeline();
    const result = computePortalPlacement(
      raycast,
      new Vector3(0, 5, 5),
      new Vector3(0, 0, -1),
      OPTIONS,
    );
    expect(result).not.toBeNull();
    // Passed through the prop (front face z=2.6) and hit the wall (z=0.5).
    expect(result!.frame.position.z).toBeCloseTo(0.5, 3);
  });

  it("bumps aside so it does not overlap the sibling portal", async () => {
    const { raycast } = await worldWithWallAndFloor();
    const sibling: PortalFrame = {
      position: new Vector3(0, 5, 0.5),
      quaternion: new Quaternion(),
      halfWidth: OPTIONS.halfWidth,
      halfHeight: OPTIONS.halfHeight,
    };
    // Aim just to the right of the sibling's centre.
    const result = computePortalPlacement(
      raycast,
      new Vector3(0.3, 5, 5),
      new Vector3(0, 0, -1),
      { ...OPTIONS, sibling },
    );
    expect(result).not.toBeNull();
    expect(portalsOverlap(result!.frame, sibling)).toBe(false);
    // Bumped to the right (away from the sibling), still on the wall.
    expect(result!.frame.position.x).toBeGreaterThan(0.3);
    expect(result!.frame.position.z).toBeCloseTo(0.5, 3);
  });
});

describe("portalsOverlap", () => {
  function frameAt(x: number, y: number, z: number): PortalFrame {
    return {
      position: new Vector3(x, y, z),
      quaternion: new Quaternion(),
      halfWidth: 0.55,
      halfHeight: 0.95,
    };
  }

  it("detects overlap on the same plane", () => {
    expect(portalsOverlap(frameAt(0, 1, 0), frameAt(0.5, 1, 0))).toBe(true);
  });

  it("allows separated portals on the same plane", () => {
    expect(portalsOverlap(frameAt(0, 1, 0), frameAt(3, 1, 0))).toBe(false);
  });

  it("allows side-by-side portals clear on the width axis", () => {
    // |dx| >= halfWidths sum + pad (1.1 + 0.02).
    expect(portalsOverlap(frameAt(0, 1, 0), frameAt(1.15, 1, 0))).toBe(false);
  });

  it("rejects tight diagonal placement (Source rectangle rule)", () => {
    // Fuera de la elipse combinada (regla vieja) pero sin ningún eje libre:
    // Portal bumpearía este placement.
    expect(portalsOverlap(frameAt(0, 1, 0), frameAt(0.9, 2.6, 0))).toBe(true);
  });

  it("ignores portals on different planes", () => {
    const wall = frameAt(0, 1, 0);
    const floor: PortalFrame = {
      position: new Vector3(0, 1, 0.3),
      quaternion: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2),
      halfWidth: 0.55,
      halfHeight: 0.95,
    };
    expect(portalsOverlap(wall, floor)).toBe(false);
  });
});

describe("persistencia de PortalGunSystem", () => {
  it("revalida el frame y resuelve colliders del mundo actual al restaurar", async () => {
    const { raycast } = await worldWithWallAndFloor();
    const placement = computePortalPlacement(
      raycast,
      new Vector3(0, 5, 5),
      new Vector3(0, 0, -1),
      OPTIONS,
    );
    expect(placement).not.toBeNull();
    const frame = placement!.frame;
    const currentBacking = resolvePortalBackingColliders(raycast, frame, "player");
    expect(currentBacking?.length).toBeGreaterThan(0);

    const clearPlacedPortals = vi.fn();
    const place = vi.fn();
    const system = Object.create(PortalGunSystem.prototype) as PortalGunSystem;
    Object.assign(system as unknown as Record<string, unknown>, {
      raycast,
      portals: new Map([
        [
          "a",
          {
            slot: "a",
            frame,
          },
        ],
      ]),
      clearPlacedPortals,
      place,
    });

    const snapshot = system.capture();
    expect(() => assertJsonValue(snapshot)).not.toThrow();
    system.restore(snapshot);

    expect(clearPlacedPortals).toHaveBeenCalledWith(false);
    expect(place).toHaveBeenCalledWith(
      "a",
      expect.objectContaining({
        halfWidth: frame.halfWidth,
        halfHeight: frame.halfHeight,
      }),
      expect.arrayContaining(currentBacking ?? []),
    );
  });
});
