import {
  ImpulseResponseCache,
  signature,
  type ImpulseResponseSpec,
} from "./ImpulseResponse";

/**
 * Retorno de efectos del mixer.
 *
 * ```
 *          ┌→ convolverA → wetA ┐
 * input → preDelay              ├→ tone → output
 *          └→ convolverB → wetB ┘
 *       └→ echoDelay → echoTone → output
 *                ↑         ↓
 *                └ feedback ┘
 * ```
 *
 * Dos convolvers en vez de uno porque cambiar de espacio pide cambiar la IR, y
 * reasignar `convolver.buffer` en caliente corta la cola. Con A/B la sala vieja
 * se apaga mientras la nueva sube y la transición no tiene escalón.
 *
 * Todo lo que la sonda acústica mueve de forma continua (tono, wet, feedback)
 * son `AudioParam` y no tocan la IR.
 */

export interface ReverbSpace extends ImpulseResponseSpec {
  /** Corte del retorno: absorción del material de la sala. */
  readonly toneHz: number;
  /** Retardo hasta la primera reflexión, en segundos. */
  readonly preDelay: number;
  readonly echoDelay: number;
  readonly echoFeedback: number;
  readonly echoWet: number;
  /** Nivel del retorno completo, 0..1. */
  readonly wet: number;
}

const MaxPreDelay = 0.25;
const MaxEchoDelay = 1.25;
const MaxFeedback = 0.75;

export class ReverbRack {
  private readonly input: GainNode;
  private readonly preDelay: DelayNode;
  private readonly convolvers: [ConvolverNode, ConvolverNode];
  private readonly wetGains: [GainNode, GainNode];
  private readonly tone: BiquadFilterNode;
  private readonly echoDelay: DelayNode;
  private readonly echoTone: BiquadFilterNode;
  private readonly echoFeedback: GainNode;
  private readonly echoWet: GainNode;
  private readonly output: GainNode;
  private readonly cache: ImpulseResponseCache;

  private active = 0;
  private activeSignature: string | null = null;

  constructor(
    private readonly context: AudioContext,
    destination: AudioNode,
  ) {
    this.cache = new ImpulseResponseCache(context);

    this.input = context.createGain();
    this.output = context.createGain();
    this.output.gain.value = 0;
    this.output.connect(destination);

    this.preDelay = context.createDelay(MaxPreDelay);
    this.tone = context.createBiquadFilter();
    this.tone.type = "lowpass";
    this.tone.frequency.value = 12_000;
    this.tone.connect(this.output);

    this.convolvers = [context.createConvolver(), context.createConvolver()];
    this.wetGains = [context.createGain(), context.createGain()];
    this.input.connect(this.preDelay);
    this.convolvers.forEach((convolver, index) => {
      // `normalize` antes del buffer: cambiarlo después obliga a recomputar.
      convolver.normalize = true;
      const wet = this.wetGains[index];
      wet.gain.value = index === 0 ? 1 : 0;
      this.preDelay.connect(convolver);
      convolver.connect(wet);
      wet.connect(this.tone);
    });

    this.echoDelay = context.createDelay(MaxEchoDelay);
    this.echoTone = context.createBiquadFilter();
    this.echoTone.type = "lowpass";
    this.echoTone.frequency.value = 5_000;
    this.echoFeedback = context.createGain();
    this.echoFeedback.gain.value = 0;
    this.echoWet = context.createGain();
    this.echoWet.gain.value = 0;

    this.input.connect(this.echoDelay);
    this.echoDelay.connect(this.echoTone);
    this.echoTone.connect(this.echoWet);
    this.echoWet.connect(this.output);
    this.echoTone.connect(this.echoFeedback);
    this.echoFeedback.connect(this.echoDelay);
  }

  /** Entrada del rack: acá manda su `auxGain` el bus master. */
  getInput(): AudioNode {
    return this.input;
  }

  apply(space: ReverbSpace, fadeSeconds = 0.6): void {
    const now = this.context.currentTime;

    this.ramp(this.output.gain, clamp(space.wet, 0, 1), fadeSeconds, now);
    this.ramp(this.tone.frequency, clamp(space.toneHz, 250, 20_000), fadeSeconds, now);
    this.ramp(this.preDelay.delayTime, clamp(space.preDelay, 0, MaxPreDelay), 0, now);
    this.ramp(this.echoDelay.delayTime, clamp(space.echoDelay, 0, MaxEchoDelay), 0, now);
    this.ramp(
      this.echoFeedback.gain,
      clamp(space.echoFeedback, 0, MaxFeedback),
      fadeSeconds,
      now,
    );
    this.ramp(this.echoWet.gain, clamp(space.echoWet, 0, 1), fadeSeconds, now);

    this.swapImpulse(space, fadeSeconds, now);
  }

  dispose(): void {
    this.input.disconnect();
    this.preDelay.disconnect();
    this.convolvers.forEach((convolver) => convolver.disconnect());
    this.wetGains.forEach((gain) => gain.disconnect());
    this.tone.disconnect();
    this.echoDelay.disconnect();
    this.echoTone.disconnect();
    this.echoFeedback.disconnect();
    this.echoWet.disconnect();
    this.output.disconnect();
    this.cache.clear();
  }

  private swapImpulse(
    spec: ImpulseResponseSpec,
    fadeSeconds: number,
    now: number,
  ): void {
    const next = signature(spec);
    if (next === this.activeSignature) {
      return;
    }

    const incoming = this.active === 0 ? 1 : 0;
    const outgoing = this.active;
    const target = this.convolvers[incoming];
    const buffer = this.cache.get(spec);
    if (target.buffer !== buffer) {
      target.buffer = buffer;
    }

    // Sin IR previa no hay nada que cruzar: entra directo.
    const fade = this.activeSignature === null ? 0 : fadeSeconds;
    this.ramp(this.wetGains[incoming].gain, 1, fade, now);
    this.ramp(this.wetGains[outgoing].gain, 0, fade, now);

    this.active = incoming;
    this.activeSignature = next;
  }

  private ramp(
    param: AudioParam,
    target: number,
    seconds: number,
    now: number,
  ): void {
    if (seconds <= 0) {
      param.cancelScheduledValues(now);
      param.value = target;
      return;
    }
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(target, now + seconds);
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
