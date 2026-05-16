import type { VectorTuple } from '../../shared/math/VectorTuple';
import type { CharacterId } from '../../engine/characters/CharacterDefinition';
import type { WeaponId } from '../gameplay/weapons/WeaponDefinition';
import type { MaterialKey } from '../../engine/render/Materials';
import type { SkyboxId } from '../../engine/render/Skybox';
import type { SunOptions } from '../../engine/render/LightingSystem';
import type { HeightSource } from '../../shared/math/HeightField';

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

export interface TerrainDefinition {
  id: string;
  /** Centro del terreno en world space. */
  position: VectorTuple;
  /** Tamaño total en metros [ancho X, profundidad Z]. */
  size: [number, number];
  /** Cantidad de muestras a lo largo de X. Más alto = más detalle / más costo. */
  widthSamples: number;
  /** Cantidad de muestras a lo largo de Z. */
  depthSamples: number;
  source: HeightSource;
  material: MaterialKey;
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
  /** Texto corto que se muestra en el selector de mapas del menú. */
  description?: string;
  /** Color de fondo de fallback (cuando no hay skybox o el HDRI falla). */
  background: number;
  /** HDRI a usar como cielo + IBL. Si se omite, usa `'default'`. */
  skybox?: SkyboxId;
  /** Configuración del sol (luz direccional principal). Si se omite, usa los defaults. */
  sun?: SunOptions;
  playerStart: VectorTuple;
  audio: LevelAudioDefinition;
  /** Terreno opcional. Cuando está definido, agrega un heightfield (mesh + collider). */
  terrain?: TerrainDefinition;
  staticBoxes: StaticBoxDefinition[];
  dynamicBoxes: DynamicBoxDefinition[];
  doors: DoorDefinition[];
  npcs: NPCDefinition[];
  weaponPickups: WeaponPickupDefinition[];
  triggers: TriggerDefinition[];
}
