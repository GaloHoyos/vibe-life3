import RAPIER from "@dimforge/rapier3d-compat";
import {
  Euler,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Quaternion,
  Scene,
  Vector3,
  type BufferGeometry,
} from "three";
import { describe, expect, it, vi } from "vitest";
import type { NavigationService } from "@engine/ai/navigation/NavigationService";
import type {
  NavigationRequest,
  NavigationRequestQueue,
} from "@engine/ai/navigation/NavigationRequestQueue";
import {
  PhysicsWorld,
  type PhysicsMetadata,
} from "@engine/physics/PhysicsWorld";
import { Raycast } from "@engine/physics/Raycast";
import { PhysicsGrabController } from "@engine/physics/grab/PhysicsGrabController";
import type { PortalFrame } from "@engine/portals/PortalFrame";
import {
  transformDirectionThroughPortal,
  transformPointThroughPortal,
  transformQuaternionThroughPortal,
} from "@engine/portals/PortalMath";
import type { CharacterMotorSnapshot } from "@engine/physics/character/CharacterMotor";
import { createBlobCoreVisual } from "@game/characters/visuals/BlobVisual";
import { BlobConfig } from "@game/config/blob.config";
import { GravityGunConfig } from "@game/config/gravitygun.config";
import { WeaponDefinitions } from "@game/config/weapons.config";
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
  it("atraviesa un portal como un solo organismo sin arrastrar chunks lejanos", async () => {
    const harness = await createHarness();
    const armor = armorRecords(harness.physics);
    const initialSnapshot = harness.animator.getDebugSnapshot();
    const releasedIndex = layerIndices(
      initialSnapshot,
      maximumLayer(initialSnapshot),
    )[0];
    const released = armor[releasedIndex];
    released.metadata.damageable!.applyDamage(1);
    expect(
      advanceUntil(
        harness,
        () => currentMetadata(harness, released).kind === "dynamic",
        1,
      ),
    ).toBe(true);
    const releasedPosition = new Vector3(14, 4, 6);
    placeBody(released.body, releasedPosition);
    stopBody(released.body);

    const travelling = armor.find(
      (_, index) =>
        index !== releasedIndex &&
        harness.animator
          .getDebugSnapshot()
          .attachedIndices.includes(index),
    )!;
    harness.coreBody.setLinvel({ x: 0.8, y: -1.2, z: -2.4 }, true);
    harness.coreBody.setAngvel({ x: 0.2, y: -0.35, z: 0.5 }, true);
    travelling.body.setLinvel({ x: -0.4, y: 0.7, z: -1.1 }, true);
    travelling.body.setAngvel({ x: 0.6, y: 0.1, z: -0.25 }, true);

    const entry: PortalFrame = {
      position: new Vector3(0, 3, 0),
      quaternion: new Quaternion(),
      halfWidth: 0.65,
      halfHeight: 1.1,
    };
    const exit: PortalFrame = {
      position: new Vector3(9, 2, -4),
      quaternion: new Quaternion().setFromEuler(
        new Euler(0, Math.PI / 2, 0),
      ),
      halfWidth: 0.65,
      halfHeight: 1.1,
    };
    const destination = new Vector3(10.55, 2.2, -4);
    const exitVelocity = new Vector3(3.2, -1.2, 0.8);
    const coreBefore = vectorFromRapier(harness.coreBody.translation());
    const coreVelocityBefore = vectorFromRapier(harness.coreBody.linvel());
    const partBefore = vectorFromRapier(travelling.body.translation());
    const partVelocityBefore = vectorFromRapier(travelling.body.linvel());
    const partAngularBefore = vectorFromRapier(travelling.body.angvel());
    const partRotationBefore = quaternionFromRapier(travelling.body.rotation());
    const positionCorrection = destination
      .clone()
      .sub(transformPointThroughPortal(coreBefore, entry, exit));
    const velocityCorrection = exitVelocity
      .clone()
      .sub(
        transformDirectionThroughPortal(
          coreVelocityBefore,
          entry,
          exit,
        ),
      );
    const expectedPartPosition = transformPointThroughPortal(
      partBefore,
      entry,
      exit,
    ).add(positionCorrection);
    const expectedPartVelocity = transformDirectionThroughPortal(
      partVelocityBefore,
      entry,
      exit,
    ).add(velocityCorrection);
    const expectedPartAngular = transformDirectionThroughPortal(
      partAngularBefore,
      entry,
      exit,
    );
    const expectedPartRotation = transformQuaternionThroughPortal(
      partRotationBefore,
      entry,
      exit,
    );
    const jointCount = harness.physics.world.impulseJoints.len();

    expect(
      harness.animator.teleportThroughPortal(
        entry,
        exit,
        destination,
        exitVelocity,
        0,
      ),
    ).toBe(true);

    expect(
      vectorFromRapier(harness.coreBody.translation()).distanceTo(destination),
    ).toBeLessThan(1e-5);
    expect(
      vectorFromRapier(harness.coreBody.linvel()).distanceTo(exitVelocity),
    ).toBeLessThan(1e-5);
    expect(
      vectorFromRapier(travelling.body.translation()).distanceTo(
        expectedPartPosition,
      ),
    ).toBeLessThan(1e-5);
    expect(
      vectorFromRapier(travelling.body.linvel()).distanceTo(
        expectedPartVelocity,
      ),
    ).toBeLessThan(1e-5);
    expect(
      vectorFromRapier(travelling.body.angvel()).distanceTo(
        expectedPartAngular,
      ),
    ).toBeLessThan(1e-5);
    expect(
      1 -
        Math.abs(
          quaternionFromRapier(travelling.body.rotation()).dot(
            expectedPartRotation,
          ),
        ),
    ).toBeLessThan(1e-5);
    expect(
      vectorFromRapier(released.body.translation()).distanceTo(
        releasedPosition,
      ),
    ).toBeLessThan(1e-5);
    expect(harness.physics.world.impulseJoints.len()).toBe(jointCount);
    expect(harness.animator.getPortalColliderHandles()).not.toContain(
      released.collider.handle,
    );

    harness.dispose();
  });

  it("construye un gel 3D grande de 36 blobs chicos con sólo la capa interna anclada al cerebro", async () => {
    const harness = await createHarness();
    const snapshot = harness.animator.getDebugSnapshot();
    const armor = armorRecords(harness.physics);

    expect(snapshot.totalCount).toBe(BlobConfig.armor.count);
    expect(snapshot.attachedCount).toBe(BlobConfig.armor.count);
    expect(snapshot.attachedIndices).toEqual(
      Array.from({ length: BlobConfig.armor.count }, (_, index) => index),
    );
    expect(snapshot.coreJointCount).toBe(BlobConfig.armor.coreAnchorCount);
    expect(snapshot.coreAnchoredIndices).toHaveLength(
      BlobConfig.armor.coreAnchorCount,
    );
    expect(layerHistogram(snapshot)).toEqual([...BlobConfig.armor.layerCounts]);
    expect(
      snapshot.coreAnchoredIndices.every(
        (index) => snapshot.layers[index] === 0,
      ),
    ).toBe(true);

    const keys = snapshot.cohesionPairs.map(([from, to]) =>
      pairKey(from, to),
    );
    expect(snapshot.cohesionBondCount).toBeGreaterThanOrEqual(
      BlobConfig.armor.count - BlobConfig.armor.coreAnchorCount,
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(snapshot.cohesionPairs.some(([from, to]) => {
      return snapshot.layers[from] !== snapshot.layers[to];
    })).toBe(true);
    for (const [from, to] of snapshot.cohesionPairs) {
      expect(from).toBeLessThan(to);
      expect(Math.abs(snapshot.layers[from] - snapshot.layers[to])).toBeLessThanOrEqual(1);
      expect(bodyDistance(armor[from].body, armor[to].body)).toBeLessThanOrEqual(
        BlobConfig.armor.cohesionAttachMaxDistance + 1e-5,
      );
    }
    const degrees = graphDegrees(snapshot);
    expect(Math.min(...degrees)).toBeGreaterThanOrEqual(
      BlobConfig.armor.cohesionNeighborCount,
    );
    const sameLayerDegrees = snapshot.layers.map((layer, index) =>
      snapshot.cohesionPairs.filter(
        ([from, to]) =>
          (from === index || to === index) &&
          snapshot.layers[from] === layer &&
          snapshot.layers[to] === layer,
      ).length,
    );
    expect(Math.min(...sameLayerDegrees)).toBeGreaterThanOrEqual(
      BlobConfig.armor.cohesionLayerNeighborCount,
    );
    expectMainGraphConsistent(snapshot);

    expect(harness.coreBody.mass()).toBeCloseTo(BlobConfig.core.mass, 4);
    expect(harness.physics.getBodyCount()).toBe(BlobConfig.armor.count + 1);
    expect(harness.scene.children).toHaveLength(BlobConfig.armor.count + 2);
    expect(new Set(snapshot.bodyHandles).size).toBe(BlobConfig.armor.count);
    expect(armor).toHaveLength(BlobConfig.armor.count);

    const surface = harness.scene.getObjectByName(
      `${harness.id}-gel-surface`,
    );
    expect(surface).toBeInstanceOf(Mesh);
    if (!(surface instanceof Mesh)) {
      throw new Error("Superficie continua del blob no encontrada");
    }
    expect(surface.material).toBeInstanceOf(MeshPhysicalMaterial);
    expect(surface.visible).toBe(true);
    expect(blobMesh(harness, 0).visible).toBe(false);
    expect((surface.material as MeshPhysicalMaterial).transparent).toBe(true);
    expect((surface.material as MeshPhysicalMaterial).opacity).toBeLessThan(1);

    let coreJoints = 0;
    let gelJoints = 0;
    const armorHandles = new Set(snapshot.bodyHandles);
    harness.physics.world.impulseJoints.forEach((joint) => {
      const handles = [joint.body1().handle, joint.body2().handle];
      if (handles.includes(harness.coreBody.handle)) {
        coreJoints += 1;
        expect(joint.contactsEnabled()).toBe(false);
        expect(handles.some((handle) => armorHandles.has(handle))).toBe(true);
      } else {
        gelJoints += 1;
        expect(joint.contactsEnabled()).toBe(true);
        expect(handles.every((handle) => armorHandles.has(handle))).toBe(true);
      }
    });
    expect(coreJoints).toBe(BlobConfig.armor.coreAnchorCount);
    expect(gelJoints).toBe(snapshot.cohesionBondCount);
    expect(harness.physics.world.impulseJoints.len()).toBe(
      snapshot.coreJointCount + snapshot.cohesionBondCount,
    );

    let maximumExtent = 0;
    for (const [index, record] of armor.entries()) {
      const radius = ballRadius(record.collider);
      maximumExtent = Math.max(
        maximumExtent,
        bodyDistance(harness.coreBody, record.body) + radius,
      );
      expect(record.collider.shape.type).toBe(RAPIER.ShapeType.Ball);
      expect(radius).toBeGreaterThanOrEqual(BlobConfig.armor.minRadius);
      expect(radius).toBeLessThanOrEqual(BlobConfig.armor.maxRadius);
      expect(record.body.mass()).toBeCloseTo(BlobConfig.armor.mass, 5);
      expect(record.body.gravityScale()).toBeCloseTo(
        BlobConfig.armor.attachedGravityScale,
        6,
      );
      expect(record.metadata).toMatchObject({
        id: `${harness.id}-blob-${index}`,
        ownerId: harness.id,
        kind: "npc",
        characterId: "blob",
        faction: "zombies",
        bodyPart: { name: `blob-armor-${index}`, damageMultiplier: 1 },
      });
      expect(record.metadata.damageable?.isAlive()).toBe(true);
    }
    expect(maximumExtent).toBeGreaterThan(1.15);
    expect(maximumExtent).toBeLessThanOrEqual(
      BlobConfig.armor.aggregateRadius + 1e-3,
    );

    const outer = armor[layerIndices(snapshot, maximumLayer(snapshot))[0]];
    const outward = vectorFromRapier(outer.body.translation())
      .sub(vectorFromRapier(harness.coreBody.translation()))
      .normalize();
    harness.physics.updateQueryPipeline();
    const hit = new Raycast(harness.physics).cast(
      vectorFromRapier(outer.body.translation()).addScaledVector(outward, 1),
      outward.clone().negate(),
      2,
    );
    expect(hit?.metadata?.bodyPart?.name).toMatch(/^blob-armor-/);

    harness.dispose();
  });

  it("convierte materia orgánica en nodos físicos conectados y abre una capa exterior uniforme", async () => {
    const harness = await createHarness();
    const initial = harness.animator.getDebugSnapshot();
    const initialHandles = new Set(initial.bodyHandles);

    expect(harness.animator.addOrganicMass(7)).toBe(7);
    const grown = harness.animator.getDebugSnapshot();
    const armor = armorRecords(harness.physics);

    expect(grown.totalCount).toBe(BlobConfig.armor.count + 7);
    expect(grown.attachedCount).toBe(BlobConfig.armor.count + 7);
    expect(grown.coreJointCount).toBe(BlobConfig.armor.coreAnchorCount);
    expect(layerHistogram(grown)).toEqual([6, 12, 18, 7]);
    expect(grown.layers).toHaveLength(BlobConfig.armor.count + 7);
    expect(armor).toHaveLength(BlobConfig.armor.count + 7);
    expect(harness.physics.getBodyCount()).toBe(BlobConfig.armor.count + 8);
    expect(harness.scene.children).toHaveLength(BlobConfig.armor.count + 9);
    expect(
      grown.bodyHandles.filter((handle) => !initialHandles.has(handle)),
    ).toHaveLength(7);
    expectMainGraphConsistent(grown);

    for (let index = BlobConfig.armor.count; index < armor.length; index += 1) {
      expect(armor[index].metadata).toMatchObject({
        id: `${harness.id}-blob-${index}`,
        ownerId: harness.id,
        kind: "npc",
        bodyPart: { name: `blob-armor-${index}`, damageMultiplier: 1 },
      });
      expect(armor[index].metadata.damageable?.isAlive()).toBe(true);
      expect(armor[index].body.mass()).toBeCloseTo(BlobConfig.armor.mass, 5);
    }

    harness.dispose();
  });

  it("crece más allá de una capa sin límites fijos y conserva índices estables", async () => {
    const harness = await createHarness();

    expect(harness.animator.addOrganicMass(40)).toBe(40);
    expect(harness.animator.addOrganicMass(Number.POSITIVE_INFINITY)).toBe(0);
    expect(harness.animator.addOrganicMass(0.9)).toBe(0);
    expect(harness.animator.addOrganicMass(3)).toBe(3);

    const grown = harness.animator.getDebugSnapshot();
    const armor = armorRecords(harness.physics);
    expect(grown.totalCount).toBe(BlobConfig.armor.count + 43);
    expect(grown.attachedIndices).toEqual(
      Array.from({ length: BlobConfig.armor.count + 43 }, (_, index) => index),
    );
    expect(layerHistogram(grown)).toEqual([6, 12, 18, 27, 16]);
    expect(new Set(grown.bodyHandles).size).toBe(grown.totalCount);
    expectMainGraphConsistent(grown);

    harness.physics.world.gravity = { x: 0, y: 0, z: 0 };
    harness.coreBody.setBodyType(
      RAPIER.RigidBodyType.KinematicPositionBased,
      true,
    );
    advanceSimulation(harness, 2.5);
    for (const record of armor) {
      const position = record.body.translation();
      expect([position.x, position.y, position.z].every(Number.isFinite)).toBe(
        true,
      );
    }
    expect(shellShapeAspect(harness, armor)).toBeLessThan(2);
    expectMainGraphConsistent(harness.animator.getDebugSnapshot());

    harness.dispose();
  });

  it("no recicla el índice de biomasa que se desprendió y marchitó", async () => {
    const harness = await createHarness();
    expect(harness.animator.addOrganicMass(1)).toBe(1);
    const grown = armorRecords(harness.physics);
    const doomed = grown[BlobConfig.armor.count];
    const outward = vectorFromRapier(doomed.body.translation())
      .sub(vectorFromRapier(harness.coreBody.translation()))
      .normalize();
    doomed.body.applyImpulse(
      outward.clone().multiplyScalar(WeaponDefinitions.revolver.impulse),
      true,
    );
    doomed.metadata.damageable!.applyDamage(
      WeaponDefinitions.revolver.damage,
      outward,
    );
    expect(
      advanceUntil(
        harness,
        () => currentMetadata(harness, doomed).kind === "dynamic",
        1,
      ),
    ).toBe(true);
    placeBody(doomed.body, new Vector3(12, 6, 0));
    advanceSimulation(
      harness,
      BlobConfig.armor.detachedLifetimeSeconds + 0.2,
      1 / 20,
    );
    expect(doomed.body.isValid()).toBe(false);

    expect(harness.animator.addOrganicMass(1)).toBe(1);
    const restored = harness.animator.getDebugSnapshot();
    expect(restored.totalCount).toBe(BlobConfig.armor.count + 1);
    expect(restored.layers[BlobConfig.armor.count]).toBe(-1);
    expect(restored.layers[BlobConfig.armor.count + 1]).toBeGreaterThanOrEqual(
      0,
    );
    expect(
      armorRecords(harness.physics).map((record) => armorIndex(record.metadata)),
    ).toContain(BlobConfig.armor.count + 1);
    expectMainGraphConsistent(restored);

    harness.dispose();
  });

  it("presta nodos exteriores para abrazar una presa y luego recompone una masa uniforme", async () => {
    const harness = await createHarness();
    harness.physics.world.gravity = { x: 0, y: 0, z: 0 };
    harness.coreBody.setBodyType(
      RAPIER.RigidBodyType.KinematicPositionBased,
      true,
    );
    const core = vectorFromRapier(harness.coreBody.translation());
    const targetRadius = 0.78;
    const target = core.clone().add(new Vector3(1.85, 0, 0));

    harness.animator.setFeedingTarget(target, targetRadius, 1);
    advanceSimulation(harness, 4);

    const embracing = harness.animator.getDebugSnapshot();
    const armor = armorRecords(harness.physics);
    const aroundPrey = armor.filter(
      (record) =>
        vectorFromRapier(record.body.translation()).distanceTo(target) <=
        targetRadius + BlobConfig.armor.maxRadius + 0.42,
    );
    const guardingCore = armor.filter(
      (record) =>
        vectorFromRapier(record.body.translation()).distanceTo(core) <= 1.3,
    );
    expect(harness.animator.getFeedingCoverage()).toBeGreaterThanOrEqual(
      BlobConfig.predator.digestionCoverageThreshold,
    );
    expect(aroundPrey.length).toBeGreaterThanOrEqual(8);
    expect(guardingCore.length).toBeGreaterThanOrEqual(18);
    expect(embracing.attachedCount).toBe(BlobConfig.armor.count);
    expect(embracing.coreJointCount).toBe(BlobConfig.armor.coreAnchorCount);

    harness.animator.clearFeedingTarget();
    advanceSimulation(harness, 4);
    expect(harness.animator.getFeedingCoverage()).toBe(0);
    expectMainGraphConsistent(harness.animator.getDebugSnapshot());
    expect(shellShapeAspect(harness, armorRecords(harness.physics))).toBeLessThan(
      1.8,
    );

    harness.dispose();
  });

  it("cae con peso pero no se desarma cuando todo el gel está en caída libre", async () => {
    const harness = await createHarness();
    const initialY = harness.coreBody.translation().y;

    advanceSimulation(
      harness,
      BlobConfig.armor.cohesionLoadInitialGraceSeconds +
        BlobConfig.armor.cohesionLoadFatigueSeconds +
        0.5,
    );

    expect(initialY - harness.coreBody.translation().y).toBeGreaterThan(0.75);
    expect(harness.coreBody.linvel().y).toBeLessThan(-3.5);
    expect(harness.animator.getDebugSnapshot().attachedCount).toBe(
      BlobConfig.armor.count,
    );
    expect(releasedArmorIndices(harness, armorRecords(harness.physics))).toEqual(
      [],
    );
    expectMainGraphConsistent(harness.animator.getDebugSnapshot());

    harness.dispose();
  });

  it("fatiga y desprende sólo parte de los blobs exteriores que cuelgan sobre un precipicio", async () => {
    const harness = await createHarness();
    const armor = armorRecords(harness.physics);
    translateWholeBlob(harness, armor, new Vector3(-0.4, 1.22, 0));
    harness.physics.createStaticBox({
      id: "blob-cliff",
      position: new Vector3(-4, -0.5, 0),
      size: new Vector3(8, 1, 8),
    });
    harness.coreBody.setBodyType(
      RAPIER.RigidBodyType.KinematicPositionBased,
      true,
    );
    const coreAnchor = vectorFromRapier(harness.coreBody.translation());
    harness.physics.updateQueryPipeline();

    const initial = harness.animator.getDebugSnapshot();
    const outerLayer = maximumLayer(initial);
    const supported = layerIndices(initial, outerLayer).filter(
      (index) => armor[index].body.translation().x < -0.65,
    );
    const everReleased = new Set<number>();
    const releasedFromVoid = new Set<number>();
    const stepCliff = (seconds: number) => {
      const steps = Math.ceil(seconds * 60);
      for (let step = 0; step < steps; step += 1) {
        harness.coreBody.setNextKinematicTranslation(coreAnchor);
        harness.animator.updateFromMotor(animationFrame(1 / 60));
        harness.physics.step(1 / 60);
        for (const index of releasedArmorIndices(harness, armor)) {
          if (
            !everReleased.has(index) &&
            armor[index].body.translation().x > 0.05
          ) {
            releasedFromVoid.add(index);
          }
          everReleased.add(index);
        }
      }
    };

    stepCliff(0.3);
    expect(everReleased.size).toBe(0);
    stepCliff(4);

    const final = harness.animator.getDebugSnapshot();
    expect(everReleased.size).toBeGreaterThanOrEqual(2);
    expect(everReleased.size).toBeLessThanOrEqual(
      BlobConfig.armor.cohesionLoadMaxChunkSize,
    );
    expect(
      releasedFromVoid.size,
    ).toBeGreaterThanOrEqual(Math.ceil(everReleased.size * 0.6));
    expect(
      [...everReleased].some((index) => initial.coreAnchoredIndices.includes(index)),
    ).toBe(false);
    expect(final.attachedCount).toBeGreaterThan(
      BlobConfig.armor.count - BlobConfig.armor.cohesionLoadMaxChunkSize,
    );
    expect(supported.some((index) => final.attachedIndices.includes(index))).toBe(
      true,
    );
    expectMainGraphConsistent(final);

    harness.dispose();
  });

  it("gotea por abajo cuando se levanta suavemente sin una sacudida", async () => {
    const harness = await createHarness();
    const armor = armorRecords(harness.physics);
    harness.physics.createStaticBox({
      id: "blob-lift-floor",
      position: new Vector3(0, -0.5, 0),
      size: new Vector3(12, 1, 12),
    });
    translateWholeBlob(harness, armor, new Vector3(0, 1.25, 0));
    harness.coreBody.setBodyType(
      RAPIER.RigidBodyType.KinematicPositionBased,
      true,
    );
    const start = vectorFromRapier(harness.coreBody.translation());
    const roots = new Set(
      harness.animator.getDebugSnapshot().coreAnchoredIndices,
    );
    const everReleased = new Set<number>();
    const releasedBelowCore = new Set<number>();
    const stepAt = (target: Vector3) => {
      harness.coreBody.setNextKinematicTranslation(target);
      harness.animator.updateFromMotor(animationFrame(1 / 60));
      harness.physics.step(1 / 60);
      const coreY = harness.coreBody.translation().y;
      for (const index of releasedArmorIndices(harness, armor)) {
        if (!everReleased.has(index) && armor[index].body.translation().y < coreY) {
          releasedBelowCore.add(index);
        }
        everReleased.add(index);
      }
    };

    for (let frame = 0; frame < 60; frame += 1) stepAt(start);
    expect(everReleased.size).toBe(0);
    for (let frame = 0; frame < 90; frame += 1) {
      const u = frame / 89;
      const smooth = u ** 3 * (u * (u * 6 - 15) + 10);
      stepAt(start.clone().add(new Vector3(0, smooth * 1.6, 0)));
    }
    const lifted = start.clone().add(new Vector3(0, 1.6, 0));
    for (let frame = 0; frame < 120; frame += 1) stepAt(lifted);

    expect(everReleased.size).toBeGreaterThanOrEqual(1);
    expect(everReleased.size).toBeLessThanOrEqual(
      BlobConfig.armor.cohesionLoadMaxChunkSize,
    );
    expect(releasedBelowCore.size).toBeGreaterThanOrEqual(
      Math.ceil(everReleased.size * 0.6),
    );
    expect([...everReleased].some((index) => roots.has(index))).toBe(false);
    expect(harness.animator.getDebugSnapshot().attachedCount).toBeGreaterThanOrEqual(
      BlobConfig.armor.cohesionLoadMinimumAttachedCount,
    );
    expectMainGraphConsistent(harness.animator.getDebugSnapshot());

    harness.dispose();
  });

  it("cede como líquido al arrastrar un blob y desprende un racimo al revolearlo", async () => {
    const runManeuver = async (abrupt: boolean) => {
      const harness = await createHarness();
      const armor = armorRecords(harness.physics);
      harness.physics.world.gravity = { x: 0, y: 0, z: 0 };
      advanceSimulation(
        harness,
        BlobConfig.armor.cohesionLoadInitialGraceSeconds + 0.2,
      );
      const initial = harness.animator.getDebugSnapshot();
      const heldIndex = layerIndices(initial, maximumLayer(initial))[0];
      const heldBody = armor[heldIndex].body;
      const grab = new PhysicsGrabController(
        harness.physics,
        new Raycast(harness.physics),
        { ...GravityGunConfig.hold, dropErrorTime: 5 },
      );
      const cameraDirection = vectorFromRapier(heldBody.translation())
        .sub(vectorFromRapier(harness.coreBody.translation()))
        .normalize();
      const swingAxis = cameraDirection
        .clone()
        .cross(new Vector3(0, 1, 0));
      if (swingAxis.lengthSq() <= 1e-6) swingAxis.set(0, 0, 1);
      swingAxis.normalize();
      const cameraQuaternion = new Quaternion();
      const cameraOrigin = vectorFromRapier(heldBody.translation()).addScaledVector(
        cameraDirection,
        -GravityGunConfig.hold.holdDistance,
      );
      grab.grab(heldBody, cameraQuaternion);
      const everReleased = new Set<number>();
      let releasedClusterObserved = false;
      let firstReleaseFrame: number | null = null;
      const frameCount = abrupt ? 120 : 180;

      for (let frame = 0; frame < frameCount; frame += 1) {
        const cameraPosition = cameraOrigin.clone();
        if (abrupt) {
          cameraPosition.addScaledVector(
            swingAxis,
            Math.floor(frame / 6) % 2 === 0 ? -0.8 : 0.8,
          );
        } else {
          const u = frame / Math.max(1, frameCount - 1);
          const smooth = u ** 3 * (u * (u * 6 - 15) + 10);
          cameraPosition.addScaledVector(cameraDirection, smooth * 4);
        }
        grab.update(
          1 / 60,
          cameraPosition,
          cameraDirection,
          cameraQuaternion,
        );
        harness.animator.updateFromMotor(animationFrame(1 / 60));
        harness.physics.step(1 / 60);
        const releasedNow = releasedArmorIndices(harness, armor);
        if (releasedNow.length > 0 && firstReleaseFrame === null) {
          firstReleaseFrame = frame;
        }
        for (const index of releasedNow) {
          everReleased.add(index);
        }
        if (releasedNow.length >= 2) {
          const snapshot = harness.animator.getDebugSnapshot();
          releasedClusterObserved ||=
            reachableWithin(
              releasedNow[0],
              snapshot.cohesionPairs,
              releasedNow,
            ).size === releasedNow.length;
        }
      }

      expect(grab.getHeldBody()).toBe(heldBody);
      const result = {
        everReleased,
        firstReleaseFrame,
        releasedClusterObserved,
        heldIndex,
        heldDistanceFromCore: vectorFromRapier(heldBody.translation()).distanceTo(
          vectorFromRapier(harness.coreBody.translation()),
        ),
        roots: new Set(initial.coreAnchoredIndices),
      };
      grab.release();
      harness.dispose();
      return result;
    };

    const smooth = await runManeuver(false);
    const abrupt = await runManeuver(true);

    expect(smooth.everReleased.has(smooth.heldIndex)).toBe(true);
    expect(smooth.everReleased.size).toBeLessThanOrEqual(3);
    expect(smooth.firstReleaseFrame).not.toBeNull();
    expect(smooth.firstReleaseFrame!).toBeGreaterThan(10);
    expect(smooth.heldDistanceFromCore).toBeGreaterThan(
      BlobConfig.armor.reassemblyAttractionRadius + 1,
    );
    expect(abrupt.everReleased.size).toBeGreaterThanOrEqual(2);
    expect(abrupt.releasedClusterObserved).toBe(true);
    expect(abrupt.firstReleaseFrame).not.toBeNull();
    expect(abrupt.firstReleaseFrame!).toBeLessThan(smooth.firstReleaseFrame!);
    expect(abrupt.everReleased.size).toBeLessThanOrEqual(
      BlobConfig.armor.cohesionLoadMaxChunkSize,
    );
    expect(
      [...abrupt.everReleased].some((index) => abrupt.roots.has(index)),
    ).toBe(false);
  });

  it("sacudir un fragmento desprendido no arranca blobs del cuerpo a distancia", async () => {
    const harness = await createHarness();
    const armor = armorRecords(harness.physics);
    harness.physics.world.gravity = { x: 0, y: 0, z: 0 };
    const initial = harness.animator.getDebugSnapshot();
    const targetIndex = layerIndices(initial, maximumLayer(initial))[0];
    const target = armor[targetIndex];

    target.metadata.damageable!.applyDamage(1);
    expect(
      advanceUntil(
        harness,
        () => currentMetadata(harness, target).kind === "dynamic",
        1,
      ),
    ).toBe(true);
    placeBody(target.body, new Vector3(8, 2, 0));
    const attachedBefore = harness.animator.getDebugSnapshot().attachedIndices;
    const grab = new PhysicsGrabController(
      harness.physics,
      new Raycast(harness.physics),
      { ...GravityGunConfig.hold, dropErrorTime: 5 },
    );
    const cameraDirection = new Vector3(1, 0, 0);
    const cameraQuaternion = new Quaternion();
    const cameraOrigin = vectorFromRapier(target.body.translation()).addScaledVector(
      cameraDirection,
      -GravityGunConfig.hold.holdDistance,
    );
    grab.grab(target.body, cameraQuaternion);

    for (let frame = 0; frame < 120; frame += 1) {
      const cameraPosition = cameraOrigin.clone();
      cameraPosition.z += Math.floor(frame / 6) % 2 === 0 ? -0.8 : 0.8;
      grab.update(
        1 / 60,
        cameraPosition,
        cameraDirection,
        cameraQuaternion,
      );
      harness.animator.updateFromMotor(animationFrame(1 / 60));
      harness.physics.step(1 / 60);
    }

    expect(grab.getHeldBody()).toBe(target.body);
    expect(harness.animator.getDebugSnapshot().attachedIndices).toEqual(
      attachedBefore,
    );
    expect(releasedArmorIndices(harness, armor)).toEqual([targetIndex]);

    grab.release();
    harness.dispose();
  });

  it("espera, rodea una pared como racimo y vuelve a integrarse al cuerpo", async () => {
    const route = deferredChunkRoute();
    const harness = await createHarness({
      navigation: route.navigation,
      navigationRequests: route.requests,
    });
    const armor = armorRecords(harness.physics);
    harness.physics.createStaticBox({
      id: "chunk-nav-floor",
      position: new Vector3(2, -0.25, 0),
      size: new Vector3(12, 0.5, 10),
    });
    harness.physics.createStaticBox({
      id: "chunk-nav-wall",
      position: new Vector3(2, 1.25, 0),
      size: new Vector3(0.5, 2.5, 2.6),
    });
    translateWholeBlob(harness, armor, new Vector3(0, 1.2, 0));
    harness.coreBody.setBodyType(
      RAPIER.RigidBodyType.KinematicPositionBased,
      true,
    );
    harness.physics.updateQueryPipeline();

    const initial = harness.animator.getDebugSnapshot();
    const indices = findBondedOuterPair(initial);
    const records = indices.map((index) => armor[index]);
    const internalDistance = bodyDistance(records[0].body, records[1].body);
    for (const record of records) {
      record.metadata.damageable!.applyDamage(1);
    }
    expect(
      advanceUntil(
        harness,
        () =>
          records.every(
            (record) => currentMetadata(harness, record).kind === "dynamic",
          ),
        0.6,
      ),
    ).toBe(true);

    const groundY = Math.max(
      ballRadius(records[0].collider),
      ballRadius(records[1].collider),
    ) + 0.03;
    placeBody(records[0].body, new Vector3(4, groundY, 0));
    placeBody(
      records[1].body,
      new Vector3(4, groundY, internalDistance),
    );
    for (const record of records) {
      record.body.setGravityScale(1, true);
    }
    // Un segundo impacto ya desprendido reinicia la espera del racimo entero.
    records[0].metadata.damageable!.applyDamage(1);
    const waitingCenter = recordsCenter(records);
    const waitingFrames = Math.floor(
      (BlobConfig.armor.reassemblyDelaySeconds - 0.12) * 60,
    );
    for (let frame = 0; frame < waitingFrames; frame += 1) {
      route.processOne();
      harness.animator.updateFromMotor(animationFrame(1 / 60));
      harness.physics.step(1 / 60);
    }
    expect(route.enqueued).toBe(0);
    expect(planarDistance(recordsCenter(records), waitingCenter)).toBeLessThan(
      0.12,
    );

    let maximumDetour = 0;
    let crossedWall = false;
    let remainedConnected = true;
    for (let frame = 0; frame < 720; frame += 1) {
      route.processOne();
      harness.animator.updateFromMotor(animationFrame(1 / 60));
      harness.physics.step(1 / 60);
      const snapshot = harness.animator.getDebugSnapshot();
      if (indices.every((index) => snapshot.attachedIndices.includes(index))) {
        break;
      }
      const center = recordsCenter(records);
      if (!crossedWall) maximumDetour = Math.max(maximumDetour, Math.abs(center.z));
      if (center.x < 1.5) crossedWall = true;
      remainedConnected &&= reachableWithin(
        indices[0],
        snapshot.cohesionPairs,
        indices,
      ).size === indices.length;
    }

    const restored = harness.animator.getDebugSnapshot();
    expect(route.enqueued).toBeGreaterThan(0);
    expect(crossedWall).toBe(true);
    expect(maximumDetour).toBeGreaterThan(1.45);
    expect(remainedConnected).toBe(true);
    expect(restored.attachedCount).toBe(BlobConfig.armor.count);
    expect(indices.every((index) => restored.attachedIndices.includes(index))).toBe(
      true,
    );
    expect(
      records.every((record) => currentMetadata(harness, record).kind === "npc"),
    ).toBe(true);
    expect(route.pending()).toBe(0);
    expectMainGraphConsistent(restored);

    harness.dispose();
  });

  it("no planifica ni se propulsa horizontalmente mientras está en el aire", async () => {
    const route = deferredChunkRoute();
    const harness = await createHarness({
      navigation: route.navigation,
      navigationRequests: route.requests,
    });
    const armor = armorRecords(harness.physics);
    const initial = harness.animator.getDebugSnapshot();
    const index = layerIndices(initial, maximumLayer(initial))[0];
    const record = armor[index];

    record.metadata.damageable!.applyDamage(1);
    expect(
      advanceUntil(
        harness,
        () => currentMetadata(harness, record).kind === "dynamic",
        0.6,
      ),
    ).toBe(true);
    placeBody(record.body, new Vector3(4, 6, 0));
    record.body.setGravityScale(1, true);
    record.metadata.damageable!.applyDamage(1);
    const start = vectorFromRapier(record.body.translation());

    for (let frame = 0; frame < 100; frame += 1) {
      route.processOne();
      harness.animator.updateFromMotor(animationFrame(1 / 60));
      harness.physics.step(1 / 60);
    }

    const end = vectorFromRapier(record.body.translation());
    expect(route.enqueued).toBe(0);
    expect(planarDistance(start, end)).toBeLessThan(0.08);
    expect(end.y).toBeLessThan(start.y - 4);
    expect(currentMetadata(harness, record).kind).toBe("dynamic");

    harness.dispose();
  });

  it("recalcula la ruta desde donde se suelta un racimo movido externamente", async () => {
    const route = deferredChunkRoute();
    const harness = await createHarness({
      navigation: route.navigation,
      navigationRequests: route.requests,
    });
    const armor = armorRecords(harness.physics);
    harness.physics.createStaticBox({
      id: "chunk-nav-carry-floor",
      position: new Vector3(0, -0.25, 0),
      size: new Vector3(14, 0.5, 10),
    });
    translateWholeBlob(harness, armor, new Vector3(0, 1.2, 0));
    harness.coreBody.setBodyType(
      RAPIER.RigidBodyType.KinematicPositionBased,
      true,
    );
    harness.physics.updateQueryPipeline();

    const initial = harness.animator.getDebugSnapshot();
    const index = layerIndices(initial, maximumLayer(initial))[0];
    const record = armor[index];
    record.metadata.damageable!.applyDamage(1);
    expect(
      advanceUntil(
        harness,
        () => currentMetadata(harness, record).kind === "dynamic",
        0.6,
      ),
    ).toBe(true);
    const groundY = ballRadius(record.collider) + 0.03;
    placeBody(record.body, new Vector3(4, groundY, 0));
    record.body.setGravityScale(1, true);
    record.metadata.damageable!.applyDamage(1);
    advanceSimulation(
      harness,
      BlobConfig.armor.reassemblyDelaySeconds + 0.1,
    );
    expect(route.pending()).toBe(1);
    expect(route.origins()[0].x).toBeCloseTo(4, 1);

    route.processOne();
    harness.physics.markHeld(record.body, true);
    placeBody(record.body, new Vector3(-4, groundY, 0));
    harness.physics.updateQueryPipeline();
    harness.animator.updateFromMotor(animationFrame(1 / 60));
    expect(route.pending()).toBe(0);

    harness.physics.markHeld(record.body, false);
    harness.animator.updateFromMotor(animationFrame(1 / 60));
    expect(route.enqueued).toBe(2);
    expect(route.origins()[1].x).toBeCloseTo(-4, 1);

    harness.dispose();
  });

  it("se despega lateralmente y vuelve a pedir ruta si queda trabado", async () => {
    const route = deferredChunkRoute({ direct: true });
    const harness = await createHarness({
      navigation: route.navigation,
      navigationRequests: route.requests,
    });
    const armor = armorRecords(harness.physics);
    harness.physics.createStaticBox({
      id: "chunk-nav-stuck-floor",
      position: new Vector3(2, -0.25, 0),
      size: new Vector3(12, 0.5, 12),
    });
    harness.physics.createStaticBox({
      id: "chunk-nav-stuck-wall",
      position: new Vector3(2, 1.25, 0),
      size: new Vector3(0.5, 2.5, 10),
    });
    translateWholeBlob(harness, armor, new Vector3(0, 1.2, 0));
    harness.coreBody.setBodyType(
      RAPIER.RigidBodyType.KinematicPositionBased,
      true,
    );
    harness.physics.updateQueryPipeline();

    const initial = harness.animator.getDebugSnapshot();
    const index = layerIndices(initial, maximumLayer(initial))[0];
    const record = armor[index];
    record.metadata.damageable!.applyDamage(1);
    expect(
      advanceUntil(
        harness,
        () => currentMetadata(harness, record).kind === "dynamic",
        0.6,
      ),
    ).toBe(true);
    placeBody(
      record.body,
      new Vector3(4, ballRadius(record.collider) + 0.03, 0),
    );
    record.body.setGravityScale(1, true);
    record.metadata.damageable!.applyDamage(1);
    advanceSimulation(
      harness,
      BlobConfig.armor.reassemblyDelaySeconds + 0.1,
    );

    let maximumLateralDisplacement = 0;
    for (let frame = 0; frame < 300; frame += 1) {
      route.processOne();
      harness.animator.updateFromMotor(animationFrame(1 / 60));
      harness.physics.step(1 / 60);
      maximumLateralDisplacement = Math.max(
        maximumLateralDisplacement,
        Math.abs(record.body.translation().z),
      );
    }

    expect(route.enqueued).toBeGreaterThan(1);
    expect(maximumLateralDisplacement).toBeGreaterThan(1);
    expect(record.body.translation().x).toBeGreaterThan(2.2);
    expect(currentMetadata(harness, record).kind).toBe("dynamic");

    harness.dispose();
  });

  it("cancela una ruta pendiente si el Blob se destruye", async () => {
    const route = deferredChunkRoute();
    const harness = await createHarness({
      navigation: route.navigation,
      navigationRequests: route.requests,
    });
    const armor = armorRecords(harness.physics);
    harness.physics.createStaticBox({
      id: "chunk-nav-dispose-floor",
      position: new Vector3(5, -0.25, 0),
      size: new Vector3(4, 0.5, 4),
    });
    harness.physics.updateQueryPipeline();
    const initial = harness.animator.getDebugSnapshot();
    const index = layerIndices(initial, maximumLayer(initial))[0];
    const record = armor[index];

    record.metadata.damageable!.applyDamage(1);
    expect(
      advanceUntil(
        harness,
        () => currentMetadata(harness, record).kind === "dynamic",
        0.6,
      ),
    ).toBe(true);
    placeBody(
      record.body,
      new Vector3(5, ballRadius(record.collider) + 0.03, 0),
    );
    record.body.setGravityScale(1, true);
    record.metadata.damageable!.applyDamage(1);
    advanceSimulation(
      harness,
      BlobConfig.armor.reassemblyDelaySeconds + 0.1,
    );
    expect(route.pending()).toBe(1);

    harness.animator.dispose();
    expect(route.pending()).toBe(0);
    route.processOne();
    expect(() => harness.physics.step(1 / 60)).not.toThrow();

    harness.disposeCore();
  });

  it("marchita y mata un mini-racimo que pasa demasiado tiempo separado", async () => {
    const route = deferredChunkRoute();
    const harness = await createHarness({
      navigation: route.navigation,
      navigationRequests: route.requests,
    });
    harness.physics.world.gravity = { x: 0, y: 0, z: 0 };
    harness.physics.createStaticBox({
      id: "chunk-lifetime-floor",
      position: new Vector3(8, -0.25, 0),
      size: new Vector3(5, 0.5, 5),
    });
    harness.physics.updateQueryPipeline();
    const armor = armorRecords(harness.physics);
    const initial = harness.animator.getDebugSnapshot();
    const indices = findBondedOuterPair(initial);
    const records = indices.map((index) => armor[index]);
    const internalDistance = bodyDistance(records[0].body, records[1].body);
    const survivingIndex = layerIndices(initial, maximumLayer(initial)).find(
      (index) => !indices.includes(index),
    )!;
    const targetMesh = blobMesh(harness, indices[0]);
    const secondMesh = blobMesh(harness, indices[1]);
    const survivingMesh = blobMesh(harness, survivingIndex);
    const targetMaterial = targetMesh.material;
    const survivingMaterial = survivingMesh.material;
    const baseScale = targetMesh.scale.x;
    const secondBaseScale = secondMesh.scale.x;
    const baseColor = targetMaterial.color.getHex();
    const baseRoughness = targetMaterial.roughness;
    const survivingColor = survivingMaterial.color.getHex();
    const survivingScale = survivingMesh.scale.x;
    const colliderRadii = records.map((record) => ballRadius(record.collider));
    const bodyCountBefore = harness.physics.getBodyCount();

    for (const record of records) record.metadata.damageable!.applyDamage(1);
    expect(
      advanceUntil(
        harness,
        () =>
          records.every(
            (record) => currentMetadata(harness, record).kind === "dynamic",
          ),
        0.7,
      ),
    ).toBe(true);
    const groundY = Math.max(...colliderRadii) + 0.03;
    placeBody(records[0].body, new Vector3(8, groundY, 0));
    placeBody(
      records[1].body,
      new Vector3(8, groundY, internalDistance),
    );
    harness.physics.updateQueryPipeline();

    const healthySeconds =
      BlobConfig.armor.detachedLifetimeSeconds -
      BlobConfig.armor.detachedWitherSeconds;
    advanceSimulation(harness, healthySeconds - 0.3, 1 / 20);
    expect(route.pending()).toBe(1);
    expect(targetMesh.scale.x).toBeCloseTo(baseScale, 5);
    expect(targetMaterial.color.getHex()).toBe(baseColor);

    advanceSimulation(harness, 0.7, 1 / 20);
    expect(targetMesh.scale.x).toBeLessThan(baseScale);
    expect(secondMesh.scale.x).toBeLessThan(secondBaseScale);
    expect(targetMaterial.color.getHex()).not.toBe(baseColor);
    expect(targetMaterial.roughness).toBeGreaterThan(baseRoughness);
    expect(ballRadius(records[0].collider)).toBeCloseTo(colliderRadii[0], 6);
    expect(survivingMesh.scale.x).toBeCloseTo(survivingScale, 6);
    expect(survivingMaterial.color.getHex()).toBe(survivingColor);
    expect(survivingMaterial.roughness).toBeCloseTo(baseRoughness, 6);

    advanceSimulation(
      harness,
      BlobConfig.armor.detachedWitherSeconds + 0.2,
      1 / 20,
    );
    const withered = harness.animator.getDebugSnapshot();
    expect(withered.totalCount).toBe(BlobConfig.armor.count - indices.length);
    expect(withered.attachedCount).toBe(
      BlobConfig.armor.count - indices.length,
    );
    expect(indices.every((index) => withered.layers[index] === -1)).toBe(true);
    expect(withered.layers[survivingIndex]).toBe(initial.layers[survivingIndex]);
    expect(
      withered.cohesionPairs.every(
        ([from, to]) => !indices.includes(from) && !indices.includes(to),
      ),
    ).toBe(true);
    expect(records.every((record) => !record.body.isValid())).toBe(true);
    expect(records.every((record) => !record.collider.isValid())).toBe(true);
    expect(
      records.every(
        (record) => harness.physics.getColliderMetadata(record.collider) === undefined,
      ),
    ).toBe(true);
    expect(targetMesh.parent).toBeNull();
    expect(secondMesh.parent).toBeNull();
    expect(harness.physics.getBodyCount()).toBe(
      bodyCountBefore - indices.length,
    );
    expect(route.pending()).toBe(0);
    expectMainGraphConsistent(withered);
    expect(records[0].metadata.damageable!.isAlive()).toBe(false);
    expect(() => records[0].metadata.damageable!.applyDamage(1)).not.toThrow();
    expect(() => harness.physics.step(1 / 60)).not.toThrow();

    harness.dispose();
  });

  it("revive por completo al reintegrarse y reinicia su tiempo de vida", async () => {
    const harness = await createHarness();
    harness.physics.world.gravity = { x: 0, y: 0, z: 0 };
    const armor = armorRecords(harness.physics);
    const initial = harness.animator.getDebugSnapshot();
    const outer = layerIndices(initial, maximumLayer(initial));
    const targetIndex = outer[0];
    const hostIndex = outer.find((index) => index !== targetIndex)!;
    const target = armor[targetIndex];
    const host = armor[hostIndex];
    const mesh = blobMesh(harness, targetIndex);
    const material = mesh.material;
    const baseScale = mesh.scale.x;
    const baseColor = material.color.getHex();
    const baseRoughness = material.roughness;
    const baseMetalness = material.metalness;

    target.metadata.damageable!.applyDamage(1);
    expect(
      advanceUntil(
        harness,
        () => currentMetadata(harness, target).kind === "dynamic",
        0.7,
      ),
    ).toBe(true);
    placeBody(target.body, new Vector3(8, 6, 0));
    advanceSimulation(
      harness,
      BlobConfig.armor.detachedLifetimeSeconds -
        BlobConfig.armor.detachedWitherSeconds * 0.5,
      1 / 20,
    );
    expect(mesh.scale.x).toBeLessThan(baseScale);

    stopBody(harness.coreBody);
    for (const record of armor) {
      if (record.body.isValid()) stopBody(record.body);
    }
    const outward = vectorFromRapier(host.body.translation())
      .sub(vectorFromRapier(harness.coreBody.translation()))
      .normalize();
    const capture = vectorFromRapier(host.body.translation()).addScaledVector(
      outward,
      ballRadius(host.collider) +
        ballRadius(target.collider) +
        BlobConfig.armor.reassemblyJoinPadding * 0.5,
    );
    placeBody(target.body, capture);
    harness.animator.updateFromMotor(animationFrame(1 / 60));

    expect(
      harness.animator.getDebugSnapshot().attachedIndices,
    ).toContain(targetIndex);
    expect(currentMetadata(harness, target).kind).toBe("npc");
    expect(mesh.scale.x).toBeCloseTo(baseScale, 6);
    expect(material.color.getHex()).toBe(baseColor);
    expect(material.roughness).toBeCloseTo(baseRoughness, 6);
    expect(material.metalness).toBeCloseTo(baseMetalness, 6);

    advanceSimulation(
      harness,
      BlobConfig.armor.detachedWitherSeconds * 0.75,
      1 / 20,
    );
    expect(target.body.isValid()).toBe(true);
    target.metadata.damageable!.applyDamage(1);
    expect(
      advanceUntil(
        harness,
        () => currentMetadata(harness, target).kind === "dynamic",
        0.7,
      ),
    ).toBe(true);
    placeBody(target.body, new Vector3(8, 6, 0));
    advanceSimulation(
      harness,
      BlobConfig.armor.detachedWitherSeconds * 0.75,
      1 / 20,
    );
    expect(target.body.isValid()).toBe(true);
    expect(mesh.scale.x).toBeCloseTo(baseScale, 6);

    harness.dispose();
  });

  it("redistribuye capas y cierra el hueco cada vez que pierde masa", async () => {
    const harness = await createHarness();
    const armor = armorRecords(harness.physics);
    harness.physics.world.gravity = { x: 0, y: 0, z: 0 };
    const initial = harness.animator.getDebugSnapshot();
    const core = vectorFromRapier(harness.coreBody.translation());
    const removed = layerIndices(initial, maximumLayer(initial))
      .map((index) => ({
        index,
        score: vectorFromRapier(armor[index].body.translation())
          .sub(core)
          .normalize()
          .x,
      }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, 5)
      .map(({ index }) => index);
    const intactOuter = layerIndices(initial, maximumLayer(initial));
    const intactHole = coverageHoleForIndices(harness, armor, intactOuter);

    for (const index of removed) {
      armor[index].metadata.damageable!.applyDamage(1);
    }
    expect(
      advanceUntil(
        harness,
        () =>
          removed.every(
            (index) => currentMetadata(harness, armor[index]).kind === "dynamic",
          ),
        1,
      ),
    ).toBe(true);
    for (let slot = 0; slot < removed.length; slot += 1) {
      placeBody(armor[removed[slot]].body, new Vector3(8 + slot, 5, 0));
    }

    const opened = harness.animator.getDebugSnapshot();
    expect(opened.attachedCount).toBe(BlobConfig.armor.count - removed.length);
    expect(attachedLayerHistogram(opened)).toEqual([6, 12, 13]);
    expect(
      opened.coreAnchoredIndices.every((index) => opened.layers[index] === 0),
    ).toBe(true);
    const openedOuter = layerIndices(opened, maximumLayer(opened)).filter(
      (index) => opened.attachedIndices.includes(index),
    );
    const openedHole = coverageHoleForIndices(harness, armor, openedOuter);
    const openedFocused = coverageGapAtCoreDirection(
      harness,
      armor,
      openedOuter,
      new Vector3(1, 0, 0),
    );
    const openedPairs = normalizedPairKeys(opened.cohesionPairs);
    expect(openedHole).toBeGreaterThan(intactHole + 0.15);

    advanceSimulation(harness, 2);
    const holeSamples: number[] = [];
    const focusedSamples: number[] = [];
    for (let sample = 0; sample < 10; sample += 1) {
      advanceSimulation(harness, 0.1);
      const snapshot = harness.animator.getDebugSnapshot();
      const outer = layerIndices(snapshot, maximumLayer(snapshot)).filter(
        (index) => snapshot.attachedIndices.includes(index),
      );
      holeSamples.push(coverageHoleForIndices(harness, armor, outer));
      focusedSamples.push(
        coverageGapAtCoreDirection(
          harness,
          armor,
          outer,
          new Vector3(1, 0, 0),
        ),
      );
    }

    const healed = harness.animator.getDebugSnapshot();
    expect(average(holeSamples)).toBeLessThan(openedHole - 0.15);
    expect(Math.max(...holeSamples)).toBeLessThan(openedHole - 0.1);
    expect(average(focusedSamples)).toBeLessThan(openedFocused * 0.8);
    expect(normalizedPairKeys(healed.cohesionPairs)).not.toEqual(openedPairs);
    expect(healed.attachedCount).toBe(BlobConfig.armor.count - removed.length);
    expect(attachedLayerHistogram(healed)).toEqual([6, 12, 13]);
    expectMainGraphConsistent(healed);

    harness.dispose();
  });

  it("mantiene el grafo gel persistente y conectado aunque no haya impactos", async () => {
    const harness = await createHarness();
    const armor = armorRecords(harness.physics);
    const initial = harness.animator.getDebugSnapshot();
    const initialPairs = normalizedPairKeys(initial.cohesionPairs);

    advanceSimulation(harness, 3);

    const settled = harness.animator.getDebugSnapshot();
    expect(normalizedPairKeys(settled.cohesionPairs)).toEqual(initialPairs);
    expect(settled.attachedCount).toBe(BlobConfig.armor.count);
    expect(settled.coreJointCount).toBe(BlobConfig.armor.coreAnchorCount);
    expectMainGraphConsistent(settled);
    for (const record of armorRecords(harness.physics)) {
      const position = record.body.translation();
      expect([position.x, position.y, position.z].every(Number.isFinite)).toBe(
        true,
      );
    }
    expect(shellShapeAspect(harness, armor)).toBeLessThan(1.35);
    expect(maximumCoreRadius(harness, armor)).toBeLessThanOrEqual(
      BlobConfig.armor.aggregateRadius + 0.05,
    );

    harness.dispose();
  });

  it("opone resistencia antes de cortar el último camino de un blob exterior", async () => {
    const harness = await createHarness();
    const armor = armorRecords(harness.physics);
    const initial = harness.animator.getDebugSnapshot();
    const targetIndex = layerIndices(initial, maximumLayer(initial))[0];
    const target = armor[targetIndex];
    const incidentPairs = initial.cohesionPairs.filter(
      ([from, to]) => from === targetIndex || to === targetIndex,
    );

    target.metadata.damageable!.applyDamage(1, new Vector3(1, 0, 0));
    const yielding = harness.animator.getDebugSnapshot();
    expect(yielding.attachedIndices).toContain(targetIndex);
    expect(yielding.attachedCount).toBe(BlobConfig.armor.count);
    expect(blobMesh(harness, targetIndex).visible).toBe(false);
    expect(yielding.coreJointCount).toBe(BlobConfig.armor.coreAnchorCount);
    expect(currentMetadata(harness, target).kind).toBe("npc");
    expect(target.metadata.damageable!.isAlive()).toBe(true);
    expectMainGraphConsistent(yielding);

    // Incluso un frame muy largo no saltea el solve físico de resistencia.
    harness.animator.updateFromMotor(
      animationFrame(BlobConfig.armor.detachResistanceSeconds * 2),
    );
    expect(
      incidentPairs.every(([from, to]) =>
        hasPair(harness.animator.getDebugSnapshot(), from, to),
      ),
    ).toBe(true);
    harness.physics.step(1 / 30);

    expect(
      advanceUntil(
        harness,
        () => currentMetadata(harness, target).kind === "dynamic",
        BlobConfig.armor.detachResistanceSeconds +
          BlobConfig.armor.cohesionShellFatigueSeconds +
          0.5,
      ),
    ).toBe(true);
    const released = harness.animator.getDebugSnapshot();
    expect(released.attachedIndices).not.toContain(targetIndex);
    expect(released.attachedCount).toBe(BlobConfig.armor.count - 1);
    const releasedMesh = blobMesh(harness, targetIndex);
    const surface = harness.scene.getObjectByName(
      `${harness.id}-gel-surface`,
    );
    expect(releasedMesh.visible).toBe(true);
    expect(surface).toBeInstanceOf(Mesh);
    if (!(surface instanceof Mesh)) {
      throw new Error("Superficie continua del blob no encontrada");
    }
    expect(releasedMesh.material.color.getHex()).toBe(
      (surface.material as MeshPhysicalMaterial).color.getHex(),
    );
    expect(releasedMesh.material.opacity).toBeCloseTo(
      (surface.material as MeshPhysicalMaterial).opacity,
      6,
    );
    expect(releasedMesh.scale.x).toBeCloseTo(
      ballRadius(target.collider) * BlobConfig.visual.surfaceNodeRadiusScale,
      6,
    );
    expect(
      released.cohesionPairs.some(
        ([from, to]) => from === targetIndex || to === targetIndex,
      ),
    ).toBe(false);
    expect(currentMetadata(harness, target)).toMatchObject({
      id: `${harness.id}-chunk-${targetIndex}`,
      impactOwnerId: harness.id,
      kind: "dynamic",
    });
    expect(target.body.gravityScale()).toBeCloseTo(1, 6);
    expect(target.metadata.damageable!.isAlive()).toBe(true);
    expectMainGraphConsistent(released);

    harness.dispose();
  });

  it("desprende dos vecinos como mini-blob y permite romperlos otra vez", async () => {
    const harness = await createHarness();
    const armor = armorRecords(harness.physics);
    const initial = harness.animator.getDebugSnapshot();
    const [firstIndex, secondIndex] = findBondedOuterPair(initial);
    const first = armor[firstIndex];
    const second = armor[secondIndex];

    first.metadata.damageable!.applyDamage(1);
    second.metadata.damageable!.applyDamage(1);
    expect(
      advanceUntil(
        harness,
        () =>
          currentMetadata(harness, first).kind === "dynamic" &&
          currentMetadata(harness, second).kind === "dynamic",
        1,
      ),
    ).toBe(true);

    const cluster = harness.animator.getDebugSnapshot();
    expect(cluster.attachedIndices).not.toContain(firstIndex);
    expect(cluster.attachedIndices).not.toContain(secondIndex);
    expect(hasPair(cluster, firstIndex, secondIndex)).toBe(true);
    expectMainGraphConsistent(cluster);

    const away = vectorFromRapier(first.body.translation())
      .sub(vectorFromRapier(second.body.translation()))
      .normalize();
    first.body.applyImpulse(
      away.clone().multiplyScalar(WeaponDefinitions.revolver.impulse),
      true,
    );
    first.metadata.damageable!.applyDamage(
      WeaponDefinitions.revolver.damage,
      away,
    );
    expect(
      advanceUntil(
        harness,
        () =>
          !hasPair(
            harness.animator.getDebugSnapshot(),
            firstIndex,
            secondIndex,
          ),
        0.25,
      ),
    ).toBe(true);
    expect(
      reachableWithin(
        firstIndex,
        harness.animator.getDebugSnapshot().cohesionPairs,
        [firstIndex, secondIndex],
      ),
    ).toEqual(new Set([firstIndex]));
    expect(currentMetadata(harness, first).kind).toBe("dynamic");
    expect(currentMetadata(harness, second).kind).toBe("dynamic");

    harness.dispose();
  });

  it("funde por contacto fragmentos del mismo blob sin adelantar su union fisica", async () => {
    const harness = await createHarness();
    harness.physics.world.gravity = { x: 0, y: 0, z: 0 };
    const armor = armorRecords(harness.physics);
    const initial = harness.animator.getDebugSnapshot();
    const [firstIndex, secondIndex] = findNonBondedOuterPair(initial);
    const first = armor[firstIndex];
    const second = armor[secondIndex];
    const firstMesh = blobMesh(harness, firstIndex);
    const secondMesh = blobMesh(harness, secondIndex);

    first.metadata.damageable!.applyDamage(1);
    second.metadata.damageable!.applyDamage(1);
    expect(
      advanceUntil(
        harness,
        () =>
          currentMetadata(harness, first).kind === "dynamic" &&
          currentMetadata(harness, second).kind === "dynamic",
        1,
      ),
    ).toBe(true);

    const visualContactDistance =
      firstMesh.scale.x +
      secondMesh.scale.x +
      BlobConfig.visual.surfaceContactPadding * 0.5;
    placeBody(first.body, new Vector3(8, 6, 0));
    placeBody(second.body, new Vector3(8 + visualContactDistance, 6, 0));
    harness.animator.updateFromMotor(animationFrame(0, true));

    expect(
      hasPair(harness.animator.getDebugSnapshot(), firstIndex, secondIndex),
    ).toBe(false);
    const fragmentSurface = harness.scene.getObjectByName(
      `${harness.id}-gel-fragment-0`,
    );
    expect(fragmentSurface).toBeInstanceOf(Mesh);
    expect(fragmentSurface?.visible).toBe(true);
    expect(firstMesh.visible).toBe(false);
    expect(secondMesh.visible).toBe(false);

    placeBody(
      second.body,
      new Vector3(
        8 +
          firstMesh.scale.x +
          secondMesh.scale.x +
          BlobConfig.visual.surfaceContactPadding +
          0.1,
        6,
        0,
      ),
    );
    harness.animator.updateFromMotor(animationFrame(0, true));

    expect(fragmentSurface?.visible).toBe(false);
    expect(firstMesh.visible).toBe(true);
    expect(secondMesh.visible).toBe(true);

    harness.dispose();
  });

  it("conserva resultados dinámicos: un golpe suave puede sacar uno y una pistola un racimo", async () => {
    const gentle = await createHarness();
    const gentleArmor = armorRecords(gentle.physics);
    const gentleSnapshot = gentle.animator.getDebugSnapshot();
    const targetIndex = layerIndices(
      gentleSnapshot,
      maximumLayer(gentleSnapshot),
    )[0];
    gentleArmor[targetIndex].metadata.damageable!.applyDamage(1);
    expect(
      advanceUntil(
        gentle,
        () => currentMetadata(gentle, gentleArmor[targetIndex]).kind === "dynamic",
        1,
      ),
    ).toBe(true);
    expect(releasedArmorIndices(gentle, gentleArmor)).toEqual([targetIndex]);
    gentle.dispose();

    const strong = await createHarness();
    const strongArmor = armorRecords(strong.physics);
    const strongSnapshot = strong.animator.getDebugSnapshot();
    const strongIndex = layerIndices(
      strongSnapshot,
      maximumLayer(strongSnapshot),
    )[0];
    const strongTarget = strongArmor[strongIndex];
    const inward = vectorFromRapier(strong.coreBody.translation())
      .sub(vectorFromRapier(strongTarget.body.translation()))
      .normalize();
    strongTarget.body.applyImpulse(
      inward.clone().multiplyScalar(WeaponDefinitions.pistol.impulse),
      true,
    );
    strongTarget.metadata.damageable!.applyDamage(
      WeaponDefinitions.pistol.damage,
      inward,
    );
    advanceSimulation(strong, 0.8);

    const released = releasedArmorIndices(strong, strongArmor);
    const result = strong.animator.getDebugSnapshot();
    expect(released).toContain(strongIndex);
    expect(released.length).toBeGreaterThan(1);
    expect(reachableWithin(released[0], result.cohesionPairs, released)).toEqual(
      new Set(released),
    );
    expectMainGraphConsistent(result);
    strong.dispose();
  });

  it("atrae tres fragmentos externos y forma un único mini-racimo después del cooldown", async () => {
    const harness = await createHarness();
    const armor = armorRecords(harness.physics);
    const initial = harness.animator.getDebugSnapshot();
    const indices = findMutuallyNonBondedOuterIndices(initial, 3);
    const records = indices.map((index) => armor[index]);

    for (const record of records) {
      record.metadata.damageable!.applyDamage(1);
    }
    expect(
      advanceUntil(
        harness,
        () =>
          records.every(
            (record) => currentMetadata(harness, record).kind === "dynamic",
          ),
        1,
      ),
    ).toBe(true);
    for (const [offset, record] of records.entries()) {
      placeBody(record.body, new Vector3(8 + offset * 0.92, 6, 0));
    }
    const initialDistance = bodyDistance(records[0].body, records[1].body);

    advanceSimulation(harness, BlobConfig.armor.reassemblyDelaySeconds * 0.6);
    expect(
      reachableWithin(
        indices[0],
        harness.animator.getDebugSnapshot().cohesionPairs,
        indices,
      ),
    ).toEqual(new Set([indices[0]]));
    expect(bodyDistance(records[0].body, records[1].body)).toBeCloseTo(
      initialDistance,
      3,
    );

    expect(
      advanceUntil(
        harness,
        () =>
          reachableWithin(
            indices[0],
            harness.animator.getDebugSnapshot().cohesionPairs,
            indices,
          ).size === indices.length,
        2.5,
      ),
    ).toBe(true);
    expect(bodyDistance(records[0].body, records[1].body)).toBeLessThan(
      initialDistance,
    );
    expect(harness.animator.getDebugSnapshot().attachedCount).toBe(
      BlobConfig.armor.count - indices.length,
    );

    harness.dispose();
  });

  it("no une fragmentos a través de paredes", async () => {
    const harness = await createHarness();
    const armor = armorRecords(harness.physics);
    const initial = harness.animator.getDebugSnapshot();
    const [firstIndex, secondIndex] = findNonBondedOuterPair(initial);
    const first = armor[firstIndex];
    const second = armor[secondIndex];

    first.metadata.damageable!.applyDamage(1);
    second.metadata.damageable!.applyDamage(1);
    expect(
      advanceUntil(
        harness,
        () =>
          currentMetadata(harness, first).kind === "dynamic" &&
          currentMetadata(harness, second).kind === "dynamic",
        1,
      ),
    ).toBe(true);
    placeBody(first.body, new Vector3(8, 6, 0));
    placeBody(second.body, new Vector3(9.1, 6, 0));
    const initialFirstX = first.body.translation().x;
    const initialSecondX = second.body.translation().x;
    harness.physics.createStaticBox({
      id: "reassembly-wall",
      position: new Vector3(8.55, -40, 0),
      size: new Vector3(0.12, 100, 20),
    });
    harness.physics.updateQueryPipeline();

    advanceSimulation(
      harness,
      BlobConfig.armor.reassemblyDelaySeconds + 1.5,
    );
    expect(
      hasPair(
        harness.animator.getDebugSnapshot(),
        firstIndex,
        secondIndex,
      ),
    ).toBe(false);
    expect(first.body.translation().x).toBeCloseTo(initialFirstX, 3);
    expect(second.body.translation().x).toBeCloseTo(initialSecondX, 3);

    harness.dispose();
  });

  it("reintegra un mini-racimo completo al tocar cualquier blob exterior del cuerpo", async () => {
    const harness = await createHarness();
    const armor = armorRecords(harness.physics);
    const initial = harness.animator.getDebugSnapshot();
    const [firstIndex, secondIndex] = findBondedOuterPair(initial);
    const first = armor[firstIndex];
    const second = armor[secondIndex];
    const rootsBefore = [...initial.coreAnchoredIndices];

    first.metadata.damageable!.applyDamage(1);
    second.metadata.damageable!.applyDamage(1);
    expect(
      advanceUntil(
        harness,
        () =>
          currentMetadata(harness, first).kind === "dynamic" &&
          currentMetadata(harness, second).kind === "dynamic",
        1,
      ),
    ).toBe(true);
    const internalDistance = bodyDistance(first.body, second.body);
    placeBody(first.body, new Vector3(8, 6, 0));
    placeBody(second.body, new Vector3(8 + internalDistance, 6, 0));
    advanceSimulation(
      harness,
      BlobConfig.armor.reassemblyDelaySeconds + 0.1,
    );
    expect(
      hasPair(
        harness.animator.getDebugSnapshot(),
        firstIndex,
        secondIndex,
      ),
    ).toBe(true);

    stopBody(harness.coreBody);
    for (const record of armor) stopBody(record.body);
    const beforeDock = harness.animator.getDebugSnapshot();
    const hostIndex = layerIndices(beforeDock, maximumLayer(beforeDock)).find(
      (index) => index !== firstIndex && index !== secondIndex,
    )!;
    const host = armor[hostIndex];
    const outward = vectorFromRapier(host.body.translation())
      .sub(vectorFromRapier(harness.coreBody.translation()))
      .normalize();
    const capture = vectorFromRapier(host.body.translation()).addScaledVector(
      outward,
      ballRadius(host.collider) +
        ballRadius(first.collider) +
        BlobConfig.armor.reassemblyJoinPadding * 0.5,
    );
    placeBody(first.body, capture);
    placeBody(
      second.body,
      capture.clone().addScaledVector(outward, internalDistance),
    );
    const mainBefore = new Set(beforeDock.attachedIndices);

    harness.animator.updateFromMotor(animationFrame(1 / 60));
    const restored = harness.animator.getDebugSnapshot();
    expect(restored.attachedCount).toBe(BlobConfig.armor.count);
    expect(restored.attachedIndices).toContain(firstIndex);
    expect(restored.attachedIndices).toContain(secondIndex);
    expect(restored.coreAnchoredIndices).toEqual(rootsBefore);
    expect(hasPair(restored, firstIndex, secondIndex)).toBe(true);
    expect(
      restored.cohesionPairs.some(
        ([from, to]) =>
          ([firstIndex, secondIndex].includes(from) && mainBefore.has(to)) ||
          ([firstIndex, secondIndex].includes(to) && mainBefore.has(from)),
      ),
    ).toBe(true);
    expect(currentMetadata(harness, first).kind).toBe("npc");
    expect(currentMetadata(harness, second).kind).toBe("npc");
    expect(blobMesh(harness, firstIndex).visible).toBe(false);
    expect(blobMesh(harness, secondIndex).visible).toBe(false);
    expectMainGraphConsistent(restored);

    harness.dispose();
  });

  it("pliega una fila de cinco fragmentos hasta formar un mini-racimo compacto", async () => {
    const harness = await createHarness();
    const armor = armorRecords(harness.physics);
    const indices = findMutuallyNonBondedOuterIndices(
      harness.animator.getDebugSnapshot(),
      5,
    );
    const records = indices.map((index) => armor[index]);

    for (const record of records) {
      record.metadata.damageable!.applyDamage(1);
    }
    expect(
      advanceUntil(
        harness,
        () =>
          records.every(
            (record) => currentMetadata(harness, record).kind === "dynamic",
          ),
        1,
      ),
    ).toBe(true);
    placeRecordsInLine(records, new Vector3(8, 6, 0), new Vector3(1, 0, 0));
    const line = clusterShapeMetrics(records);

    expect(
      advanceUntil(
        harness,
        () =>
          reachableWithin(
            indices[0],
            harness.animator.getDebugSnapshot().cohesionPairs,
            indices,
          ).size === indices.length,
        BlobConfig.armor.reassemblyDelaySeconds + 1.5,
      ),
    ).toBe(true);
    advanceSimulation(harness, 3);

    const compact = clusterShapeMetrics(records);
    expect(compact.normalizedDiameter).toBeLessThan(2.6);
    expect(compact.normalizedDiameter).toBeLessThan(
      line.normalizedDiameter * 0.72,
    );
    expect(compact.axisAspect).toBeLessThan(1.8);
    expect(compact.normalizedRadialDeviation).toBeLessThan(0.5);
    expect(
      reachableWithin(
        indices[0],
        harness.animator.getDebugSnapshot().cohesionPairs,
        indices,
      ),
    ).toEqual(new Set(indices));

    harness.dispose();
  });

  it("dobla una cola reintegrada y vuelve a cubrir el cerebro con una masa uniforme", async () => {
    const harness = await createHarness();
    const armor = armorRecords(harness.physics);
    const initial = harness.animator.getDebugSnapshot();
    const intactCoverageHole = sphericalCoverageHole(harness, armor);
    const indices = findMutuallyNonBondedOuterIndices(initial, 5);
    const records = indices.map((index) => armor[index]);

    for (const record of records) {
      record.metadata.damageable!.applyDamage(1);
    }
    expect(
      advanceUntil(
        harness,
        () =>
          records.every(
            (record) => currentMetadata(harness, record).kind === "dynamic",
          ),
        1,
      ),
    ).toBe(true);
    placeRecordsInLine(records, new Vector3(8, 6, 0), new Vector3(1, 0, 0));
    expect(
      advanceUntil(
        harness,
        () =>
          reachableWithin(
            indices[0],
            harness.animator.getDebugSnapshot().cohesionPairs,
            indices,
          ).size === indices.length,
        BlobConfig.armor.reassemblyDelaySeconds + 1.5,
      ),
    ).toBe(true);

    stopBody(harness.coreBody);
    for (const record of armor) stopBody(record.body);
    const hostIndex = layerIndices(initial, maximumLayer(initial)).find(
      (index) => !indices.includes(index),
    )!;
    const host = armor[hostIndex];
    const outward = vectorFromRapier(host.body.translation())
      .sub(vectorFromRapier(harness.coreBody.translation()))
      .normalize();
    const start = vectorFromRapier(host.body.translation()).addScaledVector(
      outward,
      ballRadius(host.collider) +
        ballRadius(records[0].collider) +
        BlobConfig.armor.reassemblyJoinPadding * 0.5,
    );
    placeRecordsInLine(records, start, outward);

    harness.animator.updateFromMotor(animationFrame(1 / 60));
    const docked = harness.animator.getDebugSnapshot();
    expect(docked.attachedCount).toBe(BlobConfig.armor.count);
    expect(attachedLayerHistogram(docked)).toEqual([
      ...BlobConfig.armor.layerCounts,
    ]);
    const tailMaximumRadius = maximumCoreRadius(harness, records);
    const tailAspect = shellShapeAspect(harness, armor);
    const tailCoverageHole = sphericalCoverageHole(harness, armor);
    const tailOuterCoverageHole = coverageHoleForIndices(
      harness,
      armor,
      layerIndices(docked, maximumLayer(docked)),
    );

    advanceSimulation(harness, 3.5);

    const uniformMaximumRadius = maximumCoreRadius(harness, records);
    const uniformAspect = shellShapeAspect(harness, armor);
    const uniformCoverageHole = sphericalCoverageHole(harness, armor);
    const uniformSnapshot = harness.animator.getDebugSnapshot();
    const uniformOuterCoverageHole = coverageHoleForIndices(
      harness,
      armor,
      layerIndices(uniformSnapshot, maximumLayer(uniformSnapshot)),
    );
    expect(uniformMaximumRadius).toBeLessThan(tailMaximumRadius * 0.8);
    expect(uniformMaximumRadius).toBeLessThanOrEqual(
      BlobConfig.armor.aggregateRadius + 0.1,
    );
    expect(uniformAspect).toBeLessThan(1.5);
    expect(uniformAspect).toBeLessThan(tailAspect * 0.8);
    expect(uniformCoverageHole).toBeLessThan(tailCoverageHole);
    expect(uniformOuterCoverageHole).toBeLessThan(tailOuterCoverageHole);
    expect(uniformCoverageHole).toBeLessThanOrEqual(
      intactCoverageHole + 0.08,
    );
    expectMainGraphConsistent(uniformSnapshot);

    harness.dispose();
  });

  it("recupera todos los roots internos de un mini-racimo al volver a la cubierta", async () => {
    const harness = await createHarness();
    const armor = armorRecords(harness.physics);
    const initial = harness.animator.getDebugSnapshot();
    const [firstIndex, secondIndex] = findBondedRootPair(initial);
    const first = armor[firstIndex];
    const second = armor[secondIndex];
    const anchors = new Map(
      initial.coreAnchoredIndices.map((index, slot) => [
        index,
        initial.anchors[slot].clone(),
      ]),
    );

    first.metadata.damageable!.applyDamage(1);
    second.metadata.damageable!.applyDamage(1);
    expect(
      advanceUntil(
        harness,
        () =>
          currentMetadata(harness, first).kind === "dynamic" &&
          currentMetadata(harness, second).kind === "dynamic",
        1,
      ),
    ).toBe(true);
    const internalDistance = bodyDistance(first.body, second.body);
    placeBody(first.body, new Vector3(8, 6, 0));
    placeBody(second.body, new Vector3(8 + internalDistance, 6, 0));
    advanceSimulation(
      harness,
      BlobConfig.armor.reassemblyDelaySeconds + 0.1,
    );

    stopBody(harness.coreBody);
    for (const record of armor) stopBody(record.body);
    placeBody(
      first.body,
      vectorFromRapier(harness.coreBody.translation()).add(
        anchors.get(firstIndex)!,
      ),
    );
    placeBody(
      second.body,
      vectorFromRapier(harness.coreBody.translation()).add(
        anchors.get(secondIndex)!,
      ),
    );
    harness.animator.updateFromMotor(animationFrame(1 / 60));

    const restored = harness.animator.getDebugSnapshot();
    expect(restored.attachedCount).toBe(BlobConfig.armor.count);
    expect(restored.coreJointCount).toBe(BlobConfig.armor.coreAnchorCount);
    expect(restored.coreAnchoredIndices).toContain(firstIndex);
    expect(restored.coreAnchoredIndices).toContain(secondIndex);
    expect(currentMetadata(harness, first).kind).toBe("npc");
    expect(currentMetadata(harness, second).kind).toBe("npc");
    expectMainGraphConsistent(restored);

    harness.dispose();
  });

  it("permite reintegrar lateralmente una pieza sostenida por la Gravity Gun", async () => {
    const harness = await createHarness();
    const armor = armorRecords(harness.physics);
    const initial = harness.animator.getDebugSnapshot();
    const outer = layerIndices(initial, maximumLayer(initial));
    const targetIndex = outer[0];
    const hostIndex = outer.find((index) => index !== targetIndex)!;
    const target = armor[targetIndex];
    const host = armor[hostIndex];
    const rootsBefore = [...initial.coreAnchoredIndices];

    target.metadata.damageable!.applyDamage(1);
    expect(
      advanceUntil(
        harness,
        () => currentMetadata(harness, target).kind === "dynamic",
        1,
      ),
    ).toBe(true);
    placeBody(target.body, new Vector3(8, 6, 0));
    advanceSimulation(
      harness,
      BlobConfig.armor.reassemblyDelaySeconds + 0.1,
    );

    stopBody(harness.coreBody);
    for (const record of armor) stopBody(record.body);
    const outward = vectorFromRapier(host.body.translation())
      .sub(vectorFromRapier(harness.coreBody.translation()))
      .normalize();
    const initialCapture = vectorFromRapier(host.body.translation()).addScaledVector(
      outward,
      ballRadius(host.collider) +
        ballRadius(target.collider) +
        BlobConfig.armor.reassemblyJoinPadding * 0.5,
    );
    placeBody(
      target.body,
      initialCapture.clone().addScaledVector(outward, 0.35),
    );

    const grab = new PhysicsGrabController(
      harness.physics,
      new Raycast(harness.physics),
      GravityGunConfig.hold,
    );
    const cameraQuaternion = new Quaternion();
    const cameraDirection = outward.clone();
    const cameraPosition = new Vector3();
    grab.grab(target.body, cameraQuaternion);

    for (
      let frame = 0;
      frame < 120 &&
      !harness.animator
        .getDebugSnapshot()
        .attachedIndices.includes(targetIndex);
      frame += 1
    ) {
      cameraDirection
        .copy(vectorFromRapier(host.body.translation()))
        .sub(vectorFromRapier(harness.coreBody.translation()))
        .normalize();
      const capture = vectorFromRapier(host.body.translation()).addScaledVector(
        cameraDirection,
        ballRadius(host.collider) +
          ballRadius(target.collider) +
          BlobConfig.armor.reassemblyJoinPadding * 0.5,
      );
      cameraPosition
        .copy(capture)
        .addScaledVector(
          cameraDirection,
          -GravityGunConfig.hold.holdDistance,
        );
      grab.update(
        1 / 60,
        cameraPosition,
        cameraDirection,
        cameraQuaternion,
      );
      harness.animator.updateFromMotor(animationFrame(1 / 60));
      harness.physics.step(1 / 60);
    }

    const restored = harness.animator.getDebugSnapshot();
    expect(restored.attachedIndices).toContain(targetIndex);
    expect(restored.attachedCount).toBe(BlobConfig.armor.count);
    expect(restored.coreAnchoredIndices).toEqual(rootsBefore);
    expect(restored.coreAnchoredIndices).not.toContain(targetIndex);
    expect(grab.getHeldBody()).toBe(target.body);
    expect(harness.physics.isHeldBody(target.body.handle)).toBe(true);
    expect(currentMetadata(harness, target).kind).toBe("npc");
    expectMainGraphConsistent(restored);

    grab.release(new Vector3());
    harness.animator.updateFromMotor(animationFrame(1 / 60));
    expect(target.body.gravityScale()).toBeCloseTo(
      BlobConfig.armor.attachedGravityScale,
      6,
    );
    harness.dispose();
  });

  it("hace reflow sólo de los roots internos y conserva conectado el cuerpo", async () => {
    const harness = await createHarness();
    const armor = armorRecords(harness.physics);
    const initial = harness.animator.getDebugSnapshot();
    const outerIndex = layerIndices(initial, maximumLayer(initial))[0];
    armor[outerIndex].metadata.damageable!.applyDamage(1);

    harness.animator.updateFromMotor(
      animationFrame(BlobConfig.armor.reflowDelay - 0.01),
    );
    expectAnchorsClose(harness.animator.getDebugSnapshot(), initial);
    harness.animator.updateFromMotor(animationFrame(0.01));
    expectAnchorsClose(harness.animator.getDebugSnapshot(), initial);

    harness.animator.updateFromMotor(
      animationFrame(BlobConfig.armor.reflowDuration * 0.5),
    );
    const halfway = harness.animator.getDebugSnapshot();
    harness.animator.updateFromMotor(
      animationFrame(BlobConfig.armor.reflowDuration * 0.5),
    );
    const completed = harness.animator.getDebugSnapshot();

    expect(completed.coreAnchoredIndices).toEqual(initial.coreAnchoredIndices);
    expect(
      completed.coreAnchoredIndices.every(
        (index) => completed.layers[index] === 0,
      ),
    ).toBe(true);
    const moved = completed.anchors
      .map((anchor, index) => ({
        index,
        distance: anchor.distanceTo(initial.anchors[index]),
      }))
      .filter(({ distance }) => distance > 1e-5);
    expect(moved.length).toBeGreaterThan(0);
    for (const { index } of moved) {
      const expected = initial.anchors[index]
        .clone()
        .lerp(completed.anchors[index], 0.5);
      expect(halfway.anchors[index].distanceTo(expected)).toBeLessThan(1e-5);
    }
    expectMainGraphConsistent(completed);

    harness.dispose();
  });

  it("marchita con fuerza la biomasa muerta y apaga especialmente el core", async () => {
    const harness = await createHarness();
    harness.physics.world.gravity = { x: 0, y: 0, z: 0 };
    const core = blobCoreMesh(harness);
    const shell = blobMesh(harness, 0);
    const coreScale = core.scale.x;
    const shellScale = shell.scale.x;

    harness.animator.notifyDeath();
    const duration = Math.max(
      BlobConfig.armor.deathWitherSeconds,
      BlobConfig.visual.coreDeathWitherSeconds,
    ) + BlobConfig.visual.deathSurfaceUpdateInterval;
    const steps = Math.ceil(duration * 20);
    for (let step = 0; step < steps; step += 1) {
      harness.animator.updateStandalone(1 / 20, { dead: true });
    }
    const surface = harness.scene.getObjectByName(
      `${harness.id}-gel-fragment-0`,
    );
    expect(surface).toBeInstanceOf(Mesh);
    if (
      !(surface instanceof Mesh) ||
      !(surface.material instanceof MeshPhysicalMaterial)
    ) {
      throw new Error("Superficie continua del cadaver no encontrada");
    }

    expect(shell.scale.x).toBeCloseTo(
      shellScale * BlobConfig.armor.deathWitherMinimumScale,
      5,
    );
    expect(shell.material.color.getHex()).toBe(
      BlobConfig.armor.deathWitherColor,
    );
    expect(shell.material.roughness).toBeCloseTo(
      BlobConfig.armor.deathWitherRoughness,
      5,
    );
    expect(surface.material.color.getHex()).toBe(
      BlobConfig.armor.deathWitherColor,
    );
    expect(surface.material.opacity).toBeCloseTo(
      BlobConfig.visual.deathSurfaceOpacity,
      5,
    );
    expect(core.scale.x).toBeCloseTo(
      coreScale * BlobConfig.visual.coreDeathMinimumScale,
      5,
    );
    expect(core.material.color.getHex()).toBe(
      BlobConfig.visual.coreDeathColor,
    );
    expect(core.material.emissive.getHex()).toBe(
      BlobConfig.visual.coreDeathEmissiveColor,
    );
    expect(core.material.emissiveIntensity).toBeCloseTo(
      BlobConfig.visual.coreDeathEmissiveIntensity,
      5,
    );
    expect(core.material.roughness).toBeCloseTo(
      BlobConfig.visual.coreDeathRoughness,
      5,
    );

    harness.dispose();
  });

  it("la muerte conserva islas uniformes por cercania y libera toda la red", async () => {
    const harness = await createHarness();
    const armor = armorRecords(harness.physics);
    const shellBodies = armor.map((record) => record.body);
    const shellColliders = armor.map((record) => record.collider);
    const grab = new PhysicsGrabController(
      harness.physics,
      new Raycast(harness.physics),
      GravityGunConfig.hold,
    );
    grab.grab(shellBodies[0], new Quaternion());
    expect(harness.physics.isHeldBody(shellBodies[0].handle)).toBe(true);

    harness.animator.notifyDeath();
    grab.release();
    expect(
      harness.scene.getObjectByName(`${harness.id}-gel-surface`)?.visible,
    ).toBe(false);
    expect(
      harness.scene.getObjectByName(`${harness.id}-gel-fragment-0`)?.visible,
    ).toBe(true);
    expect(blobMesh(harness, 0).visible).toBe(false);
    expect(harness.animator.getDebugSnapshot()).toMatchObject({
      attachedCount: 0,
      coreJointCount: 0,
      cohesionBondCount: 0,
    });
    expect(harness.physics.world.impulseJoints.len()).toBe(0);
    expect(harness.coreBody.gravityScale()).toBeCloseTo(1, 6);
    expect(shellBodies[0].gravityScale()).toBeCloseTo(1, 6);
    expect(harness.physics.isHeldBody(shellBodies[0].handle)).toBe(false);
    expect(harness.physics.getBodyCount()).toBe(BlobConfig.armor.count + 1);
    expect(
      shellColliders.every(
        (collider) => harness.physics.getColliderMetadata(collider)?.kind === "dynamic",
      ),
    ).toBe(true);

    const firstMesh = blobMesh(harness, 0);
    const secondMesh = blobMesh(harness, 1);
    const visualContactDistance =
      firstMesh.scale.x +
      secondMesh.scale.x +
      BlobConfig.visual.surfaceContactPadding * 0.5;
    placeBody(shellBodies[0], new Vector3(8, 6, 0));
    placeBody(
      shellBodies[1],
      new Vector3(8 + visualContactDistance, 6, 0),
    );
    harness.animator.updateStandalone(1 / 20, { dead: true });
    harness.animator.updateStandalone(1 / 20, { dead: true });
    const fragmentSurface = harness.scene.getObjectByName(
      `${harness.id}-gel-fragment-0`,
    );
    expect(fragmentSurface).toBeInstanceOf(Mesh);
    expect(fragmentSurface?.visible).toBe(true);
    expect(firstMesh.visible).toBe(false);
    expect(secondMesh.visible).toBe(false);

    placeBody(
      shellBodies[0],
      vectorFromRapier(harness.coreBody.translation()).add(
        new Vector3(BlobConfig.armor.coreAnchorRadius, 0, 0),
      ),
    );
    harness.animator.updateFromMotor(animationFrame(2));
    expect(harness.animator.getDebugSnapshot().attachedCount).toBe(0);

    harness.physics.world.gravity = { x: 0, y: 0, z: 0 };
    const corpseSteps = Math.ceil(
      (BlobConfig.armor.detachedLifetimeSeconds + 0.1) * 20,
    );
    for (let step = 0; step < corpseSteps; step += 1) {
      harness.animator.updateStandalone(1 / 20, { dead: true });
      harness.physics.step(1 / 20);
    }
    expect(harness.animator.getDebugSnapshot().totalCount).toBe(0);
    expect(harness.physics.getBodyCount()).toBe(1);
    expect(shellBodies.every((body) => !body.isValid())).toBe(true);

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

async function createHarness(options: {
  navigation?: NavigationService;
  navigationRequests?: NavigationRequestQueue;
} = {}) {
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
    RAPIER.RigidBodyDesc.dynamic().setTranslation(
      position.x,
      position.y,
      position.z,
    ),
  );
  const coreCollider = physics.world.createCollider(
    RAPIER.ColliderDesc.ball(BlobConfig.core.radius).setDensity(
      BlobConfig.core.mass /
        ((4 / 3) * Math.PI * BlobConfig.core.radius ** 3),
    ),
    coreBody,
  );
  coreBody.setGravityScale(BlobConfig.core.gravityScale, true);
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
  visualGroup.add(createBlobCoreVisual());
  scene.add(visualGroup);
  const animator = new BlobArmorAnimator({
    id,
    faction: "zombies",
    visualGroup,
    coreBody,
    position,
    physics,
    owner,
    navigation: options.navigation,
    navigationRequests: options.navigationRequests,
  });
  animator.updateFromMotor(animationFrame(0, true));

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

type BlobHarness = Awaited<ReturnType<typeof createHarness>>;

function deferredChunkRoute(options: { direct?: boolean } = {}): {
  navigation: NavigationService;
  requests: NavigationRequestQueue;
  readonly enqueued: number;
  processOne(): void;
  pending(): number;
  origins(): Vector3[];
} {
  const queued = new Map<string, NavigationRequest>();
  const origins: Vector3[] = [];
  let enqueued = 0;
  const navigation = {
    projectPoint: (position: Vector3) => position.clone(),
  } as unknown as NavigationService;
  const requests = {
    enqueue: (request: NavigationRequest) => {
      queued.set(request.ownerId, request);
      origins.push(request.from.clone());
      enqueued += 1;
    },
    cancel: (ownerId: string) => {
      queued.delete(ownerId);
    },
  } as unknown as NavigationRequestQueue;
  return {
    navigation,
    requests,
    get enqueued() {
      return enqueued;
    },
    processOne: () => {
      const next = queued.entries().next();
      if (next.done) return;
      const [ownerId, request] = next.value;
      queued.delete(ownerId);
      const points = options.direct
        ? [request.to.clone()]
        : detourRoutePoints(request);
      let length = 0;
      let previous = request.from;
      for (const point of points) {
        length += previous.distanceTo(point);
        previous = point;
      }
      request.onResolve({
        points,
        actions: [],
        length,
        partial: false,
      });
    },
    pending: () => queued.size,
    origins: () => origins.map((origin) => origin.clone()),
  };
}

function detourRoutePoints(request: NavigationRequest): Vector3[] {
  const middleX = (request.from.x + request.to.x) * 0.5;
  const direction = request.from.x >= request.to.x ? 1 : -1;
  const detourZ = request.from.z <= 0.5 ? 2 : -2;
  return [
    new Vector3(middleX + direction * 0.8, request.from.y, detourZ),
    new Vector3(middleX - direction * 0.8, request.to.y, detourZ),
    request.to.clone(),
  ];
}

function advanceSimulation(
  harness: BlobHarness,
  seconds: number,
  delta = 1 / 60,
): void {
  const steps = Math.ceil(Math.max(0, seconds) / delta);
  for (let step = 0; step < steps; step += 1) {
    harness.animator.updateFromMotor(animationFrame(delta));
    harness.physics.step(delta);
  }
}

function advanceUntil(
  harness: BlobHarness,
  predicate: () => boolean,
  maxSeconds: number,
  delta = 1 / 60,
): boolean {
  if (predicate()) return true;
  const steps = Math.ceil(Math.max(0, maxSeconds) / delta);
  for (let step = 0; step < steps; step += 1) {
    harness.animator.updateFromMotor(animationFrame(delta));
    harness.physics.step(delta);
    if (predicate()) return true;
  }
  return predicate();
}

function expectMainGraphConsistent(snapshot: BlobArmorDebugSnapshot): void {
  const allowed = new Set(snapshot.attachedIndices);
  const reached = new Set(
    snapshot.coreAnchoredIndices.filter((index) => allowed.has(index)),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const [from, to] of snapshot.cohesionPairs) {
      if (!allowed.has(from) || !allowed.has(to)) continue;
      if (reached.has(from) && !reached.has(to)) {
        reached.add(to);
        changed = true;
      } else if (reached.has(to) && !reached.has(from)) {
        reached.add(from);
        changed = true;
      }
    }
  }
  expect([...reached].sort((a, b) => a - b)).toEqual(
    [...allowed].sort((a, b) => a - b),
  );
}

function reachableWithin(
  start: number,
  pairs: Array<[number, number]>,
  allowedIndices: number[],
): Set<number> {
  const allowed = new Set(allowedIndices);
  const reached = new Set<number>(allowed.has(start) ? [start] : []);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [from, to] of pairs) {
      if (!allowed.has(from) || !allowed.has(to)) continue;
      if (reached.has(from) && !reached.has(to)) {
        reached.add(to);
        changed = true;
      } else if (reached.has(to) && !reached.has(from)) {
        reached.add(from);
        changed = true;
      }
    }
  }
  return reached;
}

function maximumLayer(snapshot: BlobArmorDebugSnapshot): number {
  return Math.max(...snapshot.layers);
}

function layerIndices(
  snapshot: BlobArmorDebugSnapshot,
  layer: number,
): number[] {
  return snapshot.layers.flatMap((value, index) =>
    value === layer ? [index] : [],
  );
}

function layerHistogram(snapshot: BlobArmorDebugSnapshot): number[] {
  return Array.from({ length: maximumLayer(snapshot) + 1 }, (_, layer) =>
    snapshot.layers.filter((value) => value === layer).length,
  );
}

function attachedLayerHistogram(snapshot: BlobArmorDebugSnapshot): number[] {
  return Array.from({ length: maximumLayer(snapshot) + 1 }, (_, layer) =>
    snapshot.attachedIndices.filter((index) => snapshot.layers[index] === layer)
      .length,
  );
}

function graphDegrees(snapshot: BlobArmorDebugSnapshot): number[] {
  const degrees = Array.from({ length: snapshot.layers.length }, () => 0);
  for (const [from, to] of snapshot.cohesionPairs) {
    degrees[from] += 1;
    degrees[to] += 1;
  }
  return degrees;
}

function findBondedOuterPair(
  snapshot: BlobArmorDebugSnapshot,
): [number, number] {
  const layer = maximumLayer(snapshot);
  const pair = snapshot.cohesionPairs.find(
    ([from, to]) =>
      snapshot.layers[from] === layer && snapshot.layers[to] === layer,
  );
  if (!pair) throw new Error("El gel necesita al menos un enlace exterior");
  return pair;
}

function findBondedRootPair(
  snapshot: BlobArmorDebugSnapshot,
): [number, number] {
  const roots = new Set(snapshot.coreAnchoredIndices);
  const pair = snapshot.cohesionPairs.find(
    ([from, to]) => roots.has(from) && roots.has(to),
  );
  if (!pair) throw new Error("El gel necesita un enlace entre roots internos");
  return pair;
}

function findNonBondedOuterPair(
  snapshot: BlobArmorDebugSnapshot,
): [number, number] {
  const outer = layerIndices(snapshot, maximumLayer(snapshot));
  for (let from = 0; from < outer.length; from += 1) {
    for (let to = from + 1; to < outer.length; to += 1) {
      if (!hasPair(snapshot, outer[from], outer[to])) {
        return [outer[from], outer[to]];
      }
    }
  }
  throw new Error("El gel exterior no tiene dos nodos sin enlace directo");
}

function findMutuallyNonBondedOuterIndices(
  snapshot: BlobArmorDebugSnapshot,
  count: number,
): number[] {
  const selected: number[] = [];
  for (const index of layerIndices(snapshot, maximumLayer(snapshot))) {
    if (selected.every((other) => !hasPair(snapshot, index, other))) {
      selected.push(index);
      if (selected.length === count) return selected;
    }
  }
  throw new Error(`El gel exterior no tiene ${count} nodos independientes`);
}

function hasPair(
  snapshot: BlobArmorDebugSnapshot,
  from: number,
  to: number,
): boolean {
  const key = pairKey(from, to);
  return snapshot.cohesionPairs.some(
    ([pairFrom, pairTo]) => pairKey(pairFrom, pairTo) === key,
  );
}

function normalizedPairKeys(pairs: Array<[number, number]>): string[] {
  return pairs.map(([from, to]) => pairKey(from, to)).sort();
}

function pairKey(from: number, to: number): string {
  return `${Math.min(from, to)}:${Math.max(from, to)}`;
}

function releasedArmorIndices(
  harness: BlobHarness,
  armor: ArmorRecord[],
): number[] {
  return armor.flatMap((record) =>
    currentMetadata(harness, record).kind === "dynamic"
      ? [armorIndex(record.metadata)]
      : [],
  );
}

function currentMetadata(
  harness: BlobHarness,
  record: ArmorRecord,
): PhysicsMetadata {
  const metadata = harness.physics.getColliderMetadata(record.collider);
  if (!metadata) throw new Error("Collider de armor sin metadata");
  return metadata;
}

function placeBody(body: RAPIER.RigidBody, position: Vector3): void {
  body.setTranslation(position, true);
  stopBody(body);
}

function translateWholeBlob(
  harness: BlobHarness,
  armor: ArmorRecord[],
  coreTarget: Vector3,
): void {
  const delta = coreTarget
    .clone()
    .sub(vectorFromRapier(harness.coreBody.translation()));
  harness.coreBody.setTranslation(coreTarget, true);
  harness.coreBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
  harness.coreBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
  for (const record of armor) {
    record.body.setTranslation(
      vectorFromRapier(record.body.translation()).add(delta),
      true,
    );
    record.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    record.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}

function placeRecordsInLine(
  records: ArmorRecord[],
  start: Vector3,
  direction: Vector3,
): void {
  const axis = direction.clone().normalize();
  let offset = 0;
  for (let index = 0; index < records.length; index += 1) {
    if (index > 0) {
      offset +=
        ballRadius(records[index - 1].collider) +
        ballRadius(records[index].collider) +
        BlobConfig.armor.reassemblyJoinPadding * 0.5;
    }
    placeBody(records[index].body, start.clone().addScaledVector(axis, offset));
  }
}

function clusterShapeMetrics(records: ArmorRecord[]): {
  normalizedDiameter: number;
  axisAspect: number;
  normalizedRadialDeviation: number;
} {
  const positions = records.map((record) =>
    vectorFromRapier(record.body.translation()),
  );
  const center = positions
    .reduce((sum, position) => sum.add(position), new Vector3())
    .multiplyScalar(1 / positions.length);
  const meanDiameter =
    records.reduce(
      (sum, record) => sum + ballRadius(record.collider) * 2,
      0,
    ) / records.length;
  let diameter = 0;
  for (let from = 0; from < positions.length; from += 1) {
    for (let to = from + 1; to < positions.length; to += 1) {
      diameter = Math.max(diameter, positions[from].distanceTo(positions[to]));
    }
  }
  const covariance = symmetricSecondMoment(
    positions.map((position) => position.clone().sub(center)),
  );
  const eigenvalues = symmetricEigenvalues(covariance);
  const radiusRegularizer =
    records.reduce(
      (sum, record) => sum + ballRadius(record.collider) ** 2,
      0,
    ) /
    records.length /
    5;
  const distances = positions.map((position) => position.distanceTo(center));
  const meanDistance =
    distances.reduce((sum, distance) => sum + distance, 0) /
    distances.length;
  const radialDeviation = Math.sqrt(
    distances.reduce(
      (sum, distance) => sum + (distance - meanDistance) ** 2,
      0,
    ) / distances.length,
  );
  return {
    normalizedDiameter: diameter / meanDiameter,
    axisAspect: Math.sqrt(
      (eigenvalues[0] + radiusRegularizer) /
        (eigenvalues[1] + radiusRegularizer),
    ),
    normalizedRadialDeviation: radialDeviation / meanDiameter,
  };
}

function maximumCoreRadius(
  harness: BlobHarness,
  records: ArmorRecord[],
): number {
  const core = vectorFromRapier(harness.coreBody.translation());
  return Math.max(
    ...records.map(
      (record) =>
        vectorFromRapier(record.body.translation()).distanceTo(core) +
        ballRadius(record.collider),
    ),
  );
}

function shellShapeAspect(
  harness: BlobHarness,
  records: ArmorRecord[],
): number {
  const core = vectorFromRapier(harness.coreBody.translation());
  const offsets = records.map((record) =>
    vectorFromRapier(record.body.translation()).sub(core),
  );
  const eigenvalues = symmetricEigenvalues(symmetricSecondMoment(offsets));
  const radiusRegularizer =
    records.reduce(
      (sum, record) => sum + ballRadius(record.collider) ** 2,
      0,
    ) /
    records.length /
    5;
  return Math.sqrt(
    (eigenvalues[0] + radiusRegularizer) /
      (eigenvalues[2] + radiusRegularizer),
  );
}

function sphericalCoverageHole(
  harness: BlobHarness,
  records: ArmorRecord[],
): number {
  const core = vectorFromRapier(harness.coreBody.translation());
  const occupiedDirections = records.map((record) =>
    vectorFromRapier(record.body.translation()).sub(core).normalize(),
  );
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  let maximumHole = 0;
  for (let index = 0; index < 256; index += 1) {
    const y = 1 - (2 * (index + 0.5)) / 256;
    const horizontal = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = index * goldenAngle;
    const sample = new Vector3(
      Math.cos(angle) * horizontal,
      y,
      Math.sin(angle) * horizontal,
    );
    let nearestAngle = Math.PI;
    for (const occupied of occupiedDirections) {
      nearestAngle = Math.min(
        nearestAngle,
        Math.acos(Math.max(-1, Math.min(1, sample.dot(occupied)))),
      );
    }
    maximumHole = Math.max(maximumHole, nearestAngle);
  }
  return maximumHole;
}

function coverageHoleForIndices(
  harness: BlobHarness,
  armor: ArmorRecord[],
  indices: number[],
): number {
  return sphericalCoverageHole(
    harness,
    indices.map((index) => armor[index]),
  );
}

function coverageGapAtCoreDirection(
  harness: BlobHarness,
  armor: ArmorRecord[],
  indices: number[],
  localDirection: Vector3,
): number {
  if (indices.length === 0) return Math.PI;
  const rotation = harness.coreBody.rotation();
  const direction = localDirection.clone().normalize().applyQuaternion(
    new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
  );
  const core = vectorFromRapier(harness.coreBody.translation());
  return Math.min(
    ...indices.map((index) =>
      Math.acos(
        Math.max(
          -1,
          Math.min(
            1,
            direction.dot(
              vectorFromRapier(armor[index].body.translation())
                .sub(core)
                .normalize(),
            ),
          ),
        ),
      ),
    ),
  );
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) /
    Math.max(1, values.length);
}

function symmetricSecondMoment(points: Vector3[]): number[][] {
  const matrix = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const point of points) {
    matrix[0][0] += point.x * point.x;
    matrix[0][1] += point.x * point.y;
    matrix[0][2] += point.x * point.z;
    matrix[1][1] += point.y * point.y;
    matrix[1][2] += point.y * point.z;
    matrix[2][2] += point.z * point.z;
  }
  const scale = 1 / Math.max(1, points.length);
  matrix[1][0] = matrix[0][1];
  matrix[2][0] = matrix[0][2];
  matrix[2][1] = matrix[1][2];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      matrix[row][column] *= scale;
    }
  }
  return matrix;
}

function symmetricEigenvalues(source: number[][]): number[] {
  const matrix = source.map((row) => [...row]);
  for (let iteration = 0; iteration < 12; iteration += 1) {
    let row = 0;
    let column = 1;
    for (const [candidateRow, candidateColumn] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      if (
        Math.abs(matrix[candidateRow][candidateColumn]) >
        Math.abs(matrix[row][column])
      ) {
        row = candidateRow;
        column = candidateColumn;
      }
    }
    if (Math.abs(matrix[row][column]) < 1e-10) break;
    const angle =
      0.5 *
      Math.atan2(
        2 * matrix[row][column],
        matrix[column][column] - matrix[row][row],
      );
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const rowDiagonal = matrix[row][row];
    const columnDiagonal = matrix[column][column];
    const offDiagonal = matrix[row][column];
    matrix[row][row] =
      cosine ** 2 * rowDiagonal -
      2 * sine * cosine * offDiagonal +
      sine ** 2 * columnDiagonal;
    matrix[column][column] =
      sine ** 2 * rowDiagonal +
      2 * sine * cosine * offDiagonal +
      cosine ** 2 * columnDiagonal;
    matrix[row][column] = 0;
    matrix[column][row] = 0;
    for (let other = 0; other < 3; other += 1) {
      if (other === row || other === column) continue;
      const rowValue = matrix[row][other];
      const columnValue = matrix[column][other];
      matrix[row][other] = cosine * rowValue - sine * columnValue;
      matrix[other][row] = matrix[row][other];
      matrix[column][other] = sine * rowValue + cosine * columnValue;
      matrix[other][column] = matrix[column][other];
    }
  }
  return [matrix[0][0], matrix[1][1], matrix[2][2]].sort((a, b) => b - a);
}

function stopBody(body: RAPIER.RigidBody): void {
  body.setGravityScale(0, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

function bodyDistance(
  first: RAPIER.RigidBody,
  second: RAPIER.RigidBody,
): number {
  return vectorFromRapier(first.translation()).distanceTo(
    vectorFromRapier(second.translation()),
  );
}

function recordsCenter(records: ArmorRecord[]): Vector3 {
  return records
    .reduce(
      (center, record) =>
        center.add(vectorFromRapier(record.body.translation())),
      new Vector3(),
    )
    .multiplyScalar(1 / Math.max(1, records.length));
}

function blobMesh(
  harness: BlobHarness,
  index: number,
): Mesh<BufferGeometry, MeshPhysicalMaterial> {
  const object = harness.scene.getObjectByName(`${harness.id}-blob-${index}`);
  if (
    !(object instanceof Mesh) ||
    !(object.material instanceof MeshPhysicalMaterial)
  ) {
    throw new Error(`Mesh del blob ${index} no encontrado`);
  }
  return object;
}

function blobCoreMesh(
  harness: BlobHarness,
): Mesh<BufferGeometry, MeshStandardMaterial> {
  const object = harness.visualGroup.getObjectByName("blob-core-brain");
  if (
    !(object instanceof Mesh) ||
    !(object.material instanceof MeshStandardMaterial)
  ) {
    throw new Error("Core visual del blob no encontrado");
  }
  return object;
}

function planarDistance(first: Vector3, second: Vector3): number {
  return Math.hypot(first.x - second.x, first.z - second.z);
}

function ballRadius(collider: RAPIER.Collider): number {
  return (collider.shape as RAPIER.Ball).radius;
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

function animationFrame(delta: number, visible = false): AnimationFrame {
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
    visible,
  };
}

function expectAnchorsClose(
  actual: BlobArmorDebugSnapshot,
  expected: BlobArmorDebugSnapshot,
): void {
  expect(actual.anchors).toHaveLength(expected.anchors.length);
  for (let index = 0; index < actual.anchors.length; index += 1) {
    expect(actual.anchors[index].distanceTo(expected.anchors[index])).toBeLessThan(
      1e-6,
    );
  }
}

function vectorFromRapier(value: RAPIER.Vector): Vector3 {
  return new Vector3(value.x, value.y, value.z);
}

function quaternionFromRapier(value: {
  x: number;
  y: number;
  z: number;
  w: number;
}): Quaternion {
  return new Quaternion(value.x, value.y, value.z, value.w);
}
