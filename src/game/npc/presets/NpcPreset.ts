import type { ScheduleDefinition } from '@engine/ai/brain/Task';
import type { PerceptionConfig } from '@engine/ai/perception/PerceptionSystem';
import type {
  CharacterFlinchConfig,
  CharacterGrenadeTacticConfig,
} from '@engine/characters/CharacterDefinition';
import type { NpcCalloutKind } from '@game/config/audio.config';
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
  /**
   * Usa cover points del TacticalMap (activa el NpcCoverSensor y su scan
   * periodico). Default true; apagar en presets cuyos schedules no consumen
   * conditions de cover para ahorrar el computo.
   */
  usesCover?: boolean;
  /** Reporta y consume roles/slots del SquadDirector. Default true; idem ahorro. */
  usesSquad?: boolean;
  /**
   * Disciplina de slots de ataque HL2: el NPC reclama uno de los slots
   * limitados de su faccion para disparar, y sus schedules de fuego requieren
   * `HasAttackSlot`. Default false (dispara libre, ej. Alyx).
   */
  attackSlot?: boolean;
  /**
   * Perfil de granada tactica (flush-out del target oculto). Para humanoides
   * lo copia la factory desde `CharacterPresets[..].attack.grenade`.
   */
  grenade?: CharacterGrenadeTacticConfig;
  /**
   * Cooldown de re-flinch (`FlinchReady`). Omitido = sin cooldown: cada
   * impacto vuelve a flinchear (zombies, a proposito).
   */
  flinch?: CharacterFlinchConfig;
  /**
   * Voces tacticas (`npc.callout`): habilita los rising-edge de contact/alert
   * y mapea entradas a schedules ('flank' → 'engaging'). Omitido = mudo.
   */
  callouts?: {
    bySchedule?: Record<string, NpcCalloutKind>;
  };
  /** Perfil de medic: cura a aliados/player bajo el umbral (schedule `heal`). */
  medic?: NpcMedicProfile;
  perception: PerceptionConfig;
  /** Salud maxima. */
  maxHealth: number;
  /**
   * Jefes estilo HL2 (gunship/strider): solo reciben daño explosivo; balas,
   * melee y energia hacen 0. `Npc.applyDamage` ignora todo `damageType` que no
   * sea `"explosive"`.
   */
  explosiveOnly?: boolean;
  /**
   * Daño fijo por impacto explosivo para `explosiveOnly`. Reemplaza al daño
   * radial real (que mide distancia al centro del cuerpo y en un jefe enorme
   * caeria a ~0 por falloff), garantizando N cohetes para matarlo: maxHealth /
   * explosiveHitDamage. Ej: 500 / 100 = 5 cohetes.
   */
  explosiveHitDamage?: number;
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
  /**
   * Elegible para el squad del jugador (auto-join, ordenes ir-a-punto,
   * formacion). Solo tiene sentido junto con `anchor`.
   */
  playerSquad?: boolean;
  /** Movimiento. */
  movement: NpcMovementProfile;
  /** Schedules priorizados. El Brain los ordena desc por priority. */
  schedules: ScheduleDefinition<NpcBrainContext>[];
}

/** Flags por instancia que los builders usan para incluir schedules opcionales. */
export interface NpcPresetOptions {
  /** El NPC tiene ruta de patrol asignada en el nivel. */
  hasPatrol?: boolean;
  /** Override de flinch por variante (elite flinchea menos). */
  flinch?: CharacterFlinchConfig;
}

export interface NpcMedicProfile {
  /** Fraccion de vida (0..1) bajo la cual un aliado califica para curacion. */
  healThreshold: number;
  /** Vida restaurada por curacion. */
  healAmount: number;
  /** Duracion (s) del "cast" junto al objetivo antes de aplicar el heal. */
  castTime: number;
  /** Cooldown (s) entre curaciones del medic. */
  cooldown: number;
  /** Distancia 2D maxima a la que detecta aliados heridos. */
  range: number;
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
