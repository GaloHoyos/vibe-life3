import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Euler, Quaternion, Vector3 } from "three";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { DynamicFlyerMotor } from "@engine/physics/character/DynamicFlyerMotor";
import { PortalPairState, type PortalFrame } from "@engine/portals/PortalFrame";

beforeAll(async () => {
  await RAPIER.init();
});

/** Portal de pared en x=0 con normal +X (mirando hacia el manhack). */
function wallPortal(): PortalFrame {
  return {
    position: new Vector3(0, 1.5, 0),
    quaternion: new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0)),
    halfWidth: 0.65,
    halfHeight: 1.1,
  };
}

/** Portal de piso en (6, 0.5) con normal +Y. */
function floorPortal(): PortalFrame {
  return {
    position: new Vector3(6, 0.5, 0),
    quaternion: new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0)),
    halfWidth: 0.65,
    halfHeight: 1.1,
  };
}

async function makeWorld(): Promise<PhysicsWorld> {
  const physics = new PhysicsWorld();
  await physics.init();
  physics.createStaticBox({
    id: "floor",
    position: new Vector3(0, 0, 0),
    size: new Vector3(30, 1, 30),
  });
  physics.createStaticBox({
    id: "wall",
    position: new Vector3(-0.5, 2.5, 0),
    size: new Vector3(1, 5, 10),
  });
  return physics;
}

function makeMotor(
  physics: PhysicsWorld,
  portals?: PortalPairState,
  onPortalTeleport?: (exit: Vector3) => void,
): DynamicFlyerMotor {
  return new DynamicFlyerMotor(physics, {
    id: "manhack-test",
    position: new Vector3(4, 1.5, 0),
    height: 0.6,
    radius: 0.3,
    maxSpeed: 6.5,
    acceleration: 5,
    turnSpeed: 6,
    metadata: { id: "manhack-test", kind: "npc", selfPortalTraversal: true },
    portals,
    onPortalTeleport,
  });
}

/** Vuela hacia un objetivo detrás de la pared (como perseguir al ghost). */
function fly(physics: PhysicsWorld, motor: DynamicFlyerMotor, seconds: number): void {
  const dt = 1 / 60;
  const target = new Vector3(-2, 1.5, 0);
  for (let i = 0; i < seconds * 60; i += 1) {
    motor.update(dt, target, true, null);
    physics.step(dt);
  }
}

describe("DynamicFlyerMotor — portales", () => {
  it("cruza el portal en vez de rebotar contra la pared de respaldo", async () => {
    const physics = await makeWorld();
    const pair = new PortalPairState();
    pair.set("a", wallPortal());
    pair.set("b", floorPortal());

    const exits: Vector3[] = [];
    const motor = makeMotor(physics, pair, (exit) => exits.push(exit.clone()));

    fly(physics, motor, 2);

    expect(exits.length).toBeGreaterThanOrEqual(1);
    // Salió por el portal de piso: cerca de (6, 0.5) y sobre el plano.
    expect(Math.abs(exits[0].x - 6)).toBeLessThan(1);
    expect(exits[0].y).toBeGreaterThan(0.5);
  });

  it("sin portales inyectados rebota y queda del lado de entrada", async () => {
    const physics = await makeWorld();
    const motor = makeMotor(physics);

    fly(physics, motor, 2);

    expect(motor.getPosition().x).toBeGreaterThan(0);
  });

  it("con el par sin linkear no teleporta", async () => {
    const physics = await makeWorld();
    const pair = new PortalPairState();
    pair.set("a", wallPortal());

    const exits: Vector3[] = [];
    const motor = makeMotor(physics, pair, (exit) => exits.push(exit.clone()));

    fly(physics, motor, 2);

    expect(exits).toHaveLength(0);
    expect(motor.getPosition().x).toBeGreaterThan(0);
  });
});
