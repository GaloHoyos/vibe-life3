/**
 * Respuestas al impulso sintéticas para el convolver.
 *
 * Se generan (ruido con caída exponencial y una cola de reflexiones tempranas)
 * en vez de cargarse de archivo: así el tamaño de sala es un parámetro vivo y
 * no hay 4 MB de IR por preset en el bundle.
 *
 * **Se cachean por firma.** Asignar `convolver.buffer` recompila el kernel FFT
 * en el hilo de audio: generar una IR cada vez que cambia el espacio se
 * escucha como un salto en la cola.
 */

export interface ImpulseResponseSpec {
  /** Duración de la cola, en segundos. */
  readonly duration: number;
  /** Exponente de la caída: más alto, cola más corta y seca. */
  readonly decay: number;
  /** Difusión de las reflexiones tempranas, 0..1. */
  readonly diffusion?: number;
}

const MinDuration = 0.05;
const MaxDuration = 4;
const MinDecay = 0.2;
const MaxDecay = 8;

export class ImpulseResponseCache {
  private readonly buffers = new Map<string, AudioBuffer>();

  constructor(private readonly context: AudioContext) {}

  get(spec: ImpulseResponseSpec): AudioBuffer {
    const key = signature(spec);
    const cached = this.buffers.get(key);
    if (cached) {
      return cached;
    }
    const buffer = createImpulseResponse(this.context, spec);
    this.buffers.set(key, buffer);
    return buffer;
  }

  clear(): void {
    this.buffers.clear();
  }
}

/** Redondea para que un barrido continuo de la sonda no genere una IR por frame. */
export function signature(spec: ImpulseResponseSpec): string {
  const duration = quantize(clamp(spec.duration, MinDuration, MaxDuration), 0.1);
  const decay = quantize(clamp(spec.decay, MinDecay, MaxDecay), 0.25);
  const diffusion = quantize(clamp(spec.diffusion ?? 0.5, 0, 1), 0.25);
  return `${duration}|${decay}|${diffusion}`;
}

export function createImpulseResponse(
  context: AudioContext,
  spec: ImpulseResponseSpec,
): AudioBuffer {
  const duration = clamp(spec.duration, MinDuration, MaxDuration);
  const decay = clamp(spec.decay, MinDecay, MaxDecay);
  const diffusion = clamp(spec.diffusion ?? 0.5, 0, 1);
  const length = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(2, length, context.sampleRate);
  // La primera reflexión llega antes en salas chicas; marca el "tamaño".
  const earlyGap = Math.max(1, Math.floor(length * 0.02 * (1 - diffusion * 0.5)));

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    // Semilla fija por canal: dos ruidos distintos dan ancho estéreo, y la
    // IR es reproducible entre sesiones.
    let seed = channel === 0 ? 0x12345678 : 0x87654321;

    for (let i = 0; i < length; i += 1) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      const noise = (seed / 0xffffffff) * 2 - 1;
      const t = i / length;
      const tail = (1 - t) ** decay;
      // Rampa de entrada: sin esto la cola empieza de golpe y suena a click.
      const build = i < earlyGap ? i / earlyGap : 1;
      data[i] = noise * tail * build;
    }
  }

  return buffer;
}

function quantize(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
