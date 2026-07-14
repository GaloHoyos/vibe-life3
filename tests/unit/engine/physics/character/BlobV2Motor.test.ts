import RAPIER from "@dimforge/rapier3d-compat";
import { Object3D, Quaternion, Vector3 } from "three";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { NavigationRequest, NavigationRequestQueue } from "@engine/ai/navigation/NavigationRequestQueue";
import type { NavAgentProfile, NavigationActionLink, NavigationPath } from "@engine/ai/navigation/NavigationTypes";
import { BlobOrganismController } from "@engine/blob/v2/BlobOrganismController";
import { PortalPairState } from "@engine/portals/PortalFrame";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { BlobV2Motor } from "@engine/physics/character/BlobV2Motor";

beforeAll(async () => {
  await RAPIER.init();
});

const BLOB_PROFILE: NavAgentProfile = {
  id: "blob",
  domain: "smallGround",
  radius: 0.62,
  standingHeight: 1,
  navigationHeight: 0.65,
  maxSlopeDegrees: 48,
  stepHeight: 0.32,
  maxSpeed: 3.4,
  acceleration: 12,
  canJump: true,
  canCrouch: false,
  canDrop: true,
  canOpenDoors: false,
  canUsePortals: true,
  jumpSpeed: 6,
  maxJumpDistance: 5,
  safeDropHeight: 3,
  areaCosts: {},
};

async function createMotor(options: {
  center?: Vector3;
  portals?: PortalPairState;
  navigationRequests?: NavigationRequestQueue;
  gravity?: number;
  particleTargetProvider?: ConstructorParameters<typeof BlobV2Motor>[2]["particleTargetProvider"];
} = {}) {
  const physics = new PhysicsWorld();
  await physics.init();
  const center = options.center ?? new Vector3(0, 0.6, 0);
  const controller = new BlobOrganismController({
    center,
    seed: 19,
    particleRadius: 0.08,
  });
  const motor = new BlobV2Motor(physics, controller, {
    id: "blob-v2-test",
    maxSpeed: 3.4,
    acceleration: 14,
    turnSpeed: 10,
    gravity: options.gravity ?? 0,
    metadata: { id: "blob-v2-test", kind: "npc", characterId: "blob" },
    portals: options.portals,
    navigationRequests: options.navigationRequests,
    navigationProfile: BLOB_PROFILE,
    particleTargetProvider: options.particleTargetProvider,
  });
  return { physics, controller, motor };
}

function climbLink(height: number): NavigationActionLink {
  return {
    id: `climb-${height}`,
    kind: "climb",
    start: new Vector3(-0.3, 0.08, 0),
    end: new Vector3(0.25, 0.08 + height, 0),
    bidirectional: false,
    cost: 1,
    width: 1.2,
    profileIds: ["blob"],
    climbHeight: height,
  };
}

function positionOf(result: ReturnType<BlobV2Motor["resolveParticleMotion"]>): Vector3 {
  return new Vector3(result.position.x, result.position.y, result.position.z);
}

describe("BlobV2Motor fixed stepping and collision", () => {
  it("implements NpcMotor with a small sensor and advances the controller at exactly 30 Hz", async () => {
    const { controller, motor } = await createMotor();
    expect(motor.collider.isSensor()).toBe(true);
    expect((motor.collider.shape as RAPIER.Ball).radius).toBeCloseTo(0.12);

    motor.update(1 / 60, new Vector3(2, 0, 0), true);
    expect(controller.snapshot().simulationTime).toBe(0);
    motor.update(1 / 60, new Vector3(2, 0, 0), true);
    expect(controller.snapshot().simulationTime).toBeCloseTo(1 / 30);
  });

  it("locks native evidence frames while allowing explicit fixed steps", async () => {
    const { controller, motor } = await createMotor();
    motor.prepareDeterministicEvidenceAction();

    motor.update(1 / 30, new Vector3(0, 0.6, 2), true);
    expect(controller.snapshot().simulationTime).toBe(0);

    motor.setDeterministicEvidenceStepping(true);
    motor.update(1 / 30, new Vector3(0, 0.6, 2), true);
    motor.setDeterministicEvidenceStepping(false);
    expect(controller.snapshot().simulationTime).toBeCloseTo(1 / 30);

    motor.update(1 / 30, new Vector3(0, 0.6, 2), true);
    expect(controller.snapshot().simulationTime).toBeCloseTo(1 / 30);
  });

  it("steps over 0.32 m but does not auto-climb a 0.40 m obstacle", async () => {
    const low = await createMotor({ center: new Vector3(-0.5, 0.08, 0) });
    low.physics.createStaticBox({
      id: "low-step",
      position: new Vector3(0, 0.16, 0),
      size: new Vector3(0.2, 0.32, 2),
    });
    low.physics.updateQueryPipeline();
    const cellId = low.controller.topology.coreCellId + 1;
    const over = positionOf(low.motor.resolveParticleMotion(
      cellId,
      { x: -0.5, y: 0.08, z: 0 },
      { x: 0.5, y: 0.08, z: 0 },
      0.08,
    ));
    expect(over.x).toBeGreaterThan(0.2);
    expect(over.y).toBeGreaterThanOrEqual(0.39);

    const high = await createMotor({ center: new Vector3(-0.5, 0.08, 0) });
    high.physics.createStaticBox({
      id: "high-step",
      position: new Vector3(0, 0.2, 0),
      size: new Vector3(0.2, 0.4, 2),
    });
    high.physics.updateQueryPipeline();
    const blocked = positionOf(high.motor.resolveParticleMotion(
      high.controller.topology.coreCellId + 1,
      { x: -0.5, y: 0.08, z: 0 },
      { x: 0.5, y: 0.08, z: 0 },
      0.08,
    ));
    expect(blocked.x).toBeLessThan(-0.05);
  });

  it("flows through consumable props and pushes other dynamic props with biomass-scaled force", async () => {
    const foodRig = await createMotor({ center: new Vector3(-0.5, 0.6, 0) });
    foodRig.physics.createDynamicBox({
      id: "blob-food",
      position: new Vector3(0, 0.6, 0),
      size: new Vector3(0.2, 0.5, 0.5),
      mass: 2,
      metadata: { blobConsumable: { consumeSeconds: 1.5, biomass: 4 } },
    }, new Object3D());
    foodRig.physics.updateQueryPipeline();
    const throughFood = positionOf(foodRig.motor.resolveParticleMotion(
      foodRig.controller.topology.coreCellId + 1,
      { x: -0.5, y: 0.6, z: 0 },
      { x: 0.5, y: 0.6, z: 0 },
      0.08,
    ));
    expect(throughFood.x).toBeCloseTo(0.5, 2);

    const propRig = await createMotor({ center: new Vector3(-0.5, 0.6, 0) });
    const prop = propRig.physics.createDynamicBox({
      id: "pushable-crate",
      position: new Vector3(0, 0.6, 0),
      size: new Vector3(0.2, 2, 0.5),
      mass: 2,
    }, new Object3D());
    propRig.physics.updateQueryPipeline();
    const blocked = positionOf(propRig.motor.resolveParticleMotion(
      propRig.controller.topology.coreCellId + 1,
      { x: -0.5, y: 0.6, z: 0 },
      { x: 0.5, y: 0.6, z: 0 },
      0.08,
    ));
    expect(blocked.x).toBeLessThan(0);
    propRig.motor.update(1 / 30, null, false);
    expect(prop.linvel().x).toBeGreaterThan(0);
  });

  it("accepts only explicit climb actions in the 0.33..1.25 m range", async () => {
    const { controller, motor } = await createMotor();
    motor.beginNavigationAction(climbLink(0.32));
    expect(motor.getTraversalDebugSnapshot()).toMatchObject({ kind: "none" });
    expect(motor.getTraversalDebugSnapshot().rejectedReason).toContain("outside");
    expect(controller.snapshot().traversalState).toBe("Ground");

    motor.beginNavigationAction(climbLink(1.26));
    expect(motor.getTraversalDebugSnapshot().kind).toBe("none");
    motor.beginNavigationAction(climbLink(1.25));
    expect(motor.getTraversalDebugSnapshot()).toMatchObject({ kind: "climb", coreReleased: false });
    expect(controller.snapshot().traversalState).toBe("Climb");
  });

  it("applies per-cell targets only while ScriptedPose owns the controller", async () => {
    const { controller, motor } = await createMotor();
    const initial = controller.snapshot();
    const targets = Object.fromEntries(initial.particles.map((particle) => [
      particle.cellId,
      { x: particle.position.x + 2, y: particle.position.y, z: particle.position.z },
    ]));
    motor.setParticleTargetProvider(() => ({ particleTargets: targets, particleTargetStrength: 20 }));
    for (let index = 0; index < 20; index++) motor.update(1 / 30, null, false);
    const withoutPose = controller.snapshot().core.position.x;
    expect(Math.abs(withoutPose - initial.core.position.x)).toBeLessThan(0.2);

    controller.setOverrideState("ScriptedPose");
    for (let index = 0; index < 45; index++) motor.update(1 / 30, null, false);
    expect(controller.snapshot().core.position.x).toBeGreaterThan(withoutPose + 0.5);
  });
});

describe("BlobV2Motor traversal actions", () => {
  it("physically crests a 1.25 m wall while keeping a 1.5 m wall non-traversable", async () => {
    const { physics, controller, motor } = await createMotor({
      center: new Vector3(-0.45, 0.08, 0),
    });
    physics.createStaticBox({
      id: "maximum-climb-wall",
      position: new Vector3(0, 0.625, 0),
      size: new Vector3(0.2, 1.25, 2),
    });
    physics.updateQueryPipeline();
    const link: NavigationActionLink = {
      ...climbLink(1.25),
      start: new Vector3(-0.25, 0.08, 0),
      end: new Vector3(0.25, 1.33, 0),
    };
    motor.beginNavigationAction(link);

    let sawCoreRelease = false;
    for (let frame = 0; frame < 240; frame++) {
      motor.update(1 / 30, link.end, true);
      sawCoreRelease ||= motor.getTraversalDebugSnapshot().coreReleased;
    }

    expect(sawCoreRelease).toBe(true);
    expect(controller.snapshot().core.position.y).toBeGreaterThan(1.15);
    expect(controller.snapshot().core.position.x).toBeGreaterThan(0.1);
    expect(motor.getTraversalDebugSnapshot().kind).toBe("none");

    motor.beginNavigationAction({
      ...link,
      id: "too-tall",
      end: new Vector3(0.25, 1.58, 0),
      climbHeight: 1.5,
    });
    expect(motor.getTraversalDebugSnapshot()).toMatchObject({
      kind: "none",
      rejectedReason: expect.stringContaining("outside"),
    });
  });

  it("holds the core until at least 60% of attached flesh is above the crest", async () => {
    const { controller, motor } = await createMotor({ center: new Vector3(-0.3, 0.08, 0) });
    const link = climbLink(0.5);
    motor.beginNavigationAction(link);
    const coreId = controller.topology.coreCellId;
    const held = positionOf(motor.resolveParticleMotion(
      coreId,
      link.start,
      link.end,
      controller.particles.particleRadius,
    ));
    expect(held.y).toBeLessThan(link.end.y - 0.1);
    expect(motor.getTraversalDebugSnapshot().coreReleased).toBe(false);

    const targets: Record<number, { x: number; y: number; z: number }> = {};
    const fleshIds = controller.snapshot().cells.filter((cell) => !cell.isCore).map((cell) => cell.id);
    for (const cellId of fleshIds.slice(0, Math.ceil(fleshIds.length * 0.7))) {
      targets[cellId] = { x: link.end.x, y: link.end.y + 0.2, z: 0 };
    }
    controller.setOverrideState("ScriptedPose");
    for (let index = 0; index < 90; index++) {
      controller.step(1 / 30, {
        gravity: 0,
        particleTargets: targets,
        particleTargetStrength: 30,
      });
    }
    controller.setOverrideState("None");
    motor.update(0, null, false);
    const debug = motor.getTraversalDebugSnapshot();
    expect(debug.crossedFraction).toBeGreaterThanOrEqual(0.6);
    expect(debug.coreReleased).toBe(true);

    const released = positionOf(motor.resolveParticleMotion(
      coreId,
      link.start,
      link.end,
      controller.particles.particleRadius,
    ));
    expect(released.y).toBeGreaterThan(held.y);
  });

  it("assigns flow channels proportionally and supports a legacy full opening", async () => {
    const { controller, motor } = await createMotor({ center: new Vector3(-1, 0.2, 0) });
    const flow: NavigationActionLink = {
      id: "three-channel-flow",
      kind: "flow",
      start: new Vector3(-1, 0, 0),
      end: new Vector3(1, 0, 0),
      bidirectional: true,
      cost: 1,
      width: 4,
      permeableId: "gate",
      flowOpenings: [
        { offset: -1, width: 0.5, bottom: 0, height: 1 },
        { offset: 1, width: 1.5, bottom: 0, height: 1 },
      ],
      brainCrossFraction: 0.7,
    };
    motor.beginNavigationAction(flow);
    const assignments = Object.values(motor.getTraversalDebugSnapshot().channelAssignments);
    const narrow = assignments.filter((value) => value === 0).length;
    const wide = assignments.filter((value) => value === 1).length;
    expect(wide / narrow).toBeCloseTo(3, 0);
    expect(motor.getTraversalDebugSnapshot()).toMatchObject({ requiredFraction: 0.7, coreReleased: false });

    const wideCell = Number(Object.entries(motor.getTraversalDebugSnapshot().channelAssignments)
      .find(([, channel]) => channel === 1)?.[0]);
    const guided = positionOf(motor.resolveParticleMotion(
      wideCell,
      { x: -1, y: 0.2, z: 0 },
      { x: 1, y: 0.2, z: 0 },
      controller.particles.particleRadius,
    ));
    expect(guided.z).toBeGreaterThan(0);

    motor.beginNavigationAction({ ...flow, id: "legacy", flowOpenings: undefined });
    expect(new Set(Object.values(motor.getTraversalDebugSnapshot().channelAssignments))).toEqual(new Set([0]));
  });

  it("moves the full organism through explicit grate channels with the core crossing last", async () => {
    const { physics, controller, motor } = await createMotor({
      center: new Vector3(-0.8, 0.4, 0),
    });
    physics.createStaticBox({
      id: "three-opening-grate",
      position: new Vector3(0, 0.5, 0),
      size: new Vector3(0.2, 1, 4),
      metadata: { blobPermeable: true },
    });
    physics.updateQueryPipeline();
    const link: NavigationActionLink = {
      id: "three-opening-flow",
      kind: "flow",
      start: new Vector3(-0.45, 0.05, 0),
      end: new Vector3(0.45, 0.05, 0),
      bidirectional: true,
      cost: 1,
      width: 4,
      permeableId: "three-opening-grate",
      flowOpenings: [
        { offset: -1.2, width: 0.8, bottom: 0, height: 0.9 },
        { offset: 0, width: 0.8, bottom: 0, height: 0.9 },
        { offset: 1.2, width: 0.8, bottom: 0, height: 0.9 },
      ],
      brainCrossFraction: 0.6,
    };
    motor.beginNavigationAction(link);
    expect(new Set(Object.values(motor.getTraversalDebugSnapshot().channelAssignments))).toEqual(
      new Set([0, 1, 2]),
    );

    let fractionBeforeRelease = 0;
    let sawRelease = false;
    for (let frame = 0; frame < 240; frame++) {
      motor.update(1 / 30, link.end, true);
      const debug = motor.getTraversalDebugSnapshot();
      if (!sawRelease && debug.coreReleased) {
        fractionBeforeRelease = debug.crossedFraction;
        sawRelease = true;
      }
    }

    expect(sawRelease).toBe(true);
    expect(fractionBeforeRelease).toBeGreaterThanOrEqual(0.6);
    expect(controller.snapshot().core.position.x).toBeGreaterThan(0.25);
    expect(motor.getTraversalDebugSnapshot().kind).toBe("none");
  });

  it("spreads scripted islands and completes merge only after physical contact", async () => {
    const { controller, motor } = await createMotor();
    const split = controller.splitScripted(2);
    expect(split.ok).toBe(true);
    for (let index = 0; index < 45; index++) motor.update(1 / 30, null, false);
    const scriptedId = split.islandIds[1];
    const spread = controller.snapshot().particles.filter((particle) => particle.islandId === scriptedId);
    const spreadCenter = spread.reduce(
      (sum, particle) => sum.add(new Vector3(particle.position.x, particle.position.y, particle.position.z)),
      new Vector3(),
    ).multiplyScalar(1 / spread.length);
    expect(spreadCenter.distanceTo(motor.getPosition())).toBeGreaterThan(0.5);

    expect(controller.requestScriptedMerge().ok).toBe(true);
    expect(controller.snapshot().scriptedSplit.active).toBe(true);
    for (let index = 0; index < 120 && controller.snapshot().scriptedSplit.active; index++) {
      motor.update(1 / 30, null, false);
    }
    expect(controller.snapshot().scriptedSplit.active).toBe(false);
  });
});

describe("BlobV2Motor fragments, portals and lifecycle", () => {
  it("lets an unblocked grounded fragment return and physically reattach", async () => {
    const { physics, controller, motor } = await createMotor({
      center: new Vector3(0, 0.3, 0),
      gravity: 18,
    });
    physics.createStaticBox({
      id: "fragment-return-floor",
      position: new Vector3(0, -0.25, 0),
      size: new Vector3(20, 0.5, 20),
    });
    physics.updateQueryPipeline();
    const opening = controller.applyImpact({
      point: { x: 1.2, y: 0.3, z: 0 },
      direction: { x: -1, y: 0, z: 0 },
      normal: { x: 1, y: 0, z: 0 },
      damage: 36,
      cohesionEnergy: 36,
      detachBiomass: 8,
      impulse: { x: 1.6, y: 0.65, z: 0 },
    });
    if (opening.fragmentId === null) throw new Error("Expected fragment");

    for (let index = 0; index < 270; index += 1) {
      motor.update(1 / 30, null, false);
      const state = controller.snapshot().fragments.find(
        (fragment) => fragment.id === opening.fragmentId,
      )?.state;
      if (state === "Attached") break;
    }

    expect(controller.snapshot().fragments.find(
      (fragment) => fragment.id === opening.fragmentId,
    )?.state).toBe("Attached");
    expect(controller.snapshot().biomass.total).toBe(192);
  });

  it("requests a blob-profile path only after a blocked fragment reports needsPath", async () => {
    const enqueue = vi.fn();
    const cancel = vi.fn();
    const requests = { enqueue, cancel } as unknown as NavigationRequestQueue;
    const { physics, controller, motor } = await createMotor({ navigationRequests: requests });
    physics.createStaticBox({
      id: "return-wall",
      position: new Vector3(1.5, 0, 0),
      size: new Vector3(0.2, 100, 100),
    });
    physics.updateQueryPipeline();
    const opening = controller.applyImpact({
      point: { x: 3, y: 0.6, z: 0 },
      direction: { x: -1, y: 0, z: 0 },
      normal: { x: 1, y: 0, z: 0 },
      damage: 36,
      cohesionEnergy: 36,
      detachBiomass: 8,
      impulse: { x: 0, y: 0, z: 0 },
    });
    expect(opening.fragmentId).not.toBeNull();

    for (let index = 0; index < 45; index++) motor.update(1 / 30, null, false);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0]?.[0]).toMatchObject({
      ownerId: `blob-v2-fragment:blob-v2-test:${opening.fragmentId}`,
      profile: BLOB_PROFILE,
      priority: 1,
    });
  });

  it("preserves and executes climb actions from a fragment return path", async () => {
    const harness = await blockedFragmentHarness();
    const start = new Vector3(
      harness.fragment.position.x,
      harness.fragment.position.y,
      harness.fragment.position.z,
    );
    const end = start.clone().add(new Vector3(0, 0.8, 0));
    harness.request.onResolve(actionPath(start, end, {
      id: "fragment-climb",
      kind: "climb",
      start,
      end,
      bidirectional: false,
      cost: 1,
      width: 0.8,
      profileIds: ["blob"],
      climbHeight: 0.8,
    }));

    for (let index = 0; index < 10; index++) harness.motor.update(1 / 30, null, false);
    const after = harness.controller.snapshot().fragments.find(
      (fragment) => fragment.id === harness.fragment.id,
    )!;
    expect(after.position.y).toBeGreaterThan(start.y + 0.2);
  });

  it("executes a flow action through a blob-permeable channel", async () => {
    const harness = await blockedFragmentHarness();
    const start = new Vector3(
      harness.fragment.position.x,
      harness.fragment.position.y,
      harness.fragment.position.z,
    );
    const end = start.clone().add(new Vector3(0, 0, 1.1));
    harness.physics.createStaticBox({
      id: "fragment-return-grate",
      position: start.clone().add(new Vector3(0, 0, 0.55)),
      size: new Vector3(2, 2, 0.18),
      metadata: { blobPermeable: true },
    });
    harness.physics.updateQueryPipeline();
    harness.request.onResolve(actionPath(start, end, {
      id: "fragment-flow",
      kind: "flow",
      start,
      end,
      bidirectional: false,
      cost: 1,
      width: 0.8,
      profileIds: ["blob"],
      permeableId: "fragment-return-grate",
      flowOpenings: [{ offset: 0, width: 0.8, bottom: 0, height: 1 }],
    }));

    for (let index = 0; index < 18; index++) harness.motor.update(1 / 30, null, false);
    const after = harness.controller.snapshot().fragments.find(
      (fragment) => fragment.id === harness.fragment.id,
    )!;
    expect(after.position.z).toBeGreaterThan(start.z + 0.45);
  });

  it("executes and advances a portal action on the fragment island only", async () => {
    const portals = new PortalPairState();
    const harness = await blockedFragmentHarness(portals);
    const start = new Vector3(
      harness.fragment.position.x,
      harness.fragment.position.y,
      harness.fragment.position.z,
    );
    portals.a = {
      position: start.clone().add(new Vector3(0, 0, -0.2)),
      quaternion: new Quaternion(),
      halfWidth: 1,
      halfHeight: 1,
    };
    portals.b = {
      position: new Vector3(10, start.y, 0),
      quaternion: new Quaternion(),
      halfWidth: 1,
      halfHeight: 1,
    };
    const traverse = portals.a.position.clone().add(new Vector3(0, 0, -0.2));
    const end = portals.b.position.clone().add(new Vector3(0, 0, 0.6));
    harness.request.onResolve(actionPath(traverse, end, {
      id: "fragment-portal",
      kind: "portal",
      start,
      traverseStart: traverse,
      end,
      bidirectional: false,
      cost: 1,
      width: 1,
      profileIds: ["blob"],
      portalId: "portalgun-a",
    }));
    const mainBefore = harness.controller.snapshot().core.position;

    for (let index = 0; index < 18; index++) harness.motor.update(1 / 30, null, false);
    const after = harness.controller.snapshot();
    const fragmentAfter = after.fragments.find(
      (fragment) => fragment.id === harness.fragment.id,
    )!;
    expect(fragmentAfter.position.x).toBeGreaterThan(8);
    expect(new Vector3(
      after.core.position.x,
      after.core.position.y,
      after.core.position.z,
    ).distanceTo(new Vector3(mainBefore.x, mainBefore.y, mainBefore.z))).toBeLessThan(0.2);
  });

  it("sweeps a fragment through a linked portal without moving the main island", async () => {
    const portals = new PortalPairState();
    portals.a = {
      position: new Vector3(0, 0.6, 0),
      quaternion: new Quaternion(),
      halfWidth: 2,
      halfHeight: 2,
    };
    portals.b = {
      position: new Vector3(10, 0.6, 0),
      quaternion: new Quaternion(),
      halfWidth: 2,
      halfHeight: 2,
    };
    const { controller, motor } = await createMotor({ portals });
    const opening = controller.applyImpact({
      point: { x: 0, y: 0.6, z: 0.2 },
      direction: { x: 0, y: 0, z: -1 },
      normal: { x: 0, y: 0, z: 1 },
      damage: 36,
      cohesionEnergy: 36,
      detachBiomass: 8,
      impulse: { x: 0, y: 0, z: -3 },
    });
    if (opening.fragmentId === null) throw new Error("Expected fragment");
    const fragmentBefore = controller.snapshot().fragments[0];
    const mainBefore = controller.snapshot().core.position;
    const islandId = fragmentBefore?.islandId;
    if (islandId === undefined) throw new Error("Expected fragment island");
    const speedBefore = Math.hypot(
      fragmentBefore?.velocity.x ?? 0,
      fragmentBefore?.velocity.y ?? 0,
      fragmentBefore?.velocity.z ?? 0,
    );

    motor.resolveFragmentMotion(
      opening.fragmentId,
      islandId,
      { x: 0, y: 0.6, z: 0.2 },
      { x: 0, y: 0.6, z: -0.2 },
      fragmentBefore?.velocity ?? { x: 0, y: 0, z: -3 },
      0.24,
    );
    const after = controller.snapshot();
    const fragmentAfter = after.fragments[0];
    const speedAfter = Math.hypot(
      fragmentAfter?.velocity.x ?? 0,
      fragmentAfter?.velocity.y ?? 0,
      fragmentAfter?.velocity.z ?? 0,
    );
    expect(after.core.position).toEqual(mainBefore);
    expect(fragmentAfter?.position.x).toBeGreaterThan(9);
    expect(speedAfter).toBeGreaterThanOrEqual(speedBefore * 0.9);
  });

  it("uses the Npc portal API to move only main and leaves detached islands behind", async () => {
    const { controller, motor } = await createMotor();
    const opening = controller.applyImpact({
      point: { x: 1, y: 0.6, z: 0 },
      direction: { x: -1, y: 0, z: 0 },
      normal: { x: 1, y: 0, z: 0 },
      damage: 36,
      cohesionEnergy: 36,
      detachBiomass: 8,
      impulse: { x: 2, y: 0, z: 0 },
    });
    if (opening.fragmentId === null) throw new Error("Expected fragment");
    const fragmentBefore = controller.snapshot().fragments[0]?.position;
    const destination = new Vector3(12, 2, -4);
    motor.teleportPose(destination, new Vector3(0, 0, 3), Math.PI / 2);

    const after = controller.snapshot();
    expect(after.core.position.x).toBeCloseTo(destination.x);
    expect(after.core.position.y).toBeCloseTo(destination.y);
    expect(after.core.position.z).toBeCloseTo(destination.z);
    expect(after.fragments[0]?.position).toEqual(fragmentBefore);
  });

  it("launches a coherent leap and returns traversal ownership to Ground", async () => {
    const { controller, motor } = await createMotor({ gravity: 18 });
    const startY = motor.getPosition().y;
    motor.leapTo(new Vector3(3, startY, 0), 6, 4);
    expect(motor.isLeaping()).toBe(true);
    expect(controller.snapshot().traversalState).toBe("Leap");
    let apex = startY;
    for (let index = 0; index < 100 && motor.isLeaping(); index++) {
      motor.update(1 / 30, null, false);
      apex = Math.max(apex, motor.getPosition().y);
    }
    expect(apex).toBeGreaterThan(startY + 0.2);
    expect(motor.isLeaping()).toBe(false);
    expect(controller.snapshot().traversalState).toBe("Ground");
  });

  it("freezes, shatters and disables idempotently", async () => {
    const { controller, motor } = await createMotor();
    expect(motor.freezeSolid()).toBe(true);
    expect(motor.freezeSolid()).toBe(false);
    expect(controller.snapshot().overrideState).toBe("Frozen");
    motor.update(1, new Vector3(10, 0, 0), true);
    expect(controller.snapshot().simulationTime).toBe(0);
    expect(motor.shatterFrozen()).toBe(true);
    expect(motor.shatterFrozen()).toBe(false);
    expect(controller.snapshot().overrideState).toBe("Dead");
    motor.disable();
    motor.disable();
    expect(motor.body.isEnabled()).toBe(false);
  });
});

async function blockedFragmentHarness(portals?: PortalPairState) {
  const enqueue = vi.fn();
  const requests = {
    enqueue,
    cancel: vi.fn(),
  } as unknown as NavigationRequestQueue;
  const result = await createMotor({ portals, navigationRequests: requests });
  result.physics.createStaticBox({
    id: "fragment-return-wall",
    position: new Vector3(1.5, 0, 0),
    size: new Vector3(0.2, 100, 100),
  });
  result.physics.updateQueryPipeline();
  const opening = result.controller.applyImpact({
    point: { x: 3, y: 0.6, z: 0 },
    direction: { x: -1, y: 0, z: 0 },
    normal: { x: 1, y: 0, z: 0 },
    damage: 36,
    cohesionEnergy: 36,
    detachBiomass: 8,
    impulse: { x: 0, y: 0, z: 0 },
  });
  if (opening.fragmentId === null) throw new Error("Expected blocked fragment");
  for (let index = 0; index < 45; index++) result.motor.update(1 / 30, null, false);
  const request = enqueue.mock.calls[0]?.[0] as NavigationRequest | undefined;
  const fragment = result.controller.snapshot().fragments.find(
    (candidate) => candidate.id === opening.fragmentId,
  );
  if (!request || !fragment) throw new Error("Expected a fragment navigation request");
  return { ...result, request, fragment };
}

function actionPath(
  first: Vector3,
  end: Vector3,
  link: NavigationActionLink,
): NavigationPath {
  return {
    points: [first.clone(), end.clone()],
    actions: [{ pointIndex: 0, link }],
    length: first.distanceTo(end),
    partial: false,
  };
}
