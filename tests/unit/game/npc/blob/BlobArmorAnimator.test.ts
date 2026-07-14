import RAPIER from "@dimforge/rapier3d-compat";
import { Group, Scene, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import { PhysicsWorld, type PhysicsMetadata } from "@engine/physics/PhysicsWorld";
import { Raycast } from "@engine/physics/Raycast";
import type { CharacterMotorSnapshot } from "@engine/physics/character/CharacterMotor";
import { BlobConfig } from "@game/config/blob.config";
import {
  BlobArmorAnimator,
  type BlobArmorDebugSnapshot,
} from "@game/npc/blob/BlobArmorAnimator";
import type { AnimationFrame } from "@game/npc/animation/NpcAnimator";
import type { Damageable } from "@shared/types/lifecycle";

interface ArmorRecord {
  collider: RAPIER.Collider;
  body: RAPIER.RigidBody;
  metadata: PhysicsMetadata;
}

describe("BlobArmorAnimator", () => {
  it("crea 16 cuerpos Ball, resortes sin contacto y metadata dañable individual", async () => {
    const harness = await createHarness();
    const snapshot = harness.animator.getDebugSnapshot();
    const armor = armorRecords(harness.physics);

    expect(snapshot.totalCount).toBe(BlobConfig.armor.count);
    expect(snapshot.attachedCount).toBe(BlobConfig.armor.count);
    expect(new Set(snapshot.bodyHandles).size).toBe(BlobConfig.armor.count);
    expect(harness.physics.getBodyCount()).toBe(BlobConfig.armor.count + 1);
    expect(harness.physics.world.impulseJoints.len()).toBe(BlobConfig.armor.count);
    expect(armor).toHaveLength(BlobConfig.armor.count);
    expect(harness.scene.children).toHaveLength(BlobConfig.armor.count + 1);

    const metadataIds = new Set<string>();
    for (const [index, record] of armor.entries()) {
      metadataIds.add(record.metadata.id);
      expect(record.collider.shape.type).toBe(RAPIER.ShapeType.Ball);
      expect(record.body.mass()).toBeCloseTo(BlobConfig.armor.mass, 5);
      expect(record.metadata).toMatchObject({
        ownerId: harness.id,
        kind: "npc",
        characterId: "blob",
        faction: "zombies",
        selfPortalTraversal: true,
        bodyPart: {
          name: `blob-armor-${index}`,
          damageMultiplier: 1,
        },
      });
      expect(record.metadata.damageable?.isAlive()).toBe(true);
    }
    expect(metadataIds.size).toBe(BlobConfig.armor.count);

    harness.physics.world.impulseJoints.forEach((joint) => {
      expect(joint.body1().handle).toBe(harness.coreBody.handle);
      expect(snapshot.bodyHandles).toContain(joint.body2().handle);
      expect(joint.contactsEnabled()).toBe(false);
    });

    // Desde afuera, la primera esfera de la cubierta debe interceptar el rayo
    // antes de que pueda alcanzar el collider del cerebro.
    const firstAnchor = snapshot.anchors[0].clone();
    harness.physics.updateQueryPipeline();
    const hit = new Raycast(harness.physics).cast(
      harness.position.clone().add(firstAnchor.clone().normalize().multiplyScalar(2)),
      firstAnchor.clone().normalize().negate(),
      3,
    );
    expect(hit?.metadata?.bodyPart?.name).toMatch(/^blob-armor-/);

    harness.dispose();
  });

  it("desprende una sola esfera de forma idempotente conservando body e impulso", async () => {
    const harness = await createHarness();
    const target = armorRecords(harness.physics)[0];
    const damageable = target.metadata.damageable!;
    const bodyHandle = target.body.handle;
    const colliderHandle = target.collider.handle;

    damageable.applyDamage(0, new Vector3(1, 0, 0));
    expect(harness.animator.getDebugSnapshot().attachedCount).toBe(16);

    damageable.applyDamage(1, new Vector3(1, 0, 0));

    expect(harness.animator.getDebugSnapshot().attachedCount).toBe(15);
    expect(harness.physics.world.impulseJoints.len()).toBe(15);
    expect(harness.physics.getBodyCount()).toBe(17);
    expect(harness.physics.world.getRigidBody(bodyHandle)).toBe(target.body);
    expect(target.body.linvel().x).toBeGreaterThan(0);
    expect(harness.ownerApplyDamage).not.toHaveBeenCalled();
    expect(damageable.isAlive()).toBe(false);

    const detachedMetadata = harness.physics.getColliderMetadata(
      harness.physics.world.getCollider(colliderHandle),
    );
    expect(detachedMetadata).toEqual({
      id: `${harness.id}-chunk-0`,
      kind: "dynamic",
    });

    const velocityAfterFirstHit = vectorFromRapier(target.body.linvel());
    damageable.applyDamage(10, new Vector3(1, 0, 0));
    expect(harness.animator.getDebugSnapshot().attachedCount).toBe(15);
    expect(harness.physics.world.impulseJoints.len()).toBe(15);
    expect(vectorFromRapier(target.body.linvel())).toEqual(velocityAfterFirstHit);

    const stillAttached = armorRecords(harness.physics);
    expect(stillAttached).toHaveLength(15);
    expect(stillAttached.every((record) => record.metadata.kind === "npc")).toBe(true);

    harness.dispose();
  });

  it("mantiene el hueco 0.5 s y redistribuye gradualmente durante 1.5 s", async () => {
    const harness = await createHarness();
    armorRecords(harness.physics)[0].metadata.damageable!.applyDamage(1);
    const initial = harness.animator.getDebugSnapshot();

    harness.animator.updateFromMotor(animationFrame(0.49));
    expectAnchorsClose(harness.animator.getDebugSnapshot(), initial);

    harness.animator.updateFromMotor(animationFrame(0.01));
    expectAnchorsClose(harness.animator.getDebugSnapshot(), initial);

    harness.animator.updateFromMotor(animationFrame(0.75));
    const halfway = harness.animator.getDebugSnapshot();
    harness.animator.updateFromMotor(animationFrame(0.75));
    const completed = harness.animator.getDebugSnapshot();

    const movedIndices = completed.anchors
      .map((anchor, index) => anchor.distanceTo(initial.anchors[index]))
      .map((distance, index) => ({ distance, index }))
      .filter(({ distance }) => distance > 1e-5);
    expect(movedIndices.length).toBeGreaterThan(0);

    for (const { index } of movedIndices) {
      const expectedHalfway = initial.anchors[index]
        .clone()
        .lerp(completed.anchors[index], 0.5);
      expect(halfway.anchors[index].distanceTo(expectedHalfway)).toBeLessThan(1e-5);
    }

    harness.animator.updateFromMotor(animationFrame(0.25));
    expectAnchorsClose(harness.animator.getDebugSnapshot(), completed);

    harness.dispose();
  });

  it("la muerte libera toda la cubierta y dispose elimina cuerpos, bindings, joints y meshes", async () => {
    const harness = await createHarness();
    const shellBodies = armorRecords(harness.physics).map((record) => record.body);
    const shellColliders = armorRecords(harness.physics).map((record) => record.collider);

    harness.animator.notifyDeath();

    expect(harness.animator.getDebugSnapshot().attachedCount).toBe(0);
    expect(harness.physics.world.impulseJoints.len()).toBe(0);
    expect(harness.physics.getBodyCount()).toBe(17);
    expect(
      shellColliders.every(
        (collider) => harness.physics.getColliderMetadata(collider)?.kind === "dynamic",
      ),
    ).toBe(true);

    harness.animator.dispose();

    expect(harness.physics.world.impulseJoints.len()).toBe(0);
    expect(harness.physics.getBodyCount()).toBe(1);
    expect(harness.scene.children).toEqual([harness.visualGroup]);
    expect(harness.animator.getDebugSnapshot()).toMatchObject({
      attachedCount: 0,
      totalCount: 0,
      bodyHandles: [],
    });
    expect(shellBodies.every((body) => !body.isValid())).toBe(true);
    expect(
      shellColliders.every(
        (collider) => harness.physics.getColliderMetadata(collider) === undefined,
      ),
    ).toBe(true);
    expect(() => harness.animator.dispose()).not.toThrow();
    expect(() => harness.physics.step(1 / 60)).not.toThrow();

    harness.disposeCore();
  });
});

async function createHarness() {
  const physics = new PhysicsWorld();
  await physics.init();
  const id = "blob-test";
  const position = new Vector3(0, 3, 0);
  const ownerApplyDamage = vi.fn<Damageable["applyDamage"]>();
  const owner: Damageable = {
    applyDamage: ownerApplyDamage,
    isAlive: () => true,
  };
  const coreBody = physics.world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(position.x, position.y, position.z),
  );
  const coreCollider = physics.world.createCollider(
    RAPIER.ColliderDesc.ball(BlobConfig.core.radius),
    coreBody,
  );
  physics.registerCollider(coreCollider, {
    id,
    ownerId: id,
    kind: "npc",
    characterId: "blob",
    faction: "zombies",
    damageable: owner,
    bodyPart: { name: "blob-core", damageMultiplier: 1 },
  });

  const scene = new Scene();
  const visualGroup = new Group();
  scene.add(visualGroup);
  const animator = new BlobArmorAnimator({
    id,
    faction: "zombies",
    visualGroup,
    coreBody,
    position,
    physics,
    owner,
  });
  animator.updateFromMotor(animationFrame(0));

  const disposeCore = () => {
    if (coreBody.isValid()) physics.removeBody(coreBody);
  };
  return {
    id,
    position,
    physics,
    owner,
    ownerApplyDamage,
    coreBody,
    scene,
    visualGroup,
    animator,
    disposeCore,
    dispose: () => {
      animator.dispose();
      disposeCore();
    },
  };
}

function armorRecords(physics: PhysicsWorld): ArmorRecord[] {
  const result: ArmorRecord[] = [];
  physics.world.colliders.forEach((collider) => {
    const metadata = physics.getColliderMetadata(collider);
    const body = collider.parent();
    if (!metadata?.bodyPart?.name.startsWith("blob-armor-") || !body) return;
    result.push({ collider, body, metadata });
  });
  return result.sort(
    (a, b) => armorIndex(a.metadata) - armorIndex(b.metadata),
  );
}

function armorIndex(metadata: PhysicsMetadata): number {
  return Number(metadata.bodyPart?.name.split("-").at(-1));
}

function animationFrame(delta: number): AnimationFrame {
  const snapshot: CharacterMotorSnapshot = {
    position: new Vector3(),
    velocity: new Vector3(),
    desiredVelocity: new Vector3(),
    forward: new Vector3(0, 0, 1),
    grounded: true,
    yaw: 0,
    targetYaw: 0,
    distanceToTarget: Number.POSITIVE_INFINITY,
  };
  return {
    snapshot,
    lookTarget: new Vector3(),
    balanceIsStumbling: false,
    delta,
  };
}

function expectAnchorsClose(
  actual: BlobArmorDebugSnapshot,
  expected: BlobArmorDebugSnapshot,
): void {
  expect(actual.anchors).toHaveLength(expected.anchors.length);
  for (let index = 0; index < actual.anchors.length; index += 1) {
    expect(actual.anchors[index].distanceTo(expected.anchors[index])).toBeLessThan(1e-6);
  }
}

function vectorFromRapier(value: RAPIER.Vector): Vector3 {
  return new Vector3(value.x, value.y, value.z);
}
