import type { ReverbSpace } from "@engine/audio/dsp/ReverbRack";
import type { AcousticEstimate } from "./AcousticProbe";

/**
 * Traduce lo que midió la sonda a los parámetros del retorno de efectos.
 *
 * Función pura y separada del sistema que la usa: acá está toda la decisión de
 * "qué tan reverberante suena un espacio de tal tamaño y tal material", y se
 * puede testear sin Web Audio.
 */

export interface AcousticResponseTuning {
  /** Volumen (m³) del recinto más chico que todavía cuenta como sala. */
  readonly minVolume: number;
  /** Volumen (m³) a partir del cual la cola ya no crece. */
  readonly maxVolume: number;
  readonly minDuration: number;
  readonly maxDuration: number;
  readonly minWet: number;
  readonly maxWet: number;
  /** Corte del retorno con materiales absorbentes (tierra, pasto). */
  readonly absorbentToneHz: number;
  /** Corte con materiales reflectantes (hormigón, metal). */
  readonly reflectiveToneHz: number;
  readonly maxEchoFeedback: number;
  readonly maxEchoWet: number;
}

/** Velocidad del sonido, para el pre-delay de la primera reflexión. */
const SpeedOfSound = 343;
const MaxPreDelay = 0.06;

export function reverbSpaceFor(
  estimate: AcousticEstimate,
  tuning: AcousticResponseTuning,
): ReverbSpace {
  // El tamaño se percibe en octavas, no en metros cúbicos: un pasillo de 60 m³
  // y un hangar de 60 000 m³ están a la misma "distancia" perceptual que 60 y
  // 60 000 sugieren en logaritmo, no en lineal.
  const size = clamp01(
    Math.log(Math.max(estimate.volume, tuning.minVolume) / tuning.minVolume) /
      Math.log(tuning.maxVolume / tuning.minVolume),
  );
  const reflectivity = clamp01(1 - estimate.absorption);
  // A cielo abierto no hay superficies que devuelvan: la reverb se apaga sola.
  const enclosure = clamp01(1 - estimate.openness);
  /**
   * Los rayos que se van reportan su alcance máximo, así que a la intemperie el
   * estimador "ve" un recinto enorme que no existe. La energía que escapa por
   * una abertura se comporta como absorción total (Sabine), o sea que acorta la
   * cola igual que un material absorbente: por eso la extensión que alimenta la
   * duración escala con el encierro y no con el volumen crudo.
   */
  const tailSize = size * enclosure;

  const duration = lerp(tuning.minDuration, tuning.maxDuration, tailSize);
  const wet =
    lerp(tuning.minWet, tuning.maxWet, size) *
    enclosure *
    (0.35 + 0.65 * reflectivity);
  const echoStrength = tailSize * reflectivity;

  return {
    duration,
    // Salas chicas: cola corta y seca (exponente alto). Grandes: cola larga.
    decay: lerp(4.5, 1.8, tailSize),
    diffusion: enclosure,
    toneHz: lerp(
      tuning.absorbentToneHz,
      tuning.reflectiveToneHz,
      reflectivity,
    ),
    preDelay: Math.min(
      MaxPreDelay,
      (estimate.meanDistance * 2) / SpeedOfSound,
    ),
    // Período del golpeteo: el viaje hasta la superficie más lejana.
    echoDelay: Math.min(
      0.3,
      Math.max(0.02, estimate.longestExtent / SpeedOfSound),
    ),
    echoFeedback: tuning.maxEchoFeedback * echoStrength,
    echoWet: tuning.maxEchoWet * echoStrength,
    wet,
  };
}

/** Mezcla la respuesta medida con un override autorado del nivel. */
export function blendReverbSpace(
  measured: ReverbSpace,
  override: Partial<ReverbSpace> | null,
): ReverbSpace {
  if (!override) {
    return measured;
  }
  return { ...measured, ...override };
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
