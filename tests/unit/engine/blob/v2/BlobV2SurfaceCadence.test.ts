import { describe, expect, it } from "vitest";
import { BlobV2SurfaceCadence } from "@engine/blob/v2/render/BlobV2SurfaceCadence";

describe("BlobV2SurfaceCadence", () => {
  it("uses 30/12/4 Hz without selecting a geometry resolution", () => {
    const cadence = new BlobV2SurfaceCadence();
    expect(cadence.frequency(5)).toBe(30);
    expect(cadence.frequency(30)).toBe(12);
    expect(cadence.frequency(80)).toBe(4);
    expect(cadence.isDue(1 / 30 - 0.001, 0, 5)).toBe(false);
    expect(cadence.isDue(1 / 30, 0, 5)).toBe(true);
    expect(cadence.isDue(0.249, 0, 80)).toBe(false);
    expect(cadence.isDue(0.25, 0, 80)).toBe(true);
  });
});
