import { describe, expect, it, vi } from "vitest";
import { Vector3 } from "three";
import type { ActorSnapshot } from "@game/npc/core/INpc";
import type { NpcBrainContext } from "@game/npc/brain/NpcBrainContext";
import { createHealAllyTask } from "@game/npc/brain/tasks/SupportTasks";

function makeTarget(x: number, alive = true): ActorSnapshot {
  return {
    id: "player",
    position: new Vector3(x, 0, 0),
    faction: "player",
    entity: { applyDamage: vi.fn(), isAlive: () => alive },
    isAlive: alive,
    radius: 0.35,
    health01: 0.3,
  };
}

function makeCtx(target: ActorSnapshot | null, heal = vi.fn(() => true)): NpcBrainContext {
  return {
    delta: 0.2,
    elapsed: 10,
    self: { position: new Vector3(0, 0, 0) },
    medic: target ? { target, heal } : null,
    locomotion: {
      moveTo: vi.fn(),
      stop: vi.fn(),
      face: vi.fn(),
      distanceToTarget: () => Infinity,
      hasPath: () => false,
      isStuck: () => false,
      leap: vi.fn(),
      isLeaping: () => false,
    },
  } as unknown as NpcBrainContext;
}

describe("createHealAllyTask", () => {
  it("corre hacia el aliado lejano sin castear", () => {
    const heal = vi.fn(() => true);
    const ctx = makeCtx(makeTarget(10), heal);
    const task = createHealAllyTask(0.4);
    task.init(ctx);
    expect(task.tick(ctx)).toBe("running");
    expect(ctx.locomotion.moveTo).toHaveBeenCalled();
    expect(heal).not.toHaveBeenCalled();
  });

  it("castea junto al aliado y aplica el heal al terminar", () => {
    const heal = vi.fn(() => true);
    const ctx = makeCtx(makeTarget(1), heal);
    const task = createHealAllyTask(0.4);
    task.init(ctx);
    expect(task.tick(ctx)).toBe("running"); // cast 0.2/0.4
    expect(ctx.locomotion.face).toHaveBeenCalled();
    expect(task.tick(ctx)).toBe("success"); // cast 0.4/0.4
    expect(heal).toHaveBeenCalledWith(ctx.elapsed);
  });

  it("falla sin objetivo o con el objetivo muerto", () => {
    const noTarget = makeCtx(null);
    const task = createHealAllyTask(0.4);
    task.init(noTarget);
    expect(task.tick(noTarget)).toBe("failure");

    const dead = makeCtx(makeTarget(1, false));
    task.init(dead);
    expect(task.tick(dead)).toBe("failure");
  });
});
