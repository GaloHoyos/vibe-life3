import type { VectorTuple } from '@shared/math/VectorTuple';
import type { CharacterId } from '@engine/characters/CharacterDefinition';
import type { WeaponId } from '@game/gameplay/weapons/core/WeaponDefinition';
import type { ChargerKind, ItemId } from '@game/config/items.config';
import type { MaterialKey } from '@engine/render/material/Materials';
import type { SkyboxId } from '@engine/render/environment/Skybox';
import type { SunOptions } from '@engine/render/environment/LightingSystem';
import type { HeightSource } from '@shared/math/HeightField';
import type { LevelActionKind } from '@game/GameEvents';
import type { BuildingArtifact } from '@game/levels/buildings/BuildingArtifact';

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

export interface ActionButtonDefinition {
  id: string;
  label: string;
  action: LevelActionKind;
  position: VectorTuple;
  size: VectorTuple;
}

export interface NPCDefinition {
  id: string;
  position: VectorTuple;
  characterId: CharacterId;
  patrol?: VectorTuple[];
}

export interface WeaponPickupDefinition {
  id: string;
  weaponId: WeaponId;
  position: VectorTuple;
}

export interface ItemPickupDefinition {
  id: string;
  itemId: ItemId;
  position: VectorTuple;
}

export interface ChargerDefinition {
  id: string;
  kind: ChargerKind;
  /** Base del cargador en world space — se asienta sobre esa Y. */
  position: VectorTuple;
  /** Rotación Y (radianes) para orientarlo contra la pared. Default 0. */
  rotationY?: number;
  /** Override de la reserva total. Default según `ChargerTypes[kind]`. */
  capacity?: number;
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
  /** TamaÃ±o total en metros [ancho X, profundidad Z]. */
  size: [number, number];
  /** Cantidad de muestras a lo largo de X. MÃ¡s alto = mÃ¡s detalle / mÃ¡s costo. */
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
  /** Id opcional de la mÃºsica del nivel. */
  music?: string;
}

export interface LevelDefinition {
  id: string;
  title: string;
  /** Texto corto que se muestra en el selector de mapas del menÃº. */
  description?: string;
  /** Color de fondo de fallback (cuando no hay skybox o el HDRI falla). */
  background: number;
  /** HDRI a usar como cielo + IBL. Si se omite, usa `'default'`. */
  skybox?: SkyboxId;
  /** ConfiguraciÃ³n del sol (luz direccional principal). Si se omite, usa los defaults. */
  sun?: SunOptions;
  playerStart: VectorTuple;
  audio: LevelAudioDefinition;
  /** Terreno opcional. Cuando estÃ¡ definido, agrega un heightfield (mesh + collider). */
  terrain?: TerrainDefinition;
  staticBoxes: StaticBoxDefinition[];
  /**
   * Edificios con metadata semantica. Cada artifact aporta sus boxes (que el
   * LevelLoader materializa junto con `staticBoxes`) mas los rooms/doorways
   * que `BuildingRegistry` y `NavSpace` consumen para breach/sweep de la IA.
   */
  buildings?: BuildingArtifact[];
  dynamicBoxes: DynamicBoxDefinition[];
  doors: DoorDefinition[];
  actionButtons?: ActionButtonDefinition[];
  npcs: NPCDefinition[];
  weaponPickups: WeaponPickupDefinition[];
  /** Pickups de vitals (botiquines, baterías HEV). Si se omite, el nivel no trae. */
  itemPickups?: ItemPickupDefinition[];
  /** Cargadores de pared (vida / HEV) estilo HL2. Si se omite, el nivel no trae. */
  chargers?: ChargerDefinition[];
  triggers: TriggerDefinition[];
}
