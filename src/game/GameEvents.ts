import type { Vector3 } from "three";
import type { Faction } from "@engine/ai/Faction";
import type { CharacterId } from "@engine/characters/CharacterDefinition";
import type { EventBus } from "@engine/core/EventBus";
import type { PhysicsMetadata } from "@engine/physics/PhysicsWorld";
import type { PortalSlot } from "@engine/portals/PortalFrame";
import type { WeaponId, WeaponType } from "@game/gameplay/weapons/core/WeaponDefinition";
import type { HazardKind } from "@game/levels/HazardVolumeSystem";
import type { NpcCalloutKind, UiSoundCue } from "@game/config/audio.config";
import type { ChargerKind } from "@game/config/items.config";
import type { DifficultyLevel } from "@game/config/difficulty.config";
import type { DamageType } from "@shared/types/lifecycle";
import type { SurfaceType } from "@shared/types/Surface";
import type { PropArchetypeId, PropBreakReaction } from "@game/config/props.config";
import type { ActivatorRef } from "@game/script/ActivatorRef";
import type {
  VehicleArchetypeId,
  VehicleCrewRole,
} from "@game/config/vehicles.config";
import type {
  VehicleObjectiveFailureReason,
  VehicleObjectiveKind,
  VehicleObjectiveSource,
} from "@game/gameplay/vehicles/ai/VehicleTacticalTypes";
import type {
  AirLandingFailureReason,
  AirLandingSpot,
} from "@game/gameplay/vehicles/ai/AirVehicleAiTypes";

export type LevelActionKind = "respawnEncounters" | "spawnAllWeapons";
export type CombatEventSourceKind = "player" | "npc" | "system";
export type VehicleExtractionActorFailurePhase =
  | "waiting"
  | "pickup"
  | "boarding"
  | "outbound"
  | "dropoff";
export type VehicleExtractionActorFailureReason =
  | "dead"
  | "resourceUnavailable"
  | "boardingTimedOut"
  | "boardingRejected"
  | "lostInTransit"
  | "vehicleDisabled"
  | "disembarkTimedOut"
  | "disembarkRejected";

/** Snapshot del estado del selector que se publica al HUD. */
export interface WeaponSelectorItemState {
  id: WeaponId;
  disabled: boolean;
}

export interface WeaponSelectorState {
  /** Por slot, las armas que el jugador tiene equipadas, en orden canÃ³nico. */
  slots: Array<{ slot: number; weapons: WeaponSelectorItemState[] }>;
  /** Slot actualmente abierto. */
  activeSlot: number;
  /** Arma tentativamente seleccionada (la que se equiparÃ¡ al confirmar). */
  tentativeId: WeaponId;
}

export interface GameEventMap {
  "weapon.fired": {
    weaponName: string;
    weaponType: WeaponType;
    ammo: number;
    origin: Vector3;
    direction: Vector3;
    range: number;
    sourceId?: string;
    sourceKind?: CombatEventSourceKind;
    sourceFaction?: Faction;
  };
  /**
   * Tracer suelto, desacoplado del sonido/flash de `weapon.fired`. Lo usan las
   * armas que disparan varios rayos por trigger (escopeta = un tracer por
   * perdigón) sin querer N gunshots. El `WeaponEffects` dibuja la línea.
   */
  "weapon.tracer": {
    origin: Vector3;
    direction: Vector3;
    range: number;
    sourceId?: string;
    sourceKind?: CombatEventSourceKind;
    sourceFaction?: Faction;
  };
  /**
   * Secundario distinto del primario (ej. lanzagranadas del SMG). El audio
   * usa este evento para reproducir un clip aparte. Las armas cuyo
   * secundario reusa el mismo sonido del primario emiten `weapon.fired`.
   */
  "weapon.alternate.fired": {
    weaponName: string;
    origin: Vector3;
    direction: Vector3;
    sourceId?: string;
    sourceKind?: CombatEventSourceKind;
    sourceFaction?: Faction;
  };
  "portal.placed": {
    slot: PortalSlot;
    position: Vector3;
    normal: Vector3;
    /** True cuando ambos portales existen tras esta colocación. */
    linked: boolean;
  };
  "portal.placementfailed": {
    slot: PortalSlot;
  };
  "portal.teleported": {
    entityKind: "player" | "dynamic" | "projectile" | "npc";
    entityId?: string;
    exitPosition: Vector3;
  };
  "portal.cleared": Record<string, never>;
  /** Un prop físico rápido impactó a un NPC (daño por impacto global). */
  "prop.impact": {
    targetId?: string;
    point: Vector3;
    normal?: Vector3;
    damage: number;
    /** Atacante atribuido ("player" si lo lanzó el jugador); undefined = entorno. */
    sourceId?: string;
  };
  /** Un prop del catálogo perdió vida sin llegar a romperse. */
  "prop.damaged": {
    propId: string;
    archetypeId: PropArchetypeId;
    health: number;
    maxHealth: number;
    /** Daño ya efectivo (con el multiplicador del tipo de golpe aplicado). */
    damage: number;
    /** Dónde pegó y hacia dónde: lo consume la deformación plástica. */
    point?: Vector3;
    direction?: Vector3;
    sourceId?: string;
  };
  /** Un prop del catálogo cedió: su reacción de rotura ya se despachó. */
  "prop.broken": {
    propId: string;
    archetypeId: PropArchetypeId;
    position: Vector3;
    surface: SurfaceType;
    /** Fragmentos que llegaron a spawnear (el pool puede recortarlos). */
    debrisCount: number;
    /** `collapse` derrumba la estructura entera, no sólo las uniones del muerto. */
    reaction: PropBreakReaction["kind"];
    sourceId?: string;
  };
  /** Un NPC murió congelado (ice gun al llenar el medidor de freeze). */
  "ice.frozen": {
    targetId: string;
    position: Vector3;
  };
  "weapon.hit": {
    weaponName: string;
    targetId?: string;
    surfaceKind?: PhysicsMetadata["kind"];
    /**
     * Material físico del blanco, tomado del collider. Es lo que hace que una
     * bala contra chapa no suene igual que contra hormigón; sin esto el audio
     * sólo sabe *qué clase* de cosa golpeó, no de qué está hecha.
     */
    surface?: SurfaceType;
    point: Vector3;
    normal?: Vector3;
    damage: number;
    sourceId?: string;
    sourceKind?: CombatEventSourceKind;
    sourceFaction?: Faction;
  };
  "strider.cannon.impact": {
    point: Vector3;
    /** Boca del cañón al disparar — origen del tracer. */
    origin: Vector3;
    normal?: Vector3;
    damage: number;
    radius: number;
    impulse: number;
    sourceId: string;
    sourceFaction: Faction;
  };
  "weapon.reloaded": {
    weaponName: string;
    ammo: number;
    reserve: number;
  };
  "weapon.empty": {
    weaponName: string;
  };
  /** El arma activa entró/salió de mira telescópica (scope del crossbow). */
  "weapon.scope.changed": {
    active: boolean;
  };
  /**
   * Sonido mecnico discreto despus de un evento (pump-action de la
   * shotgun tras disparar y tras recargar el ltimo cartucho). El
   * `WeaponSoundSystem` lo mapea a `WeaponAudio[name].cock`.
   */
  "weapon.cocked": {
    weaponName: string;
  };
  "weapon.ammo.changed": {
    weaponId?: WeaponId;
    current: number;
    reserve: number;
  };
  "weapon.changed": {
    weaponId?: WeaponId;
    weaponName: string;
    ammo: number;
    reserve: number;
    secondaryAmmo?: number;
  };
  "weapon.selector.opened": WeaponSelectorState;
  "weapon.selector.cycled": WeaponSelectorState;
  "weapon.selector.closed": {
    committed: boolean;
  };
  "level.action": {
    id: string;
    action: LevelActionKind;
    position: Vector3;
  };
  "npc.damaged": {
    id: string;
    characterId: CharacterId;
    amount: number;
    health: number;
    point?: Vector3;
    direction?: Vector3;
    bodyPart?: string;
    attackerId?: string;
  };
  "npc.alert": {
    id: string;
    characterId: CharacterId;
    /** Posición del NPC, para reproducir la vocalización en 3D. */
    position?: Vector3;
  };
  /** Voz tactica sincronizada con la decision del NPC (contact/engaging/...). */
  "npc.callout": {
    id: string;
    characterId: CharacterId;
    kind: NpcCalloutKind;
    position?: Vector3;
  };
  /**
   * Un NPC vio un threat â€” broadcast a la facciÃ³n para que aliados cercanos
   * reciban la LKP. SÃ³lo NPCs hostiles a `threatFaction` deberÃ­an reaccionar.
   */
  "npc.threat.spotted": {
    spotterId: string;
    spotterFaction: Faction;
    threatId: string;
    threatPosition: Vector3;
    spotterPosition: Vector3;
  };
  "world.noise": {
    kind: "gunshot" | "explosion" | "impact" | "movement";
    position: Vector3;
    radius: number;
    sourceId?: string;
    sourceFaction?: Faction;
  };
  "npc.attack": {
    id: string;
    characterId: CharacterId;
    /** Posición del NPC, para reproducir el sonido de ataque en 3D. */
    position?: Vector3;
  };
  /**
   * Un NPC lanza una granada fisica (flush-out de un target oculto). Game la
   * materializa via `GrenadeSystem.spawn` con `ownerKind: "npc"`.
   */
  "npc.grenade": {
    id: string;
    characterId: CharacterId;
    origin: Vector3;
    velocity: Vector3;
    damage: number;
    radius: number;
    impulse: number;
    fuseSeconds: number;
    sourceFaction: Faction;
    /** Elapsed del game loop al lanzar (base del fuse). */
    now: number;
  };
  /** Un medic curo a un aliado (player u otro NPC). Game aplica el heal real. */
  "npc.heal": {
    medicId: string;
    characterId: CharacterId;
    targetId: string;
    amount: number;
    position?: Vector3;
  };
  /** El NPC entra en fase de carga/telegraph de un ataque (e.g. cañón del strider). */
  "npc.charge": {
    id: string;
    characterId: CharacterId;
    /** Posición del NPC, para reproducir el sonido de carga en 3D. */
    position?: Vector3;
  };
  "npc.footstep": {
    id: string;
    characterId: CharacterId;
    position?: Vector3;
  };
  "npc.killed": {
    id: string;
    characterId: CharacterId;
    /** Entidad que produjo el daño letal (`player` o id de NPC). */
    attackerId?: string;
    /** Posición del NPC al morir, para reproducir el sonido de muerte en 3D. */
    position?: Vector3;
  };
  /** El NPC dropea su arma en la posiciÃ³n indicada (tÃ­picamente al morir). */
  "npc.weapon.dropped": {
    npcId: string;
    weaponId: string;
    position: Vector3;
  };
  /** Cambio de tamaño del squad del jugador (join/muerte/reset). */
  "squad.changed": {
    size: number;
    max: number;
  };
  /** Orden del jugador a su squad (tecla C): ir a un punto o reagruparse. */
  "squad.command": {
    kind: "move" | "regroup";
    position?: Vector3;
  };
  "door.opened": {
    id: string;
    open: boolean;
    /** Activador original de la transición; se conserva hasta !activator. */
    activator?: ActivatorRef;
  };
  "trigger.entered": {
    id: string;
  };
  /** El jugador salió del volumen de un trigger (flanco). Alimenta `OnEndTouch`. */
  "trigger.exited": {
    id: string;
  };
  /** Cambió el modo de una compañera (follow/wait/escort), por script o interacción. */
  "companion.changed": {
    id: string;
    mode: "follow" | "wait" | "escort";
  };
  /** El jugador cruzó un volumen de checkpoint. `position` = punto de reaparición. */
  "checkpoint.reached": {
    id: string;
    position: Vector3;
  };
  "dialogue.show": {
    speaker?: string;
    text: string;
    duration: number;
  };
  /**
   * Objetivo actual del jugador. `text` vacío oculta el panel. `completed`
   * marca el objetivo como cumplido (flash + fade). `marker` ubica un waypoint
   * world-space para la brújula del HUD; `null` lo limpia.
   */
  "objective.updated": {
    text: string;
    completed?: boolean;
    marker?: Vector3 | null;
  };
  "player.health.changed": {
    current: number;
    max: number;
  };
  "player.armor.changed": {
    current: number;
    max: number;
  };
  "player.stamina.changed": {
    current: number;
    max: number;
    depleted: boolean;
  };
  "player.damaged": {
    amount: number;
    direction?: Vector3;
    /** Tipo de daño; el traje HEV elige el diagnóstico de voz según esto. */
    damageType?: DamageType;
  };
  "player.dead": {
    reason: string;
  };
  /** La dificultad activa cambió (menú de opciones / nueva partida). */
  "difficulty.changed": {
    level: DifficultyLevel;
  };
  /**
   * Daño de un volumen de peligro (kill-volume). `HazardVolumeSystem` lo emite
   * en ticks mientras el jugador está adentro; `Game` lo aplica a la vida.
   * `instant` = letal inmediato (vacío).
   */
  "player.hazard": {
    amount: number;
    kind: HazardKind;
    instant: boolean;
  };
  "player.pickup.health": {
    amount: number;
  };
  "player.pickup.armor": {
    amount: number;
  };
  "player.pickup.ammo": {
    amount: number;
    weaponName?: string;
  };
  "player.pickup.weapon": {
    weaponName: string;
  };
  "interaction.focus": {
    label: string;
  };
  "interaction.blur": Record<string, never>;
  "vehicle.player.entered": {
    id: string;
    name: string;
    archetype: VehicleArchetypeId;
    seatId: string;
    role: VehicleCrewRole;
  };
  "vehicle.player.exited": {
    id: string;
    seatId: string;
  };
  "vehicle.telemetry": {
    id: string;
    name: string;
    archetype: VehicleArchetypeId;
    speed: number;
    forwardSpeed: number;
    /** Velocidad punta del preset, para escalar el velocímetro. */
    topSpeed: number;
    handbrake: boolean;
    hull: number;
    hullMax: number;
    components: Readonly<Record<string, number>>;
    boost: number;
    engineOn: boolean;
    weaponEnabled: boolean;
    weaponHeat: number;
    weaponAmmo: number;
    occupants: readonly {
      actor: string;
      seatId: string;
      role: VehicleCrewRole;
    }[];
  };
  "vehicle.damaged": {
    id: string;
    amount: number;
    zone: string;
    attackerId?: string;
  };
  "vehicle.disabled": {
    id: string;
  };
  "vehicle.destroyed": {
    id: string;
  };
  "vehicle.crashed": {
    id: string;
  };
  "vehicle.waypoint": {
    id: string;
    waypointId: string;
  };
  "vehicle.stuck": {
    id: string;
  };
  "vehicle.order.changed": {
    id: string;
    objectiveId: string;
    revision: number;
    source: VehicleObjectiveSource;
    kind: VehicleObjectiveKind;
  };
  "vehicle.order.completed": {
    id: string;
    objectiveId: string;
    revision: number;
    source: VehicleObjectiveSource;
    kind: VehicleObjectiveKind;
  };
  "vehicle.order.failed": {
    id: string;
    objectiveId: string;
    revision: number;
    source: VehicleObjectiveSource;
    kind: VehicleObjectiveKind;
    reason: VehicleObjectiveFailureReason;
    detail?: string;
  };
  "vehicle.landing.selected": {
    id: string;
    orderId: string;
    revision: number;
    requested: Vector3;
    selected: Vector3;
    deviation: number;
    source: AirLandingSpot["source"];
    surfaceId?: string;
    surfaceType?: AirLandingSpot["surfaceType"];
  };
  "vehicle.landing.landed": {
    id: string;
    orderId: string;
    revision: number;
    requested: Vector3;
    selected: Vector3;
  };
  "vehicle.landing.failed": {
    id: string;
    orderId: string;
    revision: number;
    requested: Vector3;
    reason: AirLandingFailureReason;
  };
  /** Un NPC ocupó un asiento. Hasta acá el embarque de NPCs era invisible. */
  "vehicle.crew.boarded": {
    id: string;
    actorId: string;
    seatId: string;
    role: VehicleCrewRole;
  };
  "vehicle.crew.exited": {
    id: string;
    actorId: string;
    seatId: string;
    /** Bajada forzada: evacuación o vehículo inservible. */
    emergency: boolean;
  };
  /** Una facción pidió recogida. `vehicleId` null = todavía sin aparato. */
  "vehicle.extraction.requested": {
    faction: Faction;
    position: Vector3;
    vehicleId: string | null;
  };
  /** El transporte se posó en la zona de recogida. */
  "vehicle.extraction.arrived": {
    faction: Faction;
    id: string;
  };
  "vehicle.extraction.actorFailed": {
    faction: Faction;
    vehicleId: string | null;
    actorId: string;
    phase: VehicleExtractionActorFailurePhase;
    reason: VehicleExtractionActorFailureReason;
  };
  /** El jugador levantó un prop con E (+USE). */
  "carry.grabbed": {
    id?: string;
  };
  "carry.dropped": {
    id?: string;
    reason:
      | "manual"
      | "obstructed"
      | "invalid"
      | "portalClosed"
      | "distance"
      | "weapon";
  };
  /** Empuje suave con LMB del prop cargado. */
  "carry.pushed": {
    id?: string;
  };
  "subtitle.show": {
    speaker?: string;
    text: string;
    duration: number;
  };
  "debug.toggle": {
    enabled: boolean;
  };
  "workshop.list.loaded": {
    count: number;
  };
  "workshop.subscribed": {
    id: string;
    title: string;
  };
  "workshop.unsubscribed": {
    id: string;
  };
  "workshop.enabled": {
    id: string;
    enabled: boolean;
  };
  "workshop.published": {
    id: string;
    title: string;
  };
  "workshop.rated": {
    id: string;
    rating: number;
  };
  "workshop.commented": {
    id: string;
  };
  "workshop.error": {
    action: string;
    message: string;
  };
  "ui.sound": {
    cue: UiSoundCue;
  };
  "charger.started": {
    id: string;
    kind: ChargerKind;
  };
  "charger.stopped": {
    id: string;
    kind: ChargerKind;
    depleted: boolean;
  };
  "charger.denied": {
    id: string;
    kind: ChargerKind;
    reason: "empty" | "full";
  };
}

export type GameEventBus = EventBus<GameEventMap>;
