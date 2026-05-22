import type { Group, Vector3 } from "three";
import type { Faction } from "@engine/ai/Faction";
import type { NavGraph } from "@engine/ai/NavGraph";
import type { Damageable } from "@shared/types/lifecycle";
import type { Health } from "@game/gameplay/Health";
import type { GrenadeSystem } from "@game/gameplay/weapons/grenade/GrenadeSystem";
import type { GameEventBus } from "@game/GameEvents";
import type { TacticalMap } from "@game/npc/ai/TacticalMap";
import type { SquadDirector, SquadRole } from "@game/npc/ai/SquadDirector";
import type { NpcPathDebugSnapshot } from "@game/npc/movement/NpcPathFollower";

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
}

/**
 * Contexto de mundo que se construye 1Ã— por frame y se pasa a cada NPC.
 * Por convenciÃ³n `npcs` NO incluye al NPC que estÃ¡ corriendo `update`.
 */
export interface AiFrameContext {
  delta: number;
  elapsed: number;
  aiLod: "near" | "mid" | "far";
  player: ActorSnapshot;
  npcs: ActorSnapshot[];
  tacticalMap: TacticalMap;
  navGraph: NavGraph;
  squadDirector: SquadDirector;
  grenades: GrenadeSystem;
  eventBus: GameEventBus;
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
 * Interfaz uniforme que consume `Game`/`LevelLoader`. `ZombieNpc`,
 * `CombineNpc` y `AlyxNpc` la implementan.
 */
export interface INpc {
  readonly id: string;
  readonly mesh: Group;
  readonly health: Health;
  readonly faction: Faction;
  readonly position: Vector3;
  readonly radius: number;

  update(ctx: AiFrameContext): void;
  syncFromPhysics(): void;
  applyDamage(amount: number, hitDirection?: Vector3, hitPartName?: string): void;
  isAlive(): boolean;
  getState(): string;
  getAiDebugSnapshot(): NpcAiDebugSnapshot;
  /**
   * Libera listeners del bus, releases de cover/squad y desactiva motor/animator.
   * Debe ser idempotente â€” `die()` y el teardown de nivel lo invocan ambos.
   */
  dispose(): void;
}
