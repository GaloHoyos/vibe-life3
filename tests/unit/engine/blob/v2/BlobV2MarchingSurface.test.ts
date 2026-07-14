import { describe, expect, it, vi } from "vitest";
import { Group, MeshBasicMaterial, Vector3 } from "three";
import { BlobV2MarchingSurface } from "@engine/blob/v2/render/BlobV2MarchingSurface";

describe("BlobV2MarchingSurface", () => {
  it("keeps fixed quality and uses an independent stabilized domain per axis", () => {
    const surface = makeSurface(32);
    const mesh = surface.mesh;

    expect(
      surface.rebuild({
        cells: [
          cell("a", -1.2, 0, 0),
          cell("b", 1.2, 0, 0),
        ],
      }),
    ).toBe(true);

    expect(surface.mesh).toBe(mesh);
    expect(surface.resolution).toBe(32);
    expect(surface.mesh.resolution).toBe(32);
    expect(surface.domainSize.x).toBeGreaterThan(surface.domainSize.y);
    expect(surface.domainSize.y).toBe(surface.domainSize.z);
    expect(surface.mesh.geometry.boundingSphere?.radius).toBeCloseTo(
      Math.sqrt(3),
    );
    surface.dispose();
  });

  it("subtracts the authoritative wound from the same scalar field", () => {
    const surface = makeSurface(24);
    const source = cell("body", 0, 0, 0, 0.5);
    surface.rebuild({ cells: [source] });
    const sample = centerSample(surface, new Vector3());
    const intact = surface.mesh.getCell(sample.x, sample.y, sample.z);

    surface.rebuild({
      cells: [source],
      wounds: [
        {
          id: "wound",
          position: new Vector3(),
          radius: 0.5,
          strength: 1,
        },
      ],
    });
    const breached = surface.mesh.getCell(sample.x, sample.y, sample.z);

    expect(intact).toBeGreaterThan(4);
    expect(breached).toBeLessThan(intact * 0.1);
    surface.dispose();
  });

  it("keeps stressed weakness as a real depression without opening the skin mask", () => {
    const surface = makeSurface(24);
    const source = cell("body", 0, 0, 0, 0.5);
    surface.rebuild({ cells: [source] });
    const sample = centerSample(surface, new Vector3());
    const intact = surface.mesh.getCell(sample.x, sample.y, sample.z);

    const rebuilt = surface.rebuild({
      cells: [source],
      wounds: [{
        id: "relocated-weakness",
        position: new Vector3(),
        radius: 0.32,
        strength: 0.38,
        opensSkin: false,
      }],
    });
    const weakened = surface.mesh.getCell(sample.x, sample.y, sample.z);

    expect(rebuilt).toBe(true);
    expect(surface.mesh.count).toBeGreaterThan(0);
    expect(weakened).toBeLessThan(intact);
    expect(weakened).toBeGreaterThan(0);
    surface.dispose();
  });

  it("fuses cells across the complete liquid cohesion neighbourhood", () => {
    const surface = makeSurface(32);
    const radius = 0.35;
    surface.rebuild({
      cells: [
        cell("left", -0.425, 0, 0, radius),
        cell("right", 0.425, 0, 0, radius),
      ],
    });

    const midpoint = centerSample(surface, new Vector3());
    expect(surface.mesh.getCell(midpoint.x, midpoint.y, midpoint.z)).toBeGreaterThan(4);
    surface.dispose();
  });

  it("disposes only its geometry, once, and never the shared material", () => {
    const material = new MeshBasicMaterial();
    const surface = new BlobV2MarchingSurface({
      resolution: 24,
      maxPolyCount: 4_000,
      material,
    });
    const root = new Group();
    root.add(surface.mesh);
    const geometryDispose = vi.spyOn(surface.mesh.geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");

    surface.dispose();
    surface.dispose();

    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).not.toHaveBeenCalled();
    expect(surface.mesh.parent).toBeNull();
  });

  it("warms scan, kernel, edge and populated paths without publishing synthetic geometry", () => {
    const surface = makeSurface(32);

    expect(surface.warmupBackend("scan")).toBe(true);
    expect(surface.warmupBackend("kernel")).toBe(true);
    expect(surface.warmupBackend("edges")).toBe(true);
    expect(surface.warmupBackend("surface")).toBe(true);
    expect(surface.hasBuild).toBe(false);
    expect(surface.mesh.visible).toBe(false);
    expect(surface.mesh.count).toBe(0);
    expect(surface.mesh.geometry.drawRange.count).toBe(0);

    expect(surface.rebuild({ cells: [cell("real", 0, 0, 0)] })).toBe(true);
    expect(surface.hasBuild).toBe(true);
    expect(surface.mesh.count).toBeGreaterThan(0);
    surface.dispose();
  });
});

function makeSurface(resolution: 32 | 24): BlobV2MarchingSurface {
  return new BlobV2MarchingSurface({
    resolution,
    maxPolyCount: 12_000,
    material: new MeshBasicMaterial(),
  });
}

function cell(
  id: string,
  x: number,
  y: number,
  z: number,
  radius = 0.35,
) {
  return {
    id,
    position: new Vector3(x, y, z),
    radius,
  };
}

function centerSample(
  surface: BlobV2MarchingSurface,
  position: Vector3,
): { x: number; y: number; z: number } {
  const minimum = surface.domainCenter
    .clone()
    .sub(surface.domainSize.clone().multiplyScalar(0.5));
  return {
    x: Math.floor(
      ((position.x - minimum.x) / surface.domainSize.x) * surface.resolution,
    ),
    y: Math.floor(
      ((position.y - minimum.y) / surface.domainSize.y) * surface.resolution,
    ),
    z: Math.floor(
      ((position.z - minimum.z) / surface.domainSize.z) * surface.resolution,
    ),
  };
}
