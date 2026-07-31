import type { GameEventBus } from "@game/GameEvents";
import { PlayerConfig } from "@game/config/gameplay.config";

const Config = PlayerConfig.stamina;

/**
 * Stamina HL2-style. Drena mientras el sprint estÃ¡ activo, regenera tras
 * `regenDelay` sin drenar. Si toca 0 queda `depleted` y bloquea sprint
 * hasta recargar por encima de `rechargeUnlockPercent`.
 *
 * El consumidor llama `tick(delta, draining)` cada frame con la condiciÃ³n
 * "estoy efectivamente sprintando" (tÃ­picamente
 * `CharacterController.isSprinting()`), y consulta `isDepleted()` para
 * gatear el sprint del prÃ³ximo frame.
 */
export class Stamina {
  private current: number = Config.max;
  private depleted = false;
  private timeSinceDrain = 0;
  private lastEmitted = -1;
  private lastEmittedDepleted = false;

  constructor(private readonly eventBus: GameEventBus) {
    this.emit();
  }

  tick(delta: number, draining: boolean): void {
    if (draining && !this.depleted) {
      this.current = Math.max(0, this.current - Config.drainPerSecond * delta);
      this.timeSinceDrain = 0;
      if (this.current <= 0) {
        this.depleted = true;
      }
    } else {
      this.timeSinceDrain += delta;
      if (this.timeSinceDrain >= Config.regenDelay) {
        this.current = Math.min(
          Config.max,
          this.current + Config.regenPerSecond * delta,
        );
        if (
          this.depleted &&
          this.current >= Config.rechargeUnlockPercent
        ) {
          this.depleted = false;
        }
      }
    }

    this.emitIfChanged();
  }

  isDepleted(): boolean {
    return this.depleted;
  }

  getCurrent(): number {
    return this.current;
  }

  getMax(): number {
    return Config.max;
  }

  capture(): {
    readonly current: number;
    readonly depleted: boolean;
    readonly timeSinceDrain: number;
  } {
    return {
      current: this.current,
      depleted: this.depleted,
      timeSinceDrain: this.timeSinceDrain,
    };
  }

  restore(snapshot: {
    readonly current: number;
    readonly depleted: boolean;
    readonly timeSinceDrain: number;
  }): void {
    this.current = Math.max(0, Math.min(Config.max, snapshot.current));
    this.depleted =
      snapshot.depleted && this.current < Config.rechargeUnlockPercent;
    this.timeSinceDrain = Math.max(0, snapshot.timeSinceDrain);
    this.emit();
  }

  private emit(): void {
    this.lastEmitted = this.current;
    this.lastEmittedDepleted = this.depleted;
    this.eventBus.emit("player.stamina.changed", {
      current: this.current,
      max: Config.max,
      depleted: this.depleted,
    });
  }

  private emitIfChanged(): void {
    if (
      Math.abs(this.current - this.lastEmitted) < 0.1 &&
      this.depleted === this.lastEmittedDepleted
    ) {
      return;
    }
    this.emit();
  }
}
