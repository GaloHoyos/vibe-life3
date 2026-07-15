import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Bone, Group, Vector3 } from "three";
import { BoneMapper } from "@engine/animation/pose/BoneMapper";
import { ProceduralCharacterAnimator } from "@engine/animation/procedural/ProceduralCharacterAnimator";
import { PhysicalSkeleton } from "@engine/animation/ragdoll/PhysicalSkeleton";
import { RagdollController } from "@engine/animation/ragdoll/RagdollController";
import {
  DefaultRagdollConfig,
  type RagdollConfig,
} from "@engine/animation/ragdoll/RagdollDefinition";
import { RagdollSystem } from "@engine/animation/ragdoll/RagdollSystem";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";

beforeAll(async () => {
  await RAPIER.init();
});

describe("RagdollController lifecycle", () => {
  it("expone el centro de masa activo y limpia los bodies una sola vez", async () => {
    const physics = await createPhysics();
    const light = createWeightedBody(physics, new Vector3(0, 2, 0), 1);
    const heavy = createWeightedBody(physics, new Vector3(4, 2, 0), 3);
    const controller = new RagdollController(
      physics,
      [],
      [],
      [light, heavy],
      [],
      config(),
    );

    expect(controller.getCenter()).toEqual(new Vector3(3, 2, 0));
    controller.setActive(false);
    expect(controller.getCenter()).toBeNull();
    controller.setActive(true);
    expect(controller.getCenter()).toEqual(new Vector3(3, 2, 0));

    controller.dispose();
    controller.dispose();

    expect(controller.isActive()).toBe(false);
    expect(controller.getCenter()).toBeNull();
    expect(controller.getBodyCount()).toBe(0);
    expect(controller.getPartCount()).toBe(0);
    expect(controller.getJointCount()).toBe(0);
    expect(physics.getBodyCount()).toBe(0);
  });
});

describe("PhysicalSkeleton lifecycle", () => {
  it("dispose remueve sensores y metadata y queda seguro ante updates tardios", async () => {
    const physics = await createPhysics();
    const root = skeletalRoot(new Vector3(1, 2, 3));
    const skeleton = new PhysicalSkeleton({
      id: "live-sensors",
      mapper: new BoneMapper(root),
      physics,
      characterId: "zombie",
    });
    const [part] = skeleton.getBones();

    expect(skeleton.getBodyCount()).toBe(1);
    expect(physics.getColliderMetadata(part.collider)).toMatchObject({
      ownerId: "live-sensors",
      kind: "ragdoll",
      characterId: "zombie",
    });

    skeleton.dispose();
    skeleton.dispose();

    expect(skeleton.getBodyCount()).toBe(0);
    expect(skeleton.getBones()).toEqual([]);
    expect(physics.getBodyCount()).toBe(0);
    expect(physics.getColliderMetadata(part.collider)).toBeUndefined();
    expect(() => skeleton.setEnabled(true)).not.toThrow();
    expect(() => skeleton.updateFromVisualPose()).not.toThrow();
  });
});

describe("RagdollSystem lifecycle", () => {
  it("distingue sensores vivos del cadaver y propaga center y dispose", async () => {
    const physics = await createPhysics();
    const root = skeletalRoot(new Vector3(2, 4, -1));
    const system = new RagdollSystem({
      id: "ragdoll-system",
      root,
      mapper: new BoneMapper(root),
      physics,
      characterId: "zombie",
    });

    expect(system.ensureLiveSensors()?.getBodyCount()).toBe(1);
    expect(system.getCenter()).toBeNull();
    expect(physics.getBodyCount()).toBe(1);

    system.activate();

    expect(system.isActive()).toBe(true);
    expect(system.getCenter()).toEqual(new Vector3(2, 4, -1));
    expect(system.getBodyCount()).toBe(2);

    system.dispose();
    system.dispose();

    expect(system.isActive()).toBe(false);
    expect(system.getCenter()).toBeNull();
    expect(system.getBodyCount()).toBe(0);
    expect(physics.getBodyCount()).toBe(0);
    expect(system.ensureLiveSensors()).toBeNull();
    expect(() => system.update()).not.toThrow();
    expect(() => system.updateLiveSensors()).not.toThrow();
  });
});

describe("ProceduralCharacterAnimator lifecycle", () => {
  it("expone el centro fisico y dispone toda la cadena idempotentemente", async () => {
    const physics = await createPhysics();
    const root = skeletalRoot(new Vector3(-3, 1.5, 5));
    const animator = new ProceduralCharacterAnimator({
      id: "procedural-ragdoll",
      root,
      physics,
      characterId: "zombie",
    });

    expect(animator.getPhysicalCenter()).toBeNull();
    expect(physics.getBodyCount()).toBe(1);

    animator.dieWithVelocity(undefined, new Vector3());

    expect(animator.isRagdollActive()).toBe(true);
    expect(animator.getPhysicalCenter()).toEqual(new Vector3(-3, 1.5, 5));

    animator.dispose();
    animator.dispose();

    expect(animator.isRagdollActive()).toBe(false);
    expect(animator.getPhysicalCenter()).toBeNull();
    expect(physics.getBodyCount()).toBe(0);
    expect(() => animator.die()).not.toThrow();
  });
});

async function createPhysics(): Promise<PhysicsWorld> {
  const physics = new PhysicsWorld();
  await physics.init();
  return physics;
}

function createWeightedBody(
  physics: PhysicsWorld,
  position: Vector3,
  mass: number,
): RAPIER.RigidBody {
  const body = physics.world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(
      position.x,
      position.y,
      position.z,
    ),
  );
  physics.world.createCollider(RAPIER.ColliderDesc.ball(0.1).setMass(mass), body);
  return body;
}

function skeletalRoot(position: Vector3): Group {
  const root = new Group();
  root.position.copy(position);
  const hips = new Bone();
  hips.name = "Hips";
  root.add(hips);
  root.updateMatrixWorld(true);
  return root;
}

function config(): RagdollConfig {
  return { ...DefaultRagdollConfig };
}
