import type { GameEventBus } from "@game/GameEvents";
import type { AudioBusName } from "@engine/audio/core/AudioSystem";
import type { SoundManager } from "@engine/audio/core/SoundManager";
import type { Disposable } from "@shared/types/lifecycle";

/** Buses que bajan mientras habla un personaje, para que la voz respire. */
const DUCKED_BUSES: readonly AudioBusName[] = ["ambience", "music", "footsteps"];
const DUCK_FACTOR = 0.4;
/** Colchón tras la duración de la línea antes de restaurar los buses. */
const DUCK_TAIL_SECONDS = 0.4;

export class DialogueAudioSystem implements Disposable {
  private readonly disposeShow: () => void;
  private unduckTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    eventBus: GameEventBus,
    private readonly sounds: SoundManager,
  ) {
    this.disposeShow = eventBus.on("dialogue.show", ({ duration }) => {
      if (this.sounds.hasSound("dialogue.line")) {
        this.sounds.play("dialogue.line", { bus: "dialogue" });
      }
      this.duckFor(duration);
    });
  }

  private duckFor(durationSeconds: number): void {
    this.sounds.duck(DUCKED_BUSES, DUCK_FACTOR);
    if (this.unduckTimer !== null) {
      clearTimeout(this.unduckTimer);
    }
    this.unduckTimer = setTimeout(
      () => {
        this.sounds.unduck(DUCKED_BUSES);
        this.unduckTimer = null;
      },
      Math.max(0, durationSeconds + DUCK_TAIL_SECONDS) * 1000,
    );
  }

  dispose(): void {
    this.disposeShow();
    if (this.unduckTimer !== null) {
      clearTimeout(this.unduckTimer);
      this.unduckTimer = null;
    }
    this.sounds.unduck(DUCKED_BUSES, 0);
  }
}
