import { describe, expect, it } from "vitest";
import { Health } from "@game/gameplay/Health";

describe("Health", () => {
  it("clamps damage, healing and explicit set values", () => {
    const health = new Health(100);

    expect(health.applyDamage(30)).toBe(70);
    expect(health.heal(10)).toBe(80);
    expect(health.heal(100)).toBe(100);
    expect(health.set(-10)).toBe(0);
    expect(health.isAlive()).toBe(false);
    expect(health.wasDepleted()).toBe(true);
    expect(health.heal(25)).toBe(25);
    expect(health.isAlive()).toBe(true);
  });

  it("ignores repeated damage after depletion until restored", () => {
    const health = new Health(50);

    expect(health.applyDamage(60)).toBe(0);
    expect(health.applyDamage(10)).toBe(0);

    health.reset();

    expect(health.current).toBe(50);
    expect(health.wasDepleted()).toBe(false);
  });
});
