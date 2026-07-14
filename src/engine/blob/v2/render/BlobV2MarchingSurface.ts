import {
  Box3,
  Sphere,
  Vector3,
  type Material,
} from "three";
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes.js";
import type { Disposable } from "@shared/types/lifecycle";
import {
  BLOB_FIELD_ISOLATION,
} from "@engine/blob/Blobulator";
import type {
  BlobV2RenderCellSnapshot,
  BlobV2RenderWoundSnapshot,
} from "./BlobV2RenderTypes";
import { BlobV2StableDomain } from "./BlobV2StableDomain";

export interface BlobV2MarchingSurfaceOptions {
  resolution: 32 | 24;
  maxPolyCount: number;
  /** Caller-owned and intentionally not disposed with this surface. */
  material: Material;
  name?: string;
}

export interface BlobV2SurfaceBuildInput {
  readonly cells: readonly BlobV2RenderCellSnapshot[];
  readonly wounds?: readonly BlobV2RenderWoundSnapshot[];
}

const GUARD_CELLS = 3;
const MIN_SCALE = 0.02;
const EPSILON = 1e-6;
// V2 deliberately uses a softer reciprocal field than the legacy terrain
// blobulator. A single cell keeps the same isolated radius, but neighbouring
// cells contribute across the complete 2.75r cohesion neighbourhood instead
// of reading as a pile of spheres.
const BLOB_V2_FIELD_SUBTRACT = 1;
/** Presentation-only overlap; authoritative contacts and hit corridors stay unchanged. */
export const BLOB_V2_SKIN_FIELD_SCALE = 1.25;
const BLOB_V2_SUPPORT_FACTOR = Math.sqrt(
  (BLOB_V2_FIELD_SUBTRACT + BLOB_FIELD_ISOLATION) /
    BLOB_V2_FIELD_SUBTRACT,
);
const UNIT_BOUNDS = new Box3(
  new Vector3(-1, -1, -1),
  new Vector3(1, 1, 1),
);
const UNIT_SPHERE = new Sphere(new Vector3(), Math.sqrt(3));
const WARMUP_BOUNDS = new Box3(
  new Vector3(-0.5, -0.5, -0.5),
  new Vector3(0.5, 0.5, 0.5),
);

/**
 * Fixed-resolution V2 field. It samples in world space inside a stabilized,
 * per-axis domain, so a wide low organism does not pay for a large empty cube.
 */
export class BlobV2MarchingSurface implements Disposable {
  readonly mesh: MarchingCubes;
  readonly resolution: 32 | 24;
  readonly domainCenter = new Vector3();
  readonly domainSize = new Vector3(1, 1, 1);

  private readonly domain = new BlobV2StableDomain();
  private readonly requestedBounds = new Box3();
  private readonly requestedSize = new Vector3();
  private readonly smoothedField: Float32Array;
  private readonly worldX: Float32Array;
  private readonly worldY: Float32Array;
  private readonly worldZ: Float32Array;
  private disposed = false;
  private built = false;

  constructor(options: BlobV2MarchingSurfaceOptions) {
    if (!Number.isInteger(options.maxPolyCount) || options.maxPolyCount <= 0) {
      throw new Error(
        "BlobV2MarchingSurface: maxPolyCount must be a positive integer",
      );
    }
    this.resolution = options.resolution;
    this.mesh = new MarchingCubes(
      options.resolution,
      options.material,
      false,
      false,
      options.maxPolyCount,
    );
    this.mesh.isolation = BLOB_FIELD_ISOLATION;
    this.smoothedField = new Float32Array(this.mesh.field.length);
    this.worldX = new Float32Array(options.resolution);
    this.worldY = new Float32Array(options.resolution);
    this.worldZ = new Float32Array(options.resolution);
    this.mesh.frustumCulled = true;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
    if (options.name) this.mesh.name = options.name;
    this.mesh.geometry.boundingBox = UNIT_BOUNDS.clone();
    this.mesh.geometry.boundingSphere = UNIT_SPHERE.clone();
  }

  get hasBuild(): boolean {
    return this.built;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  get scratchByteLength(): number {
    return (
      this.smoothedField.byteLength +
      this.worldX.byteLength +
      this.worldY.byteLength +
      this.worldZ.byteLength
    );
  }

  rebuild(input: BlobV2SurfaceBuildInput): boolean {
    if (this.disposed) return false;
    const activeCellCount = computeRequestedBounds(
      input.cells,
      this.resolution,
      this.requestedBounds,
      this.requestedSize,
    );
    if (activeCellCount === 0) {
      this.resetScalarField();
      this.mesh.update();
      this.mesh.visible = false;
      this.built = false;
      return false;
    }

    this.domain.stabilize(this.requestedBounds);
    this.domainCenter.copy(this.domain.center);
    this.domainSize.copy(this.domain.size);
    this.updateWorldCoordinates();

    this.resetScalarField();
    for (const cell of input.cells) this.addCell(cell);
    this.smoothFleshField();
    for (const wound of input.wounds ?? []) this.subtractWound(wound);
    this.mesh.update();
    this.built = this.mesh.count > 0;
    this.mesh.visible = this.built;
    return this.built;
  }

  setVisible(visible: boolean): void {
    if (!this.disposed) this.mesh.visible = visible && this.built;
  }

  /** Test/evidence hook: the next rebuild starts from its exact requested AABB. */
  resetStableDomain(): void {
    if (this.disposed) return;
    this.domain.reset();
  }

  /**
   * Warms the empty scan, anisotropic kernel, edge cases and a small populated
   * surface in independent jobs. Presenter schedules them cooperatively so JIT work is
   * isolated in a sub-8 ms job instead of amplifying the first 32³ rebuild.
   */
  warmupBackend(phase: "scan" | "kernel" | "edges" | "surface"): boolean {
    if (this.disposed || this.built) return false;
    this.resetScalarField();
    if (phase === "kernel" || phase === "surface") {
      this.domain.stabilize(WARMUP_BOUNDS);
      this.domainCenter.copy(this.domain.center);
      this.domainSize.copy(this.domain.size);
      this.updateWorldCoordinates();
      this.accumulateKernel(
        ORIGIN,
        phase === "surface" ? 0.24 : 0.18,
        UP,
        1.18,
        0.84,
        1,
      );
    } else if (phase === "edges") {
      const center = Math.floor(this.resolution * 0.5);
      this.mesh.setCell(
        center,
        center,
        center,
        this.mesh.isolation + 1,
      );
    }
    if (phase !== "kernel") this.mesh.update();
    this.resetScalarField();
    this.mesh.geometry.setDrawRange(0, 0);
    this.mesh.visible = false;
    this.built = false;
    if (phase === "kernel" || phase === "surface") this.domain.reset();
    this.domainCenter.set(0, 0, 0);
    this.domainSize.set(1, 1, 1);
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.built = false;
    this.mesh.visible = false;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
  }

  private addCell(cell: BlobV2RenderCellSnapshot): void {
    const scale = finiteNonNegative(cell.scale ?? 1, "cell.scale");
    const baseRadius = finitePositive(cell.radius, "cell.radius");
    if (scale <= MIN_SCALE) return;
    const radius =
      baseRadius *
      scale *
      BLOB_V2_SKIN_FIELD_SCALE;
    const contact = clamp01(cell.contactAmount ?? 0);
    const normal = normalizedOrUp(cell.contactNormal);
    const settledContact = Math.sqrt(contact);
    const tangentScale = 1 + settledContact * 0.38;
    const normalScale = 1 - settledContact * 0.34;
    this.accumulateKernel(
      cell.position,
      radius,
      normal,
      tangentScale,
      normalScale,
      1,
    );
  }

  private subtractWound(wound: BlobV2RenderWoundSnapshot): void {
    const radius = finitePositive(wound.radius, "wound.radius");
    const strength = finitePositive(wound.strength ?? 1, "wound.strength");
    this.accumulateKernel(
      wound.position,
      radius,
      UP,
      1,
      1,
      -strength * BLOB_V2_SKIN_FIELD_SCALE * BLOB_V2_SKIN_FIELD_SCALE * 1.15,
    );
  }

  private accumulateKernel(
    position: { readonly x: number; readonly y: number; readonly z: number },
    radius: number,
    normal: Vector3,
    tangentScale: number,
    normalScale: number,
    signedStrength: number,
  ): void {
    const support =
      radius * BLOB_V2_SUPPORT_FACTOR * Math.max(tangentScale, normalScale);
    const minX = fieldIndex(position.x - support, this.domain.bounds.min.x, this.domainSize.x, this.resolution);
    const maxX = fieldIndex(position.x + support, this.domain.bounds.min.x, this.domainSize.x, this.resolution) + 1;
    const minY = fieldIndex(position.y - support, this.domain.bounds.min.y, this.domainSize.y, this.resolution);
    const maxY = fieldIndex(position.y + support, this.domain.bounds.min.y, this.domainSize.y, this.resolution) + 1;
    const minZ = fieldIndex(position.z - support, this.domain.bounds.min.z, this.domainSize.z, this.resolution);
    const maxZ = fieldIndex(position.z + support, this.domain.bounds.min.z, this.domainSize.z, this.resolution) + 1;

    const strength =
      (BLOB_V2_FIELD_SUBTRACT + BLOB_FIELD_ISOLATION) * radius * radius;
    const invTangentSq = 1 / (tangentScale * tangentScale);
    const invNormalSq = 1 / (normalScale * normalScale);
    const size = this.resolution;
    const field = this.mesh.field;
    const worldX = this.worldX;
    const worldY = this.worldY;
    const worldZ = this.worldZ;

    for (let z = minZ; z < maxZ; z++) {
      const dz = worldZ[z] - position.z;
      const zOffset = size * size * z;
      for (let y = minY; y < maxY; y++) {
        const dy = worldY[y] - position.y;
        const yOffset = zOffset + size * y;
        for (let x = minX; x < maxX; x++) {
          const dx = worldX[x] - position.x;
          const alongNormal =
            dx * normal.x + dy * normal.y + dz * normal.z;
          const distanceSquared = dx * dx + dy * dy + dz * dz;
          const tangentSquared = Math.max(
            0,
            distanceSquared - alongNormal * alongNormal,
          );
          const metricSquared =
            tangentSquared * invTangentSq +
            alongNormal * alongNormal * invNormalSq;
          const contribution =
            strength / (EPSILON + metricSquared) - BLOB_V2_FIELD_SUBTRACT;
          if (contribution > 0) {
            field[yOffset + x] += contribution * signedStrength;
          }
        }
      }
    }
  }

  /**
   * One allocation-free low-pass pass blends neighbouring kernels into a
   * continuous liquid sheet. Wounds are subtracted afterwards, so their
   * geometric corridors stay sharp and aligned with the immediate mask.
   */
  private smoothFleshField(): void {
    const field = this.mesh.field;
    const target = this.smoothedField;
    const size = this.resolution;
    const size2 = size * size;
    target.fill(0);
    for (let z = 1; z < size - 1; z += 1) {
      const zOffset = z * size2;
      for (let y = 1; y < size - 1; y += 1) {
        const yOffset = zOffset + y * size;
        for (let x = 1; x < size - 1; x += 1) {
          const index = yOffset + x;
          target[index] =
            field[index] * 0.52 +
            (field[index - 1] +
              field[index + 1] +
              field[index - size] +
              field[index + size] +
              field[index - size2] +
              field[index + size2]) *
              0.08;
        }
      }
    }
    field.set(target);
  }

  /**
   * MarchingCubes.reset() clears the unused RGB palette in a JavaScript loop.
   * V2 never enables vertex colors, so native typed-array fills avoid tens of
   * thousands of redundant assignments on every 30 Hz rebuild.
   */
  private resetScalarField(): void {
    this.mesh.field.fill(0);
    this.mesh.normal_cache.fill(0);
    this.mesh.count = 0;
  }

  /** Cache the stabilized per-axis sample positions once per rebuild. */
  private updateWorldCoordinates(): void {
    const size = this.resolution;
    const min = this.domain.bounds.min;
    const stepX = this.domainSize.x / size;
    const stepY = this.domainSize.y / size;
    const stepZ = this.domainSize.z / size;
    for (let index = 0; index < size; index += 1) {
      this.worldX[index] = min.x + index * stepX;
      this.worldY[index] = min.y + index * stepY;
      this.worldZ[index] = min.z + index * stepZ;
    }
  }
}

const UP = new Vector3(0, 1, 0);
const ORIGIN = new Vector3();
const TMP_NORMAL = new Vector3();

function computeRequestedBounds(
  cells: readonly BlobV2RenderCellSnapshot[],
  resolution: number,
  bounds: Box3,
  rawSize: Vector3,
): number {
  bounds.makeEmpty();
  let activeCellCount = 0;
  for (const cell of cells) {
    const scale = finiteNonNegative(cell.scale ?? 1, "cell.scale");
    const baseRadius = finitePositive(cell.radius, "cell.radius");
    if (scale <= MIN_SCALE) continue;
    const radius =
      baseRadius *
      scale *
      BLOB_V2_SKIN_FIELD_SCALE;
    const contact = clamp01(cell.contactAmount ?? 0);
    const maximumAnisotropy = 1 + contact * 0.28;
    const support = radius * BLOB_V2_SUPPORT_FACTOR * maximumAnisotropy;
    bounds.min.x = Math.min(bounds.min.x, cell.position.x - support);
    bounds.min.y = Math.min(bounds.min.y, cell.position.y - support);
    bounds.min.z = Math.min(bounds.min.z, cell.position.z - support);
    bounds.max.x = Math.max(bounds.max.x, cell.position.x + support);
    bounds.max.y = Math.max(bounds.max.y, cell.position.y + support);
    bounds.max.z = Math.max(bounds.max.z, cell.position.z + support);
    activeCellCount += 1;
  }
  if (activeCellCount === 0) return 0;
  bounds.getSize(rawSize);
  const guardDenominator = resolution - GUARD_CELLS * 2;
  rawSize.multiplyScalar(GUARD_CELLS / guardDenominator);
  bounds.min.sub(rawSize);
  bounds.max.add(rawSize);
  return activeCellCount;
}

function normalizedOrUp(
  value: { readonly x: number; readonly y: number; readonly z: number } | undefined,
): Vector3 {
  if (!value) return UP;
  TMP_NORMAL.set(value.x, value.y, value.z);
  return TMP_NORMAL.lengthSq() > EPSILON
    ? TMP_NORMAL.normalize()
    : UP;
}

function fieldIndex(
  coordinate: number,
  minimum: number,
  domainSize: number,
  resolution: number,
): number {
  return Math.max(
    1,
    Math.min(
      resolution - 2,
      Math.floor(((coordinate - minimum) / domainSize) * resolution),
    ),
  );
}

function finitePositive(value: number, name: string): number {
  if (!Number.isFinite(value) || value < MIN_SCALE) {
    throw new Error(`BlobV2MarchingSurface: ${name} must be finite and >= ${MIN_SCALE}`);
  }
  return value;
}

function finiteNonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`BlobV2MarchingSurface: ${name} must be finite and >= 0`);
  }
  return value;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("BlobV2MarchingSurface: contactAmount must be finite");
  }
  return Math.min(1, Math.max(0, value));
}
