import type { PlayOptions } from "@engine/audio/core/SoundManager";

/**
 * Salida de audio mínima que la cola necesita. `SoundManager` la satisface;
 * en tests se pasa un fake.
 */
export interface HevVoiceSink {
  play(id: string, options?: PlayOptions): void;
  stop(id: string): void;
  hasSound(id: string): boolean;
  getBuffer(id: string): Promise<AudioBuffer | null>;
}

export interface HevVoiceRequest {
  /** Candidatos en orden de preferencia; se usa el primero disponible. */
  readonly ids: SoundRefIds;
  /** Mayor prioridad gana turno y se adelanta en la cola. */
  readonly priority: number;
  /** Identidad para de-dup: misma `key` dentro de `noRepeatSeconds` se descarta. */
  readonly key: string;
  readonly noRepeatSeconds: number;
  /** Vacía la cola e interrumpe la línea en curso antes de hablar (muerte). */
  readonly interrupt?: boolean;
}

export type SoundRefIds = string | readonly string[];

/** Contrato de cola de voz del traje; permite inyectar un fake en tests. */
export interface HevVoice {
  request(req: HevVoiceRequest): void;
  warm(ids: SoundRefIds): void;
  dispose(): void;
}

interface QueuedLine {
  readonly id: string;
  readonly priority: number;
  readonly key: string;
  readonly seq: number;
}

/** Pausa entre líneas, como el fvox del traje en Half-Life. */
const GapSeconds = 0.25;
/** Duración asumida mientras el buffer aún no se decodificó. */
const FallbackLineSeconds = 1.6;

type Scheduler = (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
type Canceller = (handle: ReturnType<typeof setTimeout>) => void;

/**
 * Serializa los anuncios de voz del traje HEV: una línea por vez, encolada por
 * prioridad y con de-dup por cooldown, replicando cómo el fvox de Half-Life
 * nunca solapa dos frases. Los beeps de dispositivo (cargador, sprint) NO pasan
 * por acá; se reproducen directo.
 */
export class HevVoiceQueue implements HevVoice {
  private readonly queue: QueuedLine[] = [];
  private readonly durations = new Map<string, number>();
  private readonly lastSpokenAt = new Map<string, number>();
  private speakingId: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  constructor(
    private readonly sink: HevVoiceSink,
    private readonly now: () => number = () => performance.now() / 1000,
    private readonly schedule: Scheduler = (fn, ms) => setTimeout(fn, ms),
    private readonly cancel: Canceller = (handle) => clearTimeout(handle),
  ) {}

  request(req: HevVoiceRequest): void {
    const id = firstOf(req.ids).find((candidate) => this.sink.hasSound(candidate));
    if (!id) {
      return;
    }
    if (req.interrupt) {
      this.reset();
    } else if (this.isThrottled(req.key, req.noRepeatSeconds) || this.isQueued(req.key)) {
      return;
    }
    this.lastSpokenAt.set(req.key, this.now());
    this.prefetchDuration(id);
    this.queue.push({ id, priority: req.priority, key: req.key, seq: this.seq++ });
    this.queue.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
    this.pump();
  }

  /** Precarga duraciones para que la primera línea de cada clip no caiga al fallback. */
  warm(ids: SoundRefIds): void {
    firstOf(ids).forEach((id) => {
      if (this.sink.hasSound(id)) {
        this.prefetchDuration(id);
      }
    });
  }

  dispose(): void {
    this.reset();
  }

  private pump(): void {
    if (this.speakingId !== null || this.queue.length === 0) {
      return;
    }
    const next = this.queue.shift();
    if (!next) {
      return;
    }
    this.speakingId = next.id;
    this.sink.play(next.id);
    const seconds = (this.durations.get(next.id) ?? FallbackLineSeconds) + GapSeconds;
    this.timer = this.schedule(() => {
      this.timer = null;
      this.speakingId = null;
      this.pump();
    }, seconds * 1000);
  }

  private isThrottled(key: string, noRepeatSeconds: number): boolean {
    const last = this.lastSpokenAt.get(key);
    return last !== undefined && this.now() - last < noRepeatSeconds;
  }

  private isQueued(key: string): boolean {
    return this.queue.some((line) => line.key === key);
  }

  private prefetchDuration(id: string): void {
    if (this.durations.has(id)) {
      return;
    }
    // Marca temprano para no disparar múltiples fetch del mismo clip.
    this.durations.set(id, FallbackLineSeconds);
    void this.sink.getBuffer(id).then((buffer) => {
      if (buffer) {
        this.durations.set(id, buffer.duration);
      }
    });
  }

  private reset(): void {
    if (this.timer !== null) {
      this.cancel(this.timer);
      this.timer = null;
    }
    if (this.speakingId !== null) {
      this.sink.stop(this.speakingId);
      this.speakingId = null;
    }
    this.queue.length = 0;
  }
}

function firstOf(ids: SoundRefIds): readonly string[] {
  return typeof ids === "string" ? [ids] : ids;
}
