import { describe, expect, it } from "vitest";
import { BlobSurfaceLodController } from "@engine/blob/BlobSurfaceLod";

describe("BlobSurfaceLodController", () => {
  it("selects 40/32/24 resolution and resists threshold oscillation", () => {
    const lod = new BlobSurfaceLodController();
    expect(
      lod.update({ distance: 10, mainViewVisible: true, now: 0 }).resolution,
    ).toBe(40);

    // The 18 m boundary has 3 m spatial and 0.5 s temporal hysteresis.
    expect(
      lod.update({ distance: 20, mainViewVisible: true, now: 1 }).resolution,
    ).toBe(40);
    expect(
      lod.update({ distance: 22, mainViewVisible: true, now: 1.1 }).resolution,
    ).toBe(40);
    expect(
      lod.update({ distance: 22, mainViewVisible: true, now: 1.61 }).resolution,
    ).toBe(32);

    expect(
      lod.update({ distance: 49, mainViewVisible: true, now: 2 }).resolution,
    ).toBe(32);
    expect(
      lod.update({ distance: 49, mainViewVisible: true, now: 2.51 }).resolution,
    ).toBe(24);
  });

  it("sleeps after 0.75 s out of view and wakes immediately through a portal", () => {
    const lod = new BlobSurfaceLodController();
    lod.update({ distance: 30, mainViewVisible: false, now: 0 });
    expect(
      lod.update({ distance: 30, mainViewVisible: false, now: 0.74 }).dormant,
    ).toBe(false);
    expect(
      lod.update({ distance: 30, mainViewVisible: false, now: 0.75 }).dormant,
    ).toBe(true);

    const portalWake = lod.update({
      distance: 30,
      mainViewVisible: false,
      portalViewVisible: true,
      now: 0.76,
    });
    expect(portalWake.dormant).toBe(false);
    expect(portalWake.resolution).toBe(32);
  });

  it("only advances the rebuild clock after completed work", () => {
    const lod = new BlobSurfaceLodController();
    expect(
      lod.update({ distance: 10, mainViewVisible: true, now: 0 }).rebuildDue,
    ).toBe(true);
    expect(lod.update({ distance: 10, mainViewVisible: true, now: 0 }).updateHz).toBe(30);
    lod.markRebuilt(0);
    expect(
      lod.update({ distance: 10, mainViewVisible: true, now: 0.02 }).rebuildDue,
    ).toBe(false);
    expect(
      lod.update({ distance: 10, mainViewVisible: true, now: 1 / 30 }).rebuildDue,
    ).toBe(true);
  });

  it("force-wakes a distant dormant surface at the cheapest LOD", () => {
    const lod = new BlobSurfaceLodController();
    expect(
      lod.update({ distance: 120, mainViewVisible: false, now: 0 }).dormant,
    ).toBe(true);
    const awake = lod.update({
      distance: 120,
      mainViewVisible: false,
      now: 0.01,
      forceWake: true,
    });
    expect(awake.dormant).toBe(false);
    expect(awake.resolution).toBe(24);
    expect(awake.rebuildDue).toBe(true);
  });
});
