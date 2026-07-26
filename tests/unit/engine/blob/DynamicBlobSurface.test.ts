import { Group, MeshBasicMaterial, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { DynamicBlobSurface } from "@engine/blob/DynamicBlobSurface";

describe("DynamicBlobSurface", () => {
  it("funde muestras cercanas en una unica superficie movil", () => {
    const material = new MeshBasicMaterial();
    const parent = new Group();
    const surface = new DynamicBlobSurface(material, {
      name: "gel-test",
      resolution: 24,
      domainSize: 4,
      maxPolyCount: 5000,
    });
    const center = new Vector3(2, 3, -1);

    surface.attachTo(parent);
    surface.update(center, [
      { position: center.clone(), radius: 0.75 },
      { position: center.clone().add(new Vector3(0.65, 0, 0)), radius: 0.6 },
    ]);

    expect(parent.getObjectByName("gel-test")).toBe(surface.object);
    expect(surface.object.position).toEqual(center);
    expect(surface.object.count).toBeGreaterThan(0);
    expect(surface.object.visible).toBe(true);

    surface.dispose();
    material.dispose();
    expect(surface.object.parent).toBeNull();
  });
});
