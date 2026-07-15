import { describe, expect, it } from "vitest";
import { AssetManifest } from "@engine/assets/AssetManifest";
import { CharacterPresets, isFlyingCharacter } from "@game/characters/CharacterPresets";
import { BlobConfig } from "@game/config/blob.config";
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
    expect(isFlyingCharacter(CharacterPresets.gunship)).toBe(true);
    expect(isFlyingCharacter(CharacterPresets.strider)).toBe(false);
    expect(isFlyingCharacter(CharacterPresets.zombie)).toBe(false);
  });

  it("registers gunship as a procedural flying mini boss", () => {
    const gunship = CharacterPresets.gunship;

    expect(gunship).toBeDefined();
    expect(gunship.modelId).toBeUndefined();
    expect(gunship.aiProfileId).toBe("gunshipBoss");
    expect(gunship.health.maxHealth).toBeGreaterThanOrEqual(600);
    expect(gunship.movement.gravity).toBe(0);
    expect(gunship.perception.eyeHeight).toBeGreaterThan(gunship.collider.radius);
  });

  it("registers strider as a procedural full-size boss", () => {
    const strider = CharacterPresets.strider;

    expect(strider).toBeDefined();
    expect(strider.modelId).toBeUndefined();
    expect(strider.aiProfileId).toBe("striderBoss");
    expect(strider.health.maxHealth).toBeGreaterThanOrEqual(1500);
    expect(strider.collider.height).toBeGreaterThan(8);
    expect(strider.collider.mass).toBeGreaterThan(1000);
    expect(strider.ragdoll.enabled).toBe(false);
    expect(strider.perception.viewDistance).toBeGreaterThanOrEqual(85);
  });

  it("registers blob as a passive procedural creature with aggregate bounds", () => {
    const blob = CharacterPresets.blob;
    const aggregateRadius = BlobConfig.armor.aggregateRadius;

    expect(blob).toBeDefined();
    expect(blob.modelId).toBeUndefined();
    expect(blob.type).toBe("creature");
    expect(blob.faction).toBe("blob");
    expect(blob.aiProfileId).toBe("blobArmor");
    expect(blob.health.maxHealth).toBe(BlobConfig.core.maxHealth);
    expect(blob.collider.radius).toBe(aggregateRadius);
    expect(blob.collider.height).toBe(aggregateRadius * 2);
    expect(blob.attack.enabled).toBe(false);
    expect(blob.ragdoll.enabled).toBe(false);
  });
});
