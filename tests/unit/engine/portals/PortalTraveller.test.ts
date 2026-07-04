import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Euler, Object3D, Quaternion, Scene, Vector3 } from "three";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { PortalPairState, type PortalFrame } from "@engine/portals/PortalFrame";
import {
  PortalTravellerSystem,
  type PortalTravellerOptions,
} from "@engine/portals/PortalTravellerSystem";

beforeAll(async () => {
  await RAPIER.init();
});

const OPTIONS: PortalTravellerOptions = {
  apertureRadius: 2.2,
  apertureThickness: 0.1,
  proximity: 2.2,
  cloneEnabled: false,
  crossingMargin: 1.15,
  dynamicTriggerOffset: 0.25,
  cooldownSeconds: 0.15,
  minExitSpeed: 1.5,
  dynamicExitClearance: 0.35,
  dynamicQueryRadius: 3,
};

/** Floor portal (outward normal +Y) at the given position, on the floor top. */
function floorPortal(x: number, z: number): PortalFrame {
  return {
    position: new Vector3(x, 0.5, z),
    quaternion: new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0)),
    halfWidth: 0.55,
    halfHeight: 0.95,
  };
}

/** Wall portal (outward normal +X). */
function wallPortal(x: number, y: number): PortalFrame {
  return {
    position: new Vector3(x, y, 0),
    quaternion: new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0)),
    halfWidth: 0.55,
    halfHeight: 0.95,
  };
}

async function makeWorld(): Promise<{ physics: PhysicsWorld; floor: RAPIER.Collider }> {
  const physics = new PhysicsWorld();
  await physics.init();
  const floorBody = physics.createStaticBox({
    id: "floor",
    position: new Vector3(0, 0, 0),
    size: new Vector3(20, 1, 20),
  });
  return { physics, floor: floorBody.collider(0) };
}

function simulate(
  physics: PhysicsWorld,
  traveller: PortalTravellerSystem,
  steps: number,
): void {
  const dt = 1 / 60;
  for (let i = 0; i < steps; i += 1) {
    traveller.update(i * dt, dt);
    physics.step(dt);
  }
}

function countDynamic(physics: PhysicsWorld): number {
  let n = 0;
  physics.world.bodies.forEach((b) => {
    if (b.isDynamic()) n += 1;
  });
  return n;
}

describe("PortalTravellerSystem — aperture hole", () => {
  it("a box over a floor portal falls through and teleports out the exit", async () => {
    const { physics, floor } = await makeWorld();
    const pair = new PortalPairState();
    const entry = floorPortal(0, 0);
    const exit = wallPortal(9, 2);
    pair.set("a", entry);
    pair.set("b", exit);

    let teleports = 0;
    const traveller = new PortalTravellerSystem(physics, new Scene(), pair, {
      ...OPTIONS,
      onTeleport: () => {
        teleports += 1;
      },
    });
    traveller.setPortal("a", entry, [floor]);
    traveller.setPortal("b", exit, []);

    const box = physics.createDynamicBox(
      { id: "crate", position: new Vector3(0, 1.0, 0), size: new Vector3(0.8, 0.8, 0.8), mass: 1 },
      new Object3D(),
    );

    simulate(physics, traveller, 180);

    expect(teleports).toBeGreaterThanOrEqual(1);
    // Exited through the wall portal near x=9, far from where it started.
    expect(box.translation().x).toBeGreaterThan(5);

    traveller.dispose();
  });

  it("a long box bridging a small portal stays supported (does not fall or teleport)", async () => {
    const { physics, floor } = await makeWorld();
    const pair = new PortalPairState();
    const entry = floorPortal(0, 0);
    const exit = wallPortal(9, 2);
    pair.set("a", entry);
    pair.set("b", exit);

    let teleports = 0;
    const traveller = new PortalTravellerSystem(physics, new Scene(), pair, {
      ...OPTIONS,
      onTeleport: () => {
        teleports += 1;
      },
    });
    traveller.setPortal("a", entry, [floor]);
    traveller.setPortal("b", exit, []);

    // Long thin plank spanning well beyond the oval; rests on the aperture ring.
    const plank = physics.createDynamicBox(
      { id: "plank", position: new Vector3(0, 0.75, 0), size: new Vector3(3, 0.3, 0.3), mass: 1 },
      new Object3D(),
    );

    simulate(physics, traveller, 180);

    expect(teleports).toBe(0);
    // Still resting on the surface, not fallen through.
    expect(plank.translation().y).toBeGreaterThan(0.4);
    expect(Math.abs(plank.translation().x)).toBeLessThan(1);

    traveller.dispose();
  });

  it("a box resting away from the portal keeps its floor contact", async () => {
    const { physics, floor } = await makeWorld();
    const pair = new PortalPairState();
    const entry = floorPortal(0, 0);
    const exit = wallPortal(9, 2);
    pair.set("a", entry);
    pair.set("b", exit);

    const traveller = new PortalTravellerSystem(physics, new Scene(), pair, OPTIONS);
    traveller.setPortal("a", entry, [floor]);
    traveller.setPortal("b", exit, []);

    const box = physics.createDynamicBox(
      { id: "far", position: new Vector3(6, 1.0, 0), size: new Vector3(0.8, 0.8, 0.8), mass: 1 },
      new Object3D(),
    );

    simulate(physics, traveller, 120);

    // Well outside the aperture radius: rests on the real floor.
    expect(box.translation().y).toBeGreaterThan(0.8);

    traveller.dispose();
  });
});

describe("PortalTravellerSystem — dual-body clone", () => {
  const cloneOptions: PortalTravellerOptions = { ...OPTIONS, cloneEnabled: true };

  it("spawns a clone mid-crossing and collapses back to one body at the exit", async () => {
    const { physics, floor } = await makeWorld();
    const pair = new PortalPairState();
    const entry = floorPortal(0, 0);
    const exit = wallPortal(9, 2);
    pair.set("a", entry);
    pair.set("b", exit);

    let teleports = 0;
    const traveller = new PortalTravellerSystem(physics, new Scene(), pair, {
      ...cloneOptions,
      onTeleport: () => {
        teleports += 1;
      },
    });
    traveller.setPortal("a", entry, [floor]);
    traveller.setPortal("b", exit, []);

    const box = physics.createDynamicBox(
      { id: "crate", position: new Vector3(0, 1.0, 0), size: new Vector3(0.8, 0.8, 0.8), mass: 1 },
      new Object3D(),
    );

    const dt = 1 / 60;
    let maxDynamic = 0;
    for (let i = 0; i < 240; i += 1) {
      traveller.update(i * dt, dt);
      physics.step(dt);
      maxDynamic = Math.max(maxDynamic, countDynamic(physics));
    }

    // The clone doubled the dynamic bodies at some point during the crossing.
    expect(maxDynamic).toBe(2);
    // It collapsed back to a single body (no leak) and crossed to the exit.
    expect(countDynamic(physics)).toBe(1);
    expect(teleports).toBeGreaterThanOrEqual(1);
    expect(box.translation().x).toBeGreaterThan(5);

    traveller.dispose();
  });

  it("clones the visual of a self-managed-mesh body (pickup-style)", async () => {
    const { physics, floor } = await makeWorld();
    const pair = new PortalPairState();
    const entry = floorPortal(0, 0);
    const exit = wallPortal(9, 2);
    pair.set("a", entry);
    pair.set("b", exit);

    const scene = new Scene();
    const traveller = new PortalTravellerSystem(physics, scene, pair, cloneOptions);
    traveller.setPortal("a", entry, [floor]);
    traveller.setPortal("b", exit, []);

    // A dynamic body whose mesh is self-managed (registered, not in bindings),
    // just like AmmoPickup / WeaponPickup.
    const body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1.0, 0),
    );
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.4, 0.4, 0.4).setDensity(0.35),
      body,
    );
    physics.registerCollider(body.collider(0), { id: "ammo", kind: "weaponPickup" });
    const visual = new Object3D();
    scene.add(visual);
    physics.setBodyVisual(body, visual);

    const dt = 1 / 60;
    let maxChildren = 0;
    for (let i = 0; i < 240; i += 1) {
      traveller.update(i * dt, dt);
      physics.step(dt);
      const t = body.translation();
      visual.position.set(t.x, t.y, t.z); // pickup syncs its own mesh
      maxChildren = Math.max(maxChildren, scene.children.length);
    }

    // The clone visual was added alongside the original during the crossing…
    expect(maxChildren).toBeGreaterThanOrEqual(2);
    // …and removed on collapse (only the original remains).
    expect(scene.children.length).toBe(1);

    traveller.dispose();
  });

  it("clear() removes any in-flight clone", async () => {
    const { physics, floor } = await makeWorld();
    const pair = new PortalPairState();
    const entry = floorPortal(0, 0);
    const exit = wallPortal(9, 2);
    pair.set("a", entry);
    pair.set("b", exit);

    const traveller = new PortalTravellerSystem(physics, new Scene(), pair, cloneOptions);
    traveller.setPortal("a", entry, [floor]);
    traveller.setPortal("b", exit, []);

    physics.createDynamicBox(
      { id: "crate", position: new Vector3(0, 1.0, 0), size: new Vector3(0.8, 0.8, 0.8), mass: 1 },
      new Object3D(),
    );

    // Step until a clone exists (dynamic count reaches 2).
    const dt = 1 / 60;
    let sawClone = false;
    for (let i = 0; i < 120 && !sawClone; i += 1) {
      traveller.update(i * dt, dt);
      physics.step(dt);
      sawClone = countDynamic(physics) === 2;
    }
    expect(sawClone).toBe(true);

    traveller.clear();
    expect(countDynamic(physics)).toBe(1);

    traveller.dispose();
  });
});
