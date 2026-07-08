import { describe, expect, it } from "vitest";
import { HevVoiceQueue, type HevVoiceSink } from "@game/audio/HevVoiceQueue";

interface Harness {
  readonly queue: HevVoiceQueue;
  readonly played: string[];
  readonly stopped: string[];
  advance(seconds: number): void;
}

function makeHarness(availableIds: string[]): Harness {
  const played: string[] = [];
  const stopped: string[] = [];
  const available = new Set(availableIds);
  const sink: HevVoiceSink = {
    play: (id) => played.push(id),
    stop: (id) => stopped.push(id),
    hasSound: (id) => available.has(id),
    getBuffer: async () => null,
  };

  let now = 0;
  let handle = 0;
  const tasks = new Map<number, { at: number; fn: () => void }>();
  const schedule = (fn: () => void, ms: number): ReturnType<typeof setTimeout> => {
    handle += 1;
    tasks.set(handle, { at: now + ms / 1000, fn });
    return handle as unknown as ReturnType<typeof setTimeout>;
  };
  const cancel = (h: ReturnType<typeof setTimeout>): void => {
    tasks.delete(h as unknown as number);
  };

  const advance = (seconds: number): void => {
    const target = now + seconds;
    for (;;) {
      const due = [...tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((a, b) => a[1].at - b[1].at);
      const next = due[0];
      if (!next) {
        now = target;
        return;
      }
      tasks.delete(next[0]);
      now = next[1].at;
      next[1].fn();
    }
  };

  const queue = new HevVoiceQueue(sink, () => now, schedule, cancel);
  return { queue, played, stopped, advance };
}

describe("HevVoiceQueue", () => {
  it("plays one line at a time, in order", () => {
    const h = makeHarness(["a", "b"]);

    h.queue.request({ ids: "a", priority: 10, key: "a", noRepeatSeconds: 0 });
    h.queue.request({ ids: "b", priority: 10, key: "b", noRepeatSeconds: 0 });

    // Sólo la primera suena de inmediato; la segunda espera su turno.
    expect(h.played).toEqual(["a"]);
    h.advance(5);
    expect(h.played).toEqual(["a", "b"]);
  });

  it("drops a repeated key inside its no-repeat window", () => {
    const h = makeHarness(["a"]);

    h.queue.request({ ids: "a", priority: 10, key: "warn", noRepeatSeconds: 5 });
    h.queue.request({ ids: "a", priority: 10, key: "warn", noRepeatSeconds: 5 });
    h.advance(10);

    expect(h.played).toEqual(["a"]);
  });

  it("lets a higher priority line jump ahead of a queued one", () => {
    const h = makeHarness(["current", "low", "high"]);

    h.queue.request({ ids: "current", priority: 50, key: "current", noRepeatSeconds: 0 });
    h.queue.request({ ids: "low", priority: 10, key: "low", noRepeatSeconds: 0 });
    h.queue.request({ ids: "high", priority: 90, key: "high", noRepeatSeconds: 0 });

    h.advance(10);
    expect(h.played).toEqual(["current", "high", "low"]);
  });

  it("interrupts the current line, flushes the queue and speaks now", () => {
    const h = makeHarness(["current", "pending", "flatline"]);

    h.queue.request({ ids: "current", priority: 50, key: "current", noRepeatSeconds: 0 });
    h.queue.request({ ids: "pending", priority: 10, key: "pending", noRepeatSeconds: 0 });
    h.queue.request({
      ids: "flatline",
      priority: 1000,
      key: "death",
      noRepeatSeconds: 0,
      interrupt: true,
    });

    expect(h.stopped).toEqual(["current"]);
    expect(h.played).toEqual(["current", "flatline"]);
    // "pending" fue descartada por la interrupción.
    h.advance(10);
    expect(h.played).toEqual(["current", "flatline"]);
  });

  it("uses the first available id from the candidate list", () => {
    const h = makeHarness(["fallback"]);

    h.queue.request({
      ids: ["primary", "fallback"],
      priority: 10,
      key: "line",
      noRepeatSeconds: 0,
    });

    expect(h.played).toEqual(["fallback"]);
  });
});
