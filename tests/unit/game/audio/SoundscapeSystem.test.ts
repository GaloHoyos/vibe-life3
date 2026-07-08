import { describe, expect, it } from "vitest";
import type { AudioSystem, AudioEnvironmentPreset } from "@engine/audio/core/AudioSystem";
import type { BackgroundAmbienceSystem } from "@engine/audio/systems/BackgroundAmbienceSystem";
import { SoundscapeSystem } from "@game/audio/SoundscapeSystem";
import { AudioDspPresets, Soundscapes } from "@game/config/audio.config";

interface EnvironmentCall {
  preset: AudioEnvironmentPreset;
  fadeSeconds: number | undefined;
}

interface AmbienceCall {
  ids: readonly string[];
  fadeSeconds: number | undefined;
}

describe("SoundscapeSystem", () => {
  it("applies the configured DSP preset and ambience set", () => {
    const { audio, ambience, system } = createSystem();

    system.activate("metalTunnel", ["background.wind"]);

    expect(audio.environments).toEqual([
      {
        preset: AudioDspPresets.metalTunnel,
        fadeSeconds: Soundscapes.metalTunnel.fadeSeconds,
      },
    ]);
    expect(ambience.replacements).toEqual([
      {
        ids: Soundscapes.metalTunnel.ambiences,
        fadeSeconds: Soundscapes.metalTunnel.fadeSeconds,
      },
    ]);
  });

  it("does not reapply DSP when the active soundscape is unchanged", () => {
    const { audio, ambience, system } = createSystem();

    system.activate("outdoor", ["background.wind"]);
    system.activate("outdoor", ["background.hl2.wind.med1"]);

    expect(audio.environments).toHaveLength(1);
    expect(audio.environments[0]).toEqual({
      preset: AudioDspPresets.outdoor,
      fadeSeconds: Soundscapes.outdoor.fadeSeconds,
    });
    expect(ambience.replacements).toEqual([
      { ids: ["background.wind"], fadeSeconds: Soundscapes.outdoor.fadeSeconds },
      { ids: ["background.hl2.wind.med1"], fadeSeconds: Soundscapes.outdoor.fadeSeconds },
    ]);
  });

  it("clears ambience and returns to the dry preset", () => {
    const { audio, ambience, system } = createSystem();

    system.activate("lab");
    system.clear();

    expect(audio.environments.at(-1)).toEqual({
      preset: AudioDspPresets.none,
      fadeSeconds: 0.5,
    });
    expect(ambience.stops).toBe(1);
  });
});

function createSystem(): {
  audio: { environments: EnvironmentCall[] };
  ambience: { replacements: AmbienceCall[]; stops: number };
  system: SoundscapeSystem;
} {
  const audio = {
    environments: [] as EnvironmentCall[],
    setAudioEnvironment(preset: AudioEnvironmentPreset, fadeSeconds?: number): void {
      this.environments.push({ preset, fadeSeconds });
    },
  };
  const ambience = {
    replacements: [] as AmbienceCall[],
    stops: 0,
    replace(ids: readonly string[], fadeSeconds?: number): void {
      this.replacements.push({ ids, fadeSeconds });
    },
    stop(): void {
      this.stops += 1;
    },
  };

  return {
    audio,
    ambience,
    system: new SoundscapeSystem(
      audio as unknown as AudioSystem,
      ambience as unknown as BackgroundAmbienceSystem,
    ),
  };
}
