import { describe, expect, it } from "vitest";
import { EventBus } from "@engine/core/EventBus";
import { UISoundSystem } from "@game/audio/UISoundSystem";
import type { GameEventMap } from "@game/GameEvents";
import { fakeSoundManager } from "@tests/support/fakes/audio";

describe("UISoundSystem", () => {
  it("plays mapped HL2 menu cues on ui.sound events", () => {
    const bus = new EventBus<GameEventMap>();
    const sounds = fakeSoundManager([
      "ui.hl2.buttonRollover",
      "ui.hl2.buttonClick",
      "ui.hl2.buttonClickRelease",
    ]);

    new UISoundSystem(bus, sounds);

    bus.emit("ui.sound", { cue: "hover" });
    bus.emit("ui.sound", { cue: "press" });
    bus.emit("ui.sound", { cue: "release" });
    bus.emit("ui.sound", { cue: "back" });

    expect(sounds.played).toEqual([
      { id: "ui.hl2.buttonRollover", options: { bus: "ui" } },
      { id: "ui.hl2.buttonClick", options: { bus: "ui" } },
      { id: "ui.hl2.buttonClickRelease", options: { bus: "ui" } },
      { id: "ui.hl2.buttonClickRelease", options: { bus: "ui" } },
    ]);
  });
});
