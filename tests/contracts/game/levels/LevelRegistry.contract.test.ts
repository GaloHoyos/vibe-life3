import { describe, expect, it } from "vitest";
import { AudioClipCatalog } from "@engine/audio/AudioManifest";
import { CharacterPresets } from "@game/characters/CharacterPresets";
import { AmmoDefinitions, AMMO_ORDER } from "@game/config/ammo.config";
import { Soundscapes } from "@game/config/audio.config";
import { ItemDefinitions, ChargerTypes } from "@game/config/items.config";
import { WeaponDefinitions, WEAPON_ORDER } from "@game/config/weapons.config";
import {
  getAllLevels,
  getCampaignLevels,
  getCustomFolderLevels,
  getLevel,
  LevelRegistry,
} from "@game/levels/LevelRegistry";
import type { LevelDefinition } from "@game/levels/LevelDefinition";
import type { EntityConnection, LogicEntityDefinition } from "@game/script/EntityIOTypes";
import { fromLevelDefinition } from "@game/editor/codegen/fromLevelDefinition";
import { sanitizeDocument } from "@game/workshop/sanitizeDocument";

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

  it("mantiene válido el grafo Entity I/O de todos los mapas registrados", () => {
    for (const level of getAllLevels()) {
      const result = sanitizeDocument(fromLevelDefinition(level));
      expect(result, `${level.id}: ${result.ok ? "" : result.reason}`).toMatchObject({ ok: true });
    }
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

  it("keeps blob-physics-test equipped for damage and physics coverage", () => {
    const level = getLevel("blob-physics-test");
    const weaponIds = new Set(level.weaponPickups.map((pickup) => pickup.weaponId));

    expect(level.npcs).toEqual([
      expect.objectContaining({ characterId: "blob" }),
    ]);
    expect(weaponIds).toEqual(
      new Set(["crowbar", "pistol", "shotgun", "iceGun", "gravityGun", "grenade", "rpg"]),
    );
    expect(level.dynamicBoxes.length).toBeGreaterThan(0);
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

  if (level.audio.soundscape) {
    expect(Soundscapes[level.audio.soundscape]).toBeDefined();
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
    for (const conn of trigger.connections ?? []) {
      expectValidConnection(conn);
    }
  }

  for (const entity of level.logicEntities ?? []) {
    expectValidLogicEntity(entity);
    for (const conn of ("connections" in entity ? entity.connections : undefined) ?? []) {
      expectValidConnection(conn);
    }
  }
}

function expectValidConnection(conn: EntityConnection): void {
  expect(conn.output.length).toBeGreaterThan(0);
  expect(conn.target.length).toBeGreaterThan(0);
  expect(conn.input.length).toBeGreaterThan(0);
  if (conn.delay !== undefined) expect(conn.delay).toBeGreaterThanOrEqual(0);
  if (conn.maxFires !== undefined) expect(conn.maxFires).toBeGreaterThan(0);
}

function expectValidLogicEntity(entity: LogicEntityDefinition): void {
  expect(entity.id.length).toBeGreaterThan(0);
  switch (entity.kind) {
    case "marker":
      expectFiniteTuple(entity.position, 3);
      return;
    case "message":
      expect(entity.text.length).toBeGreaterThan(0);
      expect(entity.duration).toBeGreaterThan(0);
      return;
    case "objective":
      if (entity.marker) expectFiniteTuple(entity.marker, 3);
      return;
    case "soundscape":
      expect(Soundscapes[entity.soundscape]).toBeDefined();
      return;
    case "npcSpawner":
      for (const npc of entity.npcs) {
        expect(CharacterPresets[npc.characterId]).toBeDefined();
        expectFiniteTuple(npc.position, 3);
      }
      return;
    case "counter":
      expect(entity.max).toBeGreaterThan(0);
      return;
    case "timer":
      expect(entity.interval).toBeGreaterThan(0);
      return;
    default:
      return;
  }
}

function expectFiniteTuple(values: readonly number[], size: number): void {
  expect(values).toHaveLength(size);
  for (const value of values) {
    expect(Number.isFinite(value)).toBe(true);
  }
}
