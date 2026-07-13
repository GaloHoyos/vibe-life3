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
import type { PlayerModelId } from '@game/config/playermodel.config';
import type { IOEntityFields, LogicEntityDefinition } from '@game/script/EntityIOTypes';
import type { ScriptedSequenceDefinition } from '@game/script/ScriptedSequenceTypes';
import type { BlobPoseDefinition } from '@game/npc/blob/BlobControl';

/** Rotacion Euler XYZ en radianes. Omitida = alineado a los ejes. */
type RotationTuple = VectorTuple;

export interface StaticBoxDefinition {
  id: string;
  position: VectorTuple;
  size: VectorTuple;
  material: MaterialKey;
  rotation?: RotationTuple;
  /** El perfil de navegación Blob puede fluir a través de este sólido. */
  blobPermeable?: boolean;
}

export interface DynamicBoxDefinition {
  id: string;
  position: VectorTuple;
  size: VectorTuple;
  mass: number;
  material: MaterialKey;
  rotation?: RotationTuple;
  /** Opt-in explícito: el Blob puede absorber y eliminar este prop. */
  blobConsumable?: {
    /** Default runtime: 2 s. */
    consumeSeconds?: number;
    /** Partículas de carne obtenidas. Default runtime: 4. */
    biomass?: number;
  };
}

export interface DoorDefinition extends IOEntityFields {
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

export interface NPCDefinition extends IOEntityFields {
  id: string;
  position: VectorTuple;
  characterId: CharacterId;
  patrol?: VectorTuple[];
  rotation?: RotationTuple;
  /** Poses coreografiadas disponibles para `SetBlobPose` por id. */
  blobPoses?: BlobPoseDefinition[];
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

/** Objetivo inicial de un nivel. El HUD lo muestra al cargar. */
export interface ObjectiveDefinition {
  text: string;
  /** Waypoint world-space opcional para la brújula. */
  marker?: VectorTuple;
}

/**
 * Volumen que emite outputs de entity I/O al cruzarlo: `OnStartTouch` al entrar,
 * `OnEndTouch` al salir. Las acciones (diálogo, spawn, puertas, etc.) viven en
 * `connections` hacia entidades lógicas — ver `@game/script/EntityIOTypes`.
 */
export interface TriggerDefinition extends IOEntityFields {
  id: string;
  position: VectorTuple;
  size: VectorTuple;
  rotation?: RotationTuple;
  /** Se desactiva tras el primer `OnStartTouch` (equivale a `trigger_once`). */
  once: boolean;
  /** Cooldown mínimo entre entradas válidas de un trigger_multiple, en segundos. */
  wait?: number;
  /** Arranca deshabilitado: no emite hasta recibir un input `Enable`. */
  startDisabled?: boolean;
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
  /** Playermodel del jugador (visible en las vistas de portal). Omitido = gordon. */
  playerModel?: PlayerModelId;
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
  /**
   * Entidades lógicas y de efecto del entity I/O (relays, counters, timers,
   * mensajes, spawners, etc.). Los triggers/puertas/NPCs las referencian por
   * nombre vía `connections`. Ver `@game/script/EntityIOTypes`.
   */
  logicEntities?: LogicEntityDefinition[];
  /** Secuencias guionadas de NPCs (scripted_sequence). Ver `@game/script/ScriptedSequenceTypes`. */
  sequences?: ScriptedSequenceDefinition[];
  /** Puntos de control para respawn. Si se omite, el nivel solo reaparece en `playerStart`. */
  checkpoints?: CheckpointDefinition[];
  /** Barriles explosivos (props dañables que explotan al morir). */
  explosiveBarrels?: ExplosiveBarrelDefinition[];
  /** Volúmenes de peligro que dañan al jugador mientras está adentro. */
  hazardVolumes?: HazardVolumeDefinition[];
}
