import type RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import { isHostileTo } from '@engine/ai/Faction';
import type { Faction } from '@engine/ai/Faction';
import type { CharacterRangedAttackConfig } from '@engine/characters/CharacterDefinition';
import type { Raycast } from '@engine/physics/Raycast';
import type { NpcCombatHandle, NpcCombatTickArgs } from '@game/npc/brain/NpcBrainContext';
import { NpcRangedCombat } from '@game/npc/combat/NpcRangedCombat';

export interface RealRangedCombatOptions {
  combat: NpcRangedCombat;
  ownerId: string;
  ownerBody: RAPIER.RigidBody;
  faction: Faction;
  eyeHeight: number;
  /** Distancia maxima a la que tiene sentido encarar combate. */
  effectiveRange: number;
  rangedConfig: CharacterRangedAttackConfig;
  raycast: Raycast;
  onReload?: (duration: number) => void;
}

const tmpOrigin = new Vector3();
const tmpFireDir = new Vector3();

/** Sin llamadas a `aim()` por mas de esto, la mira se "enfria" y el settle vuelve a 0. */
const AIM_HOLD_GRACE = 0.5;
/** Salto del aim target (m) que se interpreta como cambio de objetivo → resetea el settle. */
const AIM_TARGET_SWITCH_DISTANCE = 2.0;

/**
 * Adapter que envuelve `NpcRangedCombat` (el sistema de disparo real con
 * weapons, raycast, eventbus) y lo expone como `NpcCombatHandle` para que
 * el brain del Npc lo use.
 *
 * El Npc invoca `tick(...)` cada frame. Las llamadas del brain (`aim`,
 * `tryFire`, `reload`) trabajan sobre el `now` y target cacheados. El aim
 * settle se acumula mientras el brain apunte de forma continua: dispara
 * "frio" con `aimError` y converge a `aimErrorSettled` tras
 * `aimSettleDuration` segundos apuntando al mismo objetivo.
 */
export class RealRangedCombat implements NpcCombatHandle {
  private readonly aimTarget = new Vector3();
  private hasAim = false;
  private now = 0;
  private readonly origin = new Vector3();
  private aimedTime = 0;
  private lastAimAt = -Infinity;

  constructor(private readonly opts: RealRangedCombatOptions) {}

  tick(args: NpcCombatTickArgs): void {
    this.now = args.elapsed;
    this.origin.copy(args.position);
    this.origin.y += this.opts.eyeHeight;
    if (!this.hasAim) return;
    if (this.now - this.lastAimAt > AIM_HOLD_GRACE) {
      this.aimedTime = 0;
      this.hasAim = false;
      this.opts.combat.abortBurst();
      return;
    }
    this.aimedTime += args.delta;
    tmpOrigin.copy(this.origin);
    this.opts.combat.update({
      origin: tmpOrigin,
      targetPosition: this.aimTarget,
      ownerBody: this.opts.ownerBody,
      now: this.now,
      aimSettleProgress: this.settleProgress(),
    });
  }

  aim(target: Vector3): void {
    if (this.hasAim && target.distanceTo(this.aimTarget) > AIM_TARGET_SWITCH_DISTANCE) {
      this.aimedTime = 0;
    }
    this.aimTarget.copy(target);
    this.hasAim = true;
    this.lastAimAt = this.now;
  }

  tryFire(): boolean {
    if (!this.hasAim) return false;
    if (!this.opts.combat.canStartBurst(this.now)) return false;
    if (this.friendlyInLineOfFire()) return false;
    return this.opts.combat.startBurst(this.now);
  }

  reload(): void {
    if (!this.opts.combat.canReload()) return;
    const duration = this.opts.combat.startReload(this.now);
    if (duration > 0 && this.opts.onReload) this.opts.onReload(duration);
  }

  isReloading(): boolean {
    return this.opts.combat.isReloading(this.now);
  }

  magazineEmpty(): boolean {
    return this.opts.combat.needsReload();
  }

  effectiveRange(): number {
    return this.opts.effectiveRange;
  }

  private settleProgress(): number {
    const duration = this.opts.rangedConfig.aimSettleDuration;
    if (duration <= 0) return 1;
    return Math.max(0, Math.min(1, this.aimedTime / duration));
  }

  /**
   * True si el primer obstaculo hacia el aim target es un actor NO hostil
   * (squadmate, o el player para NPCs aliados). Aguantar el fuego en ese
   * caso evita friendly fire sin que las tasks tengan que razonarlo.
   */
  private friendlyInLineOfFire(): boolean {
    tmpFireDir.copy(this.aimTarget).sub(this.origin);
    const distance = tmpFireDir.length();
    if (distance < 0.01) return false;
    tmpFireDir.divideScalar(distance);
    const hit = this.opts.raycast.cast(
      this.origin,
      tmpFireDir,
      distance,
      this.opts.ownerBody,
      this.opts.ownerId,
    );
    const meta = hit?.metadata;
    if (!meta) return false;
    const hitFaction = meta.faction ?? (meta.kind === 'player' ? 'player' : null);
    if (!hitFaction) return false;
    return !isHostileTo(this.opts.faction, hitFaction);
  }
}
