import type RAPIER from "@dimforge/rapier3d-compat";
import { Vector3, type Object3D } from "three";
import {
  captureRigidBodySnapshot,
  restoreRigidBodySnapshot,
  type RigidBodySnapshot,
} from "@engine/physics/RigidBodySnapshot";
import type { Damageable, DamageType } from "@shared/types/lifecycle";
import type { PropArchetype, PropBreakReaction } from "@game/config/props.config";
import { propMaxHealth, resolvePropDamage } from "./propDamage";

export interface ActivePropSaveSnapshot {
  id: string;
  destroyed: false;
  health: number;
  alive: boolean;
  pendingBreak: boolean;
  lastAttackerId: string | null;
  body: RigidBodySnapshot;
}

export interface DestroyedPropSaveSnapshot {
  id: string;
  destroyed: true;
}

export type PropSaveSnapshot = ActivePropSaveSnapshot | DestroyedPropSaveSnapshot;

export interface PropInstanceOptions {
  /** Vida inicial; si se omite, la del arquetipo. */
  readonly health?: number | false;
  /** Escala uniforme aplicada al spawnear. Default 1. */
  readonly scale?: number;
  /** Aviso de daño que NO fue letal (el letal lo anuncia la rotura). */
  readonly onDamaged?: (prop: PropInstance, attackerId: string | undefined) => void;
}

/**
 * Un prop vivo del nivel: cuerpo, malla, vida y reacción de rotura. Es el
 * `Damageable` que va en la metadata de sus colliders, así lo alcanzan
 * disparos, melee, explosiones y el daño por impacto contra el mundo.
 *
 * No se rompe solo: al agotar la vida marca `pendingBreak` y el `PropBreakSystem`
 * lo resuelve en su `update`. Romper in-line mientras otra explosión recorre sus
 * damageables sería re-entrante, y es lo que hace que una cadena se vea
 * escalonada en vez de instantánea.
 */
export class PropInstance implements Damageable {
  private body: RAPIER.RigidBody | null = null;
  private health: number;
  private readonly maxHealth: number;
  private readonly onDamaged: PropInstanceOptions["onDamaged"];
  private dead = false;
  pendingBreak = false;
  /** Quién asestó el golpe letal, para atribuir la rotura y su explosión. */
  lastAttackerId?: string;
  /** Punto e impulso del golpe letal, en world space: los usa la fractura. */
  breakPoint?: Vector3;
  breakDirection?: Vector3;

  constructor(
    readonly id: string,
    readonly archetype: PropArchetype,
    readonly mesh: Object3D,
    readonly breakReaction: PropBreakReaction,
    options: PropInstanceOptions = {},
  ) {
    const resolved = options.health === undefined ? propMaxHealth(archetype) : options.health;
    this.maxHealth = resolved === false ? Infinity : resolved;
    this.health = this.maxHealth;
    this.onDamaged = options.onDamaged;
    // La malla del prop nace ya dimensionada, así que su `scale` es 1 y no
    // sirve para recuperar esto: hay que conservarlo aparte.
    this.scale = options.scale ?? 1;
  }

  /** Escala uniforme con la que se instanció. */
  readonly scale: number;

  get totalHealth(): number {
    return this.maxHealth;
  }

  get destructible(): boolean {
    return Number.isFinite(this.maxHealth);
  }

  attachBody(body: RAPIER.RigidBody): void {
    this.body = body;
  }

  getBody(): RAPIER.RigidBody | null {
    return this.body;
  }

  position(target = new Vector3()): Vector3 {
    const t = this.body?.translation();
    return t ? target.set(t.x, t.y, t.z) : target.copy(this.mesh.position);
  }

  applyDamage(
    amount: number,
    hitDirection?: Vector3,
    _hitPartName?: string,
    attackerId?: string,
    hitPoint?: Vector3,
    damageType?: DamageType,
  ): void {
    if (this.dead || !this.destructible) return;
    const effective = resolvePropDamage(this.archetype, amount, damageType);
    if (effective <= 0) return;

    if (attackerId) this.lastAttackerId = attackerId;
    this.health -= effective;
    if (this.health > 0) {
      this.onDamaged?.(this, attackerId);
      return;
    }

    this.dead = true;
    this.pendingBreak = true;
    // El punto del golpe letal es lo que decide hacia dónde revienta: sin él la
    // fractura queda simétrica y se lee como una animación, no como un impacto.
    this.breakPoint = hitPoint ? hitPoint.clone() : this.position();
    this.breakDirection = hitDirection?.clone();
  }

  isAlive(): boolean {
    return !this.dead;
  }

  currentHealth(): number {
    return this.health;
  }

  captureSaveState(): ActivePropSaveSnapshot {
    if (!this.body) throw new Error(`Prop ${this.id} sin cuerpo físico`);
    return {
      id: this.id,
      destroyed: false,
      health: finiteHealth(this.health),
      alive: !this.dead,
      pendingBreak: this.pendingBreak,
      lastAttackerId: this.lastAttackerId ?? null,
      body: captureRigidBodySnapshot(this.body),
    };
  }

  restoreSaveState(snapshot: Readonly<ActivePropSaveSnapshot>): void {
    if (snapshot.id !== this.id) {
      throw new Error(`Snapshot de prop ${snapshot.id} aplicado a ${this.id}`);
    }
    if (!this.body) throw new Error(`Prop ${this.id} sin cuerpo físico`);
    restoreRigidBodySnapshot(this.body, snapshot.body);
    this.health = Math.min(this.maxHealth, finiteHealth(snapshot.health));
    this.dead = !snapshot.alive || this.health <= 0;
    this.pendingBreak = this.dead && snapshot.pendingBreak;
    this.lastAttackerId = snapshot.lastAttackerId ?? undefined;
    this.mesh.position.set(...snapshot.body.position);
    this.mesh.quaternion.set(...snapshot.body.rotation);
  }
}

function finiteHealth(value: number): number {
  if (value === Infinity) return Infinity;
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
