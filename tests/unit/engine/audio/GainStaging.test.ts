import { describe, expect, it } from "vitest";
import {
  dbToGain,
  gainToDb,
  gainToSlider,
  normalizationGain,
  resolveClipGain,
  sliderToGain,
} from "@engine/audio/mix/GainStaging";
import { MixTuning } from "@engine/audio/mix/MixProfile";
import type { ClipLoudness } from "@engine/audio/mix/MixProfile";

const table: Record<string, ClipLoudness> = {
  // Los dos extremos reales del pool de pasos: 21 dB de diferencia entre dos
  // clips que se reproducen indistintamente.
  "hl2/footsteps/duct1.wav": { lufs: -15.8, peak: 0.9 },
  "hl2/footsteps/tile3.wav": { lufs: -37.06, peak: 0.376 },
  "silencio.wav": { lufs: -70, peak: 0 },
};

describe("dbToGain / gainToDb", () => {
  it("son inversas y anclan 0 dB en ganancia unitaria", () => {
    expect(dbToGain(0)).toBeCloseTo(1);
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3);
    expect(gainToDb(dbToGain(-13.5))).toBeCloseTo(-13.5, 6);
    expect(gainToDb(0)).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe("sliderToGain", () => {
  it("es monotona y ancla los extremos", () => {
    expect(sliderToGain(0)).toBe(0);
    expect(sliderToGain(1)).toBe(1);
    expect(sliderToGain(0.5)).toBeGreaterThan(sliderToGain(0.4));
    expect(sliderToGain(0.9)).toBeLessThan(sliderToGain(1));
  });

  it("a medio recorrido atenua ~12 dB, no la mitad del gain", () => {
    // Referencia perceptual: la sonoridad se percibe a la mitad ~10 dB abajo.
    // Un fader lineal daria -6 dB acá y se sentiria "casi igual de fuerte".
    expect(gainToDb(sliderToGain(0.5))).toBeCloseTo(-12.04, 1);
    expect(gainToDb(0.5)).toBeCloseTo(-6.02, 1);
  });

  it("clampea fuera de rango y sobrevive a valores no finitos", () => {
    expect(sliderToGain(-1)).toBe(0);
    expect(sliderToGain(2)).toBe(1);
    expect(sliderToGain(Number.NaN)).toBe(0);
  });

  it("gainToSlider revierte la curva", () => {
    expect(gainToSlider(sliderToGain(0.65))).toBeCloseTo(0.65);
  });
});

describe("normalizationGain", () => {
  it("lleva el clip a su objetivo", () => {
    const gain = normalizationGain({ lufs: -20, peak: 0.1 }, -14);
    expect(gainToDb(gain)).toBeCloseTo(6, 5);
  });

  it("no amplifica mas alla del techo de boost", () => {
    const gain = normalizationGain({ lufs: -60, peak: 0.001 }, -14);
    expect(gainToDb(gain)).toBeCloseTo(MixTuning.maxBoostDb, 5);
  });

  it("el pico acota la amplificacion antes que el objetivo", () => {
    // Pico alto: llegar al objetivo pediria +12 dB pero clipearia.
    const gain = normalizationGain({ lufs: -30, peak: 0.9 }, -14);
    expect(gain * 0.9).toBeCloseTo(dbToGain(MixTuning.peakCeilingDb), 5);
  });

  it("atenua sin mirar el pico", () => {
    const gain = normalizationGain({ lufs: -6, peak: 1.2 }, -18);
    expect(gainToDb(gain)).toBeCloseTo(-12, 5);
  });

  it("deja intacto el silencio digital y los clips sin medicion", () => {
    expect(normalizationGain({ lufs: -70, peak: 0 }, -14)).toBe(1);
    expect(normalizationGain(undefined, -14)).toBe(1);
  });
});

describe("resolveClipGain", () => {
  const duct = { role: "footstep", source: "hl2/footsteps/duct1.wav" } as const;
  const tile = { role: "footstep", source: "hl2/footsteps/tile3.wav" } as const;

  it("acerca dos clips del mismo pool que difieren 21 dB en origen", () => {
    const before = Math.abs(-15.8 - -37.06);
    const after = Math.abs(
      -15.8 +
        gainToDb(resolveClipGain(duct, 1, table)) -
        (-37.06 + gainToDb(resolveClipGain(tile, 1, table))),
    );

    expect(before).toBeGreaterThan(20);
    expect(after).toBeLessThan(6);
  });

  it("aplica el trim artistico sobre el objetivo del rol", () => {
    const plain = resolveClipGain(duct, 1, table);
    const trimmed = resolveClipGain({ ...duct, trimDb: -6 }, 1, table);

    expect(gainToDb(trimmed) - gainToDb(plain)).toBeCloseTo(-6, 5);
  });

  it("el volumen del call site multiplica, no reemplaza", () => {
    expect(resolveClipGain(duct, 0.5, table)).toBeCloseTo(
      resolveClipGain(duct, 1, table) * 0.5,
    );
    expect(resolveClipGain(duct, -3, table)).toBe(0);
  });

  it("un clip sin medicion queda en ganancia unitaria", () => {
    expect(
      resolveClipGain({ role: "impact", source: "no-existe.wav" }, 1, table),
    ).toBe(1);
  });
});
