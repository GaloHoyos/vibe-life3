import { describe, expect, it, vi } from "vitest";
import { Vector3 } from "three";
import type { NpcBrainContext } from "@game/npc/brain/NpcBrainContext";
import { createStriderCloseTask, createStriderEngageTask } from "@game/npc/brain/tasks/StriderTasks";

describe("StriderTasks", () => {
  it("uses cannon intent when the visible threat is valid and secondary is ready", () => {
    const ctx = makeContext({
      canUseIntent: (intent) => intent === "secondary",
    });
    const task = createStriderEngageTask();

    task.init(ctx);
    expect(task.tick(ctx)).toBe("running");

    expect(ctx.locomotion.stop).toHaveBeenCalledTimes(1);
    expect(ctx.combat.setIntent).toHaveBeenCalledWith("secondary");
    expect(ctx.combat.tryFire).toHaveBeenCalledTimes(1);
  });

  it("falls back to minigun movement when cannon is not ready", () => {
    const ctx = makeContext({
      canUseIntent: () => false,
    });
    const task = createStriderEngageTask();

    task.init(ctx);
    expect(task.tick(ctx)).toBe("running");

    expect(ctx.locomotion.moveTo).toHaveBeenCalledTimes(1);
    expect(ctx.combat.setIntent).toHaveBeenCalledWith("primary");
    expect(ctx.combat.tryFire).toHaveBeenCalledTimes(1);
  });

  it("stomps when close and melee intent is ready", () => {
    const ctx = makeContext({
      canUseIntent: (intent) => intent === "melee",
      selfPosition: new Vector3(0, 6, 0),
      threatPosition: new Vector3(1, 0, 1),
    });
    const task = createStriderCloseTask();

    expect(task.tick(ctx)).toBe("running");

    expect(ctx.locomotion.stop).toHaveBeenCalledTimes(1);
    expect(ctx.combat.setIntent).toHaveBeenCalledWith("melee");
    expect(ctx.combat.tryFire).toHaveBeenCalledTimes(1);
  });
});

function makeContext(options: {
  canUseIntent: (intent: "primary" | "secondary" | "melee") => boolean;
  selfPosition?: Vector3;
  threatPosition?: Vector3;
}): NpcBrainContext {
  const selfPosition = options.selfPosition ?? new Vector3(32, 6, 0);
  const threatPosition = options.threatPosition ?? new Vector3(0, 0, 0);
  return {
    delta: 1 / 60,
    elapsed: 4,
    self: {
      id: "strider",
      position: selfPosition,
      facing: new Vector3(0, 0, 1),
      faction: "combine",
      isAlive: true,
      health: 1500,
      maxHealth: 1500,
      radius: 1.35,
    },
    threat: {
      id: "player",
      position: threatPosition,
      faction: "player",
      entity: {
        applyDamage: vi.fn(),
        isAlive: () => true,
      },
      isAlive: true,
      radius: 0.35,
    },
    threatLastKnown: null,
    player: {
      id: "player",
      position: threatPosition,
      faction: "player",
      entity: {
        applyDamage: vi.fn(),
        isAlive: () => true,
      },
      isAlive: true,
      radius: 0.35,
    },
    patrolRoute: null,
    noise: { combat: null, suspicious: null },
    tactical: null,
    squad: null,
    conditions: 0,
    navSpace: {} as NpcBrainContext["navSpace"],
    buildingRegistry: {} as NpcBrainContext["buildingRegistry"],
    locomotion: {
      moveTo: vi.fn(),
      stop: vi.fn(),
      distanceToTarget: () => 0,
      hasPath: () => false,
      isStuck: () => false,
      face: vi.fn(),
      leap: vi.fn(),
      isLeaping: () => false,
    },
    combat: {
      tick: vi.fn(),
      aim: vi.fn(),
      scan: vi.fn(),
      tryFire: vi.fn(() => true),
      setIntent: vi.fn(),
      canUseIntent: vi.fn(options.canUseIntent),
      reload: vi.fn(),
      isReloading: () => false,
      magazineEmpty: () => false,
      effectiveRange: () => 85,
    },
    eventBus: {} as NpcBrainContext["eventBus"],
  };
}
