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
  suppressMinIntoSpeed: 1.2,
  suppressLookaheadSeconds: 0.1,
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

  it("keeps bodies with blocked portal traversal on the backing surface", async () => {
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

    const chassis = physics.createDynamicBox(
      {
        id: "vehicle",
        position: new Vector3(0, 1, 0),
        size: new Vector3(0.8, 0.8, 0.8),
        mass: 1200,
        metadata: { portalTraversal: "blocked" },
      },
      new Object3D(),
    );
    simulate(physics, traveller, 180);

    expect(teleports).toBe(0);
    expect(chassis.translation().y).toBeGreaterThan(0.35);
    expect(Math.abs(chassis.translation().x)).toBeLessThan(1);
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

  it("abre el hueco fisico para un organismo compuesto con teleport propio", async () => {
    const { physics, floor } = await makeWorld();
    const pair = new PortalPairState();
    const entry = floorPortal(0, 0);
    const exit = wallPortal(9, 2);
    pair.set("a", entry);
    pair.set("b", exit);
    const traveller = new PortalTravellerSystem(
      physics,
      new Scene(),
      pair,
      OPTIONS,
    );
    traveller.setPortal("a", entry, [floor]);
    traveller.setPortal("b", exit, []);

    const body = physics.createDynamicSphere(
      {
        id: "composite-node",
        position: new Vector3(0, 1, 0),
        radius: 0.2,
        mass: 1,
        metadata: {
          kind: "npc",
          selfPortalTraversal: true,
        },
      },
      new Object3D(),
    );
    const collider = body.collider(0);
    traveller.setExternalTraversalColliders(
      "composite",
      [collider.handle],
      new Set(["a"]),
    );

    simulate(physics, traveller, 120);

    expect(body.translation().y).toBeLessThan(-1);
    traveller.dispose();
  });

  it("a box falls through a floor portal whose pair sits right beside it", async () => {
    const { physics, floor } = await makeWorld();
    const pair = new PortalPairState();
    // Portales adyacentes en el MISMO piso: el anillo de apertura de "a"
    // (radio 2.2) tapa el óvalo de "b"; sin la supresión por slot el prop
    // queda apoyado en aire sólido invisible sobre la boca de "b".
    const a = floorPortal(0, 0);
    const b = floorPortal(1.5, 0);
    pair.set("a", a);
    pair.set("b", b);

    let teleports = 0;
    const traveller = new PortalTravellerSystem(physics, new Scene(), pair, {
      ...OPTIONS,
      onTeleport: () => {
        teleports += 1;
      },
    });
    traveller.setPortal("a", a, [floor]);
    traveller.setPortal("b", b, [floor]);

    physics.createDynamicBox(
      { id: "crate", position: new Vector3(1.5, 1.0, 0), size: new Vector3(0.8, 0.8, 0.8), mass: 1 },
      new Object3D(),
    );

    simulate(physics, traveller, 240);

    expect(teleports).toBeGreaterThanOrEqual(1);
    expect(countDynamic(physics)).toBe(1);

    traveller.dispose();
  });

  it("a thrown box crosses a wall portal whose pair sits right beside it", async () => {
    const { physics, floor } = await makeWorld();
    // Pared con cara frontal en x = 0 (normal +X).
    const wallBody = physics.createStaticBox({
      id: "wall",
      position: new Vector3(-0.5, 2, 0),
      size: new Vector3(1, 4, 10),
    });
    const wall = wallBody.collider(0);

    const pair = new PortalPairState();
    const a = wallPortal(0, 1.5);
    // Par adyacente sobre la MISMA pared (el ancho corre a lo largo de Z).
    const b: PortalFrame = { ...wallPortal(0, 1.5), position: new Vector3(0, 1.5, 1.5) };
    pair.set("a", a);
    pair.set("b", b);

    let teleports = 0;
    const traveller = new PortalTravellerSystem(physics, new Scene(), pair, {
      ...OPTIONS,
      cloneEnabled: true,
      onTeleport: () => {
        teleports += 1;
      },
    });
    traveller.setPortal("a", a, [wall, floor]);
    traveller.setPortal("b", b, [wall, floor]);

    const box = physics.createDynamicBox(
      { id: "thrown", position: new Vector3(1.5, 1.5, 0), size: new Vector3(0.4, 0.4, 0.4), mass: 1 },
      new Object3D(),
    );
    box.setLinvel({ x: -10, y: 0, z: 0 }, true);

    simulate(physics, traveller, 240);

    expect(teleports).toBeGreaterThanOrEqual(1);
    // Salió por "b" hacia +X (no quedó rebotando delante de "a" ni dentro de la pared).
    expect(box.translation().x).toBeGreaterThan(0.1);
    expect(countDynamic(physics)).toBe(1);

    traveller.dispose();
  });

  it("a gravity-gun-speed punt teleports at EVERY approach phase", async () => {
    // A ~40 m/s la caja recorre >0.6 m por step: sin cruce predictivo ni
    // lookahead de supresión, que pase o rebote depende de la fase del step
    // (el bug de "a veces pasan y a veces no" de la gravity gun).
    for (const startX of [1.6, 1.75, 1.9, 2.05]) {
      const { physics, floor } = await makeWorld();
      const wallBody = physics.createStaticBox({
        id: "wall",
        position: new Vector3(-0.5, 2, 0),
        size: new Vector3(1, 4, 10),
      });
      const wall = wallBody.collider(0);

      const pair = new PortalPairState();
      const entry = wallPortal(0, 1.5);
      const exit = floorPortal(6, 0);
      pair.set("a", entry);
      pair.set("b", exit);

      let teleports = 0;
      const traveller = new PortalTravellerSystem(physics, new Scene(), pair, {
        ...OPTIONS,
        cloneEnabled: true,
        onTeleport: () => {
          teleports += 1;
        },
      });
      traveller.setPortal("a", entry, [wall, floor]);
      traveller.setPortal("b", exit, [floor]);

      const box = physics.createDynamicBox(
        { id: "punted", position: new Vector3(startX, 1.5, 0), size: new Vector3(0.3, 0.3, 0.3), mass: 1 },
        new Object3D(),
      );
      box.setLinvel({ x: -40, y: 0, z: 0 }, true);

      simulate(physics, traveller, 120);

      expect(
        teleports,
        `fase startX=${startX}: sin teleport (pos ${box.translation().x.toFixed(2)}, ${box.translation().y.toFixed(2)}, ${box.translation().z.toFixed(2)})`,
      ).toBeGreaterThanOrEqual(1);
      // Salió por el portal de piso lejano, no quedó rebotando contra la pared.
      expect(
        box.translation().x,
        `fase startX=${startX}: no salió por el portal de piso (pos ${box.translation().x.toFixed(2)}, ${box.translation().y.toFixed(2)}, ${box.translation().z.toFixed(2)})`,
      ).toBeGreaterThan(4);

      traveller.dispose();
    }
  });

  it("a CCD ball (SMG grenade-like) fired at a wall portal crosses instead of stopping", async () => {
    const { physics, floor } = await makeWorld();
    const wallBody = physics.createStaticBox({
      id: "wall",
      position: new Vector3(-0.5, 2, 0),
      size: new Vector3(1, 4, 10),
    });
    const wall = wallBody.collider(0);

    const pair = new PortalPairState();
    const entry = wallPortal(0, 1.5);
    const exit = floorPortal(6, 0);
    pair.set("a", entry);
    pair.set("b", exit);

    let teleports = 0;
    const traveller = new PortalTravellerSystem(physics, new Scene(), pair, {
      ...OPTIONS,
      cloneEnabled: true,
      onTeleport: () => {
        teleports += 1;
      },
    });
    traveller.setPortal("a", entry, [wall, floor]);
    traveller.setPortal("b", exit, [floor]);

    // Réplica del body de la granada del SMG: bola chica, densa, con CCD.
    const body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(2.0, 1.5, 0)
        .setLinvel(-40, 0, 0)
        .setCcdEnabled(true),
    );
    const collider = physics.world.createCollider(
      RAPIER.ColliderDesc.ball(0.11).setDensity(800),
      body,
    );
    physics.registerCollider(collider, { id: "nade", kind: "dynamic" });

    simulate(physics, traveller, 120);

    expect(teleports).toBeGreaterThanOrEqual(1);
    // Cruzó y salió por el portal de piso lejano; no quedó frenada en la boca.
    expect(body.translation().x).toBeGreaterThan(4);

    traveller.dispose();
  });

  it("a fast angled shot exits at the mirrored crossing point, flush with the exit plane", async () => {
    const { physics, floor } = await makeWorld();
    const wallBody = physics.createStaticBox({
      id: "wall",
      position: new Vector3(-0.5, 2, 0),
      size: new Vector3(1, 4, 10),
    });
    const wall = wallBody.collider(0);

    const pair = new PortalPairState();
    const entry = wallPortal(0, 1.5);
    const exit = floorPortal(6, 0);
    pair.set("a", entry);
    pair.set("b", exit);

    const exits: Vector3[] = [];
    const traveller = new PortalTravellerSystem(physics, new Scene(), pair, {
      ...OPTIONS,
      cloneEnabled: true,
      onTeleport: (_id, exitPosition) => {
        exits.push(exitPosition.clone());
      },
    });
    traveller.setPortal("a", entry, [wall, floor]);
    traveller.setPortal("b", exit, [floor]);

    // Tiro en DIAGONAL: cruza el plano de entrada en su local x = -0.3 (world
    // z = +0.3). El espejo del portal invierte x local → debe salir en el
    // local x = +0.3 del portal de piso (world x = 6.3), pegado al plano.
    const body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(1.5, 1.5, -0.45)
        .setLinvel(-20, 0, 10)
        .setCcdEnabled(true),
    );
    const collider = physics.world.createCollider(
      RAPIER.ColliderDesc.ball(0.11).setDensity(800),
      body,
    );
    physics.registerCollider(collider, { id: "nade", kind: "dynamic" });

    simulate(physics, traveller, 30);

    expect(exits.length).toBeGreaterThanOrEqual(1);
    const first = exits[0];
    // Pegado al plano de salida (piso en y=0.5), no medio metro arriba.
    expect(first.y).toBeLessThan(0.75);
    // Punto lateral espejado del cruce real (no corrido por el trigger predictivo).
    expect(Math.abs(first.x - 6.3)).toBeLessThan(0.25);

    traveller.dispose();
  });

  it("a box punted at the BACK of a thin wall portal stays behind the wall", async () => {
    const { physics, floor } = await makeWorld();
    // Pared FINA (0.2 m) con cara frontal en x = 0: detrás (x < -0.2) la caja
    // queda dentro de la zona axial de la apertura, el caso del backdoor.
    const wallBody = physics.createStaticBox({
      id: "wall",
      position: new Vector3(-0.1, 2, 0),
      size: new Vector3(0.2, 4, 10),
    });
    const wall = wallBody.collider(0);

    const pair = new PortalPairState();
    const entry = wallPortal(0, 1.5);
    const exit = floorPortal(6, 0);
    pair.set("a", entry);
    pair.set("b", exit);

    let teleports = 0;
    const traveller = new PortalTravellerSystem(physics, new Scene(), pair, {
      ...OPTIONS,
      cloneEnabled: true,
      onTeleport: () => {
        teleports += 1;
      },
    });
    traveller.setPortal("a", entry, [wall, floor]);
    traveller.setPortal("b", exit, [floor]);

    const box = physics.createDynamicBox(
      { id: "backdoor", position: new Vector3(-2.5, 1.5, 0), size: new Vector3(0.4, 0.4, 0.4), mass: 1 },
      new Object3D(),
    );
    box.setLinvel({ x: 10, y: 0, z: 0 }, true);

    simulate(physics, traveller, 180);

    expect(teleports).toBe(0);
    // Rebotó contra la cara trasera (x = -0.2): jamás apareció del lado frontal.
    expect(box.translation().x).toBeLessThan(-0.35);
    expect(countDynamic(physics)).toBe(1);

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

  it("a stationary box near a wall portal keeps floor contact when backing collider is shared", async () => {
    const { physics, floor } = await makeWorld();
    const pair = new PortalPairState();
    const entry = wallPortal(0, 1);
    const exit = floorPortal(6, 0);
    pair.set("a", entry);
    pair.set("b", exit);

    const traveller = new PortalTravellerSystem(physics, new Scene(), pair, {
      ...OPTIONS,
      cloneEnabled: true,
    });
    traveller.setPortal("a", entry, [floor]);
    traveller.setPortal("b", exit, []);

    const box = physics.createDynamicBox(
      { id: "near-wall", position: new Vector3(0.6, 1.0, 0), size: new Vector3(0.8, 0.8, 0.8), mass: 1 },
      new Object3D(),
    );

    simulate(physics, traveller, 120);

    expect(countDynamic(physics)).toBe(1);
    expect(box.translation().y).toBeGreaterThan(0.8);
    expect(box.translation().x).toBeGreaterThan(0.2);

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
    let sawScaleSync = false;
    for (let i = 0; i < 240; i += 1) {
      traveller.update(i * dt, dt);
      if (!sawScaleSync && scene.children.length >= 2) {
        visual.scale.set(0.72, 0.81, 0.9);
        traveller.update(i * dt, 0);
        const clone = scene.children.find((child) => child !== visual);
        sawScaleSync = clone?.scale.equals(visual.scale) ?? false;
      }
      physics.step(dt);
      const t = body.translation();
      visual.position.set(t.x, t.y, t.z); // pickup syncs its own mesh
      maxChildren = Math.max(maxChildren, scene.children.length);
    }

    // The clone visual was added alongside the original during the crossing…
    expect(maxChildren).toBeGreaterThanOrEqual(2);
    expect(sawScaleSync).toBe(true);
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
