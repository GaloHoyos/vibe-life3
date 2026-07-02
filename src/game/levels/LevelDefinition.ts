import type { VectorTuple } from '@shared/math/VectorTuple';
import type { CharacterId } from '@engine/characters/CharacterDefinition';
import type { WeaponId } from '@game/gameplay/weapons/core/WeaponDefinition';
import type { AmmoId } from '@game/config/ammo.config';
import type { ChargerKind, ItemId } from '@game/config/items.config';
import type { MaterialKey } from '@engine/render/material/Materials';
import type { SkyboxId } from '@engine/render/environment/Skybox';
import type { SunOptions } from '@engine/render/environment/LightingSystem';
import type { HeightSource } from '@shared/math/HeightField';
import type { LevelActionKind } from '@game/GameEvents';
import type { SoundscapeId } from '@game/config/audio.config';
import type { BuildingArtifact } from '@game/levels/buildings/BuildingArtifact';
import type { CheckpointDefinition } from '@game/levels/CheckpointSystem';
import type { HazardVolumeDefinition } from '@game/levels/HazardVolumeSystem';
import type { ExplosiveBarrelDefinition } from '@game/gameplay/hazards/ExplosiveBarrel';
import type { LevelId } from '@game/levels/LevelRegistry';

/** Rotacion Euler XYZ en radianes. Omitida = alineado a los ejes. */
type RotationTuple = VectorTuple;

export interface StaticBoxDefinition {
  id: string;
  position: VectorTuple;
  size: VectorTuple;
  material: MaterialKey;
  rotation?: RotationTuple;
}

export interface DynamicBoxDefinition {
  id: string;
  position: VectorTuple;
  size: VectorTuple;
  mass: number;
  material: MaterialKey;
  rotation?: RotationTuple;
}

export interface DoorDefinition {
  id: string;
  position: VectorTuple;
  size: VectorTuple;
  openOffset: VectorTuple;
  speed: number;
  material: MaterialKey;
  rotation?: RotationTuple;
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
  rotation?: RotationTuple;
}

export interface NPCDefinition {
  id: string;
  position: VectorTuple;
  characterId: CharacterId;
  patrol?: VectorTuple[];
  rotation?: RotationTuple;
}

export interface WeaponPickupDefinition {
  id: string;
  weaponId: WeaponId;
  position: VectorTuple;
  rotation?: RotationTuple;
}

export interface ItemPickupDefinition {
  id: string;
  itemId: ItemId;
  position: VectorTuple;
  rotation?: RotationTuple;
}

export interface AmmoPickupDefinition {
  id: string;
  ammoId: AmmoId;
  position: VectorTuple;
  rotation?: RotationTuple;
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

/**
 * Acción que un trigger ejecuta al cruzarlo. Todo serializable (datos, no
 * código): por eso un "scripted sequence" se modela como acciones con `delay`,
 * no como closures. `delay` = segundos tras entrar al volumen (0 = inmediato).
 */
export type TriggerAction =
  | { kind: 'dialogue'; speaker?: string; text: string; duration: number; delay?: number }
  | { kind: 'spawnNpcs'; npcs: NPCDefinition[]; delay?: number }
  | { kind: 'door'; doorId: string; open: boolean; delay?: number }
  | { kind: 'levelAction'; action: LevelActionKind; delay?: number }
  | { kind: 'soundscape'; soundscape: SoundscapeId; delay?: number }
  /** Actualiza el objetivo del HUD. `completed` lo marca cumplido; `marker` mueve la brújula. */
  | { kind: 'objective'; text: string; completed?: boolean; marker?: VectorTuple; delay?: number }
  /**
   * Salida del nivel: encadena a `LevelDefinition.nextLevel` (o termina la
   * campaña si no hay). `landmark` = punto de referencia en ESTE nivel (estilo
   * `info_landmark` de HL2); el jugador reaparece en el nivel siguiente
   * conservando su offset relativo a este punto. Default = centro del trigger.
   */
  | { kind: 'endLevel'; landmark?: VectorTuple; delay?: number };

/** Objetivo inicial de un nivel. El HUD lo muestra al cargar. */
export interface ObjectiveDefinition {
  text: string;
  /** Waypoint world-space opcional para la brújula. */
  marker?: VectorTuple;
}

export interface TriggerDefinition {
  id: string;
  position: VectorTuple;
  size: VectorTuple;
  rotation?: RotationTuple;
  once: boolean;
  /** Acciones que dispara al cruzarlo. */
  actions?: TriggerAction[];
  /**
   * @deprecated Forma vieja: un único diálogo. Se mantiene para documentos
   * serializados (biblioteca/Workshop) anteriores a `actions`. El
   * `TriggerSystem` lo normaliza a una acción `dialogue` si `actions` falta.
   */
  dialogue?: {
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
  /** Soundscape activo al cargar el nivel. Si se omite, cae a exterior seco. */
  soundscape?: SoundscapeId;
}

export interface LevelDefinition {
  id: string;
  title: string;
  /** Texto corto que se muestra en el selector de mapas del menÃº. */
  description?: string;
  /**
   * Id del nivel que se carga al cruzar un trigger con acción `endLevel` (sin
   * pasar por el menú). Si se omite, ese trigger termina la campaña → menú.
   * Debe ser un id registrado en `LevelRegistry`.
   */
  nextLevel?: LevelId;
  /**
   * Punto de referencia de ENTRADA (estilo `info_landmark` de HL2). Cuando se
   * llega desde un trigger `endLevel`, el jugador reaparece en
   * `entryLandmark + offset`, donde `offset` es su posición relativa al landmark
   * del nivel anterior — así la transición conserva la posición relativa. Si se
   * omite, reaparece en `playerStart`.
   */
  entryLandmark?: VectorTuple;
  /** Objetivo que el HUD muestra al cargar el nivel. */
  objective?: ObjectiveDefinition;
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
  /** Pickups de munición separados de las armas. Si se omite, el nivel no trae. */
  ammoPickups?: AmmoPickupDefinition[];
  /** Cargadores de pared (vida / HEV) estilo HL2. Si se omite, el nivel no trae. */
  chargers?: ChargerDefinition[];
  triggers: TriggerDefinition[];
  /** Puntos de control para respawn. Si se omite, el nivel solo reaparece en `playerStart`. */
  checkpoints?: CheckpointDefinition[];
  /** Barriles explosivos (props dañables que explotan al morir). */
  explosiveBarrels?: ExplosiveBarrelDefinition[];
  /** Volúmenes de peligro que dañan al jugador mientras está adentro. */
  hazardVolumes?: HazardVolumeDefinition[];
}
