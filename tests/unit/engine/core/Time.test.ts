import { describe, expect, it } from "vitest";
import { Time } from "@engine/core/Time";

describe("Time", () => {
  it("keeps the shared frame delta monotonic when a RAF timestamp trails reset", () => {
    const time = new Time();
    time.reset(100);

    time.update(99);

    expect(time.delta).toBe(0);
    expect(time.elapsed).toBe(0);

    time.update(116);

    expect(time.delta).toBeCloseTo(0.016);
    expect(time.elapsed).toBeCloseTo(0.016);
  });

  it("continues to cap long frames at 50 milliseconds", () => {
    const time = new Time();
    time.reset(100);

    time.update(1_100);

    expect(time.delta).toBe(1 / 20);
    expect(time.elapsed).toBe(1 / 20);
  });

  it("ignores a non-finite frame timestamp without poisoning later frames", () => {
    const time = new Time();
    time.reset(100);

    time.update(Number.NaN);

    expect(time.delta).toBe(0);
    expect(time.elapsed).toBe(0);

    time.update(116);

    expect(time.delta).toBeCloseTo(0.016);
    expect(time.elapsed).toBeCloseTo(0.016);
  });
});
