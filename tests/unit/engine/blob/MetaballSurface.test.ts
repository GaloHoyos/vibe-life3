import { describe, expect, it, vi } from "vitest";
import { Group, MeshBasicMaterial, Vector3 } from "three";
import { MetaballSurface } from "@engine/blob/MetaballSurface";

describe("MetaballSurface", () => {
  it("provides conservative local bounds and keeps frustum culling enabled", () => {
    const surface = makeSurface();
    const geometry = surface.mesh.geometry;
    expect(surface.mesh.frustumCulled).toBe(true);
    expect(geometry.boundingBox?.min.toArray()).toEqual([-1, -1, -1]);
    expect(geometry.boundingBox?.max.toArray()).toEqual([1, 1, 1]);
    expect(geometry.boundingSphere?.center.toArray()).toEqual([0, 0, 0]);
    expect(geometry.boundingSphere?.radius).toBeCloseTo(Math.sqrt(3));
    surface.dispose();
  });

  it("changes LOD in place and restores bounds overwritten by init", () => {
    const surface = makeSurface();
    const mesh = surface.mesh;
    expect(surface.setResolution(40)).toBe(true);
    expect(surface.mesh).toBe(mesh);
    expect(surface.fieldResolution).toBe(40);
    expect(surface.mesh.geometry.boundingSphere?.radius).toBeCloseTo(Math.sqrt(3));
    expect(surface.setResolution(40)).toBe(false);
    surface.dispose();
  });

  it("stabilizes its domain and disposes geometry only once", () => {
    const surface = makeSurface();
    surface.beginFrame(new Vector3(), 2.01);
    expect(surface.domain).toBe(2.01);
    expect(surface.stableDomain).toBe(2.25);
    surface.beginFrame(new Vector3(), 2.26);
    expect(surface.domain).toBe(2.26);
    expect(surface.stableDomain).toBe(2.5);
    surface.beginFrame(new Vector3(), 2.24);
    expect(surface.domain).toBe(2.24);
    expect(surface.stableDomain).toBe(2.5);

    const root = new Group();
    root.add(surface.mesh);
    const disposeGeometry = vi.spyOn(surface.mesh.geometry, "dispose");
    surface.dispose();
    surface.dispose();
    expect(surface.mesh.parent).toBeNull();
    expect(surface.mesh.visible).toBe(false);
    expect(disposeGeometry).toHaveBeenCalledOnce();
  });
});

function makeSurface(): MetaballSurface {
  return new MetaballSurface({
    resolution: 32,
    maxPolyCount: 256,
    material: new MeshBasicMaterial(),
  });
}
