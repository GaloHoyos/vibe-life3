import { describe, expect, it } from "vitest";
import { EventBus } from "@engine/core/EventBus";
import type { GameEventMap } from "@game/GameEvents";
import { PlayerConfig } from "@game/config/gameplay.config";
import { Stamina } from "@game/gameplay/player/Stamina";
import { recordEvents } from "@tests/support/events";

describe("Stamina", () => {
  it("drains to depletion and recovers after the regen delay", () => {
    const bus = new EventBus<GameEventMap>();
    const events = recordEvents(bus, "player.stamina.changed");
    const stamina = new Stamina(bus);

    expect(events[0]).toEqual({
      current: PlayerConfig.stamina.max,
      max: PlayerConfig.stamina.max,
      depleted: false,
    });

    stamina.tick(7.1, true);

    expect(stamina.getCurrent()).toBe(0);
    expect(stamina.isDepleted()).toBe(true);
    expect(events.at(-1)?.depleted).toBe(true);

    stamina.tick(PlayerConfig.stamina.regenDelay - 0.01, false);
    expect(stamina.getCurrent()).toBe(0);

    stamina.tick(2, false);

    expect(stamina.getCurrent()).toBeGreaterThan(PlayerConfig.stamina.rechargeUnlockPercent);
    expect(stamina.isDepleted()).toBe(false);
    expect(events.at(-1)?.depleted).toBe(false);
  });
});
