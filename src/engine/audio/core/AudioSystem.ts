import { AudioBus } from "./AudioBus";

export type AudioBusName =
  | "master"
  | "music"
  | "ambience"
  | "sfx"
  | "weapons"
  | "enemies"
  | "footsteps"
  | "dialogue"
  | "ui";

const defaultVolumes: Record<AudioBusName, number> = {
  master: 1,
  music: 0.65,
  ambience: 0.75,
  sfx: 0.85,
  weapons: 0.9,
  enemies: 0.85,
  footsteps: 0.65,
  dialogue: 0.8,
  ui: 0.7,
};

const storageKey = "hl3.audio.volumes";

/**
 * Núcleo del audio: posee el `AudioContext`, un set de buses (master/music/
 * ambience/sfx/weapons/...) y persiste los volúmenes en `localStorage`.
 *
 * El contexto se crea lazy en el primer `unlock()` (típicamente disparado
 * por un click del usuario, requisito de los navegadores).
 */
export class AudioSystem {
  private context: AudioContext | null = null;
  private readonly buses = new Map<AudioBusName, AudioBus>();
  private readonly volumes: Record<AudioBusName, number> = {
    ...defaultVolumes,
  };
  /**
   * Multiplicador de ducking por bus (1 = sin atenuar). Se combina con el
   * volumen del usuario sin pisarlo, así el ducking de diálogo y el slider
   * conviven.
   */
  private readonly duckFactors: Record<AudioBusName, number> = {
    master: 1,
    music: 1,
    ambience: 1,
    sfx: 1,
    weapons: 1,
    enemies: 1,
    footsteps: 1,
    dialogue: 1,
    ui: 1,
  };
  private limiter: DynamicsCompressorNode | null = null;
  private muted = false;

  constructor() {
    this.loadSavedVolumes();
  }

  getContext(): AudioContext | null {
    return this.ensureContext();
  }

  unlock(): void {
    const context = this.ensureContext();
    if (!context) {
      return;
    }

    if (context.state !== "running") {
      void context.resume();
    }
  }

  pause(): void {
    const context = this.context;
    if (context && context.state === "running") {
      void context.suspend();
    }
  }

  resume(): void {
    const context = this.ensureContext();
    if (context && context.state !== "running") {
      void context.resume();
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyBusGain("master");
  }

  isMuted(): boolean {
    return this.muted;
  }

  setVolume(bus: AudioBusName, value: number): void {
    const clamped = Math.min(1, Math.max(0, value));
    this.volumes[bus] = clamped;

    if (bus === "master" && this.muted) {
      this.muted = false;
    }
    this.applyBusGain(bus);

    this.saveVolumes();
  }

  getVolume(bus: AudioBusName): number {
    return this.volumes[bus];
  }

  getBus(bus: AudioBusName): AudioBus | null {
    this.ensureContext();
    return this.buses.get(bus) ?? null;
  }

  /**
   * Atenúa temporalmente un conjunto de buses (ducking). El factor multiplica
   * el volumen del usuario sin pisarlo; `unduck` lo restaura. Lo usa el
   * ducking de diálogo para dejar respirar la voz.
   */
  duck(buses: readonly AudioBusName[], factor: number, rampSeconds = 0.15): void {
    const clamped = Math.min(1, Math.max(0, factor));
    buses.forEach((bus) => {
      this.duckFactors[bus] = clamped;
      this.applyBusGain(bus, rampSeconds);
    });
  }

  unduck(buses: readonly AudioBusName[], rampSeconds = 0.4): void {
    buses.forEach((bus) => {
      this.duckFactors[bus] = 1;
      this.applyBusGain(bus, rampSeconds);
    });
  }

  private applyBusGain(bus: AudioBusName, rampSeconds = 0): void {
    const node = this.buses.get(bus);
    if (!node) {
      return;
    }

    let target = this.volumes[bus] * this.duckFactors[bus];
    if (bus === "master" && this.muted) {
      target = 0;
    }

    const param = node.gain.gain;
    if (this.context && rampSeconds > 0) {
      const now = this.context.currentTime;
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(target, now + rampSeconds);
    } else {
      param.value = target;
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.context) {
      return this.context;
    }

    const AudioContextConstructor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextConstructor) {
      console.warn("[AudioSystem] Web Audio API not available.");
      return null;
    }

    this.context = new AudioContextConstructor();
    this.createBuses();
    return this.context;
  }

  private createBuses(): void {
    if (!this.context) {
      return;
    }

    // Limiter suave en la salida: evita clipping cuando se apilan disparos +
    // explosiones. Se ubica entre el bus master y el destino.
    const limiter = this.context.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    limiter.connect(this.context.destination);
    this.limiter = limiter;

    const master = new AudioBus("master", this.context, limiter);
    master.gain.gain.value = this.volumes.master;
    this.buses.set("master", master);

    const children: AudioBusName[] = [
      "music",
      "ambience",
      "sfx",
      "weapons",
      "enemies",
      "footsteps",
      "dialogue",
      "ui",
    ];

    children.forEach((name) => {
      const bus = new AudioBus(name, this.context as AudioContext, master);
      bus.gain.gain.value = this.volumes[name];
      this.buses.set(name, bus);
    });
  }

  private loadSavedVolumes(): void {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<Record<AudioBusName, number>>;
      (Object.keys(parsed) as AudioBusName[]).forEach((bus) => {
        const value = parsed[bus];
        if (typeof value === "number") {
          this.volumes[bus] = Math.min(1, Math.max(0, value));
        }
      });
    } catch {
      window.localStorage.removeItem(storageKey);
    }
  }

  private saveVolumes(): void {
    window.localStorage.setItem(storageKey, JSON.stringify(this.volumes));
  }
}
