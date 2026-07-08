import { describe, expect, it } from "vitest";
import { createPortalApertureMesh } from "@engine/portals/PortalApertureGeometry";

describe("createPortalApertureMesh", () => {
  const hw = 0.55;
  const hh = 0.95;
  const radius = 2;
  const thickness = 0.1;
  const segments = 32;
  const mesh = createPortalApertureMesh(hw, hh, radius, thickness, segments);

  it("emits four vertices per segment and eight triangles per segment", () => {
    expect(mesh.vertices.length).toBe(segments * 4 * 3);
    expect(mesh.indices.length).toBe(segments * 8 * 3);
  });

  it("keeps every vertex on the surface (z=0) or sunk by thickness (z=-t)", () => {
    for (let i = 0; i < mesh.vertices.length; i += 3) {
      const z = mesh.vertices[i + 2];
      // Float32 storage: -0.1 is not bit-exact, so allow a float epsilon.
      expect(Math.abs(z) < 1e-6 || Math.abs(z + thickness) < 1e-6).toBe(true);
    }
  });

  it("leaves the elliptical hole empty: no vertex lies strictly inside the oval", () => {
    for (let i = 0; i < mesh.vertices.length; i += 3) {
      const x = mesh.vertices[i];
      const y = mesh.vertices[i + 1];
      const e = (x / hw) ** 2 + (y / hh) ** 2;
      // Inner ring sits exactly on the ellipse (e≈1); outer ring is beyond it.
      expect(e).toBeGreaterThan(1 - 1e-6);
    }
  });

  it("indexes only existing vertices", () => {
    const vertexCount = mesh.vertices.length / 3;
    for (const index of mesh.indices) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(vertexCount);
    }
  });
});
