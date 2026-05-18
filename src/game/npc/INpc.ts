import type { Group, Vector3 } from "three";
import type { Faction } from "../../engine/ai/Faction";
import type { NavGraph } from "../../engine/ai/NavGraph";
import type { Damageable } from "../../shared/types/lifecycle";
import type { Health } from "../gameplay/Health";
import type { CoverSystem } from "../levels/CoverSystem";
import type { CombatSquadCoordinator } from "./CombatSquadCoordinator";

/**
 * Snapshot ligero de un actor del mundo (player u otro NPC) que cualquier
 * NPC puede leer durante su `update()` para decidir threats, alianzas,
 * separación, etc.
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
 * Contexto de mundo que se construye 1× por frame y se pasa a cada NPC.
 * Por convención `npcs` NO incluye al NPC que está corriendo `update`.
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
 * Interfaz uniforme que consume `Game`/`LevelLoader`. NPC (zombie),
 * CombineNpc y AlyxNpc la implementan.
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
}
