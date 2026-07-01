import { describe, expect, it } from "vitest";
import { AudioClipCatalog } from "@engine/audio/AudioManifest";
import { CharacterPresets } from "@game/characters/CharacterPresets";
import { AmmoDefinitions, AMMO_ORDER } from "@game/config/ammo.config";
import { ItemDefinitions, ChargerTypes } from "@game/config/items.config";
import { WeaponDefinitions, WEAPON_ORDER } from "@game/config/weapons.config";
import {
  getAllLevels,
  getCampaignLevels,
  getCustomFolderLevels,
  getLevel,
  LevelRegistry,
} from "@game/levels/LevelRegistry";
import type { LevelDefinition, TriggerAction } from "@game/levels/LevelDefinition";

describe("LevelRegistry contracts", () => {
  it("registers campaign and custom levels with unique ids", () => {
    const levels = getAllLevels();
    const ids = levels.map((level) => level.id);

    expect(levels.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(LevelRegistry).sort()).toEqual([...ids].sort());
    expect(getCampaignLevels().length).toBeGreaterThan(0);
    expect(getCustomFolderLevels().length).toBeGreaterThan(0);

    for (const level of levels) {
      expect(getLevel(level.id)).toBe(level);
    }
  });

  it("keeps registered level references resolvable", () => {
    const levels = getAllLevels();
    const levelIds = new Set(levels.map((level) => level.id));

    for (const level of levels) {
      expectValidLevel(level, levelIds);
    }

    expect(() => getLevel("__missing__")).toThrow(/no registrado/);
  });

  it("keeps weapon-scale-test covering every weapon and ammo pickup", () => {
    const level = getLevel("weapon-scale-test");

    expect(level.weaponPickups.map((pickup) => pickup.weaponId).sort()).toEqual(
      [...WEAPON_ORDER].sort(),
    );
    expect((level.ammoPickups ?? []).map((pickup) => pickup.ammoId).sort()).toEqual(
      [...AMMO_ORDER].sort(),
    );
    expect(level.npcs).toHaveLength(0);
    expect(level.triggers).toHaveLength(0);
  });
});

function expectValidLevel(level: LevelDefinition, levelIds: ReadonlySet<string>): void {
  expect(level.id.trim()).toBe(level.id);
  expect(level.title.length).toBeGreaterThan(0);
  expectFiniteTuple(level.playerStart, 3);
  expect(level.audio.ambiences.length).toBeGreaterThan(0);

  for (const soundId of [
    ...level.audio.ambiences,
    ...level.audio.footstepSounds,
    ...(level.audio.music ? [level.audio.music] : []),
  ]) {
    expect(AudioClipCatalog[soundId]).toBeDefined();
  }

  if (level.nextLevel) {
    expect(levelIds.has(level.nextLevel)).toBe(true);
  }

  for (const npc of level.npcs) {
    expect(CharacterPresets[npc.characterId]).toBeDefined();
    expectFiniteTuple(npc.position, 3);
  }

  for (const pickup of level.weaponPickups) {
    expect(WeaponDefinitions[pickup.weaponId]).toBeDefined();
    expectFiniteTuple(pickup.position, 3);
  }

  for (const pickup of level.itemPickups ?? []) {
    expect(ItemDefinitions[pickup.itemId]).toBeDefined();
    expectFiniteTuple(pickup.position, 3);
  }

  for (const pickup of level.ammoPickups ?? []) {
    expect(AmmoDefinitions[pickup.ammoId]).toBeDefined();
    expectFiniteTuple(pickup.position, 3);
  }

  for (const charger of level.chargers ?? []) {
    expect(ChargerTypes[charger.kind]).toBeDefined();
    expectFiniteTuple(charger.position, 3);
  }

  for (const trigger of level.triggers) {
    expectFiniteTuple(trigger.position, 3);
    expectFiniteTuple(trigger.size, 3);
    for (const action of trigger.actions ?? []) {
      expectValidTriggerAction(action);
    }
  }
}

function expectValidTriggerAction(action: TriggerAction): void {
  if (action.delay !== undefined) {
    expect(action.delay).toBeGreaterThanOrEqual(0);
  }

  if (action.kind === "spawnNpcs") {
    for (const npc of action.npcs) {
      expect(CharacterPresets[npc.characterId]).toBeDefined();
      expectFiniteTuple(npc.position, 3);
    }
  }

  if (action.kind === "objective" && action.marker) {
    expectFiniteTuple(action.marker, 3);
  }

  if (action.kind === "dialogue") {
    expect(action.text.length).toBeGreaterThan(0);
    expect(action.duration).toBeGreaterThan(0);
  }
}

function expectFiniteTuple(values: readonly number[], size: number): void {
  expect(values).toHaveLength(size);
  for (const value of values) {
    expect(Number.isFinite(value)).toBe(true);
  }
}
