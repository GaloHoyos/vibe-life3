import type { ScheduleDefinition } from '@engine/ai/brain/Task';
import type { PerceptionConfig } from '@engine/ai/perception/PerceptionSystem';
import type { NpcBrainContext } from '@game/npc/brain/NpcBrainContext';

/**
 * Preset data-driven que el `Npc` runtime consume. Cada arquetipo (combine,
 * zombie, alyx) exporta una funcion que produce este objeto, parametrizable
 * por stats de balance (rango melee, vision, etc.) si hace falta.
 *
 * El `Npc` instancia los schedules una vez en su construccion — los tasks
 * pueden mantener estado privado (timers, last-target) sin contaminar entre
 * NPCs.
 */
export interface NpcPreset {
  id: string;
  perception: PerceptionConfig;
  /** Salud maxima. */
  maxHealth: number;
  /** Radius del cuerpo (capsule). */
  radius: number;
  /** Distancia 2D a la que considera al threat en rango melee. */
  meleeRange: number;
  /**
   * Distancia 2D maxima de la banda de salto (`EnemyInLeapRange` se activa entre
   * `meleeRange` y este valor). Omitido / 0 = la creature no salta.
   */
  leapRange?: number;
  /** Parametros del salto balistico. Requerido si algun schedule usa el leap task. */
  leap?: NpcLeapProfile;
  /** Distancia 2D minima para `EnemyTooClose`. */
  tooCloseRange: number;
  /** Umbral de health (0..1) por debajo del cual activa `LowHealth`. */
  lowHealthRatio: number;
  /** Pose de aiming del animator. `none` para NPCs sin arma (melee). */
  weaponAim: 'twoHanded' | 'oneHanded' | 'none';
  /**
   * Ancla social (allies): si el player se aleja mas de `regroupDistance`
   * se activa `AnchorFar`; el schedule de regroup lo acerca a
   * `followDistance`. Omitido en NPCs hostiles.
   */
  anchor?: {
    followDistance: number;
    regroupDistance: number;
  };
  /** Movimiento. */
  movement: NpcMovementProfile;
  /** Schedules priorizados. El Brain los ordena desc por priority. */
  schedules: ScheduleDefinition<NpcBrainContext>[];
}

/** Flags por instancia que los builders usan para incluir schedules opcionales. */
export interface NpcPresetOptions {
  /** El NPC tiene ruta de patrol asignada en el nivel. */
  hasPatrol?: boolean;
}

export interface NpcLeapProfile {
  /** Tiempo (s) de recogida antes de lanzarse (encara al threat). */
  windup: number;
  /** Velocidad vertical inicial (m/s): define el apex y el tiempo de vuelo. */
  upSpeed: number;
  /** Tope de velocidad horizontal (m/s). */
  maxForwardSpeed: number;
  /** Pausa (s) tras aterrizar antes de re-evaluar (cadencia entre saltos). */
  recover: number;
}

export interface NpcMovementProfile {
  walkSpeed: number;
  sprintSpeed: number;
  acceleration: number;
  turnSpeed: number;
  stepOffset: number;
  snapToGround: number;
  /** Habilita planning de jump portals. */
  canJump: boolean;
  /**
   * Vuelo: el motor ignora la gravedad y se mueve en 3D (incluido Y), y la
   * locomotion beelinea al objetivo sin pedir paths al NavSpace. Default false
   * (NPC terrestre).
   */
  flying?: boolean;
  /** Altura (m) sobre el objetivo a la que el flyer flota al acercarse. */
  hoverHeight?: number;
  /**
   * Movimiento terrestre directo: no pide path humanoide al NavSpace. Lo usan
   * bosses grandes que resuelven suelo/clearance con su propio motor.
   */
  directGround?: boolean;
}
