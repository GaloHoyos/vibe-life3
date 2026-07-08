import type { LevelDefinition } from "@game/levels/LevelDefinition";
import type { MapMeta } from "@game/levels/builders/MapCreator";

export function testMapMeta(overrides: Partial<MapMeta> = {}): MapMeta {
  return {
    id: "test-map",
    title: "Test Map",
    background: 0x101820,
    playerStart: [0, 1.6, 0],
    audio: { ambiences: [], footstepSounds: [] },
    ...overrides,
  };
}

export function testLevelDefinition(overrides: Partial<LevelDefinition> = {}): LevelDefinition {
  return {
    id: "test-level",
    title: "Test Level",
    background: 0x101820,
    playerStart: [0, 1.6, 0],
    audio: { ambiences: [], footstepSounds: [] },
    staticBoxes: [],
    dynamicBoxes: [],
    doors: [],
    npcs: [],
    weaponPickups: [],
    triggers: [],
    ...overrides,
  };
}
