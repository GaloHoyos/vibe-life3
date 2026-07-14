import { describe, expect, it, vi } from "vitest";
import { Vector3 } from "three";
import type { NpcBrainContext, NpcSlotHandle } from "@game/npc/brain/NpcBrainContext";
import { createThrowGrenadeTask } from "@game/npc/brain/tasks/SquadTasks";

function makeSlots(overrides: Partial<NpcSlotHandle> = {}): NpcSlotHandle {
  return {
    claimOverwatch: vi.fn(() => true),
    releaseOverwatch: vi.fn(),
    claimGrenade: vi.fn(() => true),
    releaseGrenade: vi.fn(),
    throwGrenade: vi.fn(() => true),
    ...overrides,
  };
}

function makeCtx(slots: NpcSlotHandle | null, elapsed = 10): NpcBrainContext {
  return {
    delta: 0.1,
    elapsed,
    threatLastKnown: new Vector3(5, 0, 5),
    locomotion: {
      stop: vi.fn(),
      face: vi.fn(),
      moveTo: vi.fn(),
      distanceToTarget: () => Infinity,
      hasPath: () => false,
      isStuck: () => false,
      leap: vi.fn(),
      isLeaping: () => false,
    },
    slots,
  } as unknown as NpcBrainContext;
}

describe("createThrowGrenadeTask", () => {
  it("falla sin claim del slot de granada", () => {
    const slots = makeSlots({ claimGrenade: vi.fn(() => false) });
    const ctx = makeCtx(slots);
    const task = createThrowGrenadeTask();
    task.init(ctx);
    expect(task.tick(ctx)).toBe("failure");
    expect(slots.throwGrenade).not.toHaveBeenCalled();
  });

  it("hace windup encarando la LKP y lanza con lockout de squad", () => {
    const slots = makeSlots();
    const ctx = makeCtx(slots);
    const task = createThrowGrenadeTask(0.25);
    task.init(ctx);

    // Durante el windup encara sin lanzar.
    expect(task.tick(ctx)).toBe("running");
    expect(ctx.locomotion.face).toHaveBeenCalled();
    expect(slots.throwGrenade).not.toHaveBeenCalled();

    expect(task.tick(ctx)).toBe("running");
    expect(task.tick(ctx)).toBe("success");
    expect(slots.throwGrenade).toHaveBeenCalledWith(ctx.elapsed);
    expect(slots.releaseGrenade).toHaveBeenCalledWith(expect.any(Number));
    const lockout = vi.mocked(slots.releaseGrenade).mock.calls[0][0];
    expect(lockout).toBeGreaterThan(0);
  });

  it("si el lanzamiento falla libera el slot sin lockout", () => {
    const slots = makeSlots({ throwGrenade: vi.fn(() => false) });
    const ctx = makeCtx(slots);
    const task = createThrowGrenadeTask(0.05);
    task.init(ctx);
    expect(task.tick(ctx)).toBe("failure");
    expect(slots.releaseGrenade).toHaveBeenCalledWith(0);
  });

  it("abort libera el slot reclamado sin castigo", () => {
    const slots = makeSlots();
    const ctx = makeCtx(slots);
    const task = createThrowGrenadeTask(1.0);
    task.init(ctx);
    expect(task.tick(ctx)).toBe("running");
    task.abort(ctx);
    expect(slots.releaseGrenade).toHaveBeenCalledWith();
    expect(slots.throwGrenade).not.toHaveBeenCalled();
  });

  it("pierde la LKP a mitad del windup: falla y libera", () => {
    const slots = makeSlots();
    const ctx = makeCtx(slots);
    const task = createThrowGrenadeTask(1.0);
    task.init(ctx);
    expect(task.tick(ctx)).toBe("running");
    (ctx as { threatLastKnown: Vector3 | null }).threatLastKnown = null;
    expect(task.tick(ctx)).toBe("failure");
    expect(slots.releaseGrenade).toHaveBeenCalledWith();
  });
});
