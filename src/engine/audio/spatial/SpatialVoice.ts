import { MathUtils, type Vector3 } from "three";
import type { AudioBus } from "@engine/audio/core/AudioBus";
import {
  OcclusionTuning,
  occlusionFilterHz,
  occlusionGain,
  type OcclusionSample,
} from "./Occlusion";

/**
 * Una voz espacial y su cadena de nodos:
 *
 * ```
 * source → voiceGain → occlusionLP ─┬→ obstructionLP → panner → dryGain → bus.gain
 *                                   └→ wetGain → bus.auxGain
 * ```
 *
 * El envío húmedo sale **antes** del panner y con su propia curva: el campo
 * reverberante de una sala es casi constante dentro de ella, mientras el
 * directo cae con 1/r. Por eso la proporción wet/dry crece con la distancia,
 * que es lo que hace que algo lejano en una nave suene lavado y algo cercano
 * suene seco.
 *
 * El filtro de oclusión va antes de la bifurcación (apaga directo y reverb) y
 * el de obstrucción solo en el directo.
 */

export interface SpatialVoiceOptions {
  readonly refDistance?: number;
  readonly maxDistance?: number;
  readonly rolloffFactor?: number;
  readonly gain?: number;
  readonly loop?: boolean;
  readonly playbackRate?: number;
  readonly lowpassFrequency?: number;
  readonly panningModel?: PanningModelType;
  /** Acoplamiento con el espacio del oyente, 0..1. Lo fija el sistema. */
  readonly wet?: number;
}

const SmoothingSeconds = 0.05;
/** Suavizado de la posición: corta el zipper sin arrastrar la fuente. */
const PositionSmoothing = 0.012;

export class SpatialVoice {
  private readonly source: AudioBufferSourceNode;
  private readonly voiceGain: GainNode;
  private readonly occlusionFilter: BiquadFilterNode;
  private readonly obstructionFilter: BiquadFilterNode;
  private readonly panner: PannerNode;
  private readonly dryGain: GainNode;
  private readonly wetGain: GainNode;

  private gain: number;
  private wet: number;
  /** Atenuación del envío por oclusión; se combina con `gain` y `wet`. */
  private wetOcclusion = 1;
  private baseLowpassHz: number;
  private stopped = false;

  constructor(
    private readonly context: AudioContext,
    buffer: AudioBuffer,
    bus: AudioBus,
    options: SpatialVoiceOptions,
  ) {
    this.gain = Math.max(0, options.gain ?? 1);
    this.wet = clamp01(options.wet ?? 0);
    this.baseLowpassHz = MathUtils.clamp(
      options.lowpassFrequency ?? OcclusionTuning.clearHz,
      120,
      OcclusionTuning.clearHz,
    );

    this.source = context.createBufferSource();
    this.source.buffer = buffer;
    this.source.loop = options.loop ?? false;
    this.source.playbackRate.value = MathUtils.clamp(
      options.playbackRate ?? 1,
      0.25,
      4,
    );

    this.voiceGain = context.createGain();
    this.voiceGain.gain.value = this.gain;

    this.occlusionFilter = context.createBiquadFilter();
    this.occlusionFilter.type = "lowpass";
    this.occlusionFilter.frequency.value = this.baseLowpassHz;

    this.obstructionFilter = context.createBiquadFilter();
    this.obstructionFilter.type = "lowpass";
    this.obstructionFilter.frequency.value = OcclusionTuning.clearHz;

    this.panner = context.createPanner();
    // `equalpower` por defecto: el HRTF de Three es un convolver por voz, y con
    // decenas de one-shots por segundo es el costo dominante del audio 3D.
    this.panner.panningModel = options.panningModel ?? "equalpower";
    this.panner.distanceModel = "inverse";
    this.panner.refDistance = options.refDistance ?? 1.2;
    this.panner.maxDistance = options.maxDistance ?? 12;
    this.panner.rolloffFactor = options.rolloffFactor ?? 1.2;

    this.dryGain = context.createGain();
    this.dryGain.gain.value = 1;
    this.wetGain = context.createGain();
    this.wetGain.gain.value = this.wet;

    this.source.connect(this.voiceGain);
    this.voiceGain.connect(this.occlusionFilter);
    this.occlusionFilter.connect(this.obstructionFilter);
    this.obstructionFilter.connect(this.panner);
    this.panner.connect(this.dryGain);
    this.dryGain.connect(bus.gain);
    this.occlusionFilter.connect(this.wetGain);
    this.wetGain.connect(bus.auxGain);
  }

  start(): void {
    this.source.start();
  }

  onEnded(handler: () => void): void {
    this.source.addEventListener("ended", handler, { once: true });
  }

  setPosition(position: Vector3): void {
    const now = this.context.currentTime;
    setSmoothed(this.panner.positionX, position.x, now, PositionSmoothing);
    setSmoothed(this.panner.positionY, position.y, now, PositionSmoothing);
    setSmoothed(this.panner.positionZ, position.z, now, PositionSmoothing);
  }

  setGain(value: number): void {
    this.gain = Math.max(0, value);
    setSmoothed(
      this.voiceGain.gain,
      this.gain,
      this.context.currentTime,
      SmoothingSeconds,
    );
    this.applyWetGain();
  }

  setPlaybackRate(value: number): void {
    this.source.playbackRate.value = MathUtils.clamp(value, 0.25, 4);
  }

  /** Corte "artístico" del clip; la oclusión lo baja pero nunca lo sube. */
  setLowpassFrequency(value: number): void {
    this.baseLowpassHz = MathUtils.clamp(value, 120, OcclusionTuning.clearHz);
    setSmoothed(
      this.obstructionFilter.frequency,
      Math.min(this.baseLowpassHz, this.obstructionFilter.frequency.value),
      this.context.currentTime,
      SmoothingSeconds,
    );
  }

  /** Acoplamiento con el espacio del oyente (mismo cuarto, portal, otro piso). */
  setWet(value: number): void {
    this.wet = clamp01(value);
    this.applyWetGain();
  }

  applyOcclusion(sample: OcclusionSample): void {
    const now = this.context.currentTime;

    setSmoothed(
      this.occlusionFilter.frequency,
      Math.min(
        this.baseLowpassHz,
        occlusionFilterHz(
          sample.occlusion,
          OcclusionTuning.clearHz,
          OcclusionTuning.occludedHz,
        ),
      ),
      now,
      SmoothingSeconds,
    );
    setSmoothed(
      this.obstructionFilter.frequency,
      occlusionFilterHz(
        sample.obstruction,
        OcclusionTuning.clearHz,
        OcclusionTuning.obstructedHz,
      ),
      now,
      SmoothingSeconds,
    );
    setSmoothed(
      this.dryGain.gain,
      occlusionGain(sample.obstruction, OcclusionTuning.obstructedGain),
      now,
      SmoothingSeconds,
    );
    // La oclusión apaga también el envío: si no hay camino, tampoco llega la
    // reverb de esa fuente al espacio del oyente.
    this.wetOcclusion = occlusionGain(
      sample.occlusion,
      OcclusionTuning.occludedGain,
    );
    this.applyWetGain();
  }

  private applyWetGain(): void {
    setSmoothed(
      this.wetGain.gain,
      this.wet * this.gain * this.wetOcclusion,
      this.context.currentTime,
      SmoothingSeconds,
    );
  }

  stop(): void {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    try {
      this.source.stop();
    } catch {
      // Ya detenida: `ended` se encarga de la limpieza.
    }
  }

  dispose(): void {
    this.stop();
    this.source.disconnect();
    this.voiceGain.disconnect();
    this.occlusionFilter.disconnect();
    this.obstructionFilter.disconnect();
    this.panner.disconnect();
    this.dryGain.disconnect();
    this.wetGain.disconnect();
  }
}

function setSmoothed(
  param: AudioParam,
  value: number,
  now: number,
  timeConstant: number,
): void {
  if (param.setTargetAtTime) {
    param.setTargetAtTime(value, now, timeConstant);
  } else {
    param.value = value;
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
