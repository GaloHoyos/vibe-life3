import type { Group, Vector3 } from "three";
import type { Faction } from "@engine/ai/Faction";
import type { NavGraph } from "@engine/ai/NavGraph";
import type { Damageable } from "@shared/types/lifecycle";
import type { Health } from "@game/gameplay/Health";
import type { GrenadeSystem } from "@game/gameplay/weapons/grenade/GrenadeSystem";
import type { CoverSystem } from "@game/levels/CoverSystem";
import type { CombatSquadCoordinator } from "@game/npc/combat/CombatSquadCoordinator";
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
export interface NpcUpdateContext {
  delta: number;
  elapsed: number;
  aiLod: "near" | "mid" | "far";
  player: ActorSnapshot;
  npcs: ActorSnapshot[];
  coverSystem: CoverSystem;
  navGraph: NavGraph;
  squad: CombatSquadCoordinator;
  grenades: GrenadeSystem;
}

export interface NpcAiDebugSnapshot {
  id: string;
  state: string;
  /** Razón textual del último `fsm.setState(...)` — útil para el trace. */
  lastTransitionReason: string | null;
  position: Vector3;
  isAlive: boolean;
  wantsMove: boolean;
  target: Vector3 | null;
  threatId: string | null;
  threatPosition: Vector3 | null;
  coverId: string | null;
  path: NpcPathDebugSnapshot;
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

  update(ctx: NpcUpdateContext): void;
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
