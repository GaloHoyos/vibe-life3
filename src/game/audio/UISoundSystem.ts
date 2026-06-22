import type { GameEventBus } from "@game/GameEvents";
import type { SoundManager } from "@engine/audio/core/SoundManager";

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

    eventBus.on("player.pickup.weapon", () => {
      if (this.sounds.hasSound("weapons.pickup")) {
        this.sounds.play("weapons.pickup", { bus: "sfx" });
      }
    });

    eventBus.on("player.damaged", () => {
      if (this.sounds.hasSound("ui.damage")) {
        this.sounds.play("ui.damage", { bus: "ui" });
      }
    });
  }
}
