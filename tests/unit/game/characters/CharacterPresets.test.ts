import { describe, expect, it } from "vitest";
import { AssetManifest } from "@engine/assets/AssetManifest";
import { CharacterPresets, isFlyingCharacter } from "@game/characters/CharacterPresets";
import { WeaponDefinitions } from "@game/config/weapons.config";

describe("CharacterPresets", () => {
  it("keeps preset ids, models, colliders and vitals internally valid", () => {
    const modelIds = new Set(Object.keys(AssetManifest.models));
    const seen = new Set<string>();

    for (const [key, preset] of Object.entries(CharacterPresets)) {
      expect(preset.id).toBe(key);
      expect(seen.has(preset.id)).toBe(false);
      seen.add(preset.id);

      if (preset.modelId) {
        expect(modelIds.has(preset.modelId)).toBe(true);
      }

      expect(preset.health.maxHealth).toBeGreaterThan(0);
      expect(preset.collider.height).toBeGreaterThan(0);
      expect(preset.collider.radius).toBeGreaterThan(0);
      expect(preset.collider.mass).toBeGreaterThan(0);
      expect(preset.movement.maxSpeed).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(preset.movement.gravity)).toBe(true);
      expect(Number.isFinite(preset.visualOffset.x)).toBe(true);
      expect(Number.isFinite(preset.visualOffset.y)).toBe(true);
      expect(Number.isFinite(preset.visualOffset.z)).toBe(true);
    }
  });

  it("keeps ranged attack weapon references resolvable", () => {
    for (const preset of Object.values(CharacterPresets)) {
      if (preset.attack.type !== "ranged" || !preset.attack.ranged) {
        continue;
      }

      expect(preset.attack.ranged.weaponId in WeaponDefinitions).toBe(true);
      expect(preset.attack.ranged.burstSize).toBeGreaterThan(0);
      expect(preset.attack.ranged.pauseBetweenBursts).toBeGreaterThan(0);
    }
  });

  it("detects flying characters from gravity configuration", () => {
    expect(isFlyingCharacter(CharacterPresets.manhack)).toBe(true);
    expect(isFlyingCharacter(CharacterPresets.zombie)).toBe(false);
  });
});
