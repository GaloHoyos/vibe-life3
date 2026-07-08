import { describe, expect, it, vi } from "vitest";
import { Scene, Vector3 } from "three";
import type { Raycast } from "@engine/physics/Raycast";
import type { VfxSystem } from "@engine/render/effects/VfxSystem";
import { EventBus } from "@engine/core/EventBus";
import type { GameEventMap } from "@game/GameEvents";
import { NpcBloodEffects } from "@game/gameplay/effects/NpcBloodEffects";

describe("NpcBloodEffects", () => {
  it("spawns blood and a decal for organic NPC damage with a hit point", () => {
    const { bus, scene, raycast, vfx } = setup();
    new NpcBloodEffects(scene, bus, raycast, vfx);

    bus.emit("npc.damaged", {
      id: "z-1",
      characterId: "zombie",
      amount: 18,
      health: 42,
      point: new Vector3(0, 1, 0),
      direction: new Vector3(1, 0, 0),
      bodyPart: "chest",
      attackerId: "player",
    });

    expect(vfx.bloodImpact).toHaveBeenCalledTimes(1);
    expect(vfx.bloodImpact).toHaveBeenCalledWith(
      expect.any(Vector3),
      expect.any(Vector3),
      expect.objectContaining({ variant: "direct" }),
    );
    expect(scene.children).toHaveLength(1);
  });

  it("ignores robots and damage without a hit point", () => {
    const { bus, scene, raycast, vfx } = setup();
    new NpcBloodEffects(scene, bus, raycast, vfx);

    bus.emit("npc.damaged", {
      id: "m-1",
      characterId: "manhack",
      amount: 18,
      health: 8,
      point: new Vector3(0, 1, 0),
      direction: new Vector3(1, 0, 0),
    });
    bus.emit("npc.damaged", {
      id: "z-1",
      characterId: "zombie",
      amount: 18,
      health: 42,
    });

    expect(vfx.bloodImpact).not.toHaveBeenCalled();
    expect(scene.children).toHaveLength(0);
  });

  it("throttles bursts and decals per NPC until update clears frame counters", () => {
    const { bus, scene, raycast, vfx } = setup();
    const system = new NpcBloodEffects(scene, bus, raycast, vfx);

    for (let i = 0; i < 6; i += 1) {
      bus.emit("npc.damaged", {
        id: "z-1",
        characterId: "zombie",
        amount: 8,
        health: 80 - i,
        point: new Vector3(0, 1, 0),
        direction: new Vector3(1, 0, 0),
      });
    }

    expect(vfx.bloodImpact).toHaveBeenCalledTimes(4);
    expect(scene.children).toHaveLength(2);

    system.update(1 / 60);
    bus.emit("npc.damaged", {
      id: "z-1",
      characterId: "zombie",
      amount: 8,
      health: 70,
      point: new Vector3(0, 1, 0),
      direction: new Vector3(1, 0, 0),
    });

    expect(vfx.bloodImpact).toHaveBeenCalledTimes(5);
    expect(scene.children).toHaveLength(3);
  });

  it("clears decals and unsubscribes on dispose", () => {
    const { bus, scene, raycast, vfx } = setup();
    const system = new NpcBloodEffects(scene, bus, raycast, vfx);

    bus.emit("npc.damaged", {
      id: "z-1",
      characterId: "zombie",
      amount: 18,
      health: 42,
      point: new Vector3(0, 1, 0),
      direction: new Vector3(1, 0, 0),
    });
    expect(scene.children).toHaveLength(1);

    system.clear();
    expect(scene.children).toHaveLength(0);

    system.dispose();
    bus.emit("npc.damaged", {
      id: "z-1",
      characterId: "zombie",
      amount: 18,
      health: 24,
      point: new Vector3(0, 1, 0),
      direction: new Vector3(1, 0, 0),
    });
    expect(vfx.bloodImpact).toHaveBeenCalledTimes(1);
    expect(scene.children).toHaveLength(0);
  });
});

function setup() {
  const bus = new EventBus<GameEventMap>();
  const scene = new Scene();
  const raycast = {
    cast: vi.fn(() => ({
      collider: {},
      metadata: { id: "wall", kind: "static" },
      point: new Vector3(1, 0, 0),
      normal: new Vector3(0, 1, 0),
      toi: 1,
    })),
  } as unknown as Raycast;
  const vfx = {
    bloodImpact: vi.fn(),
  } as unknown as VfxSystem & { bloodImpact: ReturnType<typeof vi.fn> };
  return { bus, scene, raycast, vfx };
}
