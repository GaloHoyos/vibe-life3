import { describe, expect, it, vi } from "vitest";
import { EventBus } from "@engine/core/EventBus";
import type { GameEventMap } from "@game/GameEvents";
import { DialogueSystem } from "@game/narrative/DialogueSystem";
import { LevelEvents } from "@game/narrative/LevelEvents";
import { ScriptedSequence } from "@game/narrative/ScriptedSequence";
import type { Subtitles } from "@game/ui/subtitles/Subtitles";
import { recordEvents } from "@tests/support/events";

describe("ScriptedSequence", () => {
  it("runs delayed steps in order and stops after completion", () => {
    const calls: string[] = [];
    const sequence = new ScriptedSequence([
      { delay: 0.5, action: () => calls.push("first") },
      { delay: 1.0, action: () => calls.push("second") },
    ]);

    sequence.update(1);
    expect(calls).toEqual([]);

    sequence.play();
    sequence.update(0.49);
    expect(calls).toEqual([]);
    sequence.update(0.01);
    expect(calls).toEqual(["first"]);
    sequence.update(0.49);
    expect(calls).toEqual(["first"]);
    sequence.update(0.01);
    expect(calls).toEqual(["first", "second"]);
    sequence.update(10);
    expect(calls).toEqual(["first", "second"]);
  });
});

describe("DialogueSystem", () => {
  it("bridges dialogue and subtitle events to subtitles and disposes subscriptions", () => {
    const bus = new EventBus<GameEventMap>();
    const subtitles = { show: vi.fn() } as unknown as Subtitles;
    const system = new DialogueSystem(bus, subtitles);

    bus.emit("dialogue.show", { speaker: "HEV", text: "Ready", duration: 1 });
    bus.emit("subtitle.show", { text: "Objective updated", duration: 2 });

    expect(subtitles.show).toHaveBeenNthCalledWith(1, "Ready", 1, "HEV");
    expect(subtitles.show).toHaveBeenNthCalledWith(2, "Objective updated", 2, undefined);

    system.dispose();
    bus.emit("dialogue.show", { text: "Ignored", duration: 1 });

    expect(subtitles.show).toHaveBeenCalledTimes(2);
  });
});

describe("LevelEvents", () => {
  it("announces level loading through the dialogue event route", () => {
    const bus = new EventBus<GameEventMap>();
    const events = recordEvents(bus, "dialogue.show");

    new LevelEvents(bus).announceLevel("Sector 1");

    expect(events).toEqual([
      {
        speaker: "Sistema",
        text: "Cargando Sector 1.",
        duration: 2.5,
      },
    ]);
  });
});
