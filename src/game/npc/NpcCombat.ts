import { Vector3 } from "three";
import type { CharacterDefinition } from "../../engine/characters/CharacterDefinition";
import type { Raycast } from "../../engine/physics/Raycast";
import type { Damageable } from "../../shared/types/lifecycle";
import type { GameEventBus } from "../GameEvents";

export interface CombatTickContext {
  npcPosition: Vector3;
  npcForward: Vector3;
  targetPosition: Vector3;
  player: Damageable;
  balanceLocked: boolean;
}

/**
 * Componente de combate del NPC.
 *
 * Encapsula cooldown, windup, hit-window, line-of-sight y aplicación
 * de daño al jugador. El NPC lo posee por composición y decide cuándo
 * iniciarlo; el combat se encarga del resto.
 */
export class NpcCombat {
  private cooldown = 0;
  private elapsedInAttack = 0;
  private damageApplied = false;
  private inAttack = false;

  constructor(
    private readonly id: string,
    private readonly definition: CharacterDefinition,
    private readonly eventBus: GameEventBus,
    private readonly raycast: Raycast,
  ) {}

  /** Decrementa el cooldown global de ataque. Llamar cada frame. */
  tickCooldown(delta: number): void {
    this.cooldown = Math.max(0, this.cooldown - delta);
  }

  /** Está disponible para iniciar un ataque (cooldown listo + arma habilitada). */
  isReady(): boolean {
    return this.definition.attack.enabled && this.cooldown <= 0;
  }

  /** Inicia la animación de ataque. Devuelve `false` si no se pudo (deshabilitado). */
  start(): boolean {
    if (!this.definition.attack.enabled) {
      return false;
    }
    this.inAttack = true;
    this.elapsedInAttack = 0;
    this.damageApplied = false;
    this.cooldown = this.definition.attack.cooldown;
    this.eventBus.emit("npc.attack", {
      id: this.id,
      characterId: this.definition.id,
    });
    this.logDebug("attack start");
    return true;
  }

  /** True mientras la animación de ataque (windup+hitWindow) siga activa. */
  isAttacking(): boolean {
    return this.inAttack;
  }

  /** Cancela el ataque en curso (e.g. por stumble/fallen). El cooldown se mantiene. */
  cancel(): void {
    this.inAttack = false;
    this.elapsedInAttack = 0;
    this.damageApplied = false;
  }

  /**
   * Progresa la animación de ataque. Aplica daño cuando entra la
   * hit-window. Devuelve `true` mientras el ataque siga; `false` cuando
   * termina (el NPC debe volver a chase).
   */
  tickAttack(delta: number, ctx: CombatTickContext): boolean {
    if (!this.inAttack) {
      return false;
    }

    const attack = this.definition.attack;
    if (!attack.enabled) {
      this.inAttack = false;
      return false;
    }

    this.elapsedInAttack += delta;

    if (!this.damageApplied && this.elapsedInAttack >= attack.windup) {
      const windowEnd = attack.windup + attack.hitWindow;
      if (this.elapsedInAttack <= windowEnd) {
        const landed = this.tryLandHit(ctx);
        if (!landed && this.definition.debug) {
          this.logDebug("attack missed");
        }
      }
    }

    if (this.elapsedInAttack >= attack.windup + attack.hitWindow) {
      this.inAttack = false;
      return false;
    }

    return true;
  }

  private tryLandHit(ctx: CombatTickContext): boolean {
    if (!this.canHit(ctx)) {
      return false;
    }

    const directionToTarget = directionTo(ctx.npcPosition, ctx.targetPosition);
    const attack = this.definition.attack;
    ctx.player.applyDamage(attack.damage, directionToTarget);

    const knockbackReceiver = ctx.player as {
      applyKnockback?: (direction: Vector3, strength: number) => void;
    };
    if (attack.knockback > 0 && knockbackReceiver.applyKnockback) {
      knockbackReceiver.applyKnockback(directionToTarget, attack.knockback);
    }

    this.damageApplied = true;
    this.logDebug(`damage applied (${attack.damage})`);
    return true;
  }

  private canHit(ctx: CombatTickContext): boolean {
    if (!ctx.player.isAlive() || ctx.balanceLocked) {
      return false;
    }

    const attack = this.definition.attack;
    const distanceSq = ctx.npcPosition.distanceToSquared(ctx.targetPosition);
    if (distanceSq > attack.range * attack.range) {
      this.logDebug("attack failed: out of range");
      return false;
    }

    const directionToTarget = directionTo(ctx.npcPosition, ctx.targetPosition);
    const facingDot = ctx.npcForward.dot(directionToTarget);
    if (facingDot < attack.facingDotThreshold) {
      this.logDebug("attack failed: facing");
      return false;
    }

    if (
      attack.requireLineOfSight &&
      !this.hasLineOfSight(ctx.npcPosition, directionToTarget, Math.sqrt(distanceSq))
    ) {
      this.logDebug("attack failed: line of sight");
      return false;
    }

    return true;
  }

  private hasLineOfSight(
    npcPosition: Vector3,
    direction: Vector3,
    distance: number,
  ): boolean {
    const origin = npcPosition.clone().add(new Vector3(0, 0.9, 0));
    const hit = this.raycast.cast(origin, direction, distance + 0.2);
    return hit?.metadata?.id === "player";
  }

  private logDebug(message: string): void {
    if (!this.definition.debug) {
      return;
    }
    console.info(`[NPC:${this.id}] ${message}`);
  }
}

function directionTo(from: Vector3, to: Vector3): Vector3 {
  const direction = to.clone().sub(from);
  direction.y = 0;
  if (direction.lengthSq() < 0.0001) {
    return new Vector3(0, 0, 1);
  }
  return direction.normalize();
}
