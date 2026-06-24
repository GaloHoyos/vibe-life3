import type { MaterialKey } from '@engine/render/material/Materials';
import type { SkyboxId } from '@engine/render/environment/Skybox';
import { SkyboxManifest } from '@engine/render/environment/Skybox';
import { WEAPON_ORDER } from '@game/config/weapons.config';
import type { WeaponId } from '@game/gameplay/weapons/core/WeaponDefinition';
import {
  ChargerTypes,
  ItemDefinitions,
  type ChargerKind,
  type ItemId,
} from '@game/config/items.config';
import { CharacterPresets } from '@game/characters/CharacterPresets';
import type { CharacterId } from '@engine/characters/CharacterDefinition';
import type { LevelActionKind } from '@game/GameEvents';
import type { TriggerAction } from '@game/levels/LevelDefinition';
import { getAllLevels } from '@game/levels/LevelRegistry';
import type { PropKind } from './EditorDocument';

export const MATERIAL_KEYS: readonly MaterialKey[] = [
  'floor', 'wall', 'trim', 'crate', 'dynamic', 'door', 'button', 'npc', 'npcDead',
  'hazard', 'snow', 'rock', 'grass', 'sand', 'brick', 'roof', 'plaster', 'concrete', 'woodDark',
];

export const WEAPON_IDS: readonly WeaponId[] = [...WEAPON_ORDER];
export const CHARACTER_IDS: readonly CharacterId[] = Object.keys(CharacterPresets);
export const ITEM_IDS: readonly ItemId[] = Object.keys(ItemDefinitions) as ItemId[];
export const CHARGER_KINDS: readonly ChargerKind[] = Object.keys(ChargerTypes) as ChargerKind[];
export const SKYBOX_IDS: readonly SkyboxId[] = Object.keys(SkyboxManifest) as SkyboxId[];
export const LEVEL_ACTIONS: readonly LevelActionKind[] = ['respawnEncounters', 'spawnAllWeapons'];
export const TRIGGER_ACTION_KINDS: readonly TriggerAction['kind'][] = [
  'dialogue', 'spawnNpcs', 'door', 'levelAction', 'objective', 'endLevel',
];

/** Niveles registrados (campaña + custom). Para encadenar vía `nextLevel`. */
export const LEVEL_IDS: readonly string[] = getAllLevels().map((l) => l.id);

export const PROP_KINDS: readonly PropKind[] = [
  'crate', 'crateStack', 'sandbagLine', 'coverWall', 'pillar', 'cargoContainer', 'watchtower',
];
