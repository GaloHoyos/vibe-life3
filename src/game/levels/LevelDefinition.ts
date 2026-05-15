import type { VectorTuple } from '../../shared/math/VectorTuple';
import type { CharacterId } from '../../engine/characters/CharacterDefinition';
import type { WeaponId } from '../gameplay/weapons/WeaponDefinition';
import type { MaterialKey } from '../../engine/render/Materials';

export interface StaticBoxDefinition {
  id: string;
  position: VectorTuple;
  size: VectorTuple;
  material: MaterialKey;
}

export interface DynamicBoxDefinition {
  id: string;
  position: VectorTuple;
  size: VectorTuple;
  mass: number;
  material: MaterialKey;
}

export interface DoorDefinition {
  id: string;
  position: VectorTuple;
  size: VectorTuple;
  openOffset: VectorTuple;
  speed: number;
  material: MaterialKey;
  button: {
    id: string;
    label: string;
    position: VectorTuple;
    size: VectorTuple;
  };
}

export interface NPCDefinition {
  id: string;
  position: VectorTuple;
  characterId: CharacterId;
}

export interface WeaponPickupDefinition {
  id: string;
  weaponId: WeaponId;
  position: VectorTuple;
}

export interface TriggerDefinition {
  id: string;
  position: VectorTuple;
  size: VectorTuple;
  once: boolean;
  dialogue: {
    speaker?: string;
    text: string;
    duration: number;
  };
}

export interface LevelAudioDefinition {
  /** Sounds en loop que se reproducen como ambiente del nivel. */
  ambiences: string[];
  /** Pool de pasos que el jugador y los NPCs randomizan al caminar. */
  footstepSounds: string[];
  /** Id opcional de la música del nivel. */
  music?: string;
}

export interface LevelDefinition {
  id: string;
  title: string;
  background: number;
  playerStart: VectorTuple;
  audio: LevelAudioDefinition;
  staticBoxes: StaticBoxDefinition[];
  dynamicBoxes: DynamicBoxDefinition[];
  doors: DoorDefinition[];
  npcs: NPCDefinition[];
  weaponPickups: WeaponPickupDefinition[];
  triggers: TriggerDefinition[];
}
