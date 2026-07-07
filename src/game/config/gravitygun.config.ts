import type { GrabTuning } from "@engine/physics/grab/PhysicsGrabController";

/**
 * Tuning de la gravity gun (physcannon HL2-style). El hold es un shadow
 * controller dinámico (ver `PhysicsGrabController`); referencias del juego
 * original: minforce 700 / maxforce 1500, pullforce 4000, maxmass 250.
 */
export const GravityGunConfig = {
  /** Alcance del raycast tanto para grab como para punt directo. */
  reachRange: 4.0,
  pullRange: 11.0,
  pullFarSpeed: 1.8,
  pullNearSpeed: 11,
  pullFarResponse: 1.2,
  pullNearResponse: 8.5,
  /** Mirando más abajo que este pitch en el aire, el prop sostenido se suelta. */
  airDownDropPitch: -0.55,
  /** Origin offset del raycast (escapa la cápsula del player, radius 0.35). */
  rayOriginOffset: 0.55,
  /** Velocidad horizontal de un punt. */
  puntSpeed: 38,
  /** Componente vertical extra al puntear (arco corto). */
  puntLift: 5,
  /** Velocidad al lanzar desde holding. */
  throwSpeed: 42,
  throwLift: 4,
  /** Masa máxima agarrable/atraíble. El punt no tiene límite de masa. */
  grabMaxMass: 250,
  /** Daño del punt directo sobre un NPC terrestre vivo (no agarrable). */
  puntNpcDamage: 12,
  hold: {
    holdDistance: 2.4,
    minHoldDistance: 0.9,
    wallClampMargin: 0.3,
    maxLinearSpeed: 14,
    linearGain: 12,
    maxAngularSpeed: 12,
    angularGain: 10,
    dropErrorDistance: 0.9,
    dropErrorTime: 0.5,
    teleportGraceSeconds: 0.3,
  } satisfies GrabTuning,
} as const;
