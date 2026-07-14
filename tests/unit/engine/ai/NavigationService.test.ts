import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Vector3 } from "three";
import { NavigationService } from "@engine/ai/navigation/NavigationService";
import { buildNavigationGeometry } from "@engine/ai/navigation/NavigationGeometry";
import type { NavAgentProfile } from "@engine/ai/navigation/NavigationTypes";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { Raycast } from "@engine/physics/Raycast";
import { NavigationProfiles } from "@game/npc/navigation/NavAgentProfiles";
import type { StaticBoxDefinition } from "@game/levels/LevelDefinition";

describe("NavigationService", () => {
  let physics: PhysicsWorld;
  let navigation: NavigationService | null;

  beforeEach(async () => {
    physics = new PhysicsWorld();
    await physics.init();
    navigation = null;
  });

  afterEach(() => {
    navigation?.dispose();
    physics.reset();
  });

  it("projects points and returns a Detour corridor around static geometry", async () => {
    const profile = testProfile();
    const boxes = [
      box("floor", [0, -0.25, 0], [12, 0.5, 12]),
      box("wall", [0, 1, 0], [1.2, 2, 7]),
    ];
    navigation = await NavigationService.create({
      geometry: buildNavigationGeometry(boxes),
      groundProfiles: [profile],
      raycast: new Raycast(physics),
      physics,
    });

    const start = navigation.projectPoint(new Vector3(-4, 0.2, 0), profile);
    const goal = navigation.projectPoint(new Vector3(4, 0.2, 0), profile);
    expect(start).not.toBeNull();
    expect(goal).not.toBeNull();
    const path = navigation.requestPath(profile, start!, goal!);
    expect(path).not.toBeNull();
    expect(path!.points.length).toBeGreaterThan(1);
    expect(path!.length).toBeGreaterThan(start!.distanceTo(goal!));
    const debugGeometry = navigation.getDebugMeshGeometry(profile.id);
    expect(debugGeometry).not.toBeNull();
    expect(debugGeometry!.positions.length).toBeGreaterThan(0);
    expect(debugGeometry!.indices.length).toBeGreaterThan(0);
    expect(navigation.getDebugMeshGeometry("missing-profile")).toBeNull();
  }, 20_000);

  it("routes Blob fragments on the small-ground mesh without traversal actions", async () => {
    const boxes = [
      box("blob-floor", [0, -0.25, 0], [12, 0.5, 12]),
      box("blob-wall", [0, 1, 0], [1.2, 2, 7]),
    ];
    navigation = await NavigationService.create({
      geometry: buildNavigationGeometry(boxes),
      groundProfiles: [NavigationProfiles.headcrab],
      raycast: new Raycast(physics),
      physics,
    });

    const profile = NavigationProfiles.blobFragment;
    const start = navigation.projectPoint(new Vector3(-4, 0.2, 0), profile);
    const goal = navigation.projectPoint(new Vector3(4, 0.2, 0), profile);
    expect(start).not.toBeNull();
    expect(goal).not.toBeNull();
    const path = navigation.requestPath(profile, start!, goal!);

    expect(path).not.toBeNull();
    expect(path?.partial).toBe(false);
    expect(path?.actions).toEqual([]);
    expect(path!.length).toBeGreaterThan(start!.distanceTo(goal!) + 2);
    expect(path!.points.some((point) => Math.abs(point.z) > 3.5)).toBe(true);
  }, 20_000);

  it("uses a deliberate portal action link between disconnected islands", async () => {
    const profile = testProfile();
    const boxes = [
      box("left", [-4, -0.25, 0], [5, 0.5, 5]),
      box("right", [4, -0.25, 0], [5, 0.5, 5]),
    ];
    navigation = await NavigationService.create({
      geometry: buildNavigationGeometry(boxes),
      groundProfiles: [profile],
      raycast: new Raycast(physics),
      physics,
    });
    const portalLink = {
      id: "test-portal",
      kind: "portal",
      start: new Vector3(-2, 0, 0),
      end: new Vector3(2, 0, 0),
      bidirectional: true,
      cost: 1,
      width: 1.5,
      profileIds: [profile.id],
    } as const;
    navigation.setActionLinks([portalLink]);

    expect(navigation.reserveAction(portalLink, "npc-a")).toBe(true);
    expect(navigation.reserveAction(portalLink, "npc-b")).toBe(false);
    navigation.releaseAction(portalLink, "npc-a");
    expect(navigation.reserveAction(portalLink, "npc-b")).toBe(true);
    navigation.releaseAction(portalLink, "npc-b");

    const path = navigation.requestPath(
      profile,
      new Vector3(-4, 0, 0),
      new Vector3(4, 0, 0),
    );
    expect(path).not.toBeNull();
    expect(path!.actions.some((action) => action.link.kind === "portal")).toBe(true);
  }, 20_000);

  it("propaga el owner que activa un action link de puerta", async () => {
    const profile = testProfile();
    const openDoor = vi.fn();
    navigation = await NavigationService.create({
      geometry: buildNavigationGeometry([box("floor", [0, -0.25, 0], [8, 0.5, 8])]),
      groundProfiles: [profile],
      raycast: new Raycast(physics),
      physics,
      openDoor,
    });
    const link = {
      id: "door-link",
      kind: "door",
      start: new Vector3(-1, 0, 0),
      end: new Vector3(1, 0, 0),
      bidirectional: true,
      cost: 1,
      width: 1,
      doorId: "gate",
      profileIds: [profile.id],
    } as const;

    navigation.activateAction(link, "npc-42");

    expect(openDoor).toHaveBeenCalledWith("gate", "npc-42");
  }, 20_000);

  it("does not mark the capsule-center descent onto open floor as crouch", async () => {
    navigation = await NavigationService.create({
      geometry: buildNavigationGeometry([box("floor", [0, -0.25, 0], [20, 0.5, 20])]),
      groundProfiles: [NavigationProfiles.humanoid, NavigationProfiles.humanoidLimited],
      raycast: new Raycast(physics),
      physics,
    });

    const path = navigation.requestPath(
      NavigationProfiles.humanoid,
      new Vector3(-6, 0.9, -4),
      new Vector3(6, 0, 4),
    );

    expect(path).not.toBeNull();
    expect(path!.actions.some((action) => action.link.kind === "crouch")).toBe(false);
  }, 20_000);

  it("keeps the 60-agent fixed-step crowd inside the navigation frame budget", async () => {
    const profile = testProfile();
    navigation = await NavigationService.create({
      geometry: buildNavigationGeometry([box("stress-floor", [0, -0.25, 0], [36, 0.5, 36])]),
      groundProfiles: [profile],
      raycast: new Raycast(physics),
      physics,
      maxAgents: 60,
    });
    const agents = Array.from({ length: 60 }, (_, index) => {
      const row = Math.floor(index / 10);
      const column = index % 10;
      const start = new Vector3(-13 + column * 2.6, 0, -8 + row * 2.8);
      const agent = navigation!.createAgent(`stress-${index}`, profile, start);
      agent?.setGoal(new Vector3(-start.x, 0, -start.z));
      return agent;
    });
    for (let frame = 0; frame < 120; frame += 1) navigation.update(1 / 60);
    const metrics = navigation.debugSnapshot();
    expect(agents.filter(Boolean)).toHaveLength(60);
    expect(metrics.averageUpdateMs).toBeLessThan(2);
    expect(metrics.p95UpdateMs).toBeLessThan(4);
  }, 20_000);

  it("routes flying agents through the sparse 3D volume around a solid", async () => {
    physics.createStaticBox({
      id: "air-wall",
      position: new Vector3(0, 2, 0),
      size: new Vector3(1, 5, 4),
    });
    physics.updateQueryPipeline();
    navigation = await NavigationService.create({
      geometry: buildNavigationGeometry([]),
      groundProfiles: [NavigationProfiles.manhack],
      raycast: new Raycast(physics),
      physics,
    });
    const from = new Vector3(-4, 2, 0);
    const to = new Vector3(4, 2, 0);
    const path = navigation.requestPath(NavigationProfiles.manhack, from, to);
    expect(path).not.toBeNull();
    expect(path!.points.length).toBeGreaterThan(1);
    expect(path!.length).toBeGreaterThan(from.distanceTo(to));
  }, 20_000);
});

function testProfile(): NavAgentProfile {
  return {
    ...NavigationProfiles.humanoidLimited,
    id: "test-limited",
    canUsePortals: true,
    areaCosts: { ...NavigationProfiles.humanoidLimited.areaCosts },
  };
}

function box(id: string, position: [number, number, number], size: [number, number, number]): StaticBoxDefinition {
  return { id, position, size, material: "concrete" };
}
