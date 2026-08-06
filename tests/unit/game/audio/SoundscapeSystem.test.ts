import { describe, expect, it } from "vitest";
import type { ReverbSpace } from "@engine/audio/dsp/ReverbRack";
import type { AcousticSpaceSystem } from "@engine/audio/spatial/AcousticSpaceSystem";
import type { BackgroundAmbienceSystem } from "@engine/audio/systems/BackgroundAmbienceSystem";
import { SoundscapeSystem } from "@game/audio/SoundscapeSystem";
import { Soundscapes } from "@game/config/audio.config";

interface AmbienceCall {
  ids: readonly string[];
  fadeSeconds: number | undefined;
}

describe("SoundscapeSystem", () => {
  it("aplica el override de reverb y los ambientes del soundscape", () => {
    const { acoustics, ambience, system } = createSystem();

    system.activate("metalTunnel", ["background.wind"]);

    expect(acoustics.overrides).toEqual([Soundscapes.metalTunnel.reverb]);
    expect(ambience.replacements).toEqual([
      {
        ids: Soundscapes.metalTunnel.ambiences,
        fadeSeconds: Soundscapes.metalTunnel.fadeSeconds,
      },
    ]);
  });

  it("un soundscape sin override deja mandar a la sonda acustica", () => {
    const { acoustics, system } = createSystem();

    system.activate("outdoor", ["background.wind"]);

    expect(acoustics.overrides).toEqual([null]);
  });

  it("no reaplica el override si el soundscape no cambio", () => {
    const { acoustics, ambience, system } = createSystem();

    system.activate("outdoor", ["background.wind"]);
    system.activate("outdoor", ["background.hl2.wind.med1"]);

    expect(acoustics.overrides).toHaveLength(1);
    // Los ambientes si se reemplazan: cambio la lista del nivel.
    expect(ambience.replacements).toEqual([
      { ids: ["background.wind"], fadeSeconds: Soundscapes.outdoor.fadeSeconds },
      {
        ids: ["background.hl2.wind.med1"],
        fadeSeconds: Soundscapes.outdoor.fadeSeconds,
      },
    ]);
  });

  it("clear apaga ambientes y acustica", () => {
    const { acoustics, ambience, system } = createSystem();

    system.activate("lab");
    system.clear();

    expect(acoustics.clears).toBe(1);
    expect(ambience.stops).toBe(1);
  });
});

function createSystem(): {
  acoustics: { overrides: Array<Partial<ReverbSpace> | null>; clears: number };
  ambience: { replacements: AmbienceCall[]; stops: number };
  system: SoundscapeSystem;
} {
  const acoustics = {
    overrides: [] as Array<Partial<ReverbSpace> | null>,
    clears: 0,
    setOverride(override: Partial<ReverbSpace> | null): void {
      this.overrides.push(override);
    },
    clear(): void {
      this.clears += 1;
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
    acoustics,
    ambience,
    system: new SoundscapeSystem(
      acoustics as unknown as AcousticSpaceSystem,
      ambience as unknown as BackgroundAmbienceSystem,
    ),
  };
}
