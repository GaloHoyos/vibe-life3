import type { VectorTuple } from "@shared/math/VectorTuple";
import type { RigidBodySnapshot } from "@engine/physics/RigidBodySnapshot";

/** Rotacion Euler XYZ en radianes. Omitida = alineado a los ejes. */
type RotationTuple = VectorTuple;

/**
 * Definición de barril explosivo. El destructible propio ya no existe: el
 * `LevelLoader` traduce esto al arquetipo `explosiveBarrel` del catálogo de
 * props. La definición sobrevive porque es el formato con el que están
 * autorados los niveles y el editor.
 */
export interface ExplosiveBarrelDefinition {
  id: string;
  /** Base/apoyo (cara inferior), como los crates. */
  position: VectorTuple;
  rotation?: RotationTuple;
  /** Vida antes de explotar. Default 25. */
  health?: number;
  /** Daño máximo de la explosión. Default 90. */
  damage?: number;
  /** Radio de la explosión (m). Default 4.5. */
  radius?: number;
  /** Impulso a dynamics en el radio. Default 14. */
  impulse?: number;
}

export interface ActiveExplosiveBarrelSaveSnapshot {
  id: string;
  destroyed: false;
  health: number;
  alive: boolean;
  pendingExplosion: boolean;
  lastAttackerId: string | null;
  body: RigidBodySnapshot;
}

export interface DestroyedExplosiveBarrelSaveSnapshot {
  id: string;
  destroyed: true;
}

/** Formato de guardado v1. Se conserva para que las partidas viejas carguen. */
export type ExplosiveBarrelSaveSnapshot =
  | ActiveExplosiveBarrelSaveSnapshot
  | DestroyedExplosiveBarrelSaveSnapshot;
