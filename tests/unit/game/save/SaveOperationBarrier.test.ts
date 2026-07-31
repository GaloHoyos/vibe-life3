import { describe, expect, it } from "vitest";
import { SaveOperationBarrier } from "@game/save/SaveOperationBarrier";

describe("SaveOperationBarrier", () => {
  it("serializa operaciones FIFO y expone sólo la operación activa", async () => {
    const events: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const barrier = new SaveOperationBarrier({
      enter: (operation) => {
        events.push(`enter:${operation}`);
      },
      leave: (operation) => {
        events.push(`leave:${operation}`);
      },
    });

    const first = barrier.run("capture", async () => {
      events.push("first:start");
      await firstGate;
      events.push("first:end");
    });
    const second = barrier.run("restore", async () => {
      events.push("second");
      expect(barrier.currentOperation).toBe("restore");
    });

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(barrier.currentOperation).toBe("capture");
    expect(events).not.toContain("second");
    releaseFirst();
    await Promise.all([first, second]);

    expect(events).toEqual([
      "enter:capture",
      "first:start",
      "first:end",
      "leave:capture",
      "enter:restore",
      "second",
      "leave:restore",
    ]);
    expect(barrier.currentOperation).toBeNull();
  });

  it("no oculta el error primario si también falla leave", async () => {
    const barrier = new SaveOperationBarrier({
      enter: () => undefined,
      leave: () => {
        throw new Error("leave");
      },
    });

    await expect(
      barrier.run("restore", async () => {
        throw new Error("primary");
      }),
    ).rejects.toThrow("primary");
  });
});
