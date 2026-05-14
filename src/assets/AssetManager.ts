import { Object3D, SkinnedMesh } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AssetManifest, type ModelAssetConfig, type ModelAssetId } from './AssetManifest';

export interface ModelLoadResult {
  asset: ModelAssetConfig;
  gltf: GLTF | null;
  loaded: boolean;
  hasSkeleton: boolean;
  animationsIgnored: boolean;
  error?: Error;
}

export interface ModelInstance {
  asset: ModelAssetConfig;
  root: Object3D | null;
  source: 'gltf' | 'fallback';
  hasSkeleton: boolean;
  animationsIgnored: boolean;
  error?: Error;
}

export class AssetManager {
  private readonly loader = new GLTFLoader();
  private readonly modelCache = new Map<ModelAssetId, Promise<ModelLoadResult>>();

  async loadModel(id: ModelAssetId): Promise<ModelLoadResult> {
    const cached = this.modelCache.get(id);
    if (cached) {
      return cached;
    }

    const asset = AssetManifest.models[id];
    const request = this.loadModelInternal(asset);
    this.modelCache.set(id, request);
    return request;
  }

  async instantiateModel(id: ModelAssetId): Promise<ModelInstance> {
    const result = await this.loadModel(id);

    if (!result.loaded || !result.gltf) {
      return {
        asset: result.asset,
        root: null,
        source: 'fallback',
        hasSkeleton: false,
        animationsIgnored: true,
        error: result.error,
      };
    }

    const root = cloneSkeleton(result.gltf.scene) as Object3D;
    this.prepareModelRoot(root, result.asset);

    return {
      asset: result.asset,
      root,
      source: 'gltf',
      hasSkeleton: hasSkeleton(root),
      animationsIgnored: true,
    };
  }

  private async loadModelInternal(asset: ModelAssetConfig): Promise<ModelLoadResult> {
    try {
      if (asset.debug) {
        console.info(`[AssetManager] Loading model "${asset.id}" from ${asset.path}`);
      }

      const gltf = await this.loader.loadAsync(asset.path);
      const skeleton = hasSkeleton(gltf.scene);

      if (asset.debug) {
        console.info(`[AssetManager] Model "${asset.id}" loaded. Skeleton: ${skeleton}. Clips ignored: ${gltf.animations.length}`);
      }

      return {
        asset,
        gltf,
        loaded: true,
        hasSkeleton: skeleton,
        animationsIgnored: true,
      };
    } catch (unknownError) {
      const error = unknownError instanceof Error ? unknownError : new Error(String(unknownError));

      console.warn(`[AssetManager] Model "${asset.id}" failed to load. Using fallback.`, error);

      return {
        asset,
        gltf: null,
        loaded: false,
        hasSkeleton: false,
        animationsIgnored: true,
        error,
      };
    }
  }

  private prepareModelRoot(root: Object3D, asset: ModelAssetConfig): void {
    root.name = `${asset.id}-model`;
    root.traverse((object) => {
      object.frustumCulled = false;
      if ('castShadow' in object) {
        object.castShadow = true;
      }
      if ('receiveShadow' in object) {
        object.receiveShadow = true;
      }
    });
  }
}

function hasSkeleton(root: Object3D): boolean {
  let skeletonFound = false;

  root.traverse((object) => {
    if (object instanceof SkinnedMesh && object.skeleton.bones.length > 0) {
      skeletonFound = true;
    }
  });

  return skeletonFound;
}
