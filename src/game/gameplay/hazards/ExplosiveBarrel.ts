import type RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import type { Object3D } from "three";
import type { VectorTuple } from "@shared/math/VectorTuple";
import type { Damageable } from "@shared/types/lifecycle";
import {
  captureRigidBodySnapshot,
  restoreRigidBodySnapshot,
  type RigidBodySnapshot,
} from "@engine/physics/RigidBodySnapshot";

/** Rotacion Euler XYZ en radianes. Omitida = alineado a los ejes. */
type RotationTuple = VectorTuple;

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

export interface ExplosiveBarrelTuning {
  health: number;
  damage: number;
  radius: number;
  impulse: number;
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

export type ExplosiveBarrelSaveSnapshot =
  | ActiveExplosiveBarrelSaveSnapshot
  | DestroyedExplosiveBarrelSaveSnapshot;

/**
 * Barril explosivo: cuerpo dinámico dañable que explota al agotar su vida. El
 * sistema dueño difiere la explosión a su `update` (no in-line) para evitar
 * re-entrancy mientras otra explosión recorre sus damageables — eso da el
 * encadenado escalonado de barril en barril.
 */
export class ExplosiveBarrel implements Damageable {
  readonly damage: number;
  readonly radius: number;
  readonly impulse: number;
  private body: RAPIER.RigidBody | null = null;
  private health: number;
  private readonly maxHealth: number;
  private dead = false;
  pendingExplosion = false;
  /** Quién asestó el golpe letal, para atribuir la explosión (aggro/kill feed). */
  lastAttackerId?: string;

  constructor(
    readonly id: string,
    readonly mesh: Object3D,
    tuning: ExplosiveBarrelTuning,
  ) {
    this.health = tuning.health;
    this.maxHealth = tuning.health;
    this.damage = tuning.damage;
    this.radius = tuning.radius;
    this.impulse = tuning.impulse;
  }

  attachBody(body: RAPIER.RigidBody): void {
    this.body = body;
  }

  getBody(): RAPIER.RigidBody | null {
    return this.body;
  }

  position(): Vector3 {
    const t = this.body?.translation() ?? { x: 0, y: 0, z: 0 };
    return new Vector3(t.x, t.y, t.z);
  }

  applyDamage(
    amount: number,
    _hitDirection?: Vector3,
    _hitPartName?: string,
    attackerId?: string,
  ): void {
    if (this.dead) {
      return;
    }
    if (attackerId) {
      this.lastAttackerId = attackerId;
    }
    this.health -= amount;
    if (this.health <= 0) {
      this.dead = true;
      this.pendingExplosion = true;
    }
  }

  isAlive(): boolean {
    return !this.dead;
  }

  captureSaveState(): ActiveExplosiveBarrelSaveSnapshot {
    if (!this.body) {
      throw new Error(`Barril ${this.id} sin cuerpo físico`);
    }
    return {
      id: this.id,
      destroyed: false,
      health: finiteNonNegative(this.health),
      alive: !this.dead,
      pendingExplosion: this.pendingExplosion,
      lastAttackerId: this.lastAttackerId ?? null,
      body: captureRigidBodySnapshot(this.body),
    };
  }

  restoreSaveState(
    snapshot: Readonly<ActiveExplosiveBarrelSaveSnapshot>,
  ): void {
    if (snapshot.id !== this.id) {
      throw new Error(`Snapshot de barril ${snapshot.id} aplicado a ${this.id}`);
    }
    if (!this.body) {
      throw new Error(`Barril ${this.id} sin cuerpo físico`);
    }
    restoreRigidBodySnapshot(this.body, snapshot.body);
    this.health = Math.min(this.maxHealth, finiteNonNegative(snapshot.health));
    this.dead = !snapshot.alive || this.health <= 0;
    this.pendingExplosion = this.dead && snapshot.pendingExplosion;
    this.lastAttackerId = snapshot.lastAttackerId ?? undefined;
    const translation = snapshot.body.position;
    const rotation = snapshot.body.rotation;
    this.mesh.position.set(...translation);
    this.mesh.quaternion.set(...rotation);
  }
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
