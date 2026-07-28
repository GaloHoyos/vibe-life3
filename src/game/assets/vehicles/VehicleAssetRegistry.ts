import {
  BufferGeometry,
  LOD,
  Material,
  Mesh,
  Object3D,
  Texture,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { MeshoptDecoder } from "meshoptimizer";
import type { VehicleArchetypeId } from "@game/config/vehicles.config";
import type { Disposable } from "@shared/types/lifecycle";

export interface VehicleModelLoadResult {
  readonly scene: Object3D;
}

export interface VehicleModelLoader {
  loadAsync(url: string): Promise<VehicleModelLoadResult>;
}

export interface VehicleModelLease extends Disposable {
  readonly archetype: VehicleArchetypeId;
  readonly root: Object3D | null;
  readonly source: "generated" | "fallback";
  readonly error?: Error;
}

export interface VehicleAssetRegistryOptions {
  readonly loader?: VehicleModelLoader;
  readonly cloneModel?: (source: Object3D) => Object3D;
  readonly urls?: Readonly<Record<VehicleArchetypeId, string>>;
  readonly warnOnFallback?: boolean;
}

interface CachedVehicleModel {
  readonly scene: Object3D;
}

interface ModelCacheEntry {
  readonly request: Promise<CachedVehicleModel>;
  references: number;
  loaded: CachedVehicleModel | null;
  releaseWhenLoaded: boolean;
}

export const VEHICLE_MODEL_URLS: Readonly<
  Record<VehicleArchetypeId, string>
> = {
  buggy: new URL("./models/buggy.glb", import.meta.url).href,
  airboat: new URL("./models/airboat.glb", import.meta.url).href,
  helicopter: new URL("./models/helicopter.glb", import.meta.url).href,
};

const LOD_DISTANCES: Readonly<
  Record<VehicleArchetypeId, readonly [number, number]>
> = {
  buggy: [52, 112],
  airboat: [60, 128],
  helicopter: [92, 190],
};

export class VehicleAssetRegistry implements Disposable {
  private readonly loader: VehicleModelLoader;
  private readonly cloneModel: (source: Object3D) => Object3D;
  private readonly urls: Readonly<Record<VehicleArchetypeId, string>>;
  private readonly warnOnFallback: boolean;
  private readonly cache = new Map<VehicleArchetypeId, ModelCacheEntry>();
  private readonly preloadLeases = new Map<
    VehicleArchetypeId,
    VehicleModelLease
  >();
  private disposed = false;

  constructor(options: VehicleAssetRegistryOptions = {}) {
    this.loader = options.loader ?? createVehicleModelLoader();
    this.cloneModel = options.cloneModel ?? cloneSkeleton;
    this.urls = options.urls ?? VEHICLE_MODEL_URLS;
    this.warnOnFallback = options.warnOnFallback ?? true;
  }

  async acquire(archetype: VehicleArchetypeId): Promise<VehicleModelLease> {
    if (this.disposed) {
      return fallbackLease(
        archetype,
        new Error("El registro de modelos vehiculares ya fue liberado."),
      );
    }

    const entry = this.getOrCreateEntry(archetype);
    entry.references += 1;

    try {
      const loaded = await entry.request;
      if (this.disposed) {
        this.release(archetype, entry);
        return fallbackLease(
          archetype,
          new Error("El registro de modelos vehiculares se liberó durante la carga."),
        );
      }

      const root = this.cloneModel(loaded.scene);
      cloneInstanceMaterials(root);
      prepareRenderableMeshes(root);

      let leaseDisposed = false;
      return {
        archetype,
        root,
        source: "generated",
        dispose: (): void => {
          if (leaseDisposed) return;
          leaseDisposed = true;
          root.removeFromParent();
          disposeInstanceMaterials(root);
          this.release(archetype, entry);
        },
      };
    } catch (unknownError) {
      const error = toError(unknownError);
      this.release(archetype, entry);
      if (
        entry.references === 0 &&
        !entry.loaded &&
        this.cache.get(archetype) === entry
      ) {
        this.cache.delete(archetype);
      }
      if (this.warnOnFallback) {
        console.warn(
          `[VehicleAssetRegistry] No se pudo cargar "${archetype}". Se conserva el modelo procedural.`,
          error,
        );
      }
      return fallbackLease(archetype, error);
    }
  }

  preload(archetypes: readonly VehicleArchetypeId[]): Promise<void> {
    const unique = [...new Set(archetypes)].filter(
      (archetype) => !this.preloadLeases.has(archetype),
    );
    return Promise.all(
      unique.map(async (archetype) => {
        const lease = await this.acquire(archetype);
        if (this.disposed || lease.source === "fallback") {
          lease.dispose();
          return;
        }
        this.preloadLeases.set(archetype, lease);
      }),
    ).then(() => undefined);
  }

  getReferenceCount(archetype: VehicleArchetypeId): number {
    return this.cache.get(archetype)?.references ?? 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.preloadLeases.forEach((lease) => lease.dispose());
    this.preloadLeases.clear();
    this.cache.forEach((entry, archetype) => {
      if (entry.references === 0) {
        this.retireEntry(archetype, entry);
      } else {
        entry.releaseWhenLoaded = true;
      }
    });
  }

  private getOrCreateEntry(archetype: VehicleArchetypeId): ModelCacheEntry {
    const existing = this.cache.get(archetype);
    if (existing) return existing;

    const entry: ModelCacheEntry = {
      request: Promise.resolve()
        .then(() => this.loader.loadAsync(this.urls[archetype]))
        .then(({ scene }) => {
          prepareVehicleModelSource(scene, archetype);
          const loaded = { scene };
          entry.loaded = loaded;
          if (entry.releaseWhenLoaded && entry.references === 0) {
            this.retireEntry(archetype, entry);
          }
          return loaded;
        }),
      references: 0,
      loaded: null,
      releaseWhenLoaded: false,
    };
    this.cache.set(archetype, entry);
    return entry;
  }

  private release(
    archetype: VehicleArchetypeId,
    entry: ModelCacheEntry,
  ): void {
    entry.references = Math.max(0, entry.references - 1);
    if (entry.references > 0) return;
    this.retireEntry(archetype, entry);
  }

  private retireEntry(
    archetype: VehicleArchetypeId,
    entry: ModelCacheEntry,
  ): void {
    if (this.cache.get(archetype) !== entry) return;
    if (!entry.loaded) {
      entry.releaseWhenLoaded = true;
      return;
    }
    disposeModelSource(entry.loaded.scene);
    this.cache.delete(archetype);
  }
}

export function prepareVehicleModelSource(
  scene: Object3D,
  archetype: VehicleArchetypeId,
): void {
  const assetRoot = scene.getObjectByName(`${archetype}_vehicle`);
  if (!assetRoot) {
    throw new Error(`El GLB "${archetype}" no contiene su raíz declarada.`);
  }

  installLod(assetRoot, archetype);
  const wreckage = assetRoot.getObjectByName("wreckage");
  if (wreckage) wreckage.visible = false;
  prepareRenderableMeshes(scene);
}

function createVehicleModelLoader(): VehicleModelLoader {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

function installLod(
  assetRoot: Object3D,
  archetype: VehicleArchetypeId,
): void {
  if (assetRoot.getObjectByName("runtime_visual_lods") instanceof LOD) return;

  const levels = [0, 1, 2].map((level) =>
    assetRoot.children.find((child) => child.name === `visual_lod${level}`),
  );
  if (levels.some((level) => level === undefined)) {
    throw new Error(
      `El GLB "${archetype}" no contiene visual_lod0/1/2 completos.`,
    );
  }

  const lod = new LOD();
  lod.name = "runtime_visual_lods";
  lod.autoUpdate = true;
  const distances = LOD_DISTANCES[archetype];
  levels.forEach((level, index) => {
    if (!level) return;
    assetRoot.remove(level);
    level.visible = index === 0;
    lod.addLevel(level, index === 0 ? 0 : distances[index - 1] ?? 0, 0.08);
  });
  assetRoot.add(lod);
}

function prepareRenderableMeshes(root: Object3D): void {
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    // El shadow map no lee alfa: si el cristal proyectara, una cabina
    // acristalada tiraría la misma sombra maciza que una de chapa.
    node.castShadow = !isTransparent(node.material);
    node.receiveShadow = true;
    node.frustumCulled = true;
    if (!node.geometry.boundingSphere) {
      node.geometry.computeBoundingSphere();
    }
    if (!node.geometry.boundingBox) {
      node.geometry.computeBoundingBox();
    }
  });
}

export function isTransparent(material: Material | readonly Material[]): boolean {
  const materials = Array.isArray(material) ? material : [material as Material];
  return materials.some((entry) => entry.transparent);
}

function cloneInstanceMaterials(root: Object3D): void {
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    node.material = Array.isArray(node.material)
      ? node.material.map((material) => material.clone())
      : node.material.clone();
  });
}

function disposeInstanceMaterials(root: Object3D): void {
  const materials = collectMaterials(root);
  materials.forEach((material) => material.dispose());
}

function disposeModelSource(root: Object3D): void {
  const geometries = new Set<BufferGeometry>();
  const materials = collectMaterials(root);
  const textures = new Set<Texture>();
  root.traverse((node) => {
    if (node instanceof Mesh) {
      geometries.add(node.geometry);
    }
  });
  materials.forEach((material) => {
    collectMaterialTextures(material, textures);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => texture.dispose());
}

function collectMaterials(root: Object3D): Set<Material> {
  const materials = new Set<Material>();
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const nodeMaterials = Array.isArray(node.material)
      ? node.material
      : [node.material];
    nodeMaterials.forEach((material) => materials.add(material));
  });
  return materials;
}

function collectMaterialTextures(
  material: Material,
  textures: Set<Texture>,
): void {
  const candidates: readonly string[] = [
    "alphaMap",
    "aoMap",
    "bumpMap",
    "clearcoatMap",
    "clearcoatNormalMap",
    "clearcoatRoughnessMap",
    "displacementMap",
    "emissiveMap",
    "envMap",
    "lightMap",
    "map",
    "metalnessMap",
    "normalMap",
    "roughnessMap",
  ];
  const values = material as unknown as Readonly<Record<string, unknown>>;
  candidates.forEach((key) => {
    const value = values[key];
    if (value instanceof Texture) textures.add(value);
  });
}

function fallbackLease(
  archetype: VehicleArchetypeId,
  error: Error,
): VehicleModelLease {
  return {
    archetype,
    root: null,
    source: "fallback",
    error,
    dispose: (): void => undefined,
  };
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
