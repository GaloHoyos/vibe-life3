import { describe, expect, it, vi } from "vitest";
import { Object3D, Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import type { AssetManager, ModelInstance } from "@engine/assets/AssetManager";
import type { ModelAssetId } from "@engine/assets/AssetManifest";
import type { GameEventMap } from "@game/GameEvents";
import { fakePhysicsWorld } from "@tests/support/fakes";

vi.mock("@engine/render/material/Materials", async () => {
  const three = await import("three");
  return {
    getMaterial: () => new three.MeshBasicMaterial(),
  };
});

describe("CharacterFactory", () => {
  it("requires runtime services before creating an NPC", async () => {
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
