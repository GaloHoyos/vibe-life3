import type { BackgroundAmbienceSystem } from "@engine/audio/systems/BackgroundAmbienceSystem";
import type { AcousticSpaceSystem } from "@engine/audio/spatial/AcousticSpaceSystem";
import {
  DefaultSoundscapeId,
  Soundscapes,
  type SoundscapeId,
} from "@game/config/audio.config";

/**
 * Ata un soundscape del nivel a sus dos efectos: los lechos de ambiente y el
 * override de reverb.
 *
 * El override es opcional a propósito: la reverb la deriva la sonda acústica de
 * la geometría real, y el soundscape solo corrige donde la medición se queda
 * corta.
 */
export class SoundscapeSystem {
  private activeId: SoundscapeId | null = null;
  private fallbackAmbiences: readonly string[] = [];

  constructor(
    private readonly acoustics: AcousticSpaceSystem,
    private readonly ambience: BackgroundAmbienceSystem,
  ) {}

  setFallbackAmbiences(ids: readonly string[]): void {
    this.fallbackAmbiences = ids;
  }

  activate(id: SoundscapeId | undefined, fallbackAmbiences?: readonly string[]): void {
    if (fallbackAmbiences) {
      this.setFallbackAmbiences(fallbackAmbiences);
    }

    const soundscapeId = isSoundscapeId(id) ? id : DefaultSoundscapeId;
    const definition = Soundscapes[soundscapeId];
    const fadeSeconds = definition.fadeSeconds ?? 2;
    const ambiences =
      "ambiences" in definition ? definition.ambiences : this.fallbackAmbiences;

    if (this.activeId !== soundscapeId) {
      this.acoustics.setOverride(
        "reverb" in definition ? definition.reverb : null,
      );
      this.activeId = soundscapeId;
    }
    this.ambience.replace(ambiences, fadeSeconds);
  }

  clear(): void {
    this.activeId = null;
    this.fallbackAmbiences = [];
    this.acoustics.clear();
    this.ambience.stop();
  }
}

function isSoundscapeId(value: SoundscapeId | undefined): value is SoundscapeId {
  return value !== undefined && Object.prototype.hasOwnProperty.call(Soundscapes, value);
}
