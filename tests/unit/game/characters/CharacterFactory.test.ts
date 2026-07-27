import { describe, expect, it, vi } from "vitest";
import { Object3D, Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { Raycast } from "@engine/physics/Raycast";
import type { AssetManager, ModelInstance } from "@engine/assets/AssetManager";
import type { ModelAssetId } from "@engine/assets/AssetManifest";
import type { NpcRuntimeServices } from "@game/characters/CharacterFactory";
import type { GameEventMap } from "@game/GameEvents";
import { fakePhysicsWorld } from "@tests/support/fakes";

vi.mock("@engine/render/material/Materials", async () => {
  const three = await import("three");
  return {
    getMaterial: () => new three.MeshBasicMaterial(),
  };
});

describe("CharacterFactory", () => {
  // El primer test paga el import dinámico del grafo completo de la factory;
  // con la suite corriendo en paralelo el default de 5 s queda justo.
  it("requires runtime services before creating an NPC", { timeout: 15000 }, async () => {
    const { CharacterFactory } = await import("@game/characters/CharacterFactory");
    const assets = trackingAssets();
    const factory = new CharacterFactory(
      assets,
      fakePhysicsWorld(),
      new EventBus<GameEventMap>(),
    );

    await expect(
      factory.createNPC("zombie", "z-1", new Vector3()),
    ).rejects.toThrow(/requiere NpcRuntimeServices/);

    expect(assets.instantiateModel).toHaveBeenCalledWith("zombie");
  });

  it("falls back for unknown character ids without loading a model before service validation", async () => {
    const { CharacterFactory } = await import("@game/characters/CharacterFactory");
    const assets = trackingAssets();
    const factory = new CharacterFactory(
      assets,
      fakePhysicsWorld(),
      new EventBus<GameEventMap>(),
    );

    await expect(
      factory.createNPC("__unknown__", "unknown-1", new Vector3()),
    ).rejects.toThrow(/requiere NpcRuntimeServices/);

    expect(assets.instantiateModel).not.toHaveBeenCalled();
  });

  it("tags NPC physics metadata with the character id", async () => {
    const { CharacterFactory } = await import("@game/characters/CharacterFactory");
    const assets = trackingAssets();
    const physics = new PhysicsWorld();
    await physics.init();
    const registered: Array<{ id: string; kind: string; characterId?: string }> = [];
    const registerCollider = physics.registerCollider.bind(physics);
    vi.spyOn(physics, "registerCollider").mockImplementation((collider, metadata) => {
      registered.push(metadata);
      registerCollider(collider, metadata);
    });
    const factory = new CharacterFactory(
      assets,
      physics,
      new EventBus<GameEventMap>(),
    );

    const npc = await factory.createNPC("zombie", "z-1", new Vector3(), [], runtimeServices());

    expect(registered).toContainEqual(
      expect.objectContaining({
        id: "z-1",
        kind: "npc",
        characterId: "zombie",
      }),
    );
    npc.dispose();
    physics.reset();
  });

  it("mantiene una presa organica a traves de la muerte y deja que su dueno limpie el ragdoll al consumirla", async () => {
    const { CharacterFactory } = await import("@game/characters/CharacterFactory");
    const physics = new PhysicsWorld();
    await physics.init();
    const factory = new CharacterFactory(
      trackingAssets(),
      physics,
      new EventBus<GameEventMap>(),
    );
    const npc = await factory.createNPC(
      "zombie",
      "organic-zombie",
      new Vector3(0, 2, 0),
      [],
      runtimeServices(),
    );
    const parent = new Object3D();
    parent.add(npc.mesh);
    const organic = npc.getOrganicMatterHandle?.();

    expect(organic).not.toBeNull();
    expect(organic?.mass).toBeGreaterThan(0);
    expect(organic?.tryClaim("blob-hunter")).toBe(true);
    npc.applyDamage(npc.health.max * 2, undefined, undefined, "blob-hunter");
    expect(npc.isAlive()).toBe(false);
    expect(organic?.isAvailable()).toBe(true);

    organic?.setDigestionProgress("blob-hunter", 0.5);
    expect(npc.mesh.scale.x).toBeLessThan(1);
    const gained = organic?.consume("blob-hunter") ?? 0;
    expect(gained).toBeGreaterThan(0);
    expect(parent.children).not.toContain(npc.mesh);
    expect(physics.getBodyCount()).toBe(0);
    expect(() => npc.dispose()).not.toThrow();

    physics.reset();
  });
});

function trackingAssets(): AssetManager & {
  instantiateModel: ReturnType<typeof vi.fn>;
} {
  const instantiateModel = vi.fn(async (id: ModelAssetId): Promise<ModelInstance> => ({
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
  }));

  return {
    instantiateModel,
  } as unknown as AssetManager & {
    instantiateModel: ReturnType<typeof vi.fn>;
  };
}

function runtimeServices(): NpcRuntimeServices {
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
    raycast: { cast: () => null } as unknown as Raycast,
    tacticalMap: null,
    squadDirector: null,
  } as unknown as NpcRuntimeServices;
}
