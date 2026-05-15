import type { GameEventBus } from "../GameEvents";
import type { SoundManager } from "./SoundManager";

export class EnemySoundSystem {
  constructor(
    eventBus: GameEventBus,
    private readonly sounds: SoundManager,
  ) {
    eventBus.on("npc.alert", (event) => {
      this.playZombieSound(event.id, "alert") ??
        this.playGeneric("enemies.alert");
    });

    eventBus.on("npc.attack", (event) => {
      this.playZombieSound(event.id, "attack") ??
        this.playGeneric("enemies.attack");
    });

    eventBus.on("npc.damaged", (event) => {
      this.playZombieSound(event.id, "damaged") ??
        this.playGeneric("enemies.hurt");
    });

    eventBus.on("npc.killed", () => {
      if (this.sounds.hasSound("enemies.killed")) {
        this.sounds.play("enemies.killed", { bus: "enemies" });
      }
    });
  }

  private playZombieSound(
    npcId: string,
    type: "alert" | "attack" | "damaged",
  ): boolean {
    if (!npcId.toLowerCase().includes("zombie")) {
      return false;
    }

    const soundId = `enemies.zombie.${type}`;
    if (this.sounds.hasSound(soundId)) {
      this.sounds.play(soundId, { bus: "enemies" });
      return true;
    }

    return false;
  }

  private playGeneric(soundId: string): void {
    if (this.sounds.hasSound(soundId)) {
      this.sounds.play(soundId, { bus: "enemies" });
    }
  }
}
