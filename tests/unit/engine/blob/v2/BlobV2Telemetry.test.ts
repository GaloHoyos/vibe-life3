import { describe, expect, it } from "vitest";
import { BlobOrganismController, BlobV2Telemetry } from "@engine/blob/v2";

describe("BlobV2Telemetry", () => {
  it("keeps bounded timing windows and reports average, p95 and maximum", () => {
    const telemetry = new BlobV2Telemetry(4);
    for (const duration of [1, 2, 3, 4, 20]) telemetry.recordSimulation(duration);
    telemetry.recordMeshing(2.5, 40);
    telemetry.recordPresentation(0.75);
    telemetry.setVisualResources(7, 2, 1_024, 2_048);

    const snapshot = telemetry.snapshot();
    expect(snapshot.simulation).toEqual({
      samples: 4,
      averageMs: 7.25,
      p95Ms: 20,
      maximumMs: 20,
    });
    expect(snapshot.meshing).toMatchObject({ samples: 1, p95Ms: 2.5 });
    expect(snapshot.visualJobWait).toMatchObject({ samples: 1, p95Ms: 40 });
    expect(snapshot.presentation).toMatchObject({ samples: 1, p95Ms: 0.75 });
    expect(snapshot.resources).toEqual({
      surfaces: 7,
      pendingVisualJobs: 2,
      estimatedCpuBytes: 1_024,
      estimatedGpuBytes: 2_048,
    });
  });

  it("is populated by the authoritative controller step", () => {
    const controller = new BlobOrganismController();
    controller.step(1 / 30);
    controller.setOverrideState("Frozen");
    controller.step(1 / 30);

    const timing = controller.telemetry.snapshot().simulation;
    expect(timing.samples).toBe(2);
    expect(timing.averageMs).toBeGreaterThanOrEqual(0);
    expect(timing.maximumMs).toBeGreaterThanOrEqual(timing.p95Ms);
  });

  it("rejects invalid counters and clears all state", () => {
    const telemetry = new BlobV2Telemetry();
    expect(() => telemetry.recordSimulation(Number.NaN)).toThrow(/finite/);
    expect(() => telemetry.setVisualResources(-1, 0)).toThrow(/surfaces/);
    telemetry.recordMeshing(1, 2);
    telemetry.setVisualResources(1, 1, 2, 3);
    telemetry.reset();
    expect(telemetry.snapshot()).toMatchObject({
      meshing: { samples: 0 },
      visualJobWait: { samples: 0 },
      resources: { surfaces: 0, pendingVisualJobs: 0 },
    });
  });
});
