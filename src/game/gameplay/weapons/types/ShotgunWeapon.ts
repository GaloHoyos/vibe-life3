import { Vector3 } from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import {
  Weapon,
  type WeaponAlternateFireContext,
  type WeaponContext,
  type WeaponFireContext,
  type WeaponUpdateContext,
} from "@game/gameplay/weapons/core/Weapon";
import type { WeaponDefinition } from "@game/gameplay/weapons/core/WeaponDefinition";

const DEFAULT_PELLETS = 8;
/** Segundos entre carga de cartuchos durante la recarga secuencial. */
const SHELL_RELOAD_TIME = 0.55;
/** Segundos entre la carga del ltimo cartucho y el cock final. */
const POST_RELOAD_COCK_TIME = 0.4;
/** Segundos entre el boom del disparo y el cock (pump). */
const POST_FIRE_COCK_TIME = 0.18;

const spreadRight = new Vector3();
const spreadUp = new Vector3();

interface PendingVolley {
  damageMultiplier: number;
}

interface ShotgunReloadState {
  active: boolean;
  /** elapsed al que se carga el prximo cartucho. */
  nextShellAt: number;
  /** elapsed al que suena el cock final (slo en cockingPhase). */
  cockAt: number;
  /** true una vez cargado el ltimo cartucho, esperando el cock. */
  cockingPhase: boolean;
}

/**
 * Shotgun con doble disparo (alt-fire) y recarga secuencial estilo HL2:
 *
 * - **Primary (LMB)**: una salva de N pellets. Tras el boom, dispara el
 *   pump (`weapon.cocked`) con `POST_FIRE_COCK_TIME` de retraso.
 * - **Secondary (RMB, `doubleShot`)**: dos salvas separadas por
 *   `shotSpacing` segundos; cada pellet con `damageMultiplier` extra.
 *   Cada volley produce su propio cock.
 * - **Recarga (R)**: secuencial; carga un cartucho cada `SHELL_RELOAD_TIME`
 *   emitiendo `weapon.reloaded` (suena `reload.mp3`). Despus del ltimo
 *   cartucho cargado, `POST_RELOAD_COCK_TIME` y suena el cock final.
 *   Disparar en cualquier momento cancela la recarga.
 */
export class ShotgunWeapon extends Weapon {
  private pendingSecondVolleyAt = Number.POSITIVE_INFINITY;
  private pendingVolley: PendingVolley | null = null;
  private pendingCockAt = Number.POSITIVE_INFINITY;
  private readonly reload: ShotgunReloadState = {
    active: false,
    nextShellAt: Number.POSITIVE_INFINITY,
    cockAt: Number.POSITIVE_INFINITY,
    cockingPhase: false,
  };

  constructor(definition: WeaponDefinition, context: WeaponContext) {
    super(definition, context);
  }

  override tryFire(fireContext: WeaponFireContext): boolean {
    this.cancelReloadIfActive();
    const fired = super.tryFire(fireContext);
    if (fired) {
      this.pendingCockAt = fireContext.now + POST_FIRE_COCK_TIME;
    }
    return fired;
  }

  protected performFire(context: WeaponFireContext): void {
    this.firePelletVolley(context.origin, context.direction, 1);
  }

  override tryAlternateFire(context: WeaponAlternateFireContext): void {
    if (!context.pressed) {
      return;
    }
    const alt = this.definition.alternateFire;
    if (alt?.kind !== "doubleShot") {
      return;
    }
    if (this.magazine < alt.shellCost) {
      this.context.eventBus.emit("weapon.empty", { weaponName: this.name });
      return;
    }
    if (context.now - this.lastFireTime < 1 / this.definition.fireRate) {
      return;
    }

    this.cancelReloadIfActive();

    this.lastFireTime = context.now;
    this.magazine -= 1;
    this.emitFired(context.origin, context.direction);
    this.firePelletVolley(
      context.origin,
      context.direction,
      alt.damageMultiplier,
    );
    this.emitAmmoChanged();
    this.pendingCockAt = context.now + POST_FIRE_COCK_TIME;

    this.pendingSecondVolleyAt = context.now + alt.shotSpacing;
    this.pendingVolley = { damageMultiplier: alt.damageMultiplier };
  }

  override tryReload(now: number): boolean {
    if (this.reload.active) {
      return false;
    }
    if (this.magazine >= this.definition.magazineSize) {
      return false;
    }
    if (this.reserve <= 0) {
      return false;
    }

    this.reload.active = true;
    this.reload.cockingPhase = false;
    this.reload.nextShellAt = now + SHELL_RELOAD_TIME;
    this.reload.cockAt = Number.POSITIVE_INFINITY;
    return true;
  }

  override isReloading(now: number): boolean {
    return this.reload.active || super.isReloading(now);
  }

  override update(_delta: number, context: WeaponUpdateContext): void {
    if (
      this.pendingVolley !== null &&
      context.elapsed >= this.pendingSecondVolleyAt
    ) {
      if (this.magazine > 0) {
        this.magazine -= 1;
        this.emitFired(context.origin, context.direction);
        this.firePelletVolley(
          context.origin,
          context.direction,
          this.pendingVolley.damageMultiplier,
        );
        this.emitAmmoChanged();
        this.pendingCockAt = context.elapsed + POST_FIRE_COCK_TIME;
      }
      this.pendingVolley = null;
      this.pendingSecondVolleyAt = Number.POSITIVE_INFINITY;
    }

    if (context.elapsed >= this.pendingCockAt) {
      this.emitCocked();
      this.pendingCockAt = Number.POSITIVE_INFINITY;
    }

    if (this.reload.active) {
      this.tickSequentialReload(context.elapsed);
    }
  }

  override onUnequip(): void {
    this.pendingVolley = null;
    this.pendingSecondVolleyAt = Number.POSITIVE_INFINITY;
    this.pendingCockAt = Number.POSITIVE_INFINITY;
    this.resetReloadState();
  }

  private tickSequentialReload(now: number): void {
    if (!this.reload.cockingPhase) {
      if (now < this.reload.nextShellAt) {
        return;
      }
      this.loadOneShell();
      const full = this.magazine >= this.definition.magazineSize;
      const empty = this.reserve <= 0;
      if (full || empty) {
        this.reload.cockingPhase = true;
        this.reload.cockAt = now + POST_RELOAD_COCK_TIME;
      } else {
        this.reload.nextShellAt = now + SHELL_RELOAD_TIME;
      }
      return;
    }

    if (now >= this.reload.cockAt) {
      this.emitCocked();
      this.resetReloadState();
    }
  }

  private loadOneShell(): void {
    this.magazine += 1;
    this.reserve -= 1;
    this.emitAmmoChanged();
    this.context.eventBus.emit("weapon.reloaded", {
      weaponName: this.name,
      ammo: this.magazine,
      reserve: this.reserve,
    });
  }

  private cancelReloadIfActive(): void {
    if (this.reload.active) {
      this.resetReloadState();
    }
  }

  private resetReloadState(): void {
    this.reload.active = false;
    this.reload.cockingPhase = false;
    this.reload.nextShellAt = Number.POSITIVE_INFINITY;
    this.reload.cockAt = Number.POSITIVE_INFINITY;
  }

  private emitCocked(): void {
    this.context.eventBus.emit("weapon.cocked", {
      weaponName: this.name,
    });
  }

  private firePelletVolley(
    origin: Vector3,
    direction: Vector3,
    damageMultiplier: number,
  ): void {
    const pellets = this.definition.pelletsPerShot ?? DEFAULT_PELLETS;
    const spread = this.definition.spread;
    const range = this.definition.range;
    const damagePerPellet = this.definition.damage * damageMultiplier;

    for (let i = 0; i < pellets; i += 1) {
      const dir = applySpread(direction, spread);
      const rayOrigin = origin.clone().addScaledVector(dir, 0.45);
      const hit = this.context.raycast.cast(rayOrigin, dir, range);
      if (!hit) {
        continue;
      }
      if (hit.metadata?.kind === "player") {
        continue;
      }

      const parent = hit.collider.parent();
      if (parent && parent.isDynamic()) {
        const impulseScale =
          hit.metadata?.kind === "ragdoll"
            ? Math.min(this.definition.impulse, 1.25)
            : this.definition.impulse;
        this.applyImpulse(parent, dir, impulseScale);
      }

      const bodyPartMul = hit.metadata?.bodyPart?.damageMultiplier ?? 1;
      const damage = damagePerPellet * bodyPartMul;
      hit.metadata?.damageable?.applyDamage(
        damage,
        dir.clone(),
        hit.metadata?.bodyPart?.name,
      );

      this.context.eventBus.emit("weapon.hit", {
        weaponName: this.name,
        targetId: hit.metadata?.id,
        surfaceKind: hit.metadata?.kind,
        point: hit.point,
        normal: hit.normal,
        damage,
      });
    }
  }

  private applyImpulse(
    rigidBody: RAPIER.RigidBody,
    direction: Vector3,
    impulseScale: number,
  ): void {
    rigidBody.applyImpulse(
      {
        x: direction.x * impulseScale,
        y: direction.y * impulseScale,
        z: direction.z * impulseScale,
      },
      true,
    );
  }

  private emitFired(origin: Vector3, direction: Vector3): void {
    this.context.eventBus.emit("weapon.fired", {
      weaponName: this.name,
      weaponType: this.definition.type,
      ammo: this.getAmmo(),
      origin,
      direction,
      range: this.definition.range,
    });
    this.context.eventBus.emit("world.noise", {
      kind: "gunshot",
      position: origin.clone(),
      radius: Math.max(24, Math.min(this.definition.range * 0.6, 55)),
      sourceId: "player",
      sourceFaction: "player",
    });
  }
}

function applySpread(direction: Vector3, spread: number): Vector3 {
  if (spread <= 0) {
    return direction.clone().normalize();
  }

  spreadRight.crossVectors(direction, new Vector3(0, 1, 0));
  if (spreadRight.lengthSq() < 0.001) {
    spreadRight.set(1, 0, 0);
  }
  spreadRight.normalize();
  spreadUp.crossVectors(spreadRight, direction).normalize();

  return direction
    .clone()
    .addScaledVector(spreadRight, (Math.random() - 0.5) * spread)
    .addScaledVector(spreadUp, (Math.random() - 0.5) * spread)
    .normalize();
}
