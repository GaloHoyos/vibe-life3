import type RAPIER from "@dimforge/rapier3d-compat";
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector3,
  type Material,
  type Scene,
} from "three";
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes.js";
import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { SurfaceType } from "@shared/types/Surface";
import type { Disposable } from "@shared/types/lifecycle";

export interface BlobulatorOptions {
  /** Chunk edge in meters. MUST be an exact multiple of `cellSize`. */
  chunkSize: number;
  /** Marching-cubes cell size in meters (world lattice, shared by all chunks). */
  cellSize: number;
  /**
   * Overlap cells around each chunk. Needs >= 2: three's MarchingCubes skips
   * the outer field layer and the normals sample one extra cell.
   */
  padCells: number;
  /** Triangle capacity of the scratch polygonizer (per chunk rebuild). */
  maxPolyCount: number;
  /** Collider ids are `${colliderIdPrefix}-${chunkKey}`. */
  colliderIdPrefix: string;
  /** Physics surface tagged on chunk colliders (footsteps/impacts). */
  surface?: SurfaceType;
  /** Dirty-chunk rebuilds processed per `update()` call. */
  maxChunkRebuildsPerFrame: number;
}

interface BlobEntry {
  position: Vector3;
  radius: number;
}

interface ChunkEntry {
  mesh: Mesh<BufferGeometry, Material>;
  body: RAPIER.RigidBody;
}

// Reciprocal metaball field (see MarchingCubes.addBall):
//   val = strength / d² − SUBTRACT, surface at val = ISOLATION.
// SUBTRACT controls blend softness; ISOLATION > 0 is mandatory (at exactly 0,
// the polygonizer classifies empty cells as "inside" and floods the domain).
// Exported so one-shot bakes (`bakeBlobGeometry`) share the same field shape.
// Un soporte más ancho evita picos de densidad al cubrir las ~192 partículas
// del organismo. Con 12 el campo caía demasiado rápido y cada pequeño grupo
// interno producía una aguja; 4 conserva el mismo radio aislado pero mezcla la
// contribución con vecinos antes de polygonizar, como un gel continuo.
export const BLOB_FIELD_SUBTRACT = 4;
export const BLOB_FIELD_ISOLATION = 4;
/** Field support extends past the surface radius by this factor. */
export const BLOB_SUPPORT_FACTOR = Math.sqrt(
  (BLOB_FIELD_SUBTRACT + BLOB_FIELD_ISOLATION) / BLOB_FIELD_SUBTRACT,
);

const SUBTRACT = BLOB_FIELD_SUBTRACT;
const ISOLATION = BLOB_FIELD_ISOLATION;
const SUPPORT_FACTOR = BLOB_SUPPORT_FACTOR;
/** Weld grid (meters). Vertices come from a shared lattice, so 1 mm is safe. */
const WELD = 1000;

const TMP_MIN = new Vector3();
const TMP_MAX = new Vector3();

/**
 * Blobulator: isosurface de metaballs estilo Source (marching cubes) sobre un
 * campo GLOBAL de blobs, particionado en chunks alineados a una grilla mundial.
 * Cada chunk dirty se re-polygoniza con un scratch `MarchingCubes` compartido y
 * se hornea a un mesh estático + trimesh de Rapier. Los chunks vecinos muestrean
 * la misma retícula y los mismos blobs, así que la superficie es continua a
 * través de bordes (los triángulos se asignan por centroide, sin duplicados).
 */
export class Blobulator implements Disposable {
  private readonly root = new Group();
  private readonly blobs = new Map<number, BlobEntry>();
  private readonly chunks = new Map<string, ChunkEntry>();
  private readonly dirty = new Set<string>();
  private readonly scratch: MarchingCubes;
  private readonly scratchMaterial = new MeshBasicMaterial();
  private readonly cellsPerChunk: number;
  private readonly resolution: number;
  private readonly domainSize: number;
  private nextBlobId = 1;

  constructor(
    private readonly scene: Scene,
    private readonly physics: PhysicsWorld,
    private readonly material: Material,
    private readonly options: BlobulatorOptions,
  ) {
    this.cellsPerChunk = Math.round(options.chunkSize / options.cellSize);
    if (
      Math.abs(this.cellsPerChunk * options.cellSize - options.chunkSize) >
      1e-6
    ) {
      throw new Error(
        "Blobulator: chunkSize debe ser múltiplo exacto de cellSize (la retícula mundial debe alinear entre chunks).",
      );
    }
    this.resolution = this.cellsPerChunk + options.padCells * 2;
    this.domainSize = this.resolution * options.cellSize;
    this.scratch = new MarchingCubes(
      this.resolution,
      this.scratchMaterial,
      false,
      false,
      options.maxPolyCount,
    );
    this.scratch.isolation = ISOLATION;
    this.root.name = `blobulator-${options.colliderIdPrefix}`;
    this.scene.add(this.root);
  }

  addBlob(position: Vector3, radius: number): number {
    const id = this.nextBlobId++;
    this.blobs.set(id, { position: position.clone(), radius });
    this.markDirtyAround(position, radius);
    return id;
  }

  setBlobRadius(id: number, radius: number): void {
    const blob = this.blobs.get(id);
    if (!blob) {
      return;
    }
    const previous = Math.max(blob.radius, radius);
    blob.radius = radius;
    this.markDirtyAround(blob.position, previous);
  }

  removeBlob(id: number): void {
    const blob = this.blobs.get(id);
    if (!blob) {
      return;
    }
    this.blobs.delete(id);
    this.markDirtyAround(blob.position, blob.radius);
  }

  getBlobCount(): number {
    return this.blobs.size;
  }

  getBlobRadius(id: number): number | undefined {
    return this.blobs.get(id)?.radius;
  }

  getChunkCount(): number {
    return this.chunks.size;
  }

  forEachBlobInSphere(
    center: Vector3,
    radius: number,
    callback: (id: number, position: Vector3, blobRadius: number) => void,
  ): void {
    for (const [id, blob] of this.blobs) {
      const reach = radius + blob.radius;
      if (blob.position.distanceToSquared(center) <= reach * reach) {
        callback(id, blob.position, blob.radius);
      }
    }
  }

  /**
   * `SceneManager.clearLevel` desparenta el root en cada carga de nivel (el
   * Blobulator vive en un servicio que se construye una sola vez); re-parentar
   * es idempotente — mismo patrón que `NpcAiDebugOverlay`.
   */
  private ensureAttached(): void {
    if (this.root.parent !== this.scene) {
      this.scene.add(this.root);
    }
  }

  /** Rebuild throttled de chunks dirty. Llamar una vez por frame. */
  update(): void {
    this.ensureAttached();
    let budget = this.options.maxChunkRebuildsPerFrame;
    for (const key of this.dirty) {
      this.dirty.delete(key);
      this.rebuildChunk(key);
      budget -= 1;
      if (budget <= 0) {
        break;
      }
    }
  }

  /** Rebuild inmediato de todo lo pendiente (tests / teardown determinista). */
  flush(): void {
    this.ensureAttached();
    for (const key of this.dirty) {
      this.rebuildChunk(key);
    }
    this.dirty.clear();
  }

  clear(): void {
    this.blobs.clear();
    this.dirty.clear();
    for (const key of [...this.chunks.keys()]) {
      this.removeChunk(key);
    }
  }

  dispose(): void {
    this.clear();
    this.root.removeFromParent();
    this.scratch.geometry.dispose();
    this.scratchMaterial.dispose();
  }

  private markDirtyAround(position: Vector3, radius: number): void {
    const support = radius * SUPPORT_FACTOR + this.options.cellSize;
    const size = this.options.chunkSize;
    const minX = Math.floor((position.x - support) / size);
    const maxX = Math.floor((position.x + support) / size);
    const minY = Math.floor((position.y - support) / size);
    const maxY = Math.floor((position.y + support) / size);
    const minZ = Math.floor((position.z - support) / size);
    const maxZ = Math.floor((position.z + support) / size);
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          this.dirty.add(`${x},${y},${z}`);
        }
      }
    }
  }

  private rebuildChunk(key: string): void {
    const [cx, cy, cz] = key.split(",").map(Number);
    const size = this.options.chunkSize;
    const pad = this.options.padCells * this.options.cellSize;
    TMP_MIN.set(cx * size, cy * size, cz * size);
    TMP_MAX.copy(TMP_MIN).addScalar(size);
    const originX = TMP_MIN.x - pad;
    const originY = TMP_MIN.y - pad;
    const originZ = TMP_MIN.z - pad;

    const scratch = this.scratch;
    scratch.reset();
    let any = false;
    for (const blob of this.blobs.values()) {
      const support = blob.radius * SUPPORT_FACTOR;
      if (
        blob.position.x + support < originX ||
        blob.position.x - support > originX + this.domainSize ||
        blob.position.y + support < originY ||
        blob.position.y - support > originY + this.domainSize ||
        blob.position.z + support < originZ ||
        blob.position.z - support > originZ + this.domainSize
      ) {
        continue;
      }
      any = true;
      const normalizedRadius = blob.radius / this.domainSize;
      scratch.addBall(
        (blob.position.x - originX) / this.domainSize,
        (blob.position.y - originY) / this.domainSize,
        (blob.position.z - originZ) / this.domainSize,
        (SUBTRACT + ISOLATION) * normalizedRadius * normalizedRadius,
        SUBTRACT,
      );
    }
    if (!any) {
      this.removeChunk(key);
      return;
    }
    scratch.update();

    // Bake: normalized [-1,1] → mundo, y quedarse solo con los triángulos cuyo
    // centroide cae en el box del chunk (half-open): el vecino genera geometría
    // idéntica en el solape, así el dueño de cada triángulo es único y sin cracks.
    const half = this.domainSize / 2;
    const vertexCount = Math.min(
      scratch.count,
      this.options.maxPolyCount * 3,
    );
    const src = scratch.positionArray;
    const srcNormals = scratch.normalArray;
    const weldIndex = new Map<string, number>();
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const world = new Float32Array(9);

    for (let v = 0; v + 2 < vertexCount; v += 3) {
      let cxSum = 0;
      let cySum = 0;
      let czSum = 0;
      for (let k = 0; k < 3; k++) {
        const o = (v + k) * 3;
        const wx = originX + (src[o] + 1) * half;
        const wy = originY + (src[o + 1] + 1) * half;
        const wz = originZ + (src[o + 2] + 1) * half;
        world[k * 3] = wx;
        world[k * 3 + 1] = wy;
        world[k * 3 + 2] = wz;
        cxSum += wx;
        cySum += wy;
        czSum += wz;
      }
      if (
        cxSum < TMP_MIN.x * 3 ||
        cxSum >= TMP_MAX.x * 3 ||
        cySum < TMP_MIN.y * 3 ||
        cySum >= TMP_MAX.y * 3 ||
        czSum < TMP_MIN.z * 3 ||
        czSum >= TMP_MAX.z * 3
      ) {
        continue;
      }
      const tri: number[] = [];
      for (let k = 0; k < 3; k++) {
        const wx = world[k * 3];
        const wy = world[k * 3 + 1];
        const wz = world[k * 3 + 2];
        const weldKey = `${Math.round(wx * WELD)},${Math.round(wy * WELD)},${Math.round(wz * WELD)}`;
        let index = weldIndex.get(weldKey);
        if (index === undefined) {
          index = positions.length / 3;
          weldIndex.set(weldKey, index);
          positions.push(wx, wy, wz);
          const o = (v + k) * 3;
          // MarchingCubes emits raw field gradients; PBR shading needs unit
          // normals and a zero gradient would become NaN in the shader.
          const nx = srcNormals[o];
          const ny = srcNormals[o + 1];
          const nz = srcNormals[o + 2];
          const length = Math.hypot(nx, ny, nz);
          if (length > 1e-6) {
            normals.push(nx / length, ny / length, nz / length);
          } else {
            normals.push(0, 1, 0);
          }
        }
        tri.push(index);
      }
      if (tri[0] !== tri[1] && tri[1] !== tri[2] && tri[2] !== tri[0]) {
        indices.push(tri[0], tri[1], tri[2]);
      }
    }

    this.removeChunk(key);
    if (indices.length === 0) {
      return;
    }

    const geometry = new BufferGeometry();
    const positionArray = new Float32Array(positions);
    geometry.setAttribute("position", new BufferAttribute(positionArray, 3));
    geometry.setAttribute(
      "normal",
      new BufferAttribute(new Float32Array(normals), 3),
    );
    const indexArray = new Uint32Array(indices);
    geometry.setIndex(new BufferAttribute(indexArray, 1));
    geometry.computeBoundingSphere();

    const mesh = new Mesh(geometry, this.material);
    mesh.name = `${this.options.colliderIdPrefix}-${key}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);

    const body = this.physics.createStaticTrimesh({
      id: `${this.options.colliderIdPrefix}-${key}`,
      vertices: positionArray,
      indices: indexArray,
      metadata: this.options.surface ? { surface: this.options.surface } : {},
    });
    this.chunks.set(key, { mesh, body });
  }

  private removeChunk(key: string): void {
    const chunk = this.chunks.get(key);
    if (!chunk) {
      return;
    }
    this.chunks.delete(key);
    if (chunk.body.isValid()) {
      this.physics.removeBody(chunk.body);
    }
    chunk.mesh.removeFromParent();
    chunk.mesh.geometry.dispose();
  }
}
