import { Box3, Sphere, Vector3, type Material } from "three";
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes.js";
import type { Disposable } from "@shared/types/lifecycle";
import { BLOB_FIELD_ISOLATION, BLOB_FIELD_SUBTRACT } from "./Blobulator";
import {
  BlobSurfaceDomain,
  type BlobSurfaceDomainOptions,
} from "./BlobSurfaceDomain";

export interface MetaballSurfaceOptions {
  /** Field resolution per axis (the demo-classic 32..48 range is realtime). */
  resolution: number;
  /** Triangle capacity of the preallocated buffers. */
  maxPolyCount: number;
  /** Owned by the caller; `dispose()` does not free it. */
  material: Material;
  name?: string;
  /** Domain quantization/hysteresis tuning. Stable defaults are used if omitted. */
  domain?: BlobSurfaceDomainOptions;
}

/**
 * Isosuperficie de metaballs en tiempo real sobre una única instancia de
 * `MarchingCubes` (buffers fijos, repolygoniza in-place: cero alocación por
 * frame) — a diferencia del `Blobulator` (chunks estáticos + collider, para
 * masas persistentes) y de `bakeBlobGeometry` (one-shot, aloca por llamada).
 *
 * El mesh vive en espacio local [-1,1]. El caller debe transformarlo para que
 * su centro mundial coincida con `center` (snapeado a la retícula del campo),
 * su rotación mundial sea identidad y su escala sea `domainSize / 2`.
 */
export class MetaballSurface implements Disposable {
  readonly mesh: MarchingCubes;
  /** Domain center actually used this frame (grid-snapped to avoid crawl). */
  readonly center = new Vector3();
  private readonly origin = new Vector3();
  private readonly stabilizedDomain: BlobSurfaceDomain;
  private readonly localBounds = new Box3();
  private readonly localBoundingSphere = new Sphere();
  private resolution: number;
  private requestedDomainSize = 1;
  private fieldDomainSize = 1;
  private disposed = false;

  constructor(options: MetaballSurfaceOptions) {
    this.resolution = options.resolution;
    this.stabilizedDomain = new BlobSurfaceDomain(options.domain);
    this.mesh = new MarchingCubes(
      options.resolution,
      options.material,
      false,
      false,
      options.maxPolyCount,
    );
    this.mesh.isolation = BLOB_FIELD_ISOLATION;
    // MarchingCubes fixes its boundingSphere at radius 1, but a domain corner
    // sits at sqrt(3). Correct local bounds let every camera (including portal
    // cameras) perform its own safe frustum test instead of disabling culling.
    this.updateLocalBounds();
    this.mesh.frustumCulled = true;
    // A transparent marching-cubes mesh casts its whole preallocated buffer in
    // the shadow pass on some WebGL drivers. During split this showed up as
    // giant black rectangles around the splats, so the blob receives light but
    // does not participate in the opaque shadow map.
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    if (options.name) {
      this.mesh.name = options.name;
    }
  }

  get domain(): number {
    // Compatibility: callers historically use this value (or the argument
    // passed to beginFrame) to set mesh.scale = domain / 2.
    return this.requestedDomainSize;
  }

  /** Quantized size of the actual sampling lattice. */
  get stableDomain(): number {
    return this.fieldDomainSize;
  }

  get fieldResolution(): number {
    return this.resolution;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Changes the 40/32/24 LOD in-place without replacing the public mesh. */
  setResolution(resolution: number): boolean {
    if (this.disposed || resolution === this.resolution) {
      return false;
    }
    if (!Number.isInteger(resolution) || resolution < 4) {
      throw new Error("MetaballSurface: resolution must be an integer >= 4");
    }
    this.resolution = resolution;
    this.mesh.init(resolution);
    this.mesh.isolation = BLOB_FIELD_ISOLATION;
    this.updateLocalBounds();
    return true;
  }

  /** Resets the field and re-centers the domain around `centerWorld`. */
  beginFrame(centerWorld: Vector3, domainSize: number): void {
    if (this.disposed) return;
    this.requestedDomainSize = domainSize;
    this.fieldDomainSize = this.stabilizedDomain.stabilizeSize(domainSize);
    this.center.copy(
      this.stabilizedDomain.stabilizeCenter(centerWorld, this.resolution),
    );
    this.origin.copy(this.center).subScalar(this.fieldDomainSize / 2);
    this.mesh.reset();
  }

  addBall(worldPosition: Vector3, radius: number): void {
    if (this.disposed) return;
    const normalizedRadius = radius / this.fieldDomainSize;
    this.mesh.addBall(
      (worldPosition.x - this.origin.x) / this.fieldDomainSize,
      (worldPosition.y - this.origin.y) / this.fieldDomainSize,
      (worldPosition.z - this.origin.z) / this.fieldDomainSize,
      (BLOB_FIELD_SUBTRACT + BLOB_FIELD_ISOLATION) *
        normalizedRadius *
        normalizedRadius,
      BLOB_FIELD_SUBTRACT,
    );
  }

  /** Polygonizes the accumulated field into the mesh buffers. */
  endFrame(): void {
    if (this.disposed) return;
    this.mesh.update();
    // Existing callers scale by the requested domain. Counter-scale generated
    // positions so the world-space result uses the stable sampling domain,
    // without requiring an API migration in BlobAnimator.
    const correction = this.fieldDomainSize / this.requestedDomainSize;
    if (Math.abs(correction - 1) > 1e-9) {
      const positions = this.mesh.positionArray;
      const coordinateCount = this.mesh.count * 3;
      for (let i = 0; i < coordinateCount; i++) {
        positions[i] *= correction;
      }
      this.mesh.geometry.getAttribute("position").needsUpdate = true;
    }
    // `init()` and some Three versions overwrite these bounds. Keep the
    // conservative domain cube authoritative after every polygonization.
    this.updateLocalBounds();
  }

  setVisible(visible: boolean): void {
    if (this.disposed) return;
    this.mesh.visible = visible;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh.visible = false;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
  }

  private updateLocalBounds(): void {
    const correction = this.fieldDomainSize / this.requestedDomainSize;
    this.localBounds.min.setScalar(-correction);
    this.localBounds.max.setScalar(correction);
    this.localBoundingSphere.center.set(0, 0, 0);
    this.localBoundingSphere.radius = Math.sqrt(3) * correction;
    this.mesh.geometry.boundingBox = this.localBounds;
    this.mesh.geometry.boundingSphere = this.localBoundingSphere;
  }
}
