import type { GameEventBus } from "@game/GameEvents";
import type { SoundManager } from "@engine/audio/core/SoundManager";
import { UiAudio, type SoundRef } from "@game/config/audio.config";

export class UISoundSystem {
  constructor(
    eventBus: GameEventBus,
    private readonly sounds: SoundManager,
  ) {
    eventBus.on("player.pickup.health", () => {
      if (this.sounds.hasSound("ui.pickup")) {
        this.sounds.play("ui.pickup", { bus: "ui" });
      }
    });

    eventBus.on("player.pickup.ammo", () => {
      if (this.sounds.hasSound("ui.pickup")) {
        this.sounds.play("ui.pickup", { bus: "ui" });
      }
    });

    eventBus.on("player.pickup.armor", () => {
      if (this.sounds.hasSound("ui.pickup")) {
        this.sounds.play("ui.pickup", { bus: "ui" });
      }
    });

    eventBus.on("player.pickup.weapon", () => {
      if (this.sounds.hasSound("weapons.pickup")) {
        this.sounds.play("weapons.pickup", { bus: "world" });
      }
    });

    eventBus.on("player.damaged", () => {
      if (this.sounds.hasSound("ui.damage")) {
        this.sounds.play("ui.damage", { bus: "ui" });
      }
    });

    eventBus.on("ui.sound", ({ cue }) => {
      this.playUiSound(UiAudio[cue]);
    });
  }

  private playUiSound(ref: SoundRef): void {
    const ids = typeof ref === "string" ? [ref] : ref;
    const soundId = ids.find((id) => this.sounds.hasSound(id));
    if (!soundId) {
      return;
    }
    this.sounds.play(soundId, { bus: "ui" });
  }
}
