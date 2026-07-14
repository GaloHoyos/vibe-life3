import type { Group, Vector3 } from "three";
import type { Faction } from "@engine/ai/Faction";
import type { Damageable } from "@shared/types/lifecycle";
import type { Health } from "@game/gameplay/Health";
import type { GameEventBus } from "@game/GameEvents";
import type { TacticalMap } from "@game/npc/ai/TacticalMap";
import type { SquadDirector, SquadRole } from "@game/npc/ai/SquadDirector";
import type { NpcScriptOrder } from "@game/script/NpcScriptOrder";
import type { CharacterId } from "@engine/characters/CharacterDefinition";
import type { PortalFrame } from "@engine/portals/PortalFrame";

/**
 * Snapshot ligero de un actor del mundo (player u otro NPC) que cualquier
 * NPC puede leer durante su `update()` para decidir threats, alianzas,
 * separaciÃ³n, etc.
 */
export interface ActorSnapshot {
  id: string;
  position: Vector3;
  faction: Faction;
  entity: Damageable;
  isAlive: boolean;
  radius: number;
  /** Fraccion de vida 0..1 (para medics/priorizacion). Game la llena por frame. */
  health01?: number;
  /**
   * Posición real NAVEGABLE del actor cuando `position` es una proyección
   * (ghost de portal: `position` queda detrás del disco, correcta para
   * apuntar/encarar pero inútil como goal de pathfinding). Los tasks de
   * persecución terrestre usan esta y el A* decide si la ruta más corta
   * cruza el par de portales (links warp).
   */
  navPosition?: Vector3;
  /**
   * Sólo en ghosts de portal: plano del portal de SALIDA por el que se ve este
   * ghost (queda detrás del disco). Un observador únicamente puede verlo si está
   * DELANTE de este plano — un portal se ve sólo de su cara frontal. Sin esto,
   * un enemigo del otro lado de la pared lo detectaría igual.
   */
  portalView?: { position: Vector3; normal: Vector3 };
}

/**
 * Contexto de mundo que se construye 1Ã— por frame y se pasa a cada NPC.
 * Por convenciÃ³n `npcs` NO incluye al NPC que estÃ¡ corriendo `update`.
 */
export interface AiFrameContext {
  delta: number;
  elapsed: number;
  aiLod: "near" | "mid" | "far";
  /** Distancia del observador principal; útil para LOD visual propio del actor. */
  viewerDistance?: number;
  player: ActorSnapshot;
  npcs: ActorSnapshot[];
  /**
   * Proyecciones de actores a través de portales linked. Comparten `id`/`entity`
   * con el actor real; sólo estas posiciones se validan con LOS portal-aware.
   */
  portalGhosts?: ActorSnapshot[];
  tacticalMap: TacticalMap;
  squadDirector: SquadDirector;
  /**
   * Squad del jugador (rebeldes): membresia, orden ir-a-punto vigente y
   * offset de formacion. Los miembros anclan a la orden en vez del player.
   */
  playerSquad?: {
    orderPosition: Vector3 | null;
    isMember(id: string): boolean;
    formationOffsetFor(id: string): Vector3 | null;
  };
  /**
   * Control guionado (scripted_sequence + compañera): `orderFor` da la orden de
   * secuencia activa para un NPC; `anchorOverrideFor` pisa el ancla de una
   * compañera (wait/escort). Ausente si el nivel no tiene scripting activo.
   */
  script?: {
    orderFor(npcId: string): NpcScriptOrder | null;
    anchorOverrideFor(npcId: string): Vector3 | null;
    /** Radio preciso para destinos guionados; null conserva el follow normal. */
    anchorArrivalRadiusFor(npcId: string): number | null;
  };
  eventBus: GameEventBus;
}

/**
 * Estado de pathing para overlays/trace. `path` son los waypoints suavizados
 * vivos del `NpcLocomotion`; `lastStatus` es 'pending' | 'ready' | 'none'.
 * Los campos de node ids quedan del path follower viejo y se llenan neutros.
 */
export interface NpcPathDebugSnapshot {
  path: Vector3[];
  pathNodeIds: Array<number | null>;
  waypointIndex: number;
  nextWaypointNodeId: number | null;
  nextWaypoint: Vector3 | null;
  pathTarget: Vector3 | null;
  pathUsed: boolean;
  pathUseReason: string;
  requestedDestination: Vector3 | null;
  distanceToRequested: number | null;
  horizontalDistanceToRequested: number | null;
  verticalDeltaToRequested: number | null;
  lastStatus: string;
  lastRepathReason: string | null;
  lastRequestAt: number | null;
  lastProgressAt: number | null;
  startNodeId: number | null;
  goalNodeId: number | null;
  startComponentId: number | null;
  goalComponentId: number | null;
  startNodePosition: Vector3 | null;
  goalNodePosition: Vector3 | null;
}

export interface NpcAiDebugSnapshot {
  id: string;
  state: string;
  /** Stable logical AI state used for transition detection. */
  stateKey?: string;
  /** Razón textual del último `fsm.setState(...)` — útil para el trace. */
  lastTransitionReason: string | null;
  position: Vector3;
  isAlive: boolean;
  health: number;
  maxHealth: number;
  wantsMove: boolean;
  target: Vector3 | null;
  threatId: string | null;
  threatPosition: Vector3 | null;
  coverId: string | null;
  path: NpcPathDebugSnapshot;
  perception?: {
    visibleNow: boolean;
    hasMemory: boolean;
    memoryAge: number;
    lastKnownPosition: Vector3 | null;
    timeSinceLastSeen?: number;
    candidateId?: string | null;
    candidateDistance?: number;
    detectionRange?: number;
  };
  locomotion?: {
    velocity: Vector3;
    desiredVelocity: Vector3;
    speed: number;
    desiredSpeed: number;
    grounded: boolean;
    crouched?: boolean;
    distanceToTarget: number;
    yaw: number;
    targetYaw: number;
  };
  navigation?: {
    motorTarget: Vector3 | null;
  };
  combat?: {
    magazine?: number;
    reserve?: number;
    isReloading?: boolean;
    isFiringBurst?: boolean;
    canStartBurst?: boolean;
    cooldownRemaining?: number;
    reloadRemaining?: number;
    burstShotsLeft?: number;
    nextShotIn?: number;
    aimSettleProgress?: number;
    aimRequired?: number;
    meleeReady?: boolean;
    meleeAttacking?: boolean;
  };
  tactical?: {
    role?: string;
    squadRole?: SquadRole;
    flankSide?: 1 | -1;
    suppressionLevel?: number;
    lastDamageAgo?: number;
    coverPhase?: string;
    coverPhaseRemaining?: number;
    timeInCover?: number;
    coverSearchCooldownRemaining?: number;
  };
  brain?: {
    schedule: string;
    previousSchedule: string | null;
    scheduleElapsed: number;
    task: string | null;
    taskIndex: number;
    activeConditions: string[];
    threat: {
      id: string | null;
      visibleNow: boolean;
      memoryAge: number;
      lastKnownPosition: Vector3 | null;
    };
    squadRole: SquadRole | null;
    tacticalTarget: Vector3 | null;
    coverId: string | null;
    stuckReason: string | null;
  };
}

/**
 * Handle mínimo para que el sistema de portales teleporte NPCs terrestres
 * (feature flag `PortalConfig.npcTraversal`). Null en motores sin soporte
 * (flyers, strider).
 */
export interface NpcPortalHandle {
  id: string;
  radius: number;
  getPosition(): Vector3;
  getVelocity(): Vector3;
  teleport(position: Vector3, velocity: Vector3, yaw: number): void;
  /**
   * Atomic full-frame traversal for composite organisms. The generic
   * position/velocity/yaw fallback cannot rotate an internal 3D hierarchy.
   * Returning false asks the portal system to use the generic fallback.
   */
  teleportThroughPortal?(
    entry: PortalFrame,
    exit: PortalFrame,
    position: Vector3,
    velocity: Vector3,
    yaw: number,
  ): boolean;
  setColliderExclusions(handles: ReadonlySet<number> | null): void;
}

/**
 * Handle mínimo para que la ice gun convierta a un NPC en estatua de hielo.
 * `freezeSolid()` mata al NPC sin ragdoll y cede el visual a la estatua física.
 */
export interface NpcFreezeHandle {
  id: string;
  radius: number;
  /** Altura de la cápsula del personaje (dimensiona la estatua física). */
  height: number;
  getPosition(): Vector3;
  isAlive(): boolean;
  /**
   * Muerte congelada: mata al NPC sin ragdoll (la pose queda rígida) y cede
   * el visual al caller — el NPC deja de tocar su mesh, que pasa a moverlo la
   * estatua física de la ice gun. Null si ya estaba muerto.
   */
  freezeSolid(): Group | null;
  /** Cierra el runtime del NPC cuando la estatua de hielo se rompe. */
  shatter?(): void;
}

/** Interfaz uniforme que consume `Game`/`LevelLoader`. La implementa `Npc`. */
export interface INpc {
  readonly id: string;
  readonly characterId?: CharacterId;
  readonly mesh: Group;
  readonly health: Health;
  readonly faction: Faction;
  readonly position: Vector3;
  readonly radius: number;
  /** Elegible para el squad del jugador (preset con `playerSquad`). */
  readonly playerSquadEligible: boolean;
  /** Nombre visible si es compañera (preset con `companion`), o null. */
  readonly companionName: string | null;

  update(ctx: AiFrameContext): void;
  syncFromPhysics(): void;
  /** Handle de traversal por portales, o null si el motor no lo soporta. */
  getPortalTraversalHandle(): NpcPortalHandle | null;
  /** Handle de congelamiento (ice gun), o null si el NPC ya no está vivo. */
  getFreezeHandle(): NpcFreezeHandle | null;
  applyDamage(
    amount: number,
    hitDirection?: Vector3,
    hitPartName?: string,
    attackerId?: string,
    hitPoint?: Vector3,
  ): void;
  isAlive(): boolean;
  getState(): string;
  getAiDebugSnapshot(): NpcAiDebugSnapshot;
  /**
   * Libera listeners del bus, releases de cover/squad y desactiva motor/animator.
   * Debe ser idempotente â€” `die()` y el teardown de nivel lo invocan ambos.
   */
  dispose(): void;
}
