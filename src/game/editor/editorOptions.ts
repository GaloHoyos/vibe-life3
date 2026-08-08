import { MaterialDefinitions, type MaterialKey } from '@engine/render/material/Materials';
import {
  PROP_ARCHETYPE_IDS,
  type PropArchetypeId,
  type PropPhysicsMode,
} from '@game/config/props.config';
import type { SkyboxId } from '@engine/render/environment/Skybox';
import { SkyboxManifest } from '@engine/render/environment/Skybox';
import { WEAPON_ORDER } from '@game/config/weapons.config';
import type { WeaponId } from '@game/gameplay/weapons/core/WeaponDefinition';
import { AmmoDefinitions, type AmmoId } from '@game/config/ammo.config';
import {
  ChargerTypes,
  ItemDefinitions,
  type ChargerKind,
  type ItemId,
} from '@game/config/items.config';
import { CharacterPresets } from '@game/characters/CharacterPresets';
import { Soundscapes, type SoundscapeId } from '@game/config/audio.config';
import type { CharacterId } from '@engine/characters/CharacterDefinition';
import type { LevelActionKind } from '@game/GameEvents';
import type { HazardKind } from '@game/levels/HazardVolumeSystem';
import { getAllLevels } from '@game/levels/LevelRegistry';
import type { PropKind } from './EditorDocument';

// Derivadas de la tabla de materiales: la lista a mano se desincronizaba en
// silencio cada vez que se agregaba un `MaterialKey`.
export const MATERIAL_KEYS: readonly MaterialKey[] = Object.keys(
  MaterialDefinitions,
) as MaterialKey[];

export const WEAPON_IDS: readonly WeaponId[] = [...WEAPON_ORDER];
export const AMMO_IDS: readonly AmmoId[] = Object.keys(AmmoDefinitions) as AmmoId[];
export const CHARACTER_IDS: readonly CharacterId[] = Object.keys(CharacterPresets);
export const ITEM_IDS: readonly ItemId[] = Object.keys(ItemDefinitions) as ItemId[];
export const CHARGER_KINDS: readonly ChargerKind[] = Object.keys(ChargerTypes) as ChargerKind[];
export const SKYBOX_IDS: readonly SkyboxId[] = Object.keys(SkyboxManifest) as SkyboxId[];
export const SOUNDSCAPE_IDS: readonly SoundscapeId[] = Object.keys(Soundscapes) as SoundscapeId[];
export { PLAYER_MODEL_IDS } from '@game/config/playermodel.config';
export const LEVEL_ACTIONS: readonly LevelActionKind[] = ['respawnEncounters', 'spawnAllWeapons'];
export const HAZARD_KINDS: readonly HazardKind[] = ['toxic', 'fire', 'electric', 'void'];

/** Niveles registrados (campaña + custom). Para encadenar vía `nextLevel`. */
export const LEVEL_IDS: readonly string[] = getAllLevels().map((l) => l.id);

export const PROP_KINDS: readonly PropKind[] = [
  'crate', 'crateStack', 'sandbagLine', 'coverWall', 'pillar', 'cargoContainer', 'watchtower',
];

/** Arquetipos del catalogo de props, derivados de su tabla. */
export const PROP_ARCHETYPE_OPTIONS: readonly PropArchetypeId[] = [...PROP_ARCHETYPE_IDS];
export const PROP_PHYSICS_MODES: readonly PropPhysicsMode[] = ['dynamic', 'anchored', 'debris'];
