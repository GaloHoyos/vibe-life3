import type { Group, Vector3 } from "three";
import type { Faction } from "@engine/ai/Faction";
import type { NavGraph } from "@engine/ai/NavGraph";
import type { Damageable } from "@shared/types/lifecycle";
import type { Health } from "@game/gameplay/Health";
import type { CoverSystem } from "@game/levels/CoverSystem";
import type { CombatSquadCoordinator } from "@game/npc/combat/CombatSquadCoordinator";

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
  player: ActorSnapshot;
  npcs: ActorSnapshot[];
  coverSystem: CoverSystem;
  navGraph: NavGraph;
  squad: CombatSquadCoordinator;
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
  /**
   * Libera listeners del bus, releases de cover/squad y desactiva motor/animator.
   * Debe ser idempotente â€” `die()` y el teardown de nivel lo invocan ambos.
   */
  dispose(): void;
}
