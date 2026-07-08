import { describe, expect, it, vi } from "vitest";
import { Vector3 } from "three";
import type { NpcBrainContext } from "@game/npc/brain/NpcBrainContext";
import { createGunshipEngageTask } from "@game/npc/brain/tasks/GunshipTasks";

describe("GunshipTasks", () => {
  it("orbits the visible threat while aiming and firing", () => {
    const moveTo = vi.fn();
    const aim = vi.fn();
    const tryFire = vi.fn();
    const task = createGunshipEngageTask({
      minRadius: 24,
      maxRadius: 24,
      minHeight: 12,
      maxHeight: 12,
      orbitSpeed: 0,
    });
    const ctx = {
      delta: 1 / 60,
      elapsed: 10,
      self: {
        id: "gunship",
        position: new Vector3(24, 12, 0),
        facing: new Vector3(0, 0, 1),
        faction: "combine",
        isAlive: true,
        health: 600,
        maxHealth: 600,
        radius: 0.95,
      },
      threat: {
        id: "player",
        position: new Vector3(0, 0, 0),
        faction: "player",
        isAlive: true,
        radius: 0.35,
      },
      threatLastKnown: null,
      locomotion: {
        moveTo,
        stop: vi.fn(),
      },
      combat: {
        aim,
        tryFire,
      },
    } as unknown as NpcBrainContext;

    task.init(ctx);
    expect(task.tick(ctx)).toBe("running");

    expect(moveTo).toHaveBeenCalledTimes(1);
    const [target, options] = moveTo.mock.calls[0];
    expect(Math.hypot(target.x, target.z)).toBeCloseTo(24, 3);
    expect(target.y).toBeCloseTo(12, 3);
    expect(options.facing.y).toBeCloseTo(1, 3);
    expect(aim).toHaveBeenCalledWith(ctx.threat?.position);
    expect(tryFire).toHaveBeenCalledTimes(1);
  });
});
