import { describe, expect, it, vi } from "vitest";
import { BlobBehaviorController, BlobOrganismController } from "@engine/blob/v2";

describe("BlobBehaviorController", () => {
  it("owns independent organism, traversal and override state machines", () => {
    const changed = vi.fn();
    const behavior = new BlobBehaviorController({ onChanged: changed });

    expect(behavior.snapshot()).toEqual({
      organismState: "Idle",
      traversalState: "Ground",
      overrideState: "None",
    });
    behavior.setOrganismState("Hunt");
    behavior.setTraversalState("Climb");
    behavior.setOverrideState("ScriptedPose");

    expect(behavior.snapshot()).toEqual({
      organismState: "Hunt",
      traversalState: "Climb",
      overrideState: "ScriptedPose",
    });
    expect(behavior.scriptedPoseActive).toBe(true);
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it("freezes simulation reversibly, while Dead is terminal", () => {
    const behavior = new BlobBehaviorController();
    behavior.setOverrideState("Frozen");
    expect(behavior.simulationEnabled).toBe(false);
    expect(behavior.setOverrideState("None")).toBe(true);
    expect(behavior.simulationEnabled).toBe(true);

    expect(behavior.setOverrideState("Dead")).toBe(true);
    expect(behavior.setOverrideState("None")).toBe(false);
    expect(behavior.setOrganismState("Digest")).toBe(false);
    expect(behavior.setTraversalState("PortalTraverse")).toBe(false);
    expect(behavior.snapshot()).toEqual({
      organismState: "Idle",
      traversalState: "Ground",
      overrideState: "Dead",
    });
  });

  it("is the state authority exposed by BlobOrganismController snapshots", () => {
    const controller = new BlobOrganismController();
    controller.setOrganismState("Envelop");
    controller.setTraversalState("Squeeze");
    controller.setOverrideState("Frozen");

    expect(controller.snapshot()).toMatchObject({
      organismState: "Envelop",
      traversalState: "Squeeze",
      overrideState: "Frozen",
    });
    expect(controller.behavior.simulationEnabled).toBe(false);
  });
});
