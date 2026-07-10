import { describe, expect, it } from "vitest";
import { applyDefinitionStats } from "@game/characters/CharacterStats";
import { CharacterPresets } from "@game/characters/CharacterPresets";
import { buildCombinePreset } from "@game/npc/presets/combinePreset";
import { buildZombiePreset } from "@game/npc/presets/zombiePreset";

describe("applyDefinitionStats", () => {
  it("pisa vida y percepcion del builder con los valores de CharacterPresets", () => {
    const definition = CharacterPresets.combine;
    const preset = applyDefinitionStats(buildCombinePreset(), definition);

    expect(preset.maxHealth).toBe(definition.health.maxHealth);
    expect(preset.perception.visionRange).toBe(definition.perception.viewDistance);
    expect(preset.perception.visionConeRadians).toBe(definition.perception.viewConeRadians);
    expect(preset.perception.hearingRadius).toBe(definition.perception.hearingRadius);
    expect(preset.perception.memoryTime).toBe(definition.perception.memoryDuration);
    expect(preset.perception.eyeHeight).toBe(definition.perception.eyeHeight);
  });

  it("mantiene el balance runtime previo tras la consolidacion (combine y zombie)", () => {
    // Estos valores eran los efectivos del NpcPreset antes de consolidar; la
    // definicion debe reproducirlos exactamente para no alterar el balance.
    const combine = applyDefinitionStats(buildCombinePreset(), CharacterPresets.combine);
    expect(combine.maxHealth).toBe(50);
    expect(combine.perception.visionRange).toBe(32);
    expect(combine.perception.visionConeRadians).toBeCloseTo((160 * Math.PI) / 180, 10);
    expect(combine.perception.hearingRadius).toBe(18);
    expect(combine.perception.memoryTime).toBe(8);

    const zombie = applyDefinitionStats(buildZombiePreset(), CharacterPresets.zombie);
    expect(zombie.maxHealth).toBe(50);
    expect(zombie.perception.visionRange).toBe(14);
    expect(zombie.perception.visionConeRadians).toBeCloseTo((100 * Math.PI) / 180, 10);
    expect(zombie.perception.hearingRadius).toBe(25);
    expect(zombie.perception.memoryTime).toBe(10);
    expect(zombie.perception.eyeHeight).toBe(0.62);
  });
});
