import RAPIER from "@dimforge/rapier3d-compat";
import { Object3D, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import { EventBus } from "@engine/core/EventBus";
import type { AssetManager, ModelInstance } from "@engine/assets/AssetManager";
import type { ModelAssetId } from "@engine/assets/AssetManifest";
import { PhysicsWorld, type PhysicsMetadata } from "@engine/physics/PhysicsWorld";
import type { Raycast, RaycastSource } from "@engine/physics/Raycast";
import { PortalPairState } from "@engine/portals/PortalFrame";
import type { NpcRuntimeServices } from "@game/characters/CharacterFactory";
import { BlobConfig } from "@game/config/blob.config";
import type { GameEventMap } from "@game/GameEvents";

vi.mock("@engine/render/material/Materials", async () => {
  const three = await import("three");
  return {
    getMaterial: () => new three.MeshBasicMaterial(),
  };
});

describe("CharacterFactory: blob", () => {
  it("conecta preset, cerebro esférico, cubierta física y teardown completo", { timeout: 15000 }, async () => {
    const { CharacterFactory } = await import("@game/characters/CharacterFactory");
    const physics = new PhysicsWorld();
    await physics.init();
    const assets = trackingAssets();
    const factory = new CharacterFactory(
      assets,
      physics,
      new EventBus<GameEventMap>(),
    );

    const npc = await factory.createNPC(
      "blob",
      "blob-factory",
      new Vector3(1, 4, -2),
      [],
      runtimeServices(),
    );

    expect(npc.characterId).toBe("blob");
    expect(npc.health.current).toBe(BlobConfig.core.maxHealth);
    expect(npc.health.max).toBe(BlobConfig.core.maxHealth);
    expect(npc.radius).toBe(BlobConfig.armor.aggregateRadius);
    expect(assets.instantiateModel).not.toHaveBeenCalled();
    expect(physics.getBodyCount()).toBe(BlobConfig.armor.count + 1);
    // Los roots internos van al cerebro y el resto se sostiene con el grafo gel.
    expect(physics.world.impulseJoints.len()).toBeGreaterThan(
      BlobConfig.armor.count,
    );

    const records = colliderRecords(physics);
    const core = records.find(({ metadata }) => metadata.id === "blob-factory");
    const armor = records.filter(({ metadata }) =>
      metadata.bodyPart?.name.startsWith("blob-armor-"),
    );
    expect(core?.metadata).toMatchObject({
      id: "blob-factory",
      ownerId: "blob-factory",
      kind: "npc",
      characterId: "blob",
      faction: "zombies",
      selfPortalTraversal: true,
      bodyPart: { name: "blob-core", damageMultiplier: 1 },
    });
    expect(core?.collider.shape.type).toBe(RAPIER.ShapeType.Ball);
    expect((core?.collider.shape as RAPIER.Ball).radius).toBeCloseTo(
      BlobConfig.core.radius,
      6,
    );
    expect(core?.body.mass()).toBeCloseTo(BlobConfig.core.mass, 4);
    expect(core?.body.gravityScale()).toBeCloseTo(
      BlobConfig.core.gravityScale,
      6,
    );
    expect(core?.body.linearDamping()).toBeCloseTo(
      BlobConfig.armor.linearDamping,
      6,
    );
    expect(core?.body.angularDamping()).toBeCloseTo(
      BlobConfig.armor.angularDamping,
      6,
    );
    expect(armor).toHaveLength(BlobConfig.armor.count);

    npc.dispose();
    expect(physics.world.impulseJoints.len()).toBe(0);
    expect(physics.getBodyCount()).toBe(0);
    expect(() => npc.dispose()).not.toThrow();
    expect(() => physics.step(1 / 60)).not.toThrow();
  });
});

function trackingAssets(): AssetManager & {
  instantiateModel: ReturnType<typeof vi.fn>;
} {
  const instantiateModel = vi.fn(
    async (id: ModelAssetId): Promise<ModelInstance> => ({
      asset: {
        id,
        path: "",
        type: "character",
        debug: false,
      },
      root: new Object3D(),
      source: "fallback",
      hasSkeleton: false,
      animationsIgnored: true,
    }),
  );
  return { instantiateModel } as unknown as AssetManager & {
    instantiateModel: ReturnType<typeof vi.fn>;
  };
}

function runtimeServices(): NpcRuntimeServices {
  const raycast = { cast: () => null } as unknown as Raycast & RaycastSource;
  return {
    navigation: {
      createAgent: vi.fn(() => null),
      releaseAgentReservations: vi.fn(),
    },
    navigationRequests: {
      cancel: vi.fn(),
      enqueue: vi.fn(),
    },
    buildingRegistry: {},
    raycast,
    losRaycast: raycast,
    portals: new PortalPairState(),
    tacticalMap: null,
    squadDirector: null,
  } as unknown as NpcRuntimeServices;
}

function colliderRecords(physics: PhysicsWorld): Array<{
  collider: RAPIER.Collider;
  body: RAPIER.RigidBody;
  metadata: PhysicsMetadata;
}> {
  const result: Array<{
    collider: RAPIER.Collider;
    body: RAPIER.RigidBody;
    metadata: PhysicsMetadata;
  }> = [];
  physics.world.colliders.forEach((collider) => {
    const metadata = physics.getColliderMetadata(collider);
    const body = collider.parent();
    if (metadata && body) result.push({ collider, body, metadata });
  });
  return result;
}
