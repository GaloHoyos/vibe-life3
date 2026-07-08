import { describe, expect, it, vi } from "vitest";
import { EventBus } from "@engine/core/EventBus";
import type { GameEventMap } from "@game/GameEvents";
import { DialogueSystem } from "@game/narrative/DialogueSystem";
import { LevelEvents } from "@game/narrative/LevelEvents";
import type { Subtitles } from "@game/ui/subtitles/Subtitles";

describe("game runtime event routes", () => {
  it("routes level announcements through dialogue into subtitles", () => {
    const bus = new EventBus<GameEventMap>();
    const subtitles = { show: vi.fn() } as unknown as Subtitles;
    const dialogue = new DialogueSystem(bus, subtitles);
    const levels = new LevelEvents(bus);

    levels.announceLevel("Sector 2");

    expect(subtitles.show).toHaveBeenCalledWith("Cargando Sector 2.", 2.5, "Sistema");

    dialogue.dispose();
    levels.announceLevel("Sector 3");

    expect(subtitles.show).toHaveBeenCalledTimes(1);
  });
});
