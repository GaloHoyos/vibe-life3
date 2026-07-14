import { EventBus } from "@engine/core/EventBus";
import { BlobOrganismController } from "@engine/blob/v2";
import type { GameEventMap } from "@game/GameEvents";
import { BlobV2Audio } from "@game/npc/blob/v2/BlobV2Audio";
import { describe, expect, it, vi } from "vitest";

describe("BlobV2Audio", () => {
  it("emits deterministic slosh and topology cues independently from rendering", () => {
    const controller = new BlobOrganismController();
    const eventBus = new EventBus<GameEventMap>();
    const footstep = vi.fn();
    const topology = vi.fn();
    eventBus.on("npc.footstep", footstep);
    eventBus.on("npc.attack", topology);
    const audio = new BlobV2Audio({ ownerId: "blob-a", eventBus });

    audio.tick(0.1, controller.snapshot());
    controller.transformIsland(controller.topology.mainIslandId, {
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      translation: { x: 1, y: 0, z: 0 },
    });
    audio.tick(0.1, controller.snapshot());
    expect(footstep).toHaveBeenCalledOnce();
    expect(topology).not.toHaveBeenCalled();

    const core = controller.snapshot().core.position;
    controller.applyImpact({
      point: { x: core.x + 0.5, y: core.y, z: core.z },
      normal: { x: 1, y: 0, z: 0 },
      direction: { x: -1, y: 0, z: 0 },
      damage: 40,
      cohesionEnergy: 40,
      detachBiomass: 8,
    });
    audio.tick(0.1, controller.snapshot());
    audio.tick(0.1, controller.snapshot());
    expect(topology).toHaveBeenCalledOnce();

    audio.dispose();
    controller.transformIsland(controller.topology.mainIslandId, {
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      translation: { x: 1, y: 0, z: 0 },
    });
    audio.tick(1, controller.snapshot());
    expect(footstep).toHaveBeenCalledOnce();
  });
});
