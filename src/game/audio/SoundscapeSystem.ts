import type { AudioSystem } from "@engine/audio/core/AudioSystem";
import type { BackgroundAmbienceSystem } from "@engine/audio/systems/BackgroundAmbienceSystem";
import {
  AudioDspPresets,
  DefaultSoundscapeId,
  Soundscapes,
  type SoundscapeId,
} from "@game/config/audio.config";

export class SoundscapeSystem {
  private activeId: SoundscapeId | null = null;
  private fallbackAmbiences: readonly string[] = [];

  constructor(
    private readonly audio: AudioSystem,
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
      this.audio.setAudioEnvironment(AudioDspPresets[definition.dsp], fadeSeconds);
      this.activeId = soundscapeId;
    }
    this.ambience.replace(ambiences, fadeSeconds);
  }

  clear(): void {
    this.activeId = null;
    this.fallbackAmbiences = [];
    this.audio.setAudioEnvironment(AudioDspPresets.none, 0.5);
    this.ambience.stop();
  }
}

function isSoundscapeId(value: SoundscapeId | undefined): value is SoundscapeId {
  return value !== undefined && Object.prototype.hasOwnProperty.call(Soundscapes, value);
}
