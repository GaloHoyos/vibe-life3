import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Euler, Quaternion, Vector3 } from "three";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { Raycast } from "@engine/physics/Raycast";
import { PortalPairState, type PortalFrame } from "@engine/portals/PortalFrame";
import { PortalRaycast } from "@engine/portals/PortalRaycast";

beforeAll(async () => {
  await RAPIER.init();
});

/**
 * World layout:
 * - "wallA": box centered (0, 5, -0.5), front face on z = 0. Portal A sits on
 *   it (normal +Z).
 * - "wallB": box centered (30, 5, -0.5), front face on z = 0. Portal B sits on
 *   it (normal +Z) — same orientation, so a ray entering A along −Z exits B
 *   along +Z.
 * - "target": box in front of wall B at (30, 5, 6).
 */
async function setupWorld(): Promise<{
  raycast: Raycast;
  pair: PortalPairState;
  portal: PortalRaycast;
}> {
  const physics = new PhysicsWorld();
  await physics.init();
  physics.createStaticBox({
    id: "wallA",
    position: new Vector3(0, 5, -0.5),
    size: new Vector3(12, 12, 1),
  });
  physics.createStaticBox({
    id: "wallB",
    position: new Vector3(30, 5, -0.5),
    size: new Vector3(12, 12, 1),
  });
  physics.createStaticBox({
    id: "target",
    position: new Vector3(30, 5, 6),
    size: new Vector3(1, 1, 1),
    metadata: { kind: "player" },
  });
  physics.updateQueryPipeline();

  const pair = new PortalPairState();
  const identity = new Quaternion();
  const frameA: PortalFrame = {
    position: new Vector3(0, 5, 0),
    quaternion: identity.clone(),
    halfWidth: 0.55,
    halfHeight: 0.95,
  };
  const frameB: PortalFrame = {
    position: new Vector3(30, 5, 0),
    quaternion: identity.clone(),
    halfWidth: 0.55,
    halfHeight: 0.95,
  };
  pair.set("a", frameA);
  pair.set("b", frameB);

  const raycast = new Raycast(physics);
  return { raycast, pair, portal: new PortalRaycast(raycast, pair) };
}

describe("PortalRaycast", () => {
  it("continues through the pair and hits the target on the far side", async () => {
    const { portal } = await setupWorld();
    const hit = portal.cast(new Vector3(0, 5, 8), new Vector3(0, 0, -1), 60);
    expect(hit).not.toBeNull();
    expect(hit!.metadata?.id).toBe("target");
  });

  it("hits the backing wall when the ray misses the disc", async () => {
    const { portal } = await setupWorld();
    // Aim 2 m beside the portal center — still wall A, outside the ellipse.
    const hit = portal.cast(new Vector3(2, 5, 8), new Vector3(0, 0, -1), 60);
    expect(hit).not.toBeNull();
    expect(hit!.metadata?.id).toBe("wallA");
  });

  it("behaves like a straight raycast when the pair is not linked", async () => {
    const { portal, pair } = await setupWorld();
    pair.set("b", null);
    const hit = portal.cast(new Vector3(0, 5, 8), new Vector3(0, 0, -1), 60);
    expect(hit).not.toBeNull();
    expect(hit!.metadata?.id).toBe("wallA");
  });

  it("castSegments returns one segment per stretch", async () => {
    const { portal } = await setupWorld();
    const result = portal.castSegments(
      new Vector3(0, 5, 8),
      new Vector3(0, 0, -1),
      60,
    );
    expect(result.hit?.metadata?.id).toBe("target");
    expect(result.segments).toHaveLength(2);
    // First segment ends at portal A's plane.
    expect(result.segments[0].end.z).toBeCloseTo(0, 3);
    // Second segment starts just off portal B and ends at the target.
    expect(result.segments[1].origin.x).toBeCloseTo(30, 3);
    expect(result.segments[1].end.z).toBeCloseTo(5.5, 3);
  });

  it("respects remaining distance across the jump", async () => {
    const { portal } = await setupWorld();
    // 8 m to the portal + ~5.5 m to the target = ~13.5 m; 10 m is not enough.
    const hit = portal.cast(new Vector3(0, 5, 8), new Vector3(0, 0, -1), 10);
    expect(hit).toBeNull();
  });

  it("projectileStep rebases position and direction through the pair", async () => {
    const { portal } = await setupWorld();
    const position = new Vector3(0, 5, 1);
    const direction = new Vector3(0, 0, -1);
    const leftover = portal.projectileStep(position, direction, 2, null);
    expect(leftover).not.toBeNull();
    expect(leftover!).toBeCloseTo(1, 5);
    // Exits at portal B along +Z (same-facing portals flip the direction).
    expect(position.x).toBeCloseTo(30, 3);
    expect(direction.z).toBeCloseTo(1, 5);
  });

  it("projectileStep returns null when a solid hit lands clearly first", async () => {
    const { portal } = await setupWorld();
    const position = new Vector3(0, 5, 8);
    const direction = new Vector3(0, 0, -1);
    // A hit at 2 m (well before the portal at 8 m) suppresses the jump.
    const leftover = portal.projectileStep(position, direction, 10, 2);
    expect(leftover).toBeNull();
    expect(position.z).toBeCloseTo(8, 5);
  });

  it("rotated exit portal redirects the ray (wall → floor-style jump)", async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    physics.createStaticBox({
      id: "wallA",
      position: new Vector3(0, 5, -0.5),
      size: new Vector3(12, 12, 1),
    });
    physics.createStaticBox({
      id: "ceilTarget",
      position: new Vector3(30, 12, 0),
      size: new Vector3(2, 1, 2),
      metadata: { kind: "player" },
    });
    physics.updateQueryPipeline();
    const pair = new PortalPairState();
    pair.set("a", {
      position: new Vector3(0, 5, 0),
      quaternion: new Quaternion(),
      halfWidth: 0.55,
      halfHeight: 0.95,
    });
    // Portal B on a floor at (30, 8, 0), normal +Y.
    pair.set("b", {
      position: new Vector3(30, 8, 0),
      quaternion: new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0)),
      halfWidth: 0.55,
      halfHeight: 0.95,
    });
    const portal = new PortalRaycast(new Raycast(physics), pair);
    const hit = portal.cast(new Vector3(0, 5, 8), new Vector3(0, 0, -1), 60);
    expect(hit).not.toBeNull();
    expect(hit!.metadata?.id).toBe("ceilTarget");
  });
});
