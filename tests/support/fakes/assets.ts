import { Object3D } from "three";
import type { ModelAssetId } from "@engine/assets/AssetManifest";
import type { AssetManager, ModelInstance, ModelLoadResult } from "@engine/assets/AssetManager";

const fallbackAsset = (id: ModelAssetId) => ({
  id,
  path: "",
  type: "prop" as const,
  debug: false,
});

export function fakeAssets(): AssetManager {
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
      root: new Object3D(),
      source: "fallback",
      hasSkeleton: false,
      animationsIgnored: true,
    }),
  } as AssetManager;
}
