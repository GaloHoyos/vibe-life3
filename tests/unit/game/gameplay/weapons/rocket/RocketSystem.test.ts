import { describe, expect, it, vi } from "vitest";
import { Object3D, Scene, Vector3 } from "three";
import type { AssetManager, ModelInstance, ModelLoadResult } from "@engine/assets/AssetManager";
import type { PositionalSoundManager } from "@engine/audio/core/PositionalSoundManager";
import type { ModelAssetId } from "@engine/assets/AssetManifest";
import type { Raycast, RaycastHit } from "@engine/physics/Raycast";
import type { VfxSystem } from "@engine/render/effects/VfxSystem";
import type { GrenadeSystem } from "@game/gameplay/weapons/grenade/GrenadeSystem";
import { RocketSystem } from "@game/gameplay/weapons/rocket/RocketSystem";

function setup(raycastImpl: Raycast["cast"] = vi.fn(() => null)) {
  const scene = new Scene();
  const grenades = {
    detonate: vi.fn(),
  };
  const vfx = {
    rocketTrail: vi.fn(),
  };
  const positionalSounds = {
    attachToObject: vi.fn(),
    stopAttached: vi.fn(),
  };
  const system = new RocketSystem(
    scene,
    fakeRocketAssets(),
    { cast: raycastImpl } as Raycast,
    grenades as unknown as GrenadeSystem,
    vfx as unknown as VfxSystem,
    positionalSounds as unknown as PositionalSoundManager,
  );
  return { scene, system, grenades, vfx, positionalSounds };
}

function spawn(system: RocketSystem): string {
  return system.spawn({
    origin: new Vector3(0, 0, 0),
    direction: new Vector3(0, 0, 1),
    damage: 200,
    radius: 5.1,
    impulse: 26,
    ownerKind: "player",
    sourceId: "player",
    sourceFaction: "player",
    weaponName: "RPG",
    now: 0,
  });
}

function hit(kind: NonNullable<RaycastHit["metadata"]>["kind"], point: Vector3, toi: number): RaycastHit {
  return {
    collider: {} as RaycastHit["collider"],
    metadata: { id: `${kind}-hit`, kind },
    point,
    normal: new Vector3(0, 0, -1),
    toi,
  };
}

describe("RocketSystem", () => {
  it("gira suavemente hacia el laser target", () => {
    const { system } = setup();
    const id = spawn(system);

    system.updateLaser("player", new Vector3(0, 0, 0), new Vector3(1, 0, 0));
    system.update(0, 0.4);

    const snapshot = system.getRocketSnapshot(id);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.direction.x).toBeGreaterThan(0);
    expect(snapshot!.direction.z).toBeGreaterThan(0.9);
  });

  it("detona al impactar y delega explosion radial a GrenadeSystem", () => {
    const impact = hit("static", new Vector3(0, 0, 1.5), 1.5);
    const { system, grenades, positionalSounds } = setup(vi.fn(() => impact));
    const id = spawn(system);

    system.update(0.1, 0.1);

    expect(system.hasRocket(id)).toBe(false);
    expect(grenades.detonate).toHaveBeenCalledTimes(1);
    expect(grenades.detonate).toHaveBeenCalledWith(
      impact.point,
      expect.objectContaining({
        damage: 200,
        radius: 5.1,
        impulse: 26,
        ownerKind: "player",
        sourceId: "player",
        sourceFaction: "player",
        weaponName: "RPG",
      }),
    );
    expect(positionalSounds.stopAttached).toHaveBeenCalled();
  });

  it("ignora weapon pickups y detona contra el siguiente impacto valido", () => {
    const cast = vi
      .fn()
      .mockReturnValueOnce(hit("weaponPickup", new Vector3(0, 0, 0.2), 0.2))
      .mockReturnValueOnce(hit("door", new Vector3(0, 0, 1.2), 0.9));
    const { system, grenades } = setup(cast);

    spawn(system);
    system.update(0.1, 0.1);

    expect(cast).toHaveBeenCalledTimes(2);
    expect(grenades.detonate).toHaveBeenCalledTimes(1);
    expect(grenades.detonate.mock.calls[0][0]).toEqual(new Vector3(0, 0, 1.2));
  });

  it("limpia cohetes y laser dot en clear/dispose", () => {
    const { scene, system, positionalSounds } = setup();

    spawn(system);
    expect(positionalSounds.attachToObject).toHaveBeenCalledWith(
      "weapons.rpg.hl2.rocketLoop",
      expect.any(Object3D),
      expect.objectContaining({ loop: true }),
    );
    system.updateLaser("player", new Vector3(), new Vector3(0, 0, 1));
    expect(scene.children.length).toBeGreaterThan(0);

    system.clear();
    expect(scene.children.filter((child) => child.visible)).toHaveLength(0);
    expect(positionalSounds.stopAttached).toHaveBeenCalled();

    system.dispose();
    expect(scene.children).toHaveLength(0);
  });
});

function fakeRocketAssets(): AssetManager {
  const fallbackAsset = (id: ModelAssetId) => ({
    id,
    path: "",
    type: "prop" as const,
    debug: false,
  });
  return {
    loadModel: async (id: ModelAssetId): Promise<ModelLoadResult> => ({
      asset: fallbackAsset(id),
      gltf: null,
      loaded: false,
      hasSkeleton: false,
      animationsIgnored: true,
    }),
    instantiateModel: async (id: ModelAssetId): Promise<ModelInstance> => ({
      asset: fallbackAsset(id),
      root: null,
      source: "fallback",
      hasSkeleton: false,
      animationsIgnored: true,
    }),
  } as AssetManager;
}
