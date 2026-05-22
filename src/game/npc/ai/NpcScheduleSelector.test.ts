import { describe, expect, it } from "vitest";
import { NpcConditionSet } from "./NpcConditionSet";
import { NpcScheduleSelector } from "./NpcScheduleSelector";
import { getCharacterAIProfile } from "./CharacterAIProfiles";

describe("NpcScheduleSelector", () => {
  it("prioritizes reload over tactical cover", () => {
    const profile = getCharacterAIProfile("combineSoldier");
    const selector = new NpcScheduleSelector(profile);
    const conditions = new NpcConditionSet();
    conditions.set("LowHealth");
    conditions.set("NeedsReload");

    const result = selector.select(conditions, "CombatStand", 2);

    expect(result.schedule.id).toBe("Reload");
    expect(result.changed).toBe(true);
  });

  it("selects cover when soldier is low health and not already in cover", () => {
    const profile = getCharacterAIProfile("combineSoldier");
    const selector = new NpcScheduleSelector(profile);
    const conditions = new NpcConditionSet();
    conditions.set("LowHealth");

    const result = selector.select(conditions, "CombatStand", 2);

    expect(result.schedule.id).toBe("TakeCover");
  });

  it("blocks take cover when a cover slot is already owned", () => {
    const profile = getCharacterAIProfile("combineSoldier");
    const selector = new NpcScheduleSelector(profile);
    const conditions = new NpcConditionSet();
    conditions.set("LowHealth");
    conditions.set("HasCover");
    conditions.set("SeeEnemy");

    const result = selector.select(conditions, "CombatStand", 2);

    expect(result.schedule.id).toBe("CoverFire");
  });
});
