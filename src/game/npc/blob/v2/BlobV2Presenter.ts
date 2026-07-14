import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Object3D,
} from "three";
import {
  blobSurfaceScheduler,
  type BlobSurfaceRebuildRequest,
  type BlobSurfaceRequestId,
} from "@engine/blob/BlobSurfaceScheduler";
import {
  BLOB_V2_MAX_VISIBLE_WOUNDS,
  BLOB_V2_SKIN_COLOR,
  blobV2WoundMaskRadius,
  createBlobV2CoreMaterial,
  createBlobV2SkinMaterial,
  createBlobV2ShedDropletMaterial,
  createBlobV2TendonMaterial,
  setBlobV2CoreGlow,
  setBlobV2IslandVisual,
  setBlobV2WoundMasks,
  type BlobV2SkinUniforms,
} from "@engine/blob/v2/render/BlobV2Material";
import { BlobV2MarchingSurface } from "@engine/blob/v2/render/BlobV2MarchingSurface";
import { BlobV2SurfaceCadence } from "@engine/blob/v2/render/BlobV2SurfaceCadence";
import type { BlobV2Telemetry } from "@engine/blob/v2/BlobV2Telemetry";
import type {
  BlobV2IslandId,
  BlobV2FragmentVisualState,
  BlobV2OrganismRenderSnapshot,
  BlobV2RenderCellSnapshot,
  BlobV2RenderIslandSnapshot,
  BlobV2RenderView,
  BlobV2RenderWoundSnapshot,
} from "@engine/blob/v2/render/BlobV2RenderTypes";
import {
  blobV2WorldInverse,
  blobV2WorldToLocalMatrix,
  setBlobV2WorldTransform,
} from "@engine/blob/v2/render/BlobV2WorldTransform";

const MAIN_RESOLUTION = 32;
const FRAGMENT_RESOLUTION = 24;
const MAX_FRAGMENT_SURFACES = 6;
const DEFAULT_FALLBACK_CAPACITY = 512;
// The 32/24 grids top out far below the legacy capacities for this scalar
// field (benchmark peaks are ~5.6k/~1.7k triangles). Keeping >2x headroom
// avoids truncation while staying inside the fully-split GPU memory budget.
const DEFAULT_MAIN_POLY_COUNT = 12_000;
const DEFAULT_FRAGMENT_POLY_COUNT = 4_000;
const UP = new Vector3(0, 1, 0);
const SIDE = new Vector3(1, 0, 0);
const IDENTITY_QUATERNION = new Quaternion();
const TMP_CONTACT_NORMAL = new Vector3();
const TENDONS_PER_WOUND = 3;
const MAX_TENDONS = BLOB_V2_MAX_VISIBLE_WOUNDS * TENDONS_PER_WOUND;
const MAX_SHED_DROPLETS = 64;
const SHED_SKIN_COLOR = new Color(BLOB_V2_SKIN_COLOR);
const SHED_WITHER_COLOR = new Color(0x66706b);

export interface BlobV2SurfaceSchedulerPort {
  request(request: BlobSurfaceRebuildRequest): void;
  cancel(id: BlobSurfaceRequestId): void;
}

export interface BlobV2PresenterOptions {
  ownerId: string;
  scheduler?: BlobV2SurfaceSchedulerPort;
  maxFallbackCells?: number;
  maxMainPolyCount?: number;
  maxFragmentPolyCount?: number;
  cadence?: BlobV2SurfaceCadence;
  telemetry?: BlobV2Telemetry;
  /** Tests/specialized preloaders may opt out; production defaults to true. */
  warmupBackend?: boolean;
}

export interface BlobV2PresenterSurfaceInfo {
  readonly id: BlobV2IslandId;
  readonly generation: number;
  readonly resolution: 32 | 24;
  readonly hasBuild: boolean;
  readonly pending: boolean;
  readonly completedRevision: number;
  readonly domainCenter: readonly [number, number, number];
  readonly domainSize: readonly [number, number, number];
  readonly drawCount: number;
  readonly geometryFingerprint: string;
  readonly latestIslandCenter: readonly [number, number, number];
  readonly builtIslandCenter: readonly [number, number, number];
  readonly meshPosition: readonly [number, number, number];
  readonly meshScale: readonly [number, number, number];
  readonly mesh: Object3D;
}

interface CapturedIsland {
  readonly id: BlobV2IslandId;
  readonly generation: number;
  readonly revision: number;
  readonly cells: readonly BlobV2RenderCellSnapshot[];
  readonly wounds: readonly BlobV2RenderWoundSnapshot[];
  readonly center: Vector3;
  readonly scheduledAt: number;
  readonly queuedAtMs: number;
}

interface SurfaceState {
  readonly id: BlobV2IslandId;
  readonly generation: number;
  readonly resolution: 32 | 24;
  readonly schedulerId: symbol;
  readonly surface: BlobV2MarchingSurface;
  readonly latestIslandCenter: Vector3;
  readonly builtIslandCenter: Vector3;
  readonly flowDirection: Vector3;
  wounds: readonly BlobV2RenderWoundSnapshot[];
  fragmentState: BlobV2FragmentVisualState | undefined;
  witherProgress: number;
  warmupStage: 0 | 1 | 2 | 3 | 4;
  pending: boolean;
  completedRevision: number;
  lastCompletedAt: number;
}

/**
 * Presentation-only consumer for Blob V2 snapshots. Simulation, hitboxes,
 * audio, damage and topology ownership deliberately live elsewhere.
 */
export class BlobV2Presenter {
  readonly group = new Group();

  private readonly ownerId: string;
  private readonly scheduler: BlobV2SurfaceSchedulerPort;
  private readonly cadence: BlobV2SurfaceCadence;
  private readonly telemetry?: BlobV2Telemetry;
  private readonly warmupBackend: boolean;
  private readonly maxFallbackCells: number;
  private readonly maxMainPolyCount: number;
  private readonly maxFragmentPolyCount: number;
  private readonly skinMaterial;
  private readonly skinUniforms: BlobV2SkinUniforms;
  private readonly fallback: InstancedMesh;
  private readonly tendons: InstancedMesh;
  private readonly shedDroplets: InstancedMesh;
  private readonly core: Mesh;
  private readonly surfaces = new Map<BlobV2IslandId, SurfaceState>();
  private readonly fallbackMatrix = new Matrix4();
  private readonly fallbackWorldInverse = new Matrix4();
  private readonly fallbackPosition = new Vector3();
  private readonly fallbackScale = new Vector3();
  private readonly fallbackQuaternion = new Quaternion();
  private readonly tendonMatrix = new Matrix4();
  private readonly tendonWorldInverse = new Matrix4();
  private readonly tendonPosition = new Vector3();
  private readonly tendonScale = new Vector3();
  private readonly tendonQuaternion = new Quaternion();
  private readonly tendonNormal = new Vector3();
  private readonly tendonDirection = new Vector3();
  private readonly tendonTangentA = new Vector3();
  private readonly tendonTangentB = new Vector3();
  private readonly shedMatrix = new Matrix4();
  private readonly shedWorldInverse = new Matrix4();
  private readonly shedPosition = new Vector3();
  private readonly shedScale = new Vector3();
  private readonly shedQuaternion = new Quaternion();
  private readonly shedDirection = new Vector3();
  private readonly shedColor = new Color();
  private readonly placementCenter = new Vector3();
  private readonly placementScale = new Vector3();
  private fallbackWounds: readonly BlobV2RenderWoundSnapshot[] = [];
  private frozen = false;
  private disposed = false;

  constructor(root: Object3D, options: BlobV2PresenterOptions) {
    if (!options.ownerId) {
      throw new Error("BlobV2Presenter: ownerId cannot be empty");
    }
    this.ownerId = options.ownerId;
    this.scheduler = options.scheduler ?? blobSurfaceScheduler;
    this.cadence = options.cadence ?? new BlobV2SurfaceCadence();
    this.telemetry = options.telemetry;
    this.warmupBackend = options.warmupBackend !== false;
    this.maxFallbackCells = positiveInteger(
      options.maxFallbackCells ?? DEFAULT_FALLBACK_CAPACITY,
      "maxFallbackCells",
    );
    this.maxMainPolyCount = positiveInteger(
      options.maxMainPolyCount ?? DEFAULT_MAIN_POLY_COUNT,
      "maxMainPolyCount",
    );
    this.maxFragmentPolyCount = positiveInteger(
      options.maxFragmentPolyCount ?? DEFAULT_FRAGMENT_POLY_COUNT,
      "maxFragmentPolyCount",
    );

    this.group.name = `blob-v2-presenter-${options.ownerId}`;
    root.add(this.group);

    const skin = createBlobV2SkinMaterial();
    this.skinMaterial = skin.material;
    this.skinUniforms = skin.uniforms;

    this.fallback = new InstancedMesh(
      new SphereGeometry(1, 10, 8),
      this.skinMaterial,
      this.maxFallbackCells,
    );
    this.fallback.name = `blob-v2-fallback-${options.ownerId}`;
    this.fallback.count = 0;
    this.fallback.visible = false;
    this.fallback.castShadow = false;
    this.fallback.receiveShadow = true;
    this.fallback.frustumCulled = true;
    this.fallback.onBeforeRender = () => {
      setBlobV2IslandVisual(this.skinUniforms, undefined, undefined, 0);
      setBlobV2WoundMasks(this.skinUniforms, this.fallbackWounds);
    };
    this.group.add(this.fallback);

    this.tendons = new InstancedMesh(
      new CylinderGeometry(1, 1, 1, 6, 1, false),
      createBlobV2TendonMaterial(),
      MAX_TENDONS,
    );
    this.tendons.name = `blob-v2-wound-tendons-${options.ownerId}`;
    this.tendons.count = 0;
    this.tendons.visible = false;
    this.tendons.castShadow = false;
    this.tendons.receiveShadow = true;
    this.tendons.frustumCulled = true;
    this.tendons.renderOrder = 1;
    this.group.add(this.tendons);

    this.shedDroplets = new InstancedMesh(
      new SphereGeometry(1, 8, 6),
      createBlobV2ShedDropletMaterial(),
      MAX_SHED_DROPLETS,
    );
    this.shedDroplets.name = `blob-v2-shed-droplets-${options.ownerId}`;
    this.shedDroplets.count = 0;
    this.shedDroplets.visible = false;
    this.shedDroplets.castShadow = false;
    this.shedDroplets.receiveShadow = true;
    this.shedDroplets.frustumCulled = true;
    this.shedDroplets.renderOrder = 2;
    this.group.add(this.shedDroplets);

    this.core = new Mesh(
      new SphereGeometry(1, 18, 12),
      createBlobV2CoreMaterial(),
    );
    this.core.name = `blob-v2-core-${options.ownerId}`;
    this.core.renderOrder = 1;
    this.core.castShadow = false;
    this.core.receiveShadow = true;
    this.core.frustumCulled = true;
    this.group.add(this.core);
    this.updateTelemetryResources();
  }

  get isFrozen(): boolean {
    return this.frozen;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  get activeSurfaceCount(): number {
    return this.surfaces.size;
  }

  get fallbackCellCount(): number {
    return this.fallback.count;
  }

  get visibleTendonCount(): number {
    return this.tendons.count;
  }

  get visibleShedDropletCount(): number {
    return this.shedDroplets.count;
  }

  /**
   * Makes a frozen debug capture independent of whichever intermediate LOD
   * jobs happened to finish during browser startup. Production never calls
   * this; stable-domain hysteresis remains active throughout normal play.
   */
  resetStableDomainsForEvidence(): void {
    if (this.disposed || this.frozen) return;
    for (const state of this.surfaces.values()) {
      this.scheduler.cancel(state.schedulerId);
      state.pending = false;
      state.surface.resetStableDomain();
      state.completedRevision = -1;
      state.lastCompletedAt = Number.NEGATIVE_INFINITY;
    }
  }

  update(
    snapshot: BlobV2OrganismRenderSnapshot,
    view: BlobV2RenderView,
  ): void {
    if (this.disposed || this.frozen) return;
    const presentationStartedAt = performance.now();
    try {
      validateView(view);
      validateSnapshot(snapshot);

    const visibleInAnyView =
      view.mainViewVisible !== false || view.portalViewVisible === true;
    this.group.visible = visibleInAnyView;
    setBlobV2CoreGlow(
      this.skinUniforms,
      snapshot.core.position,
      snapshot.core.exposure ?? 0,
      view.now,
    );
    this.updateCore(snapshot);

    const selected = selectSurfaceIslands(snapshot, this.surfaces);
    this.reconcileSurfaceStates(selected);

    for (const island of selected) {
      const state = this.surfaces.get(island.id);
      if (!state) continue;
      computeIslandCenter(island.cells, state.latestIslandCenter);
      state.fragmentState = island.fragmentState;
      state.wounds = island.wounds ?? [];
      state.flowDirection.set(
        island.flowDirection?.x ?? 0,
        island.flowDirection?.y ?? 0,
        island.flowDirection?.z ?? 0,
      );
      state.witherProgress = clamp01(island.witherProgress ?? 0);
      this.placeSurface(state);

      // Snapshot sequence advances with simulation. It must not bypass the
      // 30/12/4 Hz render cadence; only explicit topology/wound revisions do.
      const revision = island.geometryRevision ?? 0;
      const revisionChanged = revision !== state.completedRevision;
      const cadenceDue = this.cadence.isDue(
        view.now,
        state.lastCompletedAt,
        view.viewerDistance,
      );
      if (
        (visibleInAnyView || view.forceWake === true) &&
        (view.forceWake === true || revisionChanged || cadenceDue)
      ) {
        this.scheduleRebuild(
          state,
          captureIsland(island, revision, view.now),
          view.viewerDistance,
        );
      }
    }

      this.updateFallback(snapshot);
      this.updateTendons(snapshot);
      this.updateShedDroplets(snapshot);
    } finally {
      this.telemetry?.recordPresentation(
        Math.max(0, performance.now() - presentationStartedAt),
      );
      this.updateTelemetryResources();
    }
  }

  getSurfaceInfo(id: BlobV2IslandId): BlobV2PresenterSurfaceInfo | null {
    const state = this.surfaces.get(id);
    if (!state) return null;
    return {
      id: state.id,
      generation: state.generation,
      resolution: state.resolution,
      hasBuild: state.surface.hasBuild,
      pending: state.pending,
      completedRevision: state.completedRevision,
      domainCenter: state.surface.domainCenter.toArray(),
      domainSize: state.surface.domainSize.toArray(),
      drawCount: state.surface.mesh.geometry.drawRange.count,
      geometryFingerprint: geometryFingerprint(state.surface.mesh),
      latestIslandCenter: state.latestIslandCenter.toArray(),
      builtIslandCenter: state.builtIslandCenter.toArray(),
      meshPosition: state.surface.mesh.position.toArray(),
      meshScale: state.surface.mesh.scale.toArray(),
      mesh: state.surface.mesh,
    };
  }

  /**
   * Stops all jobs and leaves a fully local Three hierarchy for the ice/statue
   * owner. Freezing does not dispose render resources.
   */
  freeze(): Group {
    if (this.disposed || this.frozen) return this.group;
    this.frozen = true;
    for (const state of this.surfaces.values()) {
      this.scheduler.cancel(state.schedulerId);
      state.pending = false;
    }
    this.updateTelemetryResources();
    this.group.updateWorldMatrix(true, true);
    return this.group;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const state of this.surfaces.values()) {
      this.scheduler.cancel(state.schedulerId);
      state.surface.dispose();
    }
    this.surfaces.clear();

    // InstancedMesh owns instanceMatrix outside its BufferGeometry. Three's
    // renderer releases that GPU buffer only when the object itself emits its
    // dispose event; disposing the sphere geometry alone is insufficient.
    this.fallback.dispose();
    disposeGeometry(this.fallback.geometry);
    this.tendons.dispose();
    disposeGeometry(this.tendons.geometry);
    if (Array.isArray(this.tendons.material)) {
      for (const material of this.tendons.material) material.dispose();
    } else {
      this.tendons.material.dispose();
    }
    this.shedDroplets.dispose();
    disposeGeometry(this.shedDroplets.geometry);
    if (Array.isArray(this.shedDroplets.material)) {
      for (const material of this.shedDroplets.material) material.dispose();
    } else {
      this.shedDroplets.material.dispose();
    }
    disposeGeometry(this.core.geometry);
    if (Array.isArray(this.core.material)) {
      for (const material of this.core.material) material.dispose();
    } else {
      this.core.material.dispose();
    }
    this.skinMaterial.dispose();
    this.group.removeFromParent();
    this.telemetry?.setVisualResources(0, 0, 0, 0);
  }

  private updateCore(snapshot: BlobV2OrganismRenderSnapshot): void {
    this.core.visible = snapshot.core.visible !== false && snapshot.core.radius > 0;
    if (!this.core.visible) return;
    this.placementCenter.set(
      snapshot.core.position.x,
      snapshot.core.position.y,
      snapshot.core.position.z,
    );
    this.placementScale.setScalar(snapshot.core.radius);
    setBlobV2WorldTransform(
      this.core,
      this.placementCenter,
      IDENTITY_QUATERNION,
      this.placementScale,
    );
  }

  private reconcileSurfaceStates(
    selected: readonly BlobV2RenderIslandSnapshot[],
  ): void {
    const wanted = new Map(selected.map((island) => [island.id, island]));
    for (const [id, state] of this.surfaces) {
      const island = wanted.get(id);
      const resolution = island
        ? resolutionForIsland(island)
        : state.resolution;
      if (
        !island ||
        island.generation !== state.generation ||
        resolution !== state.resolution
      ) {
        this.destroySurfaceState(state);
        this.surfaces.delete(id);
      }
    }

    for (const island of selected) {
      if (this.surfaces.has(island.id)) continue;
      const resolution = resolutionForIsland(island);
      const surface = new BlobV2MarchingSurface({
        resolution,
        maxPolyCount:
          resolution === MAIN_RESOLUTION
            ? this.maxMainPolyCount
            : this.maxFragmentPolyCount,
        material: this.skinMaterial,
        name: surfaceName(this.ownerId, island.id, island.generation),
      });
      surface.mesh.renderOrder = 2;
      surface.mesh.matrixAutoUpdate = true;
      this.group.add(surface.mesh);
      const state: SurfaceState = {
        id: island.id,
        generation: island.generation,
        resolution,
        schedulerId: Symbol(
          `${this.ownerId}:blob-v2:${String(island.id)}:${island.generation}`,
        ),
        surface,
        latestIslandCenter: new Vector3(),
        builtIslandCenter: new Vector3(),
        flowDirection: new Vector3(),
        wounds: island.wounds ?? [],
        fragmentState: island.fragmentState,
        witherProgress: clamp01(island.witherProgress ?? 0),
        // MarchingCubes defines hot polygonization closures per instance, so
        // every surface receives the cheap staged warm-up before its first
        // real build. They share the normal scheduler budget and request ID.
        warmupStage: this.warmupBackend ? 0 : 4,
        pending: false,
        completedRevision: -1,
        lastCompletedAt: -Infinity,
      };
      surface.mesh.onBeforeRender = () => {
        setBlobV2IslandVisual(
          this.skinUniforms,
          state.fragmentState,
          state.flowDirection,
          state.witherProgress,
        );
        setBlobV2WoundMasks(this.skinUniforms, state.wounds);
      };
      this.surfaces.set(island.id, state);
    }
  }

  private scheduleRebuild(
    state: SurfaceState,
    captured: CapturedIsland,
    viewerDistance: number,
  ): void {
    state.pending = true;
    const expectedState = state;
    let jobStartedAt = captured.queuedAtMs;
    this.scheduler.request({
      id: state.schedulerId,
      resolution: state.resolution,
      priority:
        state.resolution === MAIN_RESOLUTION
          ? viewerDistance
          : viewerDistance + 10,
      rebuild: () => {
        jobStartedAt = performance.now();
        if (
          this.disposed ||
          this.frozen ||
          this.surfaces.get(captured.id) !== expectedState ||
          expectedState.generation !== captured.generation
        ) {
          return;
        }
        const warmupStage = expectedState.warmupStage;
        // The populated warm-up is useful for the 32 grid's first large
        // buffer write. On 24 it costs more than the real fragment surface,
        // so the edge phase is the final cooperative warm-up there.
        const completedWarmupStage = expectedState.resolution === 32 ? 4 : 3;
        if (warmupStage < completedWarmupStage) {
          if (expectedState.surface.warmupBackend(
            warmupStage === 0
              ? "scan"
              : warmupStage === 1
                ? "kernel"
                : warmupStage === 2
                  ? "edges"
                  : "surface",
          )) {
            expectedState.warmupStage =
              warmupStage === 0
                ? 1
                : warmupStage === 1
                  ? 2
                  : warmupStage === 2
                    ? 3
                    : 4;
            this.scheduleRebuild(expectedState, captured, viewerDistance);
          }
          return;
        }
        expectedState.surface.rebuild(captured);
        expectedState.builtIslandCenter.copy(captured.center);
        expectedState.completedRevision = captured.revision;
        expectedState.lastCompletedAt = captured.scheduledAt;
        expectedState.pending = false;
        this.placeSurface(expectedState);
      },
      onComplete: (durationMs) => {
        this.telemetry?.recordMeshing(
          durationMs,
          Math.max(0, jobStartedAt - captured.queuedAtMs),
        );
        this.updateTelemetryResources();
      },
    });
  }

  private placeSurface(state: SurfaceState): void {
    if (!state.surface.hasBuild) return;
    this.placementCenter
      .copy(state.surface.domainCenter)
      .add(state.latestIslandCenter)
      .sub(state.builtIslandCenter);
    this.placementScale.copy(state.surface.domainSize).multiplyScalar(0.5);
    setBlobV2WorldTransform(
      state.surface.mesh,
      this.placementCenter,
      IDENTITY_QUATERNION,
      this.placementScale,
    );
  }

  private updateFallback(snapshot: BlobV2OrganismRenderSnapshot): void {
    let instance = 0;
    const mainIsland = snapshot.islands.find(
      (island) => island.id === snapshot.mainIslandId,
    );
    this.fallbackWounds = mainIsland?.wounds ?? [];
    // Keep the uniforms current even before Three invokes onBeforeRender. The
    // callback reapplies them because every surface shares this material.
    setBlobV2WoundMasks(this.skinUniforms, this.fallbackWounds);
    blobV2WorldInverse(this.fallback, this.fallbackWorldInverse);
    for (const island of snapshot.islands) {
      const state = this.surfaces.get(island.id);
      if (
        state &&
        state.generation === island.generation &&
        state.surface.hasBuild
      ) {
        continue;
      }
      for (const cell of island.cells) {
        if (instance >= this.maxFallbackCells) break;
        const scale = Math.max(0, cell.scale ?? 1);
        if (scale <= 0.02 || cell.radius <= 0) continue;
        this.fallbackPosition.set(
          cell.position.x,
          cell.position.y,
          cell.position.z,
        );
        const contact = clamp01(cell.contactAmount ?? 0);
        setContactQuaternion(this.fallbackQuaternion, cell.contactNormal);
        this.fallbackScale.set(
          cell.radius * scale * (1 + contact * 0.28),
          cell.radius * scale * (1 - contact * 0.22),
          cell.radius * scale * (1 + contact * 0.28),
        );
        blobV2WorldToLocalMatrix(
          this.fallbackWorldInverse,
          this.fallbackPosition,
          this.fallbackQuaternion,
          this.fallbackScale,
          this.fallbackMatrix,
        );
        this.fallback.setMatrixAt(instance++, this.fallbackMatrix);
      }
      if (instance >= this.maxFallbackCells) break;
    }
    this.fallback.count = instance;
    this.fallback.visible = instance > 0;
    if (instance > 0) {
      this.fallback.instanceMatrix.needsUpdate = true;
      this.fallback.computeBoundingBox();
      this.fallback.computeBoundingSphere();
    }
  }

  private updateTendons(snapshot: BlobV2OrganismRenderSnapshot): void {
    const mainIsland = snapshot.islands.find(
      (island) => island.id === snapshot.mainIslandId,
    );
    const mainState = mainIsland
      ? this.surfaces.get(mainIsland.id)
      : undefined;
    const hasFallbackSkin = mainIsland?.cells.some(
      (cell) =>
        cell.radius > 0 && Math.max(0, cell.scale ?? 1) > 0.02,
    ) ?? false;
    if (
      !mainIsland ||
      (!mainState?.surface.hasBuild && !hasFallbackSkin) ||
      (mainIsland.wounds?.length ?? 0) === 0
    ) {
      this.tendons.count = 0;
      this.tendons.visible = false;
      return;
    }

    let instance = 0;
    blobV2WorldInverse(this.tendons, this.tendonWorldInverse);
    for (const wound of mainIsland.wounds ?? []) {
      if (instance >= MAX_TENDONS) break;
      const radius = blobV2WoundMaskRadius(wound);
      if (radius <= 0.015) continue;

      this.tendonNormal.set(
        wound.position.x - snapshot.core.position.x,
        wound.position.y - snapshot.core.position.y,
        wound.position.z - snapshot.core.position.z,
      );
      if (this.tendonNormal.lengthSq() < 1e-8) {
        this.tendonNormal.copy(UP);
      } else {
        this.tendonNormal.normalize();
      }
      const tangentReference = Math.abs(this.tendonNormal.y) < 0.85
        ? UP
        : SIDE;
      this.tendonTangentA
        .crossVectors(this.tendonNormal, tangentReference)
        .normalize();
      this.tendonTangentB
        .crossVectors(this.tendonNormal, this.tendonTangentA)
        .normalize();

      for (
        let strand = 0;
        strand < TENDONS_PER_WOUND && instance < MAX_TENDONS;
        strand += 1
      ) {
        const angle = (strand - 1) * 0.62;
        const offset = (strand - 1) * radius * 0.17;
        this.tendonDirection
          .copy(this.tendonTangentA)
          .multiplyScalar(Math.cos(angle))
          .addScaledVector(this.tendonTangentB, Math.sin(angle))
          .normalize();
        this.tendonPosition
          .set(wound.position.x, wound.position.y, wound.position.z)
          .addScaledVector(this.tendonNormal, -radius * 0.22)
          .addScaledVector(this.tendonTangentB, offset);
        this.tendonQuaternion.setFromUnitVectors(UP, this.tendonDirection);
        const thickness = Math.max(0.012, radius * 0.055);
        this.tendonScale.set(
          thickness,
          radius * (strand === 1 ? 1.18 : 1.08),
          thickness,
        );
        blobV2WorldToLocalMatrix(
          this.tendonWorldInverse,
          this.tendonPosition,
          this.tendonQuaternion,
          this.tendonScale,
          this.tendonMatrix,
        );
        this.tendons.setMatrixAt(instance++, this.tendonMatrix);
      }
    }
    this.tendons.count = instance;
    this.tendons.visible = instance > 0;
    if (instance > 0) {
      this.tendons.instanceMatrix.needsUpdate = true;
      this.tendons.computeBoundingBox();
      this.tendons.computeBoundingSphere();
    }
  }

  private updateShedDroplets(snapshot: BlobV2OrganismRenderSnapshot): void {
    const droplets = snapshot.shedDroplets ?? [];
    if (droplets.length === 0) {
      this.shedDroplets.count = 0;
      this.shedDroplets.visible = false;
      return;
    }

    blobV2WorldInverse(this.shedDroplets, this.shedWorldInverse);
    let instance = 0;
    for (const droplet of droplets) {
      if (instance >= MAX_SHED_DROPLETS) break;
      const wither = clamp01(droplet.witherProgress);
      const shrink = Math.max(0.02, 1 - wither);
      if (!(droplet.radius > 0) || shrink <= 0.02) continue;
      this.shedPosition.set(
        droplet.position.x,
        droplet.position.y,
        droplet.position.z,
      );
      this.shedDirection.set(
        droplet.velocity.x,
        droplet.velocity.y,
        droplet.velocity.z,
      );
      const speed = this.shedDirection.length();
      if (speed > 1e-5) {
        this.shedQuaternion.setFromUnitVectors(
          UP,
          this.shedDirection.multiplyScalar(1 / speed),
        );
      } else {
        this.shedQuaternion.identity();
      }
      const radius = droplet.radius * shrink;
      this.shedScale.set(
        radius * (1 - wither * 0.18),
        radius * (1 + Math.min(0.55, speed * 0.1)),
        radius * (1 - wither * 0.18),
      );
      blobV2WorldToLocalMatrix(
        this.shedWorldInverse,
        this.shedPosition,
        this.shedQuaternion,
        this.shedScale,
        this.shedMatrix,
      );
      this.shedDroplets.setMatrixAt(instance, this.shedMatrix);
      this.shedColor
        .copy(SHED_SKIN_COLOR)
        .lerp(SHED_WITHER_COLOR, wither * 0.82);
      this.shedDroplets.setColorAt(instance, this.shedColor);
      instance += 1;
    }
    this.shedDroplets.count = instance;
    this.shedDroplets.visible = instance > 0;
    if (instance > 0) {
      this.shedDroplets.instanceMatrix.needsUpdate = true;
      if (this.shedDroplets.instanceColor) {
        this.shedDroplets.instanceColor.needsUpdate = true;
      }
      this.shedDroplets.computeBoundingBox();
      this.shedDroplets.computeBoundingSphere();
    }
  }

  private destroySurfaceState(state: SurfaceState): void {
    this.scheduler.cancel(state.schedulerId);
    state.pending = false;
    state.surface.dispose();
  }

  private updateTelemetryResources(): void {
    if (!this.telemetry || this.disposed) return;
    let cpuBytes = geometryBytes(this.fallback.geometry) +
      geometryBytes(this.tendons.geometry) +
      geometryBytes(this.shedDroplets.geometry) +
      geometryBytes(this.core.geometry) +
      this.fallback.instanceMatrix.array.byteLength +
      this.tendons.instanceMatrix.array.byteLength +
      this.shedDroplets.instanceMatrix.array.byteLength +
      (this.shedDroplets.instanceColor?.array.byteLength ?? 0);
    let gpuBytes = cpuBytes;
    for (const state of this.surfaces.values()) {
      const mesh = state.surface.mesh;
      const geometry = geometryBytes(mesh.geometry);
      gpuBytes += geometry;
      cpuBytes += geometry + mesh.field.byteLength +
        mesh.normal_cache.byteLength + mesh.palette.byteLength +
        state.surface.scratchByteLength;
    }
    let pending = 0;
    for (const state of this.surfaces.values()) {
      if (state.pending) pending += 1;
    }
    this.telemetry.setVisualResources(
      this.surfaces.size,
      pending,
      cpuBytes,
      gpuBytes,
    );
  }
}

function geometryFingerprint(mesh: BlobV2MarchingSurface["mesh"]): string {
  const position = mesh.geometry.getAttribute("position");
  const drawCount = Math.min(
    position.count,
    Math.max(0, mesh.geometry.drawRange.count),
  );
  let hash = 0x811c9dc5;
  for (let index = 0; index < drawCount * position.itemSize; index += 1) {
    const value = Math.round((position.array[index] ?? 0) * 1e7);
    hash ^= value | 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function selectSurfaceIslands(
  snapshot: BlobV2OrganismRenderSnapshot,
  existing: ReadonlyMap<BlobV2IslandId, SurfaceState>,
): BlobV2RenderIslandSnapshot[] {
  const main = snapshot.islands.find(
    (island) => island.id === snapshot.mainIslandId,
  );
  const fragments = snapshot.islands.filter(
    (island) => island.id !== snapshot.mainIslandId,
  );
  fragments.sort((a, b) => {
    const aExisting = existing.has(a.id) ? 0 : 1;
    const bExisting = existing.has(b.id) ? 0 : 1;
    if (aExisting !== bExisting) return aExisting - bExisting;
    return String(a.id).localeCompare(String(b.id));
  });
  return [
    ...(main ? [main] : []),
    ...fragments.slice(0, MAX_FRAGMENT_SURFACES),
  ];
}

function resolutionForIsland(island: BlobV2RenderIslandSnapshot): 32 | 24 {
  return island.kind === "main" ? MAIN_RESOLUTION : FRAGMENT_RESOLUTION;
}

function captureIsland(
  island: BlobV2RenderIslandSnapshot,
  revision: number,
  scheduledAt: number,
): CapturedIsland {
  // Render snapshots are immutable by contract. Retaining their arrays until
  // this scheduled job runs avoids cloning every cell/Vector3 at 30 Hz and is
  // safe even when a newer snapshot replaces the request before execution.
  const cells = island.cells;
  const wounds = island.wounds ?? [];
  return {
    id: island.id,
    generation: island.generation,
    revision,
    cells,
    wounds,
    center: computeIslandCenter(cells, new Vector3()),
    scheduledAt,
    queuedAtMs: performance.now(),
  };
}

function computeIslandCenter(
  cells: readonly BlobV2RenderCellSnapshot[],
  target: Vector3,
): Vector3 {
  target.set(0, 0, 0);
  let weight = 0;
  for (const cell of cells) {
    const cellWeight = Math.max(0, cell.scale ?? 1);
    target.x += cell.position.x * cellWeight;
    target.y += cell.position.y * cellWeight;
    target.z += cell.position.z * cellWeight;
    weight += cellWeight;
  }
  return weight > 0 ? target.multiplyScalar(1 / weight) : target;
}

function setContactQuaternion(
  target: Quaternion,
  normal:
    | { readonly x: number; readonly y: number; readonly z: number }
    | undefined,
): void {
  if (!normal) {
    target.identity();
    return;
  }
  TMP_CONTACT_NORMAL.set(normal.x, normal.y, normal.z);
  if (TMP_CONTACT_NORMAL.lengthSq() < 1e-8) {
    target.identity();
    return;
  }
  target.setFromUnitVectors(UP, TMP_CONTACT_NORMAL.normalize());
}

function validateSnapshot(snapshot: BlobV2OrganismRenderSnapshot): void {
  if (!Number.isFinite(snapshot.sequence)) {
    throw new Error("BlobV2Presenter: snapshot.sequence must be finite");
  }
  const ids = new Set<BlobV2IslandId>();
  for (const island of snapshot.islands) {
    if (ids.has(island.id)) {
      throw new Error(`BlobV2Presenter: duplicate island ID ${String(island.id)}`);
    }
    ids.add(island.id);
    if (!Number.isInteger(island.generation) || island.generation < 0) {
      throw new Error("BlobV2Presenter: island generation must be a non-negative integer");
    }
  }
}

function validateView(view: BlobV2RenderView): void {
  if (!Number.isFinite(view.now)) {
    throw new Error("BlobV2Presenter: view.now must be finite");
  }
  if (!Number.isFinite(view.viewerDistance) || view.viewerDistance < 0) {
    throw new Error(
      "BlobV2Presenter: view.viewerDistance must be finite and >= 0",
    );
  }
}

function surfaceName(
  ownerId: string,
  islandId: BlobV2IslandId,
  generation: number,
): string {
  return `blob-v2-surface-${ownerId}-${String(islandId)}-g${generation}`;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`BlobV2Presenter: ${name} must be a positive integer`);
  }
  return value;
}

function disposeGeometry(geometry: BufferGeometry): void {
  geometry.dispose();
}

function geometryBytes(geometry: BufferGeometry): number {
  let bytes = geometry.index?.array.byteLength ?? 0;
  for (const attribute of Object.values(geometry.attributes)) {
    bytes += attribute.array.byteLength;
  }
  return bytes;
}
