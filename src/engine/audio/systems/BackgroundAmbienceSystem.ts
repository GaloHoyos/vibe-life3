import { AudioClipCatalog } from "@engine/audio/AudioManifest";
import type { SoundManager } from "@engine/audio/core/SoundManager";

/**
 * Reproduce ambientes en loop a partir de una lista de ids de clips.
 *
 * Es agnÃ³stico al juego: no conoce niveles ni eventos. La capa de juego
 * le pasa los ids al cargar un nivel y los detiene al salir.
 */
export class BackgroundAmbienceSystem {
  private readonly activeIds = new Set<string>();

  constructor(private readonly sounds: SoundManager) {}

  /** Inicia los ambientes indicados. Ignora ids no presentes en el catÃ¡logo. */
  start(ambienceIds: readonly string[], fadeIn = 2): void {
    ambienceIds.forEach((id) => {
      if (this.activeIds.has(id)) {
        return;
      }
      const clip = AudioClipCatalog[id];
      if (!clip) {
        return;
      }
      this.activeIds.add(id);
      this.sounds.playLoop(id, { volume: clip.volume, fadeIn });
    });
  }

  replace(ambienceIds: readonly string[], fadeSeconds = 2): void {
    const nextIds = new Set(ambienceIds);
    this.activeIds.forEach((id) => {
      if (!nextIds.has(id)) {
        this.sounds.fadeOut(id, fadeSeconds);
        this.activeIds.delete(id);
      }
    });
    this.start(ambienceIds, fadeSeconds);
  }

  /** Detiene todos los ambientes activos con fade-out. */
  stop(fadeOut = 1.4): void {
    this.activeIds.forEach((id) => {
      this.sounds.fadeOut(id, fadeOut);
    });
    this.activeIds.clear();
  }
}
