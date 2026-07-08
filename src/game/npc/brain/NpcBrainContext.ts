import type { Vector3 } from 'three';
import type { ConditionMask } from '@engine/ai/brain/Condition';
import type { NavSpace } from '@engine/ai/nav/NavSpace';
import type { GameEventBus } from '@game/GameEvents';
import type { ActorSnapshot } from '@game/npc/core/INpc';
import type { BuildingRegistry } from '@game/levels/buildings/BuildingRegistry';
import type { Faction } from '@engine/ai/Faction';
import type { NoiseSnapshot } from '@game/npc/brain/NpcNoiseSensor';
import type { NpcTacticalHandle } from '@game/npc/brain/NpcCoverSensor';
import type { SquadRole } from '@game/npc/ai/SquadDirector';

export interface NpcSelfSnapshot {
  id: string;
  position: Vector3;
  facing: Vector3;
  faction: Faction;
  isAlive: boolean;
  health: number;
  maxHealth: number;
  radius: number;
}

/**
 * Interfaz minima que el brain ve de la locomotion. Mantenerla flaca permite
 * implementar otros motores (volador, nadador) sin tocar tasks.
 */
export interface NpcLocomotionHandle {
  /** Pide moverse hacia un punto. La locomotion encola un path si hace falta. */
  moveTo(target: Vector3, options?: NpcMoveOptions): void;
  /** Detiene el movimiento (libera el target actual). */
  stop(): void;
  /** Distancia 2D actual al target activo, o Infinity si no hay. */
  distanceToTarget(): number;
  hasPath(): boolean;
  isStuck(): boolean;
  /** Encara hacia un punto sin moverse. */
  face(target: Vector3): void;
  /** Salto balistico hacia un punto (creatures terrestres como el headcrab). */
  leap(target: Vector3, params: NpcLeapParams): void;
  /** True mientras el cuerpo este en el aire por un `leap`. */
  isLeaping(): boolean;
}

export interface NpcLeapParams {
  /** Velocidad vertical inicial del salto (m/s). Define el apex y el tiempo de vuelo. */
  upSpeed: number;
  /** Tope de velocidad horizontal del salto (m/s). */
  maxForwardSpeed: number;
}

export interface NpcMoveOptions {
  /** Si presente, encara a este punto mientras se mueve hacia `target`. */
  facing?: Vector3;
  /** 'walk' (default) | 'sprint'. */
  gait?: 'walk' | 'sprint';
}

/** Estado del mundo que el `Npc` empuja al combat handle cada frame. */
export interface NpcCombatTickArgs {
  delta: number;
  elapsed: number;
  position: Vector3;
  facing: Vector3;
  threat: ActorSnapshot | null;
}

export type NpcCombatIntent = "primary" | "secondary" | "melee";

/**
 * Interfaz minima del subsistema de combate que las tasks consumen.
 * Implementada por `NpcMeleeCombat` o `RealRangedCombat` segun el preset.
 */
export interface NpcCombatHandle {
  /** Avanza timers internos (cooldowns, rafagas, hit-windows). Lo llama el `Npc`, no las tasks. */
  tick(args: NpcCombatTickArgs): void;
  /** Apunta hacia el threat (solo ranged). Sin efecto en melee. */
  aim(target: Vector3): void;
  /**
   * Barre buscando sin disparar (la torreta lo usa tras perder al enemigo:
   * escanea unos segundos y luego se desactiva). Opcional: la mayoria de los
   * combats no escanean.
   */
  scan?(): void;
  /** Intenta disparar una rafaga / golpe. Devuelve true si se inicio. */
  tryFire(): boolean;
  /** Selecciona arma/accion especial en combats con mas de un modo. */
  setIntent?(intent: NpcCombatIntent): void;
  /** Readiness opcional para tasks que no deben bloquear otros ataques. */
  canUseIntent?(intent: NpcCombatIntent): boolean;
  reload(): void;
  isReloading(): boolean;
  magazineEmpty(): boolean;
  /** Distancia maxima a la que tiene sentido encarar combate. */
  effectiveRange(): number;
}

/**
 * Punto del threat para MOVERSE (goal de pathfinding). Los ghosts de portal
 * proyectan `position` detrás del disco — correcto para apuntar/encarar, pero
 * como goal de A* cae en celdas del lado equivocado de la pared. `navPosition`
 * trae la posición real y el A* decide si la ruta más corta cruza el par
 * (links warp). Los flyers NO deben usar esto: steerean directo al ghost y el
 * motor cruza el disco.
 */
export function threatNavPosition(ctx: NpcBrainContext): Vector3 | null {
  if (ctx.threat) return ctx.threat.navPosition ?? ctx.threat.position;
  return ctx.threatLastKnown;
}

export interface NpcBrainContext {
  delta: number;
  elapsed: number;
  self: NpcSelfSnapshot;
  /** Threat actual (player u otro NPC hostil). `null` si no hay. */
  threat: ActorSnapshot | null;
  /** Ultimo punto conocido del threat (memoria de perception). */
  threatLastKnown: Vector3 | null;
  /** Snapshot del player (puede ser aliado — no necesariamente threat). */
  player: ActorSnapshot;
  /** Ruta de patrol del nivel, o null si el NPC no patrulla. */
  patrolRoute: Vector3[] | null;
  /** Ruidos oidos recientemente (decaen solos). */
  noise: NoiseSnapshot;
  /** Handle de cover/flank/retreat. Null en presets sin tactica (zombies). */
  tactical: NpcTacticalHandle | null;
  /** Rol asignado por el SquadDirector este frame. Null sin squad. */
  squad: { role: SquadRole; flankSide: 1 | -1 } | null;
  conditions: ConditionMask;
  navSpace: NavSpace;
  buildingRegistry: BuildingRegistry;
  locomotion: NpcLocomotionHandle;
  combat: NpcCombatHandle;
  eventBus: GameEventBus;
}
