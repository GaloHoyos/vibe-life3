import { describe, expect, it } from "vitest";
import { has, hasAll, hasAny } from "@engine/ai/brain/Condition";
import { Cond, condMask } from "@game/npc/brain/NpcConditions";

describe("NpcConditions", () => {
  it("builds stable condition masks from named condition keys", () => {
    const mask = condMask("SeeEnemy", "LowHealth", "MagazineEmpty");

    expect(has(mask, Cond.SeeEnemy)).toBe(true);
    expect(has(mask, Cond.LowHealth)).toBe(true);
    expect(has(mask, Cond.MagazineEmpty)).toBe(true);
    expect(has(mask, Cond.EnemyDead)).toBe(false);
    expect(hasAll(mask, condMask("SeeEnemy", "LowHealth"))).toBe(true);
    expect(hasAny(mask, condMask("EnemyDead", "MagazineEmpty"))).toBe(true);
  });

  it("assigns every condition a unique single bit within the 31-bit budget", () => {
    const flags = Object.values(Cond);
    const seen = new Set<number>();
    for (const flag of flags) {
      // Potencia de dos exacta (un solo bit).
      expect(flag & (flag - 1)).toBe(0);
      expect(flag).toBeGreaterThan(0);
      // Bit 31 reservado para mantener `>>> 0` predecible.
      expect(flag).toBeLessThanOrEqual(1 << 30);
      expect(seen.has(flag)).toBe(false);
      seen.add(flag);
    }
  });
});
