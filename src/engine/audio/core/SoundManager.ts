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
}

interface SoundInstance {
  id: string;
  category: AudioCategory;
  source: AudioBufferSourceNode;
  gain: GainNode;
  loop: boolean;
}

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

  constructor(private readonly audio: AudioSystem) {}

  preload(soundIds?: string[]): void {
    const ids = soundIds ?? Object.keys(AudioClipCatalog);
    ids.forEach((id) => {
      void this.loadBuffer(id);
    });
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
      const clip = AudioClipCatalog[id];
      if (clip && clip.category === category) {
        instances.forEach((instance) => instance.source.stop());
        this.active.delete(id);
      }
    });
  }

  setBusVolume(bus: AudioBusName, value: number): void {
    this.audio.setVolume(bus, value);
  }

  hasSound(soundId: string): boolean {
    return Boolean(AudioClipCatalog[soundId]);
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

    const context = this.audio.getContext();
    if (!context) {
      return;
    }

    const buffer = await this.loadBuffer(soundId);
    if (!buffer) {
      return;
    }

    const bus = this.audio.getBus(options.bus ?? clip.bus);
    if (!bus) {
      return;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = options.loop ?? clip.loop;

    const gain = context.createGain();
    const baseVolume = clip.volume * (options.volume ?? 1);
    gain.gain.value = baseVolume;

    source.connect(gain);
    gain.connect(bus.gain);

    const instance: SoundInstance = {
      id: soundId,
      category: clip.category,
      source,
      gain,
      loop: source.loop,
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
      const list = this.active.get(soundId);
      if (!list) {
        return;
      }

      this.active.set(
        soundId,
        list.filter((entry) => entry !== instance),
      );
    });

    source.start();
  }

  private async loadBuffer(soundId: string): Promise<AudioBuffer | null> {
    if (this.buffers.has(soundId)) {
      return this.buffers.get(soundId) ?? null;
    }

    const clip = this.getClip(soundId);
    if (!clip) {
      return null;
    }

    const context = this.audio.getContext();
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
    const clip = AudioClipCatalog[soundId];
    if (!clip) {
      return null;
    }
    return clip;
  }
}
