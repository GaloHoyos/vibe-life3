import type { SoundManager } from "./SoundManager";

/**
 * Reproduce un track musical en loop, con crossfade entre tracks.
 *
 * Es agnóstico al juego: recibe ids de clips registrados en el catálogo.
 * `Game` consulta `LevelDefinition.audio.music` y le pasa el id al cargar
 * un nivel (o llama `stopMusic()` si el nivel no define música).
 */
export class MusicManager {
  private currentId: string | null = null;

  constructor(private readonly sounds: SoundManager) {}

  playMusic(soundId: string): void {
    this.stopMusic();
    this.currentId = soundId;
    this.sounds.playLoop(soundId, { bus: "music" });
  }

  stopMusic(): void {
    if (!this.currentId) {
      return;
    }

    this.sounds.stop(this.currentId);
    this.currentId = null;
  }

  fadeToMusic(soundId: string): void {
    if (this.currentId) {
      this.sounds.fadeOut(this.currentId, 1.5);
    }
    this.currentId = soundId;
    this.sounds.playLoop(soundId, { bus: "music", fadeIn: 1.5 });
  }
}
