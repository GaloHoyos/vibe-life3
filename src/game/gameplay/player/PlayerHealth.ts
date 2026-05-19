import type { Vector3 } from "three";
import { PlayerHealthConfig } from "@game/config/gameplay.config";
import { Dialogue } from "@game/config/strings";
import type { GameEventBus } from "@game/GameEvents";
import { Health } from "@game/gameplay/Health";

export class PlayerHealth {
  private readonly health: Health;
  private armorCurrent: number;
  private armorMax: number;
  private dead = false;
  private godMode = false;

  constructor(
    private readonly eventBus: GameEventBus,
    maxHealth = 100,
    armorMax = 0,
    armorCurrent = armorMax,
  ) {
    this.health = new Health(maxHealth);
    this.armorMax = Math.max(0, armorMax);
    this.armorCurrent = Math.max(0, Math.min(armorCurrent, this.armorMax));
    this.emitHealthChanged();
    this.emitArmorChanged();
  }

  get current(): number {
    return this.health.current;
  }

  get max(): number {
    return this.health.max;
  }

  get armor(): number {
    return this.armorCurrent;
  }

  get armorMaximum(): number {
    return this.armorMax;
  }

  get isDead(): boolean {
    return this.dead;
  }

  isAlive(): boolean {
    return !this.dead && this.health.isAlive();
  }

  toggleGodMode(): boolean {
    this.godMode = !this.godMode;
    if (this.godMode) {
      this.health.reset();
      this.dead = false;
      this.armorCurrent = this.armorMax;
      this.emitHealthChanged();
      this.emitArmorChanged();
    }
    return this.godMode;
  }

  isGodMode(): boolean {
    return this.godMode;
  }

  takeDamage(amount: number, _source?: string, hitDirection?: Vector3): number {
    if (this.dead || amount <= 0) {
      return this.health.current;
    }
    if (this.godMode) {
      this.eventBus.emit("player.damaged", { amount: 0, direction: hitDirection });
      return this.health.current;
    }

    const absorbed = this.absorbWithArmor(amount);
    const remaining = Math.max(0, amount - absorbed);
    const currentHealth = this.health.applyDamage(remaining);

    this.eventBus.emit("player.damaged", {
      amount: remaining,
      direction: hitDirection,
    });
    this.emitHealthChanged();

    if (currentHealth <= 0 && !this.dead) {
      this.dead = true;
      this.eventBus.emit("player.dead", { reason: "damage" });
      this.eventBus.emit("subtitle.show", Dialogue.playerDead);
    }

    return currentHealth;
  }

  heal(amount: number): number {
    if (this.dead || amount <= 0) {
      return this.health.current;
    }

    const currentHealth = this.health.heal(amount);
    this.emitHealthChanged();
    return currentHealth;
  }

  reset(): void {
    this.health.reset();
    this.dead = false;
    this.armorCurrent = this.armorMax;
    this.emitHealthChanged();
    this.emitArmorChanged();
  }

  setArmor(current: number, max = current): void {
    this.armorMax = Math.max(0, max);
    this.armorCurrent = Math.max(0, Math.min(current, this.armorMax));
    this.emitArmorChanged();
  }

  private absorbWithArmor(amount: number): number {
    if (this.armorCurrent <= 0 || amount <= 0) {
      return 0;
    }

    const absorption = Math.min(
      this.armorCurrent,
      amount * PlayerHealthConfig.armorAbsorptionRatio,
    );
    this.armorCurrent = Math.max(0, this.armorCurrent - absorption);
    this.emitArmorChanged();
    return absorption;
  }

  private emitHealthChanged(): void {
    this.eventBus.emit("player.health.changed", {
      current: this.health.current,
      max: this.health.max,
    });
  }

  private emitArmorChanged(): void {
    this.eventBus.emit("player.armor.changed", {
      current: this.armorCurrent,
      max: this.armorMax,
    });
  }
}
