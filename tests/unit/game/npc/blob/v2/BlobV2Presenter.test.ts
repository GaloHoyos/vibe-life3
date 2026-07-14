import { describe, expect, it, vi } from "vitest";
import {
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  Quaternion,
  Vector3,
} from "three";
import type {
  BlobSurfaceRebuildRequest,
  BlobSurfaceRequestId,
} from "@engine/blob/BlobSurfaceScheduler";
import { BlobSurfaceScheduler } from "@engine/blob/BlobSurfaceScheduler";
import { BlobV2Telemetry } from "@engine/blob/v2/BlobV2Telemetry";
import type { BlobV2OrganismRenderSnapshot } from "@engine/blob/v2/render/BlobV2RenderTypes";
import {
  BLOB_V2_SKIN_COLOR,
  type BlobV2SkinUniforms,
} from "@engine/blob/v2/render/BlobV2Material";
import {
  BlobV2Presenter,
  type BlobV2SurfaceSchedulerPort,
} from "@game/npc/blob/v2/BlobV2Presenter";

describe("BlobV2Presenter", () => {
  it("queues spawn surfaces, uses ellipsoid fallback, then keeps fixed 32/24 meshes", () => {
    const root = new Group();
    const scheduler = new BlobSurfaceScheduler({
      budgetMs: 1_000,
      maxHighQualityPerFrame: 10,
    });
    const presenter = new BlobV2Presenter(root, {
      ownerId: "fixed",
      scheduler,
      maxMainPolyCount: 12_000,
      maxFragmentPolyCount: 8_000,
    });
    const snapshot = makeSnapshot(1, ["fragment"]);

    presenter.update(snapshot, view(0, 5));

    expect(scheduler.pendingCount).toBe(2);
    expect(presenter.fallbackCellCount).toBe(2);
    expect(presenter.getSurfaceInfo("main")).toMatchObject({
      resolution: 32,
      hasBuild: false,
      pending: true,
    });
    expect(presenter.getSurfaceInfo("fragment")).toMatchObject({
      resolution: 24,
      hasBuild: false,
      pending: true,
    });

    scheduler.runFrame();
    presenter.update(snapshot, view(0.001, 5));

    expect(presenter.fallbackCellCount).toBe(0);
    const main = presenter.getSurfaceInfo("main")!;
    const fragment = presenter.getSurfaceInfo("fragment")!;
    expect(main.hasBuild).toBe(true);
    expect(fragment.hasBuild).toBe(true);
    expect((main.mesh as Mesh).matrixAutoUpdate).toBe(true);
    expect((main.mesh as Mesh).material).toBe((fragment.mesh as Mesh).material);

    const material = (main.mesh as Mesh).material as MeshPhysicalMaterial;
    expect(material.color.getHex()).toBe(BLOB_V2_SKIN_COLOR);
    expect(material.transparent).toBe(false);
    expect(material.opacity).toBe(1);
    expect(material.transmission).toBe(0);
    expect(material.clearcoat).toBeGreaterThan(0.9);
    expect(material.clearcoatRoughness).toBeLessThan(0.15);
    expect(material.roughness).toBeGreaterThanOrEqual(0.3);
    expect(material.roughness).toBeLessThan(0.4);
    const core = root.getObjectByName("blob-v2-core-fixed") as Mesh;
    expect((core.material as MeshPhysicalMaterial).depthTest).toBe(true);
    expect((core.material as MeshPhysicalMaterial).depthWrite).toBe(true);
    presenter.dispose();
    scheduler.dispose();
  });

  it("invalidates a stale generation even if a cancelled job still runs", () => {
    const root = new Group();
    const scheduler = new LeakyDeferredScheduler();
    const presenter = new BlobV2Presenter(root, {
      ownerId: "generation",
      scheduler,
      maxMainPolyCount: 8_000,
    });

    presenter.update(makeSnapshot(1), view(0, 5));
    const oldMesh = presenter.getSurfaceInfo("main")!.mesh;
    presenter.update(makeSnapshot(2), view(0.01, 5));
    const current = presenter.getSurfaceInfo("main")!;

    expect(current.generation).toBe(2);
    expect(current.mesh).not.toBe(oldMesh);
    expect(oldMesh.parent).toBeNull();

    scheduler.run(0);
    expect(presenter.getSurfaceInfo("main")!.hasBuild).toBe(false);
    expect(presenter.getSurfaceInfo("main")!.pending).toBe(true);
    presenter.dispose();
  });

  it("does not let simulation sequence bypass the 30 Hz rebuild cadence", () => {
    const scheduler = new LeakyDeferredScheduler();
    const presenter = new BlobV2Presenter(new Group(), {
      ownerId: "cadence",
      scheduler,
      maxMainPolyCount: 8_000,
      warmupBackend: false,
    });
    const initial = makeSnapshot(1);
    presenter.update(initial, view(0, 5));
    scheduler.run(0);

    presenter.update({ ...initial, sequence: 2 }, view(0.01, 5));
    expect(scheduler.requests).toHaveLength(1);

    presenter.update({ ...initial, sequence: 3 }, view(1 / 30, 5));
    expect(scheduler.requests).toHaveLength(2);
    presenter.dispose();
  });

  it("uses normal local transforms under a moved and rotated owner", () => {
    const root = new Group();
    root.position.set(7, 1, -3);
    root.rotation.set(0, Math.PI / 3, 0);
    root.updateWorldMatrix(true, true);
    const scheduler = new BlobSurfaceScheduler({ budgetMs: 1_000 });
    const presenter = new BlobV2Presenter(root, {
      ownerId: "local",
      scheduler,
      maxMainPolyCount: 8_000,
    });
    const snapshot = makeSnapshot(1, [], new Vector3(9.25, 2, -1.5));

    presenter.update(snapshot, view(0, 5));
    scheduler.runFrame();
    presenter.update(snapshot, view(0.001, 5));
    root.updateWorldMatrix(true, true);

    const mesh = presenter.getSurfaceInfo("main")!.mesh;
    const worldPosition = mesh.getWorldPosition(new Vector3());
    expect(worldPosition.distanceTo(snapshot.core.position as Vector3)).toBeLessThan(0.35);
    expect(mesh.position.distanceTo(worldPosition)).toBeGreaterThan(1);
    expect(mesh.matrixAutoUpdate).toBe(true);
    presenter.dispose();
    scheduler.dispose();
  });

  it("caps autonomous surfaces at one main plus six fragments", () => {
    const root = new Group();
    const scheduler = new BlobSurfaceScheduler({
      budgetMs: 1_000,
      maxHighQualityPerFrame: 20,
    });
    const presenter = new BlobV2Presenter(root, {
      ownerId: "cap",
      scheduler,
      maxMainPolyCount: 8_000,
      maxFragmentPolyCount: 4_000,
    });
    const fragmentIds = Array.from({ length: 7 }, (_, index) => `f${index}`);
    const snapshot = makeSnapshot(1, fragmentIds);

    presenter.update(snapshot, view(0, 5));
    expect(presenter.activeSurfaceCount).toBe(7);
    scheduler.runFrame();
    presenter.update(snapshot, view(0.001, 5));

    expect(presenter.fallbackCellCount).toBe(1);
    expect(presenter.getSurfaceInfo("f6")).toBeNull();
    presenter.dispose();
    scheduler.dispose();
  });

  it("opens fallback skin immediately and keeps tendons inside visible wounds", () => {
    const root = new Group();
    const scheduler = new LeakyDeferredScheduler();
    const presenter = new BlobV2Presenter(root, {
      ownerId: "immediate-wound",
      scheduler,
      warmupBackend: false,
    });
    const base = makeSnapshot(1);
    const woundPosition = new Vector3(0, 0, 0.34);
    const wounded: BlobV2OrganismRenderSnapshot = {
      ...base,
      islands: base.islands.map((island) =>
        island.id === "main"
          ? {
              ...island,
              geometryRevision: 2,
              wounds: [{
                id: "wound",
                position: woundPosition,
                radius: 0.3,
                strength: 1,
              }],
            }
          : island
      ),
    };

    const stressed: BlobV2OrganismRenderSnapshot = {
      ...wounded,
      sequence: 0,
      islands: wounded.islands.map((island) =>
        island.id === "main"
          ? {
              ...island,
              geometryRevision: 1,
              wounds: island.wounds?.map((wound) => ({
                ...wound,
                strength: 0.38,
                opensSkin: false,
              })),
            }
          : island
      ),
    };

    presenter.update(stressed, view(0, 5));
    const fallback = root.getObjectByName(
      "blob-v2-fallback-immediate-wound",
    ) as InstancedMesh;
    const uniforms = (fallback.material as MeshPhysicalMaterial).userData
      .blobV2SkinUniforms as BlobV2SkinUniforms;
    expect(uniforms.woundCount.value).toBe(0);
    expect(presenter.visibleTendonCount).toBe(0);

    presenter.update(wounded, view(0.01, 5));

    expect(presenter.fallbackCellCount).toBe(1);
    expect(uniforms.woundCount.value).toBe(1);
    expect(uniforms.woundSpheres.value[0].w).toBeCloseTo(0.3);
    expect(presenter.visibleTendonCount).toBe(3);

    const tendons = root.getObjectByName(
      "blob-v2-wound-tendons-immediate-wound",
    ) as InstancedMesh;
    const matrix = new Vector3();
    const scale = new Vector3();
    const quaternion = new Quaternion();
    const instanceMatrix = new Matrix4();
    for (let index = 0; index < tendons.count; index += 1) {
      tendons.getMatrixAt(index, instanceMatrix);
      instanceMatrix.decompose(matrix, quaternion, scale);
      expect(
        matrix.distanceTo(woundPosition) + scale.y * 0.5 + scale.x,
      ).toBeLessThan(0.3);
    }

    presenter.update({ ...base, sequence: 2 }, view(0.01, 5));
    expect(uniforms.woundCount.value).toBe(0);
    expect(presenter.visibleTendonCount).toBe(0);
    presenter.dispose();
  });

  it("renders overflow biomass as shrinking instanced droplets without MC surfaces", () => {
    const root = new Group();
    const presenter = new BlobV2Presenter(root, {
      ownerId: "shed",
      scheduler: new LeakyDeferredScheduler(),
      warmupBackend: false,
    });
    const base = makeSnapshot(1);
    presenter.update({
      ...base,
      shedDroplets: [{
        id: "shed-1",
        position: new Vector3(0.5, 0.25, 0),
        velocity: new Vector3(1, 2, 0),
        radius: 0.2,
        witherProgress: 0.5,
      }],
    }, view(0, 5));

    expect(presenter.activeSurfaceCount).toBe(1);
    expect(presenter.visibleShedDropletCount).toBe(1);
    const droplets = root.getObjectByName(
      "blob-v2-shed-droplets-shed",
    ) as InstancedMesh;
    const matrix = new Matrix4();
    const position = new Vector3();
    const scale = new Vector3();
    droplets.getMatrixAt(0, matrix);
    matrix.decompose(position, new Quaternion(), scale);
    expect(position).toEqual(new Vector3(0.5, 0.25, 0));
    expect(Math.max(scale.x, scale.z)).toBeLessThan(0.11);
    const color = new Color();
    droplets.getColorAt(0, color);
    expect(color.r - color.b).toBeLessThan(0.2);

    presenter.update({ ...base, sequence: 2 }, view(0.01, 5));
    expect(presenter.visibleShedDropletCount).toBe(0);
    presenter.dispose();
  });

  it("freezes without disposing, cancels work, and disposes idempotently", () => {
    const root = new Group();
    const scheduler = new LeakyDeferredScheduler();
    const presenter = new BlobV2Presenter(root, {
      ownerId: "freeze",
      scheduler,
    });
    presenter.update(makeSnapshot(1), view(0, 5));
    const group = presenter.freeze();

    expect(group.parent).toBe(root);
    expect(presenter.isFrozen).toBe(true);
    expect(scheduler.cancelled.size).toBe(1);
    scheduler.run(0);
    expect(presenter.getSurfaceInfo("main")!.hasBuild).toBe(false);

    const groupRemove = vi.spyOn(group, "removeFromParent");
    const fallback = root.getObjectByName(
      "blob-v2-fallback-freeze",
    ) as InstancedMesh;
    const fallbackDispose = vi.spyOn(fallback, "dispose");
    presenter.dispose();
    presenter.dispose();
    expect(groupRemove).toHaveBeenCalledOnce();
    expect(fallbackDispose).toHaveBeenCalledOnce();
    expect(group.parent).toBeNull();
  });

  it("releases every surface and queued job through 100 split/merge/freeze cycles", () => {
    const root = new Group();
    const scheduler = new BlobSurfaceScheduler({ budgetMs: 1_000 });
    let allocatedGeometries = 0;
    let disposedGeometries = 0;
    let maxSurfaces = 0;
    let maxPendingJobs = 0;

    for (let cycle = 0; cycle < 100; cycle += 1) {
      const presenter = new BlobV2Presenter(root, {
        ownerId: `soak-${cycle}`,
        scheduler,
        maxFallbackCells: 8,
        maxMainPolyCount: 256,
        maxFragmentPolyCount: 128,
      });
      presenter.update(makeSnapshot(cycle + 1), view(cycle, 5));
      presenter.update(
        makeSnapshot(
          cycle + 1,
          Array.from({ length: 6 }, (_, index) => `f${index}`),
        ),
        view(cycle + 0.01, 5),
      );

      const geometries = [
        (root.getObjectByName(`blob-v2-fallback-soak-${cycle}`) as InstancedMesh)
          .geometry,
        (root.getObjectByName(`blob-v2-core-soak-${cycle}`) as Mesh).geometry,
        (root.getObjectByName(
          `blob-v2-wound-tendons-soak-${cycle}`,
        ) as InstancedMesh).geometry,
        (root.getObjectByName(
          `blob-v2-shed-droplets-soak-${cycle}`,
        ) as InstancedMesh).geometry,
        ...["main", "f0", "f1", "f2", "f3", "f4", "f5"].map(
          (id) => (presenter.getSurfaceInfo(id)!.mesh as Mesh).geometry,
        ),
      ];
      allocatedGeometries += geometries.length;
      for (const geometry of geometries) {
        geometry.addEventListener("dispose", () => {
          disposedGeometries += 1;
        });
      }
      maxSurfaces = Math.max(maxSurfaces, presenter.activeSurfaceCount);
      maxPendingJobs = Math.max(maxPendingJobs, scheduler.pendingCount);
      expect(presenter.activeSurfaceCount).toBe(7);
      expect(scheduler.pendingCount).toBe(7);

      presenter.update(makeSnapshot(cycle + 1), view(cycle + 0.02, 5));
      expect(presenter.activeSurfaceCount).toBe(1);
      expect(scheduler.pendingCount).toBe(1);

      presenter.freeze();
      expect(scheduler.pendingCount).toBe(0);
      presenter.dispose();
      presenter.dispose();
      expect(presenter.activeSurfaceCount).toBe(0);
      expect(root.children).toHaveLength(0);
    }

    expect(maxSurfaces).toBe(7);
    expect(maxPendingJobs).toBe(7);
    expect(allocatedGeometries).toBe(1_100);
    expect(disposedGeometries).toBe(allocatedGeometries);
    expect(scheduler.pendingCount).toBe(0);
    scheduler.dispose();
  });

  it("records bounded presentation, meshing, wait and visual resource telemetry", () => {
    const telemetry = new BlobV2Telemetry(64);
    const scheduler = new BlobSurfaceScheduler({
      budgetMs: 1_000,
      maxHighQualityPerFrame: 16,
    });
    const presenter = new BlobV2Presenter(new Group(), {
      ownerId: "telemetry",
      scheduler,
      telemetry,
    });
    presenter.update(
      makeSnapshot(
        1,
        Array.from({ length: 6 }, (_, index) => `fragment-${index}`),
      ),
      view(0, 5),
    );

    const queued = telemetry.snapshot();
    expect(queued.presentation.samples).toBe(1);
    expect(queued.resources).toMatchObject({
      surfaces: 7,
      pendingVisualJobs: 7,
    });
    expect(queued.resources.estimatedCpuBytes).toBeLessThan(12 * 1024 * 1024);
    expect(queued.resources.estimatedGpuBytes).toBeLessThan(8 * 1024 * 1024);

    scheduler.runFrame();
    const built = telemetry.snapshot();
    expect(built.meshing.samples).toBeGreaterThanOrEqual(7);
    expect(built.visualJobWait.samples).toBe(built.meshing.samples);
    expect(built.resources.pendingVisualJobs).toBe(0);
    expect(built.resources.surfaces).toBe(7);

    presenter.dispose();
    expect(telemetry.snapshot().resources).toEqual({
      surfaces: 0,
      pendingVisualJobs: 0,
      estimatedCpuBytes: 0,
      estimatedGpuBytes: 0,
    });
    scheduler.dispose();
  });
});

class LeakyDeferredScheduler implements BlobV2SurfaceSchedulerPort {
  readonly requests: BlobSurfaceRebuildRequest[] = [];
  readonly cancelled = new Set<BlobSurfaceRequestId>();

  request(request: BlobSurfaceRebuildRequest): void {
    this.requests.push(request);
  }

  cancel(id: BlobSurfaceRequestId): void {
    this.cancelled.add(id);
  }

  run(index: number): void {
    this.requests[index]?.rebuild();
  }
}

function makeSnapshot(
  generation: number,
  fragmentIds: readonly string[] = [],
  center = new Vector3(),
): BlobV2OrganismRenderSnapshot {
  return {
    sequence: 1,
    mainIslandId: "main",
    core: {
      position: center.clone(),
      radius: 0.32,
      exposure: 0,
    },
    islands: [
      {
        id: "main",
        generation,
        kind: "main",
        cells: [
          {
            id: "main-cell",
            position: center.clone(),
            radius: 0.42,
          },
        ],
      },
      ...fragmentIds.map((id, index) => ({
        id,
        generation: 1,
        kind: "fragment" as const,
        cells: [
          {
            id: `${id}-cell`,
            position: center.clone().add(new Vector3(1.5 + index, 0, 0)),
            radius: 0.3,
          },
        ],
      })),
    ],
  };
}

function view(now: number, viewerDistance: number) {
  return {
    now,
    viewerDistance,
    mainViewVisible: true,
  };
}
