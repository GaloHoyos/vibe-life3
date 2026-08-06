import { ClipLoudnessTable } from "@engine/audio/generated/loudness.generated";
import {
  MixTuning,
  RoleLoudnessTargets,
  type AudioRole,
  type ClipLoudness,
} from "./MixProfile";

/**
 * Único lugar donde se decide cuánta ganancia lleva un sonido. Todo el audio
 * —2D y espacial— pasa por acá, así que un clip suena igual sin importar por
 * qué camino se reproduzca.
 *
 * Funciones puras a propósito: el math se testea sin Web Audio.
 */

/** Lo mínimo que hace falta de un clip para calcular su ganancia. */
export interface ClipGainInput {
  readonly role: AudioRole;
  /** Path relativo a `engine/assets/sounds`; llave de la tabla de sonoridad. */
  readonly source: string;
  /** Ajuste artístico sobre el objetivo del rol, en dB. */
  readonly trimDb?: number;
}

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

export function gainToDb(gain: number): number {
  return gain <= 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(gain);
}

/**
 * Curva del slider. Un fader lineal se siente mal: a la mitad del recorrido el
 * volumen apenas baja. Elevar al cuadrado aproxima la sonoridad percibida
 * (medio recorrido ≈ -6 dB) sin irse al extremo de una curva en dB pura, que
 * deja el tramo bajo del slider inutilizable.
 */
export function sliderToGain(value: number): number {
  const clamped = clamp01(value);
  return clamped * clamped;
}

export function gainToSlider(gain: number): number {
  return Math.sqrt(Math.max(0, gain));
}

/**
 * Ganancia que lleva un clip desde su sonoridad medida hasta el objetivo de su
 * rol, acotada por el techo de amplificación y por el pico para no clipear.
 */
export function normalizationGain(
  loudness: ClipLoudness | undefined,
  targetLufs: number,
): number {
  if (!loudness || loudness.lufs <= MixTuning.silenceFloorLufs) {
    return 1;
  }

  const gain = dbToGain(
    Math.min(targetLufs - loudness.lufs, MixTuning.maxBoostDb),
  );
  if (loudness.peak <= 0) {
    return gain;
  }

  const peakLimit = dbToGain(MixTuning.peakCeilingDb) / loudness.peak;
  return Math.min(gain, peakLimit);
}

export function resolveClipGain(
  clip: ClipGainInput,
  volume = 1,
  table: Readonly<Record<string, ClipLoudness>> = ClipLoudnessTable,
): number {
  const normalized = normalizationGain(
    table[clip.source],
    RoleLoudnessTargets[clip.role],
  );
  return normalized * dbToGain(clip.trimDb ?? 0) * Math.max(0, volume);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
