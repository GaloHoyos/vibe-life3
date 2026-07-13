import { describe, expect, it, vi } from "vitest";
import { BlobSurfaceScheduler } from "@engine/blob/BlobSurfaceScheduler";

describe("BlobSurfaceScheduler", () => {
  it("honors the frame budget and carries excess work to the next frame", () => {
    let now = 0;
    const completed: string[] = [];
    const scheduler = new BlobSurfaceScheduler({
      budgetMs: 3.5,
      now: () => now,
    });
    for (const id of ["a", "b", "c"]) {
      scheduler.request({
        id,
        resolution: 32,
        rebuild: () => {
          completed.push(id);
          now += 2;
        },
      });
    }

    const first = scheduler.runFrame();
    expect(completed).toEqual(["a", "b"]);
    expect(first.rebuilt).toBe(2);
    expect(first.deferred).toBe(1);
    expect(scheduler.runFrame().rebuilt).toBe(1);
    expect(completed).toEqual(["a", "b", "c"]);
  });

  it("runs at most one high-quality surface but still uses budget for lower LODs", () => {
    let now = 0;
    const completed: string[] = [];
    const scheduler = new BlobSurfaceScheduler({
      budgetMs: 10,
      maxHighQualityPerFrame: 1,
      now: () => now,
    });
    const add = (id: string, resolution: 40 | 32) =>
      scheduler.request({
        id,
        resolution,
        rebuild: () => {
          completed.push(id);
          now += 1;
        },
      });
    add("hq-a", 40);
    add("hq-b", 40);
    add("mid", 32);

    const stats = scheduler.runFrame();
    expect(stats.highQualityRebuilt).toBe(1);
    expect(completed).toEqual(["hq-a", "mid"]);
    expect(stats.deferred).toBe(1);
  });

  it("coalesces requests and disposes idempotently", () => {
    const scheduler = new BlobSurfaceScheduler();
    const stale = vi.fn();
    const latest = vi.fn();
    scheduler.request({ id: "blob", resolution: 24, rebuild: stale });
    scheduler.request({ id: "blob", resolution: 24, rebuild: latest });
    expect(scheduler.pendingCount).toBe(1);
    scheduler.runFrame();
    expect(stale).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();

    scheduler.dispose();
    scheduler.dispose();
    scheduler.request({ id: "ignored", resolution: 40, rebuild: stale });
    expect(scheduler.pendingCount).toBe(0);
  });

  it("reports a rebuild that exceeds the non-blocking target", () => {
    let now = 0;
    const onSlow = vi.fn();
    const scheduler = new BlobSurfaceScheduler({
      now: () => now,
      slowRebuildMs: 8,
      onSlowRebuild: onSlow,
    });
    scheduler.request({
      id: "slow",
      resolution: 24,
      rebuild: () => {
        now += 9;
      },
    });
    const stats = scheduler.runFrame();
    expect(stats.slowRebuilds).toBe(1);
    expect(onSlow).toHaveBeenCalledOnce();
  });
});
