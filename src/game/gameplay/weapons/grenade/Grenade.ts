import type RAPIER from "@dimforge/rapier3d-compat";
import type { Color, Object3D, Vector3 } from "three";
import type { Faction } from "@engine/ai/Faction";

/**
 * - `fuse`: la granada hace tick a un fuse (con beeps acelerando). Al
 *   llegar a 0 explota. Rebota libremente en el mundo.
 * - `impact`: explota al primer contacto con un cuerpo (NPC, esttico o
 *   dinmico). Se usa para el lanzagranadas del SMG.
 */
export type GrenadeMode = "fuse" | "impact";

/**
 * Faccin del lanzador. Determina a quin daa la explosin (todo lo que
 * sea damageable y no comparta faccin recibe dao; la facin propia
 * tambin recibe self-damage para no hacer la granada gratuita).
 */
export type GrenadeOwnerKind = "player" | "npc";

export interface GrenadeSpawnOptions {
  mode: GrenadeMode;
  origin: Vector3;
  velocity: Vector3;
  /** Dao mximo (al centro de la explosin). Cae linealmente con la distancia. */
  damage: number;
  /** Radio en metros de la explosin. */
  radius: number;
  /** Impulso aplicado a dynamic bodies en el radio. */
  impulse: number;
  /** Slo `fuse`: segundos hasta explotar. Default 3.5. */
  fuseSeconds?: number;
  /** Faccin propietaria, para attribution del dao. */
  ownerKind: GrenadeOwnerKind;
  sourceId?: string;
  sourceFaction?: Faction;
  /** Nombre del arma para el `weapon.hit` emitido por cada vctima. */
  weaponName: string;
  /** Elapsed time del game loop  base para fuse/hardExpires/beep timing. */
  now: number;
}

/**
 * Parámetros de una explosión genérica (sin granada). Lo consume
 * `GrenadeSystem.detonate` para que cualquier fuente (granadas, barriles
 * explosivos, etc.) genere la misma explosión radial.
 */
export interface ExplosionParams {
  /** Daño máximo (al centro). Cae linealmente con la distancia. */
  damage: number;
  /** Radio en metros. */
  radius: number;
  /** Impulso aplicado a dynamic bodies en el radio. */
  impulse: number;
  ownerKind: GrenadeOwnerKind;
  sourceId?: string;
  sourceFaction?: Faction;
  /** Nombre del arma para el `weapon.hit` emitido por cada víctima. */
  weaponName: string;
  /** Cuerpo a excluir del impulso (p. ej. la propia granada). */
  ignoreBody?: RAPIER.RigidBody;
  /** Tinte del VFX de explosión (energía del strider, etc.). Default = fuego. */
  color?: Color;
}

export interface ActiveGrenade {
  id: string;
  mode: GrenadeMode;
  body: RAPIER.RigidBody;
  mesh: Object3D;
  damage: number;
  radius: number;
  impulse: number;
  /** elapsed al spawnear. */
  spawnedAt: number;
  /** elapsed al que detona. Slo `fuse` usa este field. */
  fuseEndsAt: number;
  /** elapsed lmite para auto-cleanup de granadas impact que nunca chocaron. */
  hardExpiresAt: number;
  /** Prxima vez que toca beep (slo `fuse`). */
  nextBeepAt: number;
  /** Cantidad de beeps reproducidos (acelera con cada uno). */
  beepCount: number;
  ownerKind: GrenadeOwnerKind;
  sourceId?: string;
  sourceFaction?: Faction;
  weaponName: string;
  exploded: boolean;
}
