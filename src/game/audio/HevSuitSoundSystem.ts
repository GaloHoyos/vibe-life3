import type { SoundManager } from "@engine/audio/core/SoundManager";
import type { GameEventBus } from "@game/GameEvents";
import { HevSuitAudio, type SoundRef } from "@game/config/audio.config";
import type { HazardKind } from "@game/levels/HazardVolumeSystem";

const DamageCooldownSeconds = 1.8;
const HazardCooldownSeconds = 4;

export class HevSuitSoundSystem {
  private healthCurrent: number | null = null;
  private armorCurrent: number | null = null;
  private staminaDepleted: boolean | null = null;
  private activeChargerLoop: string | null = null;
  private lastDamageAt = Number.NEGATIVE_INFINITY;
  private readonly lastHazardAt = new Map<HazardKind, number>();

  constructor(
    eventBus: GameEventBus,
    private readonly sounds: SoundManager,
  ) {
    eventBus.on("player.pickup.health", () => {
      this.play(HevSuitAudio.healthPickup);
    });
    eventBus.on("player.pickup.armor", () => {
      this.play(HevSuitAudio.armorPickup);
    });
    eventBus.on("charger.started", ({ kind }) => {
      this.startChargerLoop(
        kind === "armor" ? HevSuitAudio.armorChargerLoop : HevSuitAudio.healthChargerLoop,
      );
    });
    eventBus.on("charger.stopped", ({ depleted }) => {
      this.stopChargerLoop();
      if (depleted) {
        this.play(HevSuitAudio.chargerDone);
      }
    });
    eventBus.on("charger.denied", () => {
      this.play(HevSuitAudio.chargerDenied);
    });
    eventBus.on("player.health.changed", ({ current }) => {
      this.handleHealthChanged(current);
    });
    eventBus.on("player.armor.changed", ({ current }) => {
      this.handleArmorChanged(current);
    });
    eventBus.on("player.damaged", ({ amount }) => {
      this.handleDamage(amount);
    });
    eventBus.on("player.hazard", ({ kind }) => {
      this.handleHazard(kind);
    });
    eventBus.on("player.stamina.changed", ({ depleted }) => {
      this.handleStaminaChanged(depleted);
    });
    eventBus.on("player.dead", () => {
      this.stopChargerLoop();
      this.play(HevSuitAudio.flatline);
    });
  }

  private handleHealthChanged(current: number): void {
    const previous = this.healthCurrent;
    this.healthCurrent = current;
    if (previous === null || current >= previous) {
      return;
    }
    if (previous > 10 && current <= 10) {
      this.play(HevSuitAudio.nearDeath);
      return;
    }
    if (previous > 25 && current <= 25) {
      this.play(HevSuitAudio.healthCritical);
    }
  }

  private handleArmorChanged(current: number): void {
    const previous = this.armorCurrent;
    this.armorCurrent = current;
    if (previous === null) {
      return;
    }
    if (previous > 0 && current <= 0) {
      this.play(HevSuitAudio.armorGone);
    } else if (previous <= 0 && current > 0) {
      this.play(HevSuitAudio.powerRestored);
    }
  }

  private handleDamage(amount: number): void {
    if (amount <= 0) {
      return;
    }
    const now = nowSeconds();
    if (now - this.lastDamageAt < DamageCooldownSeconds) {
      return;
    }
    this.lastDamageAt = now;
    this.play(HevSuitAudio.damage);
  }

  private handleHazard(kind: HazardKind): void {
    const now = nowSeconds();
    const last = this.lastHazardAt.get(kind) ?? Number.NEGATIVE_INFINITY;
    if (now - last < HazardCooldownSeconds) {
      return;
    }
    this.lastHazardAt.set(kind, now);
    switch (kind) {
      case "fire":
        this.play(HevSuitAudio.hazardFire);
        break;
      case "toxic":
        this.play(HevSuitAudio.hazardToxic);
        break;
      case "electric":
        this.play(HevSuitAudio.hazardElectric);
        break;
      case "void":
        this.play(HevSuitAudio.hazardVoid);
        break;
    }
  }

  private handleStaminaChanged(depleted: boolean): void {
    const previous = this.staminaDepleted;
    this.staminaDepleted = depleted;
    if (previous === false && depleted) {
      this.play(HevSuitAudio.auxDepleted);
    }
  }

  private startChargerLoop(ref: SoundRef): void {
    const soundId = this.firstAvailable(ref);
    if (!soundId) {
      return;
    }
    if (this.activeChargerLoop === soundId) {
      return;
    }
    this.stopChargerLoop();
    this.activeChargerLoop = soundId;
    this.sounds.playLoop(soundId, { bus: "ui", fadeIn: 0.08 });
  }

  private stopChargerLoop(): void {
    if (!this.activeChargerLoop) {
      return;
    }
    this.sounds.fadeOut(this.activeChargerLoop, 0.12);
    this.activeChargerLoop = null;
  }

  private play(ref: SoundRef): void {
    const soundId = this.firstAvailable(ref);
    if (!soundId) {
      return;
    }
    this.sounds.play(soundId);
  }

  private firstAvailable(ref: SoundRef): string | null {
    const ids = typeof ref === "string" ? [ref] : ref;
    return ids.find((id) => this.sounds.hasSound(id)) ?? null;
  }
}

function nowSeconds(): number {
  return performance.now() / 1000;
}
