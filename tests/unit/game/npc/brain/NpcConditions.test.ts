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
});
