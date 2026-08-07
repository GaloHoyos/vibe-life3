import { BufferGeometry, LOD, Material, Matrix4, Mesh, Object3D, Texture, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "meshoptimizer";
import type { ColliderSpec } from "@engine/physics/ColliderSpec";
import type { Disposable } from "@shared/types/lifecycle";
import type { PropArchetypeId, PropPackId } from "@game/config/props.config";
import { PropArchetypes } from "@game/config/props.config";

export interface PropModelLoadResult {
  readonly scene: Object3D;
}

export interface PropModelLoader {
  loadAsync(url: string): Promise<PropModelLoadResult>;
}

/** Un fragmento autorado del prop, listo para que el pool lo instancie. */
export interface PropChunkSource {
  /**
   * Geometría COMPARTIDA del pack, ya en metros y centrada en su propio
   * origen. El debris nunca la deforma, así que N fragmentos = 0 geometrías
   * nuevas.
   */
  readonly geometry: BufferGeometry;
  readonly material: Material;
  /** Dirección del fragmento desde el centro del prop. */
  readonly sector: readonly [number, number, number];
  readonly massFraction: number;
  readonly size: readonly [number, number, number];
  /** Dónde estaba el fragmento dentro del prop, en espacio del prop. */
  readonly center: readonly [number, number, number];
}

export interface PropModelLease extends Disposable {
  readonly archetypeId: PropArchetypeId;
  /** Visual clonado y listo para agregar a la escena. `null` si no cargó. */
  readonly root: Object3D | null;
  readonly source: "generated" | "fallback";
  /** Casco de colisión horneado en el GLB. `null` = usar la caja de `bounds`. */
  readonly collider: ColliderSpec | null;
  readonly chunks: readonly PropChunkSource[];
  readonly error?: Error;
}

export interface PropAssetRegistryOptions {
  readonly loader?: PropModelLoader;
  readonly cloneModel?: (source: Object3D) => Object3D;
  readonly urls?: Readonly<Record<PropPackId, string>>;
  readonly warnOnFallback?: boolean;
}

interface CachedPack {
  readonly scene: Object3D;
  readonly colliders: Map<PropArchetypeId, ColliderSpec>;
  readonly chunks: Map<PropArchetypeId, PropChunkSource[]>;
}

interface PackCacheEntry {
  readonly request: Promise<CachedPack>;
  references: number;
  loaded: CachedPack | null;
  releaseWhenLoaded: boolean;
}

export const PROP_PACK_URLS: Readonly<Record<PropPackId, string>> = {
  propsWood: new URL("./models/propsWood.glb", import.meta.url).href,
  propsMetal: new URL("./models/propsMetal.glb", import.meta.url).href,
  propsSynthetic: new URL("./models/propsSynthetic.glb", import.meta.url).href,
};

/** Distancia (m) a la que un prop pasa a su malla simplificada. */
const LOD_DISTANCE = 28;

/**
 * Dueño de los tres packs de props. Los props comparten GLB de a cuatro, así
 * que la caché es por pack y con refcount: el primer cajón de un nivel carga
 * `propsWood` y el último en morir lo libera.
 *
 * Si un pack no carga, `acquire` devuelve un lease de fallback en vez de tirar:
 * el prop se queda con su caja de reserva y el nivel sigue jugable.
 */
export class PropAssetRegistry implements Disposable {
  private readonly loader: PropModelLoader;
  private readonly cloneModel: (source: Object3D) => Object3D;
  private readonly urls: Readonly<Record<PropPackId, string>>;
  private readonly warnOnFallback: boolean;
  private readonly cache = new Map<PropPackId, PackCacheEntry>();
  private readonly preloadLeases = new Map<PropPackId, PropModelLease>();
  private disposed = false;

  constructor(options: PropAssetRegistryOptions = {}) {
    this.loader = options.loader ?? createPropModelLoader();
    this.cloneModel = options.cloneModel ?? ((source) => source.clone(true));
    this.urls = options.urls ?? PROP_PACK_URLS;
    this.warnOnFallback = options.warnOnFallback ?? true;
  }

  async acquire(archetypeId: PropArchetypeId, variant = 0): Promise<PropModelLease> {
    const archetype = PropArchetypes[archetypeId];
    if (this.disposed || !archetype) {
      return fallbackLease(archetypeId, new Error("El registro de props ya fue liberado."));
    }
    const pack = archetype.asset.pack;
    const entry = this.getOrCreateEntry(pack);
    entry.references += 1;

    try {
      const loaded = await entry.request;
      if (this.disposed) {
        this.release(pack, entry);
        return fallbackLease(archetypeId, new Error("El registro se liberó durante la carga."));
      }
      const source = loaded.scene.getObjectByName(archetype.asset.node);
      if (!source) {
        throw new Error(`El pack "${pack}" no contiene "${archetype.asset.node}".`);
      }

      const root = this.cloneModel(source);
      selectVariant(root, variant, archetype.asset.variants);
      installLod(root);
      cloneInstanceMaterials(root);
      prepareRenderableMeshes(root);

      let leaseDisposed = false;
      return {
        archetypeId,
        root,
        source: "generated",
        collider: loaded.colliders.get(archetypeId) ?? null,
        chunks: loaded.chunks.get(archetypeId) ?? [],
        dispose: (): void => {
          if (leaseDisposed) return;
          leaseDisposed = true;
          root.removeFromParent();
          disposeInstanceMaterials(root);
          this.release(pack, entry);
        },
      };
    } catch (unknownError) {
      const error = toError(unknownError);
      this.release(pack, entry);
      if (entry.references === 0 && !entry.loaded && this.cache.get(pack) === entry) {
        this.cache.delete(pack);
      }
      if (this.warnOnFallback) {
        console.warn(
          `[PropAssetRegistry] No se pudo cargar "${archetypeId}". Se usa la caja de reserva.`,
          error,
        );
      }
      return fallbackLease(archetypeId, error);
    }
  }

  /**
   * Lease inmediato si el pack ya está en memoria; `null` si todavía no.
   *
   * Existe para que `PropSystem.spawn` siga siendo síncrono: el nivel precarga
   * sus packs y recién después spawnea, así el cuerpo se arma con su casco real
   * de una vez en vez de nacer como caja y reconstruirse a mitad de camino.
   */
  acquireSync(archetypeId: PropArchetypeId, variant = 0): PropModelLease | null {
    const archetype = PropArchetypes[archetypeId];
    if (this.disposed || !archetype) return null;
    const pack = archetype.asset.pack;
    const entry = this.cache.get(pack);
    const loaded = entry?.loaded;
    if (!entry || !loaded) return null;
    const source = loaded.scene.getObjectByName(archetype.asset.node);
    if (!source) return null;

    entry.references += 1;
    const root = this.cloneModel(source);
    selectVariant(root, variant, archetype.asset.variants);
    installLod(root);
    cloneInstanceMaterials(root);
    prepareRenderableMeshes(root);

    let leaseDisposed = false;
    return {
      archetypeId,
      root,
      source: "generated",
      collider: loaded.colliders.get(archetypeId) ?? null,
      chunks: loaded.chunks.get(archetypeId) ?? [],
      dispose: (): void => {
        if (leaseDisposed) return;
        leaseDisposed = true;
        root.removeFromParent();
        disposeInstanceMaterials(root);
        this.release(pack, entry);
      },
    };
  }

  /** Deja los packs de estos arquetipos cargados mientras dure el nivel. */
  preload(archetypeIds: readonly PropArchetypeId[]): Promise<void> {
    const packs = [...new Set(archetypeIds.map((id) => PropArchetypes[id]?.asset.pack))].filter(
      (pack): pack is PropPackId => pack !== undefined && !this.preloadLeases.has(pack),
    );
    return Promise.all(
      packs.map(async (pack) => {
        const anyArchetype = (Object.keys(PropArchetypes) as PropArchetypeId[]).find(
          (id) => PropArchetypes[id].asset.pack === pack,
        );
        if (!anyArchetype) return;
        const lease = await this.acquire(anyArchetype);
        if (this.disposed || lease.source === "fallback") {
          lease.dispose();
          return;
        }
        this.preloadLeases.set(pack, lease);
      }),
    ).then(() => undefined);
  }

  getReferenceCount(pack: PropPackId): number {
    return this.cache.get(pack)?.references ?? 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.preloadLeases.forEach((lease) => lease.dispose());
    this.preloadLeases.clear();
    this.cache.forEach((entry, pack) => {
      if (entry.references === 0) this.retireEntry(pack, entry);
      else entry.releaseWhenLoaded = true;
    });
  }

  private getOrCreateEntry(pack: PropPackId): PackCacheEntry {
    const existing = this.cache.get(pack);
    if (existing) return existing;

    const entry: PackCacheEntry = {
      request: Promise.resolve()
        .then(() => this.loader.loadAsync(this.urls[pack]))
        .then(({ scene }) => {
          const loaded: CachedPack = {
            scene,
            colliders: readPackColliders(scene),
            chunks: readPackChunks(scene),
          };
          entry.loaded = loaded;
          if (entry.releaseWhenLoaded && entry.references === 0) {
            this.retireEntry(pack, entry);
          }
          return loaded;
        }),
      references: 0,
      loaded: null,
      releaseWhenLoaded: false,
    };
    this.cache.set(pack, entry);
    return entry;
  }

  private release(pack: PropPackId, entry: PackCacheEntry): void {
    entry.references = Math.max(0, entry.references - 1);
    if (entry.references > 0) return;
    this.retireEntry(pack, entry);
  }

  private retireEntry(pack: PropPackId, entry: PackCacheEntry): void {
    if (this.cache.get(pack) !== entry) return;
    if (!entry.loaded) {
      entry.releaseWhenLoaded = true;
      return;
    }
    // Las geometrías de fragmentos son clones horneados que no cuelgan de la
    // escena, así que `disposeModelSource` no las alcanza.
    for (const chunks of entry.loaded.chunks.values()) {
      for (const chunk of chunks) chunk.geometry.dispose();
    }
    disposeModelSource(entry.loaded.scene);
    this.cache.delete(pack);
  }
}

/**
 * Lee los cascos horneados del pack. El nodo `collider_*` es una malla sin
 * material cuyas posiciones son la nube de puntos del casco convexo; Rapier
 * recalcula el casco a partir de ellas.
 */
export function readPackColliders(scene: Object3D): Map<PropArchetypeId, ColliderSpec> {
  const result = new Map<PropArchetypeId, ColliderSpec>();
  for (const id of Object.keys(PropArchetypes) as PropArchetypeId[]) {
    const root = scene.getObjectByName(PropArchetypes[id].asset.node);
    if (!root) continue;
    const parts: ColliderSpec = root.children
      .filter((child): child is Mesh => child instanceof Mesh && child.name.startsWith("collider_"))
      .map((mesh) => {
        const attribute = mesh.geometry.getAttribute("position");
        const points = new Float32Array(attribute.count * 3);
        for (let index = 0; index < attribute.count; index += 1) {
          points[index * 3] = attribute.getX(index);
          points[index * 3 + 1] = attribute.getY(index);
          points[index * 3 + 2] = attribute.getZ(index);
        }
        return { shape: { kind: "hull" as const, points } };
      });
    if (parts.length > 0) result.set(id, parts);
  }
  return result;
}

/** Lee los fragmentos autorados y su reparto de masa. */
export function readPackChunks(scene: Object3D): Map<PropArchetypeId, PropChunkSource[]> {
  const result = new Map<PropArchetypeId, PropChunkSource[]>();
  for (const id of Object.keys(PropArchetypes) as PropArchetypeId[]) {
    const root = scene.getObjectByName(PropArchetypes[id].asset.node);
    const chunksRoot = root?.getObjectByName("chunks");
    if (!chunksRoot) continue;
    root!.updateWorldMatrix(false, true);
    const chunks: PropChunkSource[] = [];
    for (const child of chunksRoot.children) {
      const mesh = child instanceof Mesh ? child : findFirstMesh(child);
      if (!mesh) continue;
      const extras = (child.userData ?? {}) as { sector?: number[]; massFraction?: number };
      if (!Array.isArray(extras.sector) || typeof extras.massFraction !== "number") continue;

      // `meshopt` cuantiza las posiciones y deja la desnormalización en la
      // matriz del nodo: leer la geometría cruda daría coordenadas inventadas.
      // Se hornea una vez por pack y queda centrada en su propio origen, que es
      // como la necesita un cuerpo rígido.
      const geometry = mesh.geometry.clone();
      geometry.applyMatrix4(relativeMatrix(mesh, root!));
      geometry.computeBoundingBox();
      const box = geometry.boundingBox;
      if (!box) continue;
      const center = new Vector3();
      const size = new Vector3();
      box.getCenter(center);
      box.getSize(size);
      geometry.translate(-center.x, -center.y, -center.z);

      chunks.push({
        geometry,
        material: Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material,
        sector: [extras.sector[0] ?? 0, extras.sector[1] ?? 1, extras.sector[2] ?? 0],
        massFraction: extras.massFraction,
        size: [Math.max(size.x, 0.02), Math.max(size.y, 0.02), Math.max(size.z, 0.02)],
        center: [center.x, center.y, center.z],
      });
    }
    if (chunks.length > 0) result.set(id, chunks);
  }
  return result;
}

/** Matriz de `node` en el espacio de `ancestor`. */
function relativeMatrix(node: Object3D, ancestor: Object3D): Matrix4 {
  return new Matrix4()
    .copy(ancestor.matrixWorld)
    .invert()
    .multiply(node.matrixWorld);
}

function findFirstMesh(root: Object3D): Mesh | null {
  let found: Mesh | null = null;
  root.traverse((node) => {
    if (!found && node instanceof Mesh) found = node;
  });
  return found;
}

/** Deja viva sólo la variante pedida: las demás son peso muerto por instancia. */
function selectVariant(root: Object3D, variant: number, total: number): void {
  const chosen = total > 0 ? ((variant % total) + total) % total : 0;
  for (const lodRoot of root.children) {
    if (!lodRoot.name.startsWith("visual_lod")) continue;
    for (const variantNode of [...lodRoot.children]) {
      if (variantNode.name === `variant_${chosen}`) continue;
      lodRoot.remove(variantNode);
    }
  }
}

/** Arma el `THREE.LOD` a partir de `visual_lod0/1`. */
function installLod(root: Object3D): void {
  if (root.getObjectByName("runtime_visual_lods") instanceof LOD) return;
  const levels = [0, 1].map((level) =>
    root.children.find((child) => child.name === `visual_lod${level}`),
  );
  if (levels.some((level) => level === undefined)) return;

  const lod = new LOD();
  lod.name = "runtime_visual_lods";
  lod.autoUpdate = true;
  levels.forEach((level, index) => {
    if (!level) return;
    root.remove(level);
    level.visible = index === 0;
    lod.addLevel(level, index === 0 ? 0 : LOD_DISTANCE, 0.08);
  });
  // Los cascos y fragmentos no se dibujan: viven en el árbol sólo como datos.
  for (const child of [...root.children]) {
    if (child.name.startsWith("collider_") || child.name === "chunks") child.visible = false;
  }
  root.add(lod);
}

function createPropModelLoader(): PropModelLoader {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

function prepareRenderableMeshes(root: Object3D): void {
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    // El shadow map no lee alfa: un vidrio que proyectara tiraría la misma
    // sombra maciza que una chapa.
    node.castShadow = !isTransparent(node.material);
    node.receiveShadow = true;
    node.frustumCulled = true;
    if (!node.geometry.boundingSphere) node.geometry.computeBoundingSphere();
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
  });
}

function isTransparent(material: Material | readonly Material[]): boolean {
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
  collectMaterials(root).forEach((material) => material.dispose());
}

function disposeModelSource(root: Object3D): void {
  const geometries = new Set<BufferGeometry>();
  const materials = collectMaterials(root);
  const textures = new Set<Texture>();
  root.traverse((node) => {
    if (node instanceof Mesh) geometries.add(node.geometry);
  });
  materials.forEach((material) => collectMaterialTextures(material, textures));
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => texture.dispose());
}

function collectMaterials(root: Object3D): Set<Material> {
  const materials = new Set<Material>();
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const nodeMaterials = Array.isArray(node.material) ? node.material : [node.material];
    nodeMaterials.forEach((material) => materials.add(material));
  });
  return materials;
}

function collectMaterialTextures(material: Material, textures: Set<Texture>): void {
  const candidates: readonly string[] = [
    "alphaMap",
    "aoMap",
    "emissiveMap",
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

function fallbackLease(archetypeId: PropArchetypeId, error: Error): PropModelLease {
  return {
    archetypeId,
    root: null,
    source: "fallback",
    collider: null,
    chunks: [],
    error,
    dispose: (): void => undefined,
  };
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
