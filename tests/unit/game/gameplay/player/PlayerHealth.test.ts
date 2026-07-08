import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import type { GameEventMap } from "@game/GameEvents";
import { PlayerHealth } from "@game/gameplay/player/PlayerHealth";
import { recordEvents } from "@tests/support/events";

describe("PlayerHealth", () => {
  it("absorbs damage with armor and emits health, armor and damage events", () => {
    const bus = new EventBus<GameEventMap>();
    const healthEvents = recordEvents(bus, "player.health.changed");
    const armorEvents = recordEvents(bus, "player.armor.changed");
    const damageEvents = recordEvents(bus, "player.damaged");
    const player = new PlayerHealth(bus, 100, 50, 50);

    const remaining = player.takeDamage(40, "test", new Vector3(1, 0, 0));

    expect(healthEvents[0]).toEqual({ current: 100, max: 100 });
    expect(armorEvents[0]).toEqual({ current: 50, max: 50 });
    expect(remaining).toBeCloseTo(74);
    expect(player.armor).toBeCloseTo(36);
    expect(damageEvents).toHaveLength(1);
    expect(damageEvents[0].amount).toBeCloseTo(26);
    expect(healthEvents.at(-1)?.current).toBeCloseTo(74);
    expect(armorEvents.at(-1)?.current).toBeCloseTo(36);
  });

  it("emits death once and ignores later damage while dead", () => {
    const bus = new EventBus<GameEventMap>();
    const deadEvents = recordEvents(bus, "player.dead");
    const subtitles = recordEvents(bus, "subtitle.show");
    const damageEvents = recordEvents(bus, "player.damaged");
    const player = new PlayerHealth(bus, 100, 0, 0);

    player.takeDamage(200);
    player.takeDamage(200);

    expect(player.isDead).toBe(true);
    expect(deadEvents).toEqual([{ reason: "damage" }]);
    expect(subtitles).toHaveLength(1);
    expect(damageEvents).toHaveLength(1);
  });

  it("god mode restores vitals and converts damage to a zero-damage event", () => {
    const bus = new EventBus<GameEventMap>();
    const damageEvents = recordEvents(bus, "player.damaged");
    const player = new PlayerHealth(bus, 100, 25, 10);

    expect(player.toggleGodMode()).toBe(true);
    expect(player.current).toBe(100);
    expect(player.armor).toBe(25);

    player.takeDamage(100);

    expect(player.current).toBe(100);
    expect(damageEvents).toEqual([{ amount: 0, direction: undefined }]);
  });
});
