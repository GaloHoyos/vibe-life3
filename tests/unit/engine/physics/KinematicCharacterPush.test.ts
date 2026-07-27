import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Object3D, Vector3 } from "three";
import type { CameraSystem } from "@engine/render/CameraSystem";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { CHARACTER_MEDIUM_COLLISION_GROUPS } from "@engine/physics/CollisionGroups";
import {
  CharacterController,
  type MovementInput,
} from "@engine/physics/character/CharacterController";
import { CharacterMotor } from "@engine/physics/character/CharacterMotor";

const DT = 1 / 60;
const FORWARD: MovementInput = {
  forward: true,
  back: false,
  left: false,
  right: false,
  jumpPressed: false,
  sprintDown: false,
  crouchDown: false,
};
const CAMERA = {
  getPlanarForward: () => new Vector3(0, 0, 1),
  getPlanarRight: () => new Vector3(1, 0, 0),
} as unknown as CameraSystem;

beforeAll(async () => {
  await RAPIER.init();
});

describe("impulso de personajes cinemáticos", () => {
  it("el jugador transmite impulso al caminar contra un rigid body", async () => {
    const physics = await createWorld();
    const controller = createPlayerController(physics);
    const prop = createProp(physics, new Vector3(0, 0.35, 1.2));
    physics.updateQueryPipeline();

    for (let frame = 0; frame < 60; frame += 1) {
      controller.update(DT, FORWARD, CAMERA);
      physics.step(DT);
    }

    expect(prop.translation().z).toBeGreaterThan(1.5);
    expect(prop.linvel().z).toBeGreaterThan(0.1);
  });

  it("un NPC terrestre transmite impulso usando la masa de su preset", async () => {
    const physics = await createWorld();
    const motor = new CharacterMotor(physics, {
      id: "npc-pusher",
      position: new Vector3(0, 0.9, 0),
      height: 1.8,
      radius: 0.35,
      mass: 60,
      maxSpeed: 3,
      acceleration: 12,
      turnSpeed: 8,
      rotationSmoothing: 0,
      faceTargetDeadzone: 0,
      turnBeforeMoveAngle: Math.PI,
      minMoveFacingDot: -1,
      gravity: 20.5,
      stepOffset: 0.2,
      snapToGround: 0.2,
      metadata: { id: "npc-pusher", kind: "npc" },
    });
    const prop = createProp(physics, new Vector3(0, 0.35, 1.2));
    physics.updateQueryPipeline();

    for (let frame = 0; frame < 90; frame += 1) {
      motor.update(DT, new Vector3(0, 0.9, 5), true);
      physics.step(DT);
    }

    expect(prop.translation().z).toBeGreaterThan(1.5);
  });

  it("una superficie viscosa frena el paso y amortigua el aterrizaje", async () => {
    const normalPhysics = await createWorld();
    const viscousPhysics = await createWorld(true);
    const normal = createPlayerController(normalPhysics);
    const viscous = createPlayerController(viscousPhysics);
    normalPhysics.updateQueryPipeline();
    viscousPhysics.updateQueryPipeline();

    for (let frame = 0; frame < 90; frame += 1) {
      normal.update(DT, FORWARD, CAMERA);
      viscous.update(DT, FORWARD, CAMERA);
      normalPhysics.step(DT);
      viscousPhysics.step(DT);
    }

    expect(viscous.getPosition().z).toBeLessThan(normal.getPosition().z * 0.55);

    normal.teleport(new Vector3(0, 6, 0), new Vector3(0, -16, 0));
    viscous.teleport(new Vector3(0, 6, 0), new Vector3(0, -16, 0));
    let normalImpact = 0;
    let viscousImpact = 0;
    for (let frame = 0; frame < 90; frame += 1) {
      normal.update(DT, { ...FORWARD, forward: false }, CAMERA);
      viscous.update(DT, { ...FORWARD, forward: false }, CAMERA);
      normalPhysics.step(DT);
      viscousPhysics.step(DT);
      normalImpact = Math.max(normalImpact, normal.consumeLandingImpact());
      viscousImpact = Math.max(viscousImpact, viscous.consumeLandingImpact());
    }

    expect(viscousImpact).toBeLessThan(normalImpact * 0.25);
  });

  it("el jugador atraviesa un volumen viscoso, se ralentiza y aparta sus partes", async () => {
    const normalPhysics = await createWorld();
    const mediumPhysics = await createWorld();
    const pushPhysics = await createWorld();
    const normal = createPlayerController(normalPhysics);
    const immersed = createPlayerController(mediumPhysics);
    const pusher = createPlayerController(pushPhysics);
    createPassThroughVolume(mediumPhysics);
    const part = createPassThroughPart(
      pushPhysics,
      new Vector3(0, 0.9, 0.95),
    );
    normalPhysics.updateQueryPipeline();
    mediumPhysics.updateQueryPipeline();
    pushPhysics.updateQueryPipeline();

    for (let frame = 0; frame < 75; frame += 1) {
      normal.update(DT, FORWARD, CAMERA);
      immersed.update(DT, FORWARD, CAMERA);
      pusher.update(DT, FORWARD, CAMERA);
      normalPhysics.step(DT);
      mediumPhysics.step(DT);
      pushPhysics.step(DT);
    }

    expect(immersed.getPosition().z).toBeGreaterThan(2.3);
    expect(immersed.getPosition().z).toBeLessThan(normal.getPosition().z * 0.82);
    expect(part.translation().z).toBeGreaterThan(1.05);
  });

  it("un NPC terrestre también atraviesa y vadea el volumen viscoso", async () => {
    const physics = await createWorld();
    createPassThroughVolume(physics);
    const motor = createGroundNpc(physics, "npc-in-medium");
    physics.updateQueryPipeline();

    for (let frame = 0; frame < 150; frame += 1) {
      motor.update(DT, new Vector3(0, 0.9, 7), true);
      physics.step(DT);
    }

    expect(motor.getPosition().z).toBeGreaterThan(3.2);
  });
});

async function createWorld(viscous = false): Promise<PhysicsWorld> {
  const physics = new PhysicsWorld();
  await physics.init();
  physics.createStaticBox({
    id: viscous ? "viscous-floor" : "floor",
    position: new Vector3(0, -0.25, 0),
    size: new Vector3(30, 0.5, 30),
    metadata: viscous
      ? {
          characterContact: {
            speedScale: 0.34,
            damping: 7,
            landingImpactScale: 0.18,
          },
        }
      : undefined,
  });
  return physics;
}

function createPlayerController(physics: PhysicsWorld): CharacterController {
  return new CharacterController(physics, {
    position: new Vector3(0, 0.9, 0),
    radius: 0.35,
    standingHalfHeight: 0.55,
    crouchHalfHeight: 0.3,
    standingEyeHeight: 0.75,
    crouchEyeHeight: 0.22,
    walkSpeed: 6.2,
    sprintSpeed: 9.5,
    crouchSpeed: 2.5,
    jumpSpeed: 9.2,
    groundAccelerate: 14,
    airAccelerate: 14,
    maxAirWishSpeed: 0.7,
    friction: 6,
    stopSpeed: 1.5,
    crouchTransitionTime: 0.18,
    dynamicPushMass: 70,
  });
}

function createProp(physics: PhysicsWorld, position: Vector3): RAPIER.RigidBody {
  return physics.createDynamicBox(
    {
      id: "push-prop",
      position,
      size: new Vector3(0.7, 0.7, 0.7),
      mass: 4,
    },
    new Object3D(),
  );
}

function createGroundNpc(physics: PhysicsWorld, id: string): CharacterMotor {
  return new CharacterMotor(physics, {
    id,
    position: new Vector3(0, 0.9, 0),
    height: 1.8,
    radius: 0.35,
    mass: 60,
    maxSpeed: 3,
    acceleration: 12,
    turnSpeed: 8,
    rotationSmoothing: 0,
    faceTargetDeadzone: 0,
    turnBeforeMoveAngle: Math.PI,
    minMoveFacingDot: -1,
    gravity: 20.5,
    stepOffset: 0.2,
    snapToGround: 0.2,
    metadata: { id, kind: "npc" },
  });
}

function createPassThroughVolume(physics: PhysicsWorld): void {
  physics.createStaticBox({
    id: "viscous-volume",
    position: new Vector3(0, 0.9, 1.8),
    size: new Vector3(2.5, 1.8, 2.4),
    metadata: { characterContact: passThroughContact() },
  });
}

function createPassThroughPart(
  physics: PhysicsWorld,
  position: Vector3,
): RAPIER.RigidBody {
  const body = physics.createDynamicBox(
    {
      id: "viscous-part",
      position,
      size: new Vector3(0.4, 0.4, 0.4),
      mass: 0.24,
      metadata: { characterContact: passThroughContact() },
    },
    new Object3D(),
  );
  body.collider(0).setCollisionGroups(CHARACTER_MEDIUM_COLLISION_GROUPS);
  return body;
}

function passThroughContact() {
  return {
    speedScale: 0.34,
    damping: 7,
    landingImpactScale: 0.18,
    passThrough: true,
    fullImmersionCount: 1,
    verticalDamping: 9,
    pushAcceleration: 11,
  } as const;
}
