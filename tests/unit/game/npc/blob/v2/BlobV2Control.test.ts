import { describe, expect, it } from "vitest";
import { BlobOrganismController } from "@engine/blob/v2";
import { BlobV2Control } from "@game/npc/blob/v2/BlobV2Control";

describe("BlobV2Control", () => {
  it("conserva fragmentos fuera de los targets de pose y emite poseReached", () => {
    const controller = new BlobOrganismController({ initialBiomass: 48, maximumBiomass: 64 });
    controller.applyImpact({
      point: { x: 0.2, y: 0, z: 0 },
      direction: { x: -1, y: 0, z: 0 },
      damage: 40,
      detachBiomass: 8,
    });
    const control = new BlobV2Control({ controller });
    control.setPose({ id: "column", kind: "column", center: { x: 2, y: 0, z: 3 }, height: 4, radius: 1, duration: 0.5 });

    const frame = control.update(0.5);
    const fragmentCells = new Set(controller.snapshot().fragments.flatMap((fragment) => fragment.cellIds));
    expect(frame?.strength).toBe(1);
    expect(control.getDebugSnapshot()).toMatchObject({
      active: true,
      id: "column",
      kind: "column",
      phase: "held",
      progress: 1,
      strength: 1,
      targetCount: 40,
    });
    expect(Object.keys(frame?.targets ?? {}).every((id) => !fragmentCells.has(Number(id)))).toBe(true);
    expect(control.drainEvents()).toContainEqual({ type: "poseReached", poseId: "column", pose: "column" });
  });

  it("hace reset gradual y mantiene split/merge separados", () => {
    const controller = new BlobOrganismController({ initialBiomass: 48, maximumBiomass: 64 });
    const control = new BlobV2Control({ controller });
    control.setPose({ kind: "sphere", duration: 1 });
    control.update(1);
    control.drainEvents();
    control.resetPose();
    expect(control.update(0.5)?.strength).toBeCloseTo(0.5, 5);
    expect(control.update(0.5)).toBeNull();
    expect(control.getDebugSnapshot()).toEqual({
      active: false,
      id: null,
      kind: null,
      phase: null,
      progress: 0,
      strength: 0,
      targetCount: 0,
    });
    expect(control.drainEvents()).toContainEqual({ type: "poseReset" });

    control.split(3);
    expect(control.drainEvents()).toContainEqual({ type: "split", components: 3 });
    control.merge();
    expect(controller.snapshot().scriptedSplit.mergeRequested).toBe(true);
  });

  it("steers gameplay envelopment without leaking I/O and scripted poses win", () => {
    const controller = new BlobOrganismController({ initialBiomass: 48 });
    const control = new BlobV2Control({ controller });

    expect(control.setGameplayEnvelope(
      "prey-a",
      { x: 1, y: 0.4, z: 0 },
      0.4,
    )).toBe(true);
    expect(control.update(0.42)?.strength).toBe(1);
    expect(control.getDebugSnapshot()).toMatchObject({
      active: true,
      id: "blob-gameplay-envelope:prey-a",
      phase: "held",
    });
    expect(control.drainEvents()).toEqual([]);

    expect(control.resetGameplayEnvelope("prey-a")).toBe(true);
    expect(control.setGameplayEnvelope(
      "prey-a",
      { x: 1.2, y: 0.4, z: 0 },
      0.4,
    )).toBe(true);
    expect(control.getDebugSnapshot().phase).toBe("enter");

    control.setPose({ id: "scripted", kind: "sphere", duration: 0.1 });
    expect(control.setGameplayEnvelope(
      "prey-a",
      { x: 2, y: 0.4, z: 0 },
      0.4,
    )).toBe(false);
    control.update(0.1);
    expect(control.drainEvents()).toContainEqual({
      type: "poseReached",
      poseId: "scripted",
      pose: "sphere",
    });
  });
});
