import {
  AudioClipCatalog,
  type AudioClipDefinition,
  type AudioCategory,
} from "@engine/audio/AudioManifest";
import type { AudioBusName } from "./AudioSystem";
import type { AudioSystem } from "./AudioSystem";

export interface PlayOptions {
  volume?: number;
  loop?: boolean;
  fadeIn?: number;
  bus?: AudioBusName;
  /** Desafinación en cents (±). Rompe la repetición de one-shots (pasos, disparos). */
  detune?: number;
  /** Multiplicador de velocidad de reproducción (pitch + duración). */
  playbackRate?: number;
  /** Jitter de volumen relativo (0..1). El volumen final se randomiza ±jitter. */
  volumeJitter?: number;
}

interface SoundInstance {
  id: string;
  category: AudioCategory;
  bus: AudioBusName;
  source: AudioBufferSourceNode;
  gain: GainNode;
  loop: boolean;
  startedAt: number;
}

/**
 * Máximo de voces concurrentes por bus. Al excederse se corta la voz más
 * vieja del bus (voice stealing) para evitar acumulación infinita y clipping.
 */
const VoiceCaps: Partial<Record<AudioBusName, number>> = {
  weapons: 16,
  vehicles: 20,
  enemies: 12,
  footsteps: 4,
  sfx: 12,
  ui: 8,
};
const DefaultVoiceCap = 24;

/** Ventana anti-retrigger: mismo clip disparado < esto se colapsa en una sola voz. */
const MinRetriggerSeconds = 0.02;

/**
 * Carga clips del `AudioClipCatalog` bajo demanda y los reproduce a travÃ©s
 * del bus indicado en cada clip (o uno explÃ­cito en `PlayOptions.bus`).
 *
 * Soporta loops con fade-in y fade-out por id (`playLoop` / `fadeOut`),
 * y one-shots sin tracking (`play`). Llamar `hasSound(id)` antes de
 * reproducir si el catÃ¡logo puede no contener el clip.
 */
export class SoundManager {
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly active = new Map<string, SoundInstance[]>();
  private readonly lastPlayedAt = new Map<string, number>();
  private readonly registeredClips = new Map<
    string,
    { definition: AudioClipDefinition; leases: number }
  >();

  constructor(private readonly audio: AudioSystem) {}

  preload(soundIds?: string[]): void {
    const ids =
      soundIds ??
      [...Object.keys(AudioClipCatalog), ...this.registeredClips.keys()];
    ids.forEach((id) => {
      void this.loadBuffer(id);
    });
  }

  /**
   * Registro descartable para contenido game-owned. Engine conserva un
   * catálogo base, mientras niveles o módulos pueden alquilar clips propios
   * sin hacer que `AudioManifest` conozca contenido del juego.
   */
  registerClips(definitions: readonly AudioClipDefinition[]): () => void {
    for (const definition of definitions) {
      if (AudioClipCatalog[definition.id]) {
        throw new Error(
          `[SoundManager] El clip dinámico '${definition.id}' colisiona con el catálogo base.`,
        );
      }
      const registered = this.registeredClips.get(definition.id);
      if (
        registered &&
        (registered.definition.path !== definition.path ||
          registered.definition.bus !== definition.bus ||
          registered.definition.category !== definition.category)
      ) {
        throw new Error(
          `[SoundManager] El clip dinámico '${definition.id}' ya fue registrado con otra definición.`,
        );
      }
    }

    definitions.forEach((definition) => {
      const registered = this.registeredClips.get(definition.id);
      if (registered) {
        registered.leases += 1;
      } else {
        this.registeredClips.set(definition.id, {
          definition: { ...definition },
          leases: 1,
        });
      }
    });

    let released = false;
    return () => {
      if (released) return;
      released = true;
      definitions.forEach((definition) => {
        const registered = this.registeredClips.get(definition.id);
        if (!registered) return;
        registered.leases -= 1;
        if (registered.leases > 0) return;
        this.stop(definition.id);
        this.buffers.delete(definition.id);
        this.lastPlayedAt.delete(definition.id);
        this.registeredClips.delete(definition.id);
      });
    };
  }

  play(soundId: string, options: PlayOptions = {}): void {
    void this.playInternal(soundId, { ...options, loop: false });
  }

  playLoop(soundId: string, options: PlayOptions = {}): void {
    void this.playInternal(soundId, { ...options, loop: true });
  }

  stop(soundId: string): void {
    const instances = this.active.get(soundId);
    if (!instances) {
      return;
    }

    instances.forEach((instance) => {
      instance.source.stop();
    });
    this.active.delete(soundId);
  }

  fadeOut(soundId: string, duration = 1): void {
    const instances = this.active.get(soundId);
    if (!instances || instances.length === 0) {
      return;
    }

    const context = this.audio.getContext();
    if (!context) {
      return;
    }

    instances.forEach((instance) => {
      const now = context.currentTime;
      instance.gain.gain.cancelScheduledValues(now);
      instance.gain.gain.setValueAtTime(instance.gain.gain.value, now);
      instance.gain.gain.linearRampToValueAtTime(0, now + duration);
      instance.source.stop(now + duration + 0.05);
    });

    this.active.delete(soundId);
  }

  stopAllByCategory(category: AudioCategory): void {
    [...this.active.entries()].forEach(([id, instances]) => {
      const clip = this.getClip(id);
      if (clip && clip.category === category) {
        instances.forEach((instance) => instance.source.stop());
        this.active.delete(id);
      }
    });
  }

  setBusVolume(bus: AudioBusName, value: number): void {
    this.audio.setVolume(bus, value);
  }

  duck(buses: readonly AudioBusName[], factor: number, rampSeconds?: number): void {
    this.audio.duck(buses, factor, rampSeconds);
  }

  unduck(buses: readonly AudioBusName[], rampSeconds?: number): void {
    this.audio.unduck(buses, rampSeconds);
  }

  hasSound(soundId: string): boolean {
    return this.getClip(soundId) !== null;
  }

  async getBuffer(soundId: string): Promise<AudioBuffer | null> {
    return this.loadBuffer(soundId);
  }

  private async playInternal(
    soundId: string,
    options: PlayOptions,
  ): Promise<void> {
    const clip = this.getClip(soundId);
    if (!clip) {
      return;
    }

    const context = await this.audio.getContextWhenReady();
    if (!context) {
      return;
    }

    const busName = options.bus ?? clip.bus;

    // Anti-machine-gun: el mismo clip disparado en la misma ráfaga de frames
    // se colapsa; sin esto se apilan decenas de voces idénticas que clippean.
    const loop = options.loop ?? clip.loop;
    if (!loop) {
      const last = this.lastPlayedAt.get(soundId);
      if (last !== undefined && context.currentTime - last < MinRetriggerSeconds) {
        return;
      }
      this.lastPlayedAt.set(soundId, context.currentTime);
      this.enforceVoiceCap(busName);
    }

    const buffer = await this.loadBuffer(soundId, context);
    if (!buffer) {
      return;
    }

    const bus = this.audio.getBus(busName);
    if (!bus) {
      return;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    if (options.playbackRate !== undefined) {
      source.playbackRate.value = options.playbackRate;
    }
    if (options.detune !== undefined && source.detune) {
      source.detune.value = options.detune;
    }

    const gain = context.createGain();
    const jitter = options.volumeJitter
      ? 1 + (Math.random() * 2 - 1) * options.volumeJitter
      : 1;
    const baseVolume = clip.volume * (options.volume ?? 1) * jitter;
    gain.gain.value = baseVolume;

    source.connect(gain);
    gain.connect(bus.gain);

    const instance: SoundInstance = {
      id: soundId,
      category: clip.category,
      bus: busName,
      source,
      gain,
      loop: source.loop,
      startedAt: context.currentTime,
    };

    if (!this.active.has(soundId)) {
      this.active.set(soundId, []);
    }
    this.active.get(soundId)?.push(instance);

    if (options.fadeIn && options.fadeIn > 0) {
      const now = context.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(baseVolume, now + options.fadeIn);
    }

    source.addEventListener("ended", () => {
      this.removeInstance(instance);
    });

    source.start();
  }

  /**
   * Aplica el límite de voces del bus con voice stealing: si ya se alcanzó el
   * cap, corta las voces one-shot más viejas para hacerle lugar a la nueva.
   * Los loops (ambience, música, motor del cohete) no cuentan ni se roban.
   */
  private enforceVoiceCap(busName: AudioBusName): void {
    const cap = VoiceCaps[busName] ?? DefaultVoiceCap;
    const onBus: SoundInstance[] = [];
    this.active.forEach((list) => {
      list.forEach((instance) => {
        if (instance.bus === busName && !instance.loop) {
          onBus.push(instance);
        }
      });
    });

    if (onBus.length < cap) {
      return;
    }

    onBus.sort((a, b) => a.startedAt - b.startedAt);
    const toStop = onBus.length - cap + 1;
    for (let i = 0; i < toStop; i += 1) {
      const instance = onBus[i];
      if (!instance) {
        continue;
      }
      try {
        instance.source.stop();
      } catch {
        // Ya detenida; el handler `ended` limpia el resto.
      }
      this.removeInstance(instance);
    }
  }

  private removeInstance(instance: SoundInstance): void {
    const list = this.active.get(instance.id);
    if (!list) {
      return;
    }
    const filtered = list.filter((entry) => entry !== instance);
    if (filtered.length > 0) {
      this.active.set(instance.id, filtered);
    } else {
      this.active.delete(instance.id);
    }
  }

  private async loadBuffer(
    soundId: string,
    readyContext?: AudioContext,
  ): Promise<AudioBuffer | null> {
    if (this.buffers.has(soundId)) {
      return this.buffers.get(soundId) ?? null;
    }

    const clip = this.getClip(soundId);
    if (!clip) {
      return null;
    }

    const context = readyContext ?? (await this.audio.getContextWhenReady());
    if (!context) {
      return null;
    }

    try {
      const response = await fetch(clip.path);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = await context.decodeAudioData(arrayBuffer);
      this.buffers.set(soundId, buffer);
      return buffer;
    } catch {
      console.warn(`[SoundManager] Failed to load ${soundId}`);
      return null;
    }
  }

  private getClip(soundId: string): AudioClipDefinition | null {
    const clip =
      this.registeredClips.get(soundId)?.definition ??
      AudioClipCatalog[soundId];
    if (!clip) {
      return null;
    }
    return clip;
  }
}
