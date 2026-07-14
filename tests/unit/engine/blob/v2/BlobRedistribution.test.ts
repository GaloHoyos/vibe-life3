import { describe, expect, it } from "vitest";
import { BLOB_V2_FIXED_STEP_SECONDS, BlobOrganismController } from "@engine/blob/v2";

function advance(controller: BlobOrganismController, seconds: number): void {
  const count = Math.ceil(seconds / BLOB_V2_FIXED_STEP_SECONDS);
  for (let index = 0; index < count; index++) controller.step(BLOB_V2_FIXED_STEP_SECONDS);
}

function detachAndDestroy(controller: BlobOrganismController): number {
  const opening = controller.applyImpact({
    point: { x: 1, y: 0, z: 0 },
    direction: { x: -1, y: 0, z: 0 },
    normal: { x: 1, y: 0, z: 0 },
    damage: 36,
    cohesionEnergy: 36,
    detachBiomass: 8,
    impulse: { x: 0, y: 0, z: 0 },
  });
  if (opening.fragmentId === null) throw new Error("Expected fragment");
  controller.applyImpact({
    point: { x: 1, y: 0, z: 0 },
    direction: { x: -1, y: 0, z: 0 },
    damage: 48,
    fragmentId: opening.fragmentId,
  });
  if (opening.woundId === null) throw new Error("Expected wound");
  return opening.woundId;
}

describe("Blob breach redistribution and repair", () => {
  it("waits 3 seconds, redistributes for 2, and moves weakness without creating biomass", () => {
    const controller = new BlobOrganismController({
      coverageSectors: [
        { id: "near", center: { x: 0.8, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 }, availableBiomass: 24 },
        { id: "far", center: { x: -2, y: 0, z: 0 }, normal: { x: -1, y: 0, z: 0 }, availableBiomass: 24 },
      ],
    });
    const sourceWoundId = detachAndDestroy(controller);
    expect(controller.snapshot().biomass.total).toBe(184);

    advance(controller, 2.9);
    expect(controller.snapshot().core.state).toBe("Exposed");
    advance(controller, 0.11);
    expect(controller.snapshot().core.state).toBe("Redistributing");
    expect(controller.snapshot().biomass.total).toBe(184);

    advance(controller, 2.01);
    const snapshot = controller.snapshot();
    const source = snapshot.wounds.find((wound) => wound.id === sourceWoundId);
    const relocated = snapshot.wounds.find((wound) => wound.sourceWoundId === sourceWoundId);
    expect(source?.state).toBe("Closed");
    expect(relocated).toMatchObject({
      state: "Stressed",
      point: { x: -2, y: 0, z: 0 },
      repairDeficit: 8,
    });
    expect(relocated?.cohesionThreshold).toBeLessThan(36);
    expect(snapshot.core.state).toBe("Covered");
    expect(snapshot.biomass).toMatchObject({ total: 184, attached: 184, fragments: 0 });
    expect(controller.drainEvents()).toContainEqual({
      type: "breachRelocated",
      woundId: sourceWoundId,
      newWoundId: relocated?.id,
      sectorId: "far",
    });
  });

  it("leaves the original breach exposed when no sector can pay its cost", () => {
    const controller = new BlobOrganismController({
      coverageSectors: [
        { id: "thin", center: { x: -2, y: 0, z: 0 }, availableBiomass: 4 },
      ],
    });
    const woundId = detachAndDestroy(controller);
    advance(controller, 6);
    expect(controller.snapshot().wounds.find((wound) => wound.id === woundId)?.state).toBe("Exposed");
    expect(controller.snapshot().core.state).toBe("Exposed");
  });

  it("uses consumed biomass on the deepest wound before restoring/growing", () => {
    const controller = new BlobOrganismController({ coverageSectors: [] });
    detachAndDestroy(controller);
    const consumption = controller.consumeBiomass(8);

    expect(consumption).toMatchObject({ accepted: 8, repaired: 8, restored: 8, growth: 0 });
    expect(controller.snapshot().biomass).toMatchObject({ total: 192, attached: 192, fragments: 0 });
    expect(controller.snapshot().core.state).toBe("Covered");
    expect(controller.snapshot().wounds[0]?.state).toBe("Closed");
  });
});
