import type { SoundManager } from "@engine/audio/core/SoundManager";

export interface FootstepSoundConfig {
  /** Tiempo (s) entre pasos cuando el caminante estÃ¡ a velocidad plena. */
  stepCooldown: number;
}

const DefaultFootstepConfig: FootstepSoundConfig = {
  stepCooldown: 0.45,
};

/**
 * Reproduce pasos a partir de un pool configurable. La capa de juego
 * pasa el pool con `setSounds(...)` despuÃ©s de cargar el nivel; el
 * sistema randomiza dentro de ese pool en cada paso. La cadencia se
 * configura inyectando un `FootstepSoundConfig`.
 */
export class FootstepSoundSystem {
  private cooldown = 0;
  private soundIds: readonly string[] = [];
  private config: FootstepSoundConfig = DefaultFootstepConfig;

  constructor(private readonly sounds: SoundManager) {}

  /** Configura el pool de pasos del nivel actual. */
  setSounds(soundIds: readonly string[]): void {
    this.soundIds = soundIds;
  }

  /** Ajusta cadencia y otros parÃ¡metros (tÃ­picamente desde game/config). */
  configure(config: FootstepSoundConfig): void {
    this.config = config;
  }

  update(delta: number, speed: number): void {
    if (speed <= 0 || this.soundIds.length === 0) {
      return;
    }

    this.cooldown -= delta;
    if (this.cooldown > 0) {
      return;
    }

    this.cooldown = this.config.stepCooldown;
    const soundId = this.pickRandom(this.soundIds);
    if (soundId && this.sounds.hasSound(soundId)) {
      this.sounds.play(soundId, { bus: "footsteps" });
    }
  }

  private pickRandom(items: readonly string[]): string | null {
    if (items.length === 0) {
      return null;
    }
    const index = Math.floor(Math.random() * items.length);
    return items[index] ?? null;
  }
}
