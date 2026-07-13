import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import {
  BlobSurfaceDomain,
  blobDomainSizeWithCellGuard,
} from "@engine/blob/BlobSurfaceDomain";

describe("BlobSurfaceDomain", () => {
  it("quantizes growth and applies hysteresis before shrinking", () => {
    const domain = new BlobSurfaceDomain({
      sizeQuantum: 0.25,
      shrinkHysteresis: 0.125,
    });

    expect(domain.stabilizeSize(2.01)).toBe(2.25);
    expect(domain.stabilizeSize(2.26)).toBe(2.5);
    // Small breathing around the old threshold cannot toggle the scale.
    expect(domain.stabilizeSize(2.24)).toBe(2.5);
    expect(domain.stabilizeSize(2.14)).toBe(2.5);
    expect(domain.stabilizeSize(2.12)).toBe(2.25);
  });

  it("keeps the lattice center still inside a Schmitt-trigger boundary", () => {
    const domain = new BlobSurfaceDomain({
      sizeQuantum: 1,
      centerHysteresisCells: 0.15,
    });
    domain.stabilizeSize(4);

    expect(domain.stabilizeCenter(new Vector3(0, 0, 0), 4).x).toBe(0);
    expect(domain.stabilizeCenter(new Vector3(0.6, 0, 0), 4).x).toBe(0);
    expect(domain.stabilizeCenter(new Vector3(0.66, 0, 0), 4).x).toBe(1);
    // Crossing back over the ordinary half-cell boundary is not enough.
    expect(domain.stabilizeCenter(new Vector3(0.4, 0, 0), 4).x).toBe(1);
    expect(domain.stabilizeCenter(new Vector3(0.34, 0, 0), 4).x).toBe(0);
  });

  it("reserves three complete sampling cells around the field support", () => {
    const reach = 2.343;
    const resolution = 40;
    const size = blobDomainSizeWithCellGuard(reach, resolution, 3);
    const cell = size / resolution;
    expect(size / 2 - reach).toBeCloseTo(cell * 3, 10);
    expect(() => blobDomainSizeWithCellGuard(reach, 4, 2)).toThrow();
  });
});
