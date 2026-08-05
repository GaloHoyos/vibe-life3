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
import type { Faction } from '@engine/ai/Faction';
import type {
  VehicleCrewRole,
  VehiclePresetId,
} from '@game/config/vehicles.config';
import type {
  VehicleDriverProfileId,
  VehicleGunnerProfileId,
  VehiclePilotProfileId,
} from '@game/config/vehicleAi.config';
import type { LandmarkReference } from '@game/levels/LevelTransition';

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
  /**
   * Identidad estable al cruzar un changelevel. El NPC con la misma clave en el
   * nivel destino hereda pose y vitales del origen (companion que te sigue).
   */
  transitionKey?: string;
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

export interface VehicleCrewAssignment {
  /** Targetname del actor, o `!player`. */
  actor: string;
  role: VehicleCrewRole;
  /** Si se omite, el runtime elige el primer asiento compatible libre. */
  seatId?: string;
}

export type VehicleAiBehavior =
  | 'hold'
  | 'patrol'
  | 'escort'
  | 'transport'
  | 'intercept'
  | 'flank'
  | 'retreat';

export interface VehicleAiDefinition {
  enabled: boolean;
  behavior: VehicleAiBehavior;
  /** Targetname de marker, actor o vehículo según el comportamiento. */
  goal?: string;
  allowRecoverySnap?: boolean;
  /** Estilo de conducción. Default según el preset. */
  driverProfile?: VehicleDriverProfileId;
  /** Disciplina de tiro de la tripulación. Default según el preset. */
  gunnerProfile?: VehicleGunnerProfileId;
  /** Oficio del piloto en aparatos aéreos. Default según el comportamiento. */
  pilotProfile?: VehiclePilotProfileId;
  /**
   * Si puede abandonar temporalmente su `behavior` para pelear o huir. Default
   * según el comportamiento: los ofensivos sí, los de logística no.
   */
  allowMissionDeviation?: boolean;
  /** Vehículos que comparten `convoyId` mantienen separación entre sí. */
  convoyId?: string;
}

/**
 * Oferta de tripulación autónoma. El vehículo declara qué puestos quiere
 * cubiertos y los NPCs de la facción se reparten los roles solos; los triggers
 * `EnableCrewing`/`DisableCrewing` encienden y apagan la oferta sin tener que
 * guionar cada abordaje.
 */
export interface VehicleAiCrewDefinition {
  /**
   * Estado inicial de la oferta. Default `true`. En `false` el aparato espera
   * un `EnableCrewing` del guion, que es como se autora una tripulación que
   * corre hacia su vehículo recién cuando el jugador entra en escena.
   */
  enabled?: boolean;
  /**
   * Puestos a cubrir, en orden de prioridad. Default: primero los mandos y
   * después la torreta, porque un aparato sin piloto no sirve de nada.
   */
  roles?: VehicleCrewRole[];
  /** Radio de reclutamiento en metros. Default 30. */
  radius?: number;
}

export const VEHICLE_ACCESS_POLICIES = [
  'player',
  'resistance',
  'combine',
] as const;

export type VehicleAccessPolicy = (typeof VEHICLE_ACCESS_POLICIES)[number];

export function isVehicleAccessPolicy(value: unknown): value is VehicleAccessPolicy {
  return typeof value === 'string' &&
    VEHICLE_ACCESS_POLICIES.some((policy) => policy === value);
}

/** Instancia autorada de un preset vehicular. */
export interface VehicleDefinition extends IOEntityFields {
  id: string;
  presetId: VehiclePresetId;
  position: VectorTuple;
  rotation?: RotationTuple;
  faction?: Faction;
  /**
   * Defines which crews may occupy the vehicle.
   * - `player`: Gordon drives; allies may only ride as companions.
   * - `resistance`: Gordon, Alyx, and Resistance humanoids may occupy it.
   * - `combine`: Gordon or Combine may occupy it, without mixing factions.
   *
   * Omitting it preserves older maps by deriving the policy from `faction`.
   */
  accessPolicy?: VehicleAccessPolicy;
  crew?: VehicleCrewAssignment[];
  weaponEnabled?: boolean;
  startDisabled?: boolean;
  startLocked?: boolean;
  engineOn?: boolean;
  /** Helicopters deny manual dismount by default; scripted/forced exits ignore this flag. */
  allowPlayerExit?: boolean;
  /**
   * Blindaje escenográfico: registra los impactos y dispara `OnDamaged`, pero la
   * vida no baja, así que sólo la entrada `Crash` lo derriba. Conmutable en
   * caliente con `EnableDamage` / `DisableDamage`.
   */
  invulnerable?: boolean;
  /** Primer waypoint de la ruta normal; requerido por el helicóptero. */
  pathStart?: string;
  /** Primer waypoint de la secuencia de choque. */
  crashPathStart?: string;
  /** Default `fatal`; los setpieces pueden declarar un choque sobrevivible. */
  crashPolicy?: 'survivable' | 'fatal';
  /** Autoriza que la cadena `next` vuelva a un waypoint ya visitado. */
  pathLoop?: boolean;
  ai?: VehicleAiDefinition;
  /** Tripulación que el vehículo ofrece a los NPCs de su facción. */
  aiCrew?: VehicleAiCrewDefinition;
  /** Identidad estable al cruzar un changelevel. */
  transitionKey?: string;
  portalTraversal?: 'blocked';
}

/**
 * Backward compatibility for maps predating `accessPolicy`: Combine and
 * Resistance vehicles inherit their faction; every other vehicle is player-only.
 */
export function resolveVehicleAccessPolicy(
  definition: Pick<VehicleDefinition, 'accessPolicy' | 'faction'>,
): VehicleAccessPolicy {
  if (definition.accessPolicy) return definition.accessPolicy;
  if (definition.faction === 'combine') return 'combine';
  if (definition.faction === 'resistance') return 'resistance';
  return 'player';
}

/** Nodo Source-style de una ruta vehicular enlazada por `next`. */
export interface VehicleWaypointDefinition extends IOEntityFields {
  id: string;
  position: VectorTuple;
  next?: string;
  speed?: number;
  wait?: number;
  /** Inclinación lateral autorada, en radianes. */
  bank?: number;
}

export interface WaterVolumeDefinition {
  id: string;
  /** Centro del volumen físico. La cara superior es la superficie del agua. */
  position: VectorTuple;
  size: VectorTuple;
  flow?: VectorTuple;
  surface?: 'canal' | 'river' | 'industrial';
}

export type VehicleNavSurface = 'ground' | 'water' | 'both';

/**
 * Anotacion sobre el terreno manejable, que el bake deriva de la colision real.
 * No define donde se puede conducir: lo ajusta (`cost`, `speedLimit`, `flags`) o
 * lo recorta (`blocked`).
 */
export interface VehicleNavAreaDefinition {
  id: string;
  polygon: VectorTuple[];
  surface: VehicleNavSurface;
  cost?: number;
  speedLimit?: number;
  tags?: string[];
  flags?: Array<'noCombat' | 'noReverse' | 'parking' | 'shore'>;
  /** Recorta el poligono del grid aunque la geometria lo declare manejable. */
  blocked?: boolean;
}

export interface VehicleNavLaneDefinition {
  id: string;
  points: VectorTuple[];
  width: number;
  direction: 'forward' | 'backward' | 'both';
  speedLimit?: number;
  priority?: number;
  tags?: string[];
}

export type VehicleNavMarkerKind =
  | 'parking'
  | 'boarding'
  | 'recovery'
  | 'passingBay'
  | 'landingZone'
  | 'dropZone';

export interface VehicleNavMarkerDefinition extends IOEntityFields {
  id: string;
  position: VectorTuple;
  heading?: number;
  kind: VehicleNavMarkerKind;
  allowedPresets?: VehiclePresetId[];
  /** Sólo un marker explícito puede habilitar el último escalón de recovery. */
  allowRecoverySnap?: boolean;
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
  entryLandmark?: LandmarkReference;
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
  /** Vehículos pilotables, tripulados o guionados. */
  vehicles?: VehicleDefinition[];
  /** Rutas enlazadas para helicópteros y movimientos guionados. */
  vehicleWaypoints?: VehicleWaypointDefinition[];
  /** Agua renderizable y consultable por motores de flotación. */
  waterVolumes?: WaterVolumeDefinition[];
  /** Regiones donde el bake de navegación vehicular puede generar espacio libre. */
  vehicleNavAreas?: VehicleNavAreaDefinition[];
  /** Carriles autorados del grafo vehicular global. */
  vehicleNavLanes?: VehicleNavLaneDefinition[];
  /** Puntos semánticos de parking, boarding, recovery y aterrizaje. */
  vehicleNavMarkers?: VehicleNavMarkerDefinition[];
}
