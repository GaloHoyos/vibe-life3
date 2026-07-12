import { describe, expect, it } from "vitest";
import { has, hasAll, hasAny, type ConditionMask } from "@engine/ai/brain/Condition";
import { Cond, condMask } from "@game/npc/brain/NpcConditions";

/** Cantidad de bits prendidos entre ambos words. */
function popcount(mask: ConditionMask): number {
  let count = 0;
  for (let word of [mask.lo, mask.hi]) {
    word >>>= 0;
    while (word !== 0) {
      count += word & 1;
      word >>>= 1;
    }
  }
  return count;
}

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

  it("assigns every condition a unique single bit across the two words", () => {
    const flags = Object.values(Cond);
    const seen = new Set<string>();
    for (const flag of flags) {
      // Exactamente un bit prendido entre lo/hi.
      expect(popcount(flag)).toBe(1);
      const key = `${flag.lo}:${flag.hi}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});
