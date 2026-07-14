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

export interface AudioEnvironmentReverbSettings {
  readonly duration: number;
  readonly decay: number;
  readonly wet: number;
  readonly preDelay?: number;
  readonly tone?: number;
}

export interface AudioEnvironmentEchoSettings {
  readonly delay: number;
  readonly feedback: number;
  readonly wet: number;
  readonly tone?: number;
}

export interface AudioEnvironmentPreset {
  readonly reverb: AudioEnvironmentReverbSettings;
  readonly echo: AudioEnvironmentEchoSettings;
  readonly sends: Partial<Record<AudioBusName, number>>;
}

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

interface AudioBusDspSends {
  readonly reverb: GainNode;
  readonly echo: GainNode;
}

interface AudioDspRack {
  readonly reverbInput: GainNode;
  readonly reverbPreDelay: DelayNode;
  readonly convolver: ConvolverNode;
  readonly reverbTone: BiquadFilterNode;
  readonly echoInput: GainNode;
  readonly echoDelay: DelayNode;
  readonly echoTone: BiquadFilterNode;
  readonly echoFeedback: GainNode;
  readonly busSends: Map<AudioBusName, AudioBusDspSends>;
}

const audioUnlockEvents = [
  "pointerdown",
  "touchend",
  "keydown",
  "click",
] as const;

/**
 * Núcleo del audio: posee el `AudioContext`, un set de buses (master/music/
 * ambience/sfx/weapons/...) y persiste los volúmenes en `localStorage`.
 *
 * El contexto se crea lazy durante el primer gesto confiable del usuario.
 * Crear (o reanudar) un `AudioContext` durante el bootstrap activa la política
 * de autoplay de los navegadores, por eso los getters nunca lo construyen.
 */
export class AudioSystem {
  private context: AudioContext | null = null;
  private readonly contextWaiters = new Set<
    (context: AudioContext | null) => void
  >();
  private listeningForUnlock = false;
  private disposed = false;
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
  private dspRack: AudioDspRack | null = null;
  private dspVolume = 1;
  private currentEnvironment: AudioEnvironmentPreset | null = null;
  private muted = false;

  constructor() {
    this.loadSavedVolumes();
    this.listenForUserGesture();
  }

  getContext(): AudioContext | null {
    return this.context;
  }

  /**
   * Espera al contexto que creará el primer gesto del usuario. Permite que
   * cargas/loops solicitados durante un boot directo queden pendientes en vez
   * de crear Web Audio fuera del gesto o perderse silenciosamente.
   */
  getContextWhenReady(): Promise<AudioContext | null> {
    if (this.disposed) {
      return Promise.resolve(null);
    }
    if (this.context) {
      return Promise.resolve(this.context);
    }

    if (!this.getAudioContextConstructor()) {
      this.warnAudioUnavailable();
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      this.contextWaiters.add(resolve);
    });
  }

  unlock(): void {
    if (this.disposed) {
      return;
    }
    const context =
      this.context ??
      (this.hasActiveUserGesture() ? this.ensureContext() : null);
    if (!context) {
      return;
    }

    this.resumeContext(context);
  }

  pause(): void {
    const context = this.context;
    if (context && context.state === "running") {
      void context.suspend();
    }
  }

  resume(): void {
    if (this.disposed) {
      return;
    }
    const context = this.context;
    if (context) {
      this.resumeContext(context);
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyBusGain("master");
  }

  isMuted(): boolean {
    return this.muted;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.stopListeningForUserGesture();
    this.resolveContextWaiters(null);

    const context = this.context;
    this.context = null;
    this.buses.clear();
    this.limiter = null;
    this.dspRack = null;
    if (context && context.state !== "closed") {
      void context.close().catch(() => {
        // El teardown no debe fallar si el navegador ya cerró el contexto.
      });
    }
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
    return this.buses.get(bus) ?? null;
  }

  setAudioEnvironment(
    preset: AudioEnvironmentPreset,
    fadeSeconds = 1,
  ): void {
    this.currentEnvironment = preset;
    const context = this.context;
    const rack = this.dspRack;
    if (!context || !rack) {
      return;
    }

    this.applyEnvironmentPreset(context, rack, preset, fadeSeconds);
  }

  setDspVolume(value: number, fadeSeconds = 0.2): void {
    this.dspVolume = clamp01(value);
    const context = this.context;
    const rack = this.dspRack;
    if (!context || !rack || !this.currentEnvironment) {
      return;
    }

    this.applyEnvironmentSends(context, rack, this.currentEnvironment, fadeSeconds);
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
    if (this.disposed) {
      return null;
    }
    if (this.context) {
      return this.context;
    }

    const AudioContextConstructor = this.getAudioContextConstructor();
    if (!AudioContextConstructor) {
      this.warnAudioUnavailable();
      this.resolveContextWaiters(null);
      return null;
    }

    this.context = new AudioContextConstructor();
    this.createBuses();
    this.resolveContextWaiters(this.context);
    return this.context;
  }

  private getAudioContextConstructor(): typeof AudioContext | undefined {
    return (
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    );
  }

  private warnAudioUnavailable(): void {
    console.warn("[AudioSystem] Web Audio API not available.");
  }

  private listenForUserGesture(): void {
    if (this.disposed || this.listeningForUnlock) {
      return;
    }
    this.listeningForUnlock = true;
    audioUnlockEvents.forEach((eventName) => {
      window.addEventListener(eventName, this.handleUserGesture, {
        capture: true,
        passive: true,
      });
    });
  }

  private stopListeningForUserGesture(): void {
    if (!this.listeningForUnlock) {
      return;
    }
    this.listeningForUnlock = false;
    audioUnlockEvents.forEach((eventName) => {
      window.removeEventListener(eventName, this.handleUserGesture, true);
    });
  }

  private readonly handleUserGesture = (event: Event): void => {
    // Eventos sintéticos no conceden activación y volverían a disparar la
    // advertencia de autoplay aunque hayan pasado por un event handler.
    if (this.disposed || !event.isTrusted) {
      return;
    }
    const context = this.ensureContext();
    if (context) {
      this.resumeContext(context);
    }
  };

  private hasActiveUserGesture(): boolean {
    return window.navigator.userActivation?.isActive === true;
  }

  private resumeContext(context: AudioContext): void {
    if (context.state === "running") {
      this.stopListeningForUserGesture();
      return;
    }

    void context
      .resume()
      .then(() => {
        if (context.state === "running") {
          this.stopListeningForUserGesture();
        }
      })
      .catch(() => {
        // El navegador puede rechazar el intento si perdió la activación.
        // Conservamos los listeners para reintentar en el siguiente gesto.
      });
  }

  private resolveContextWaiters(context: AudioContext | null): void {
    this.contextWaiters.forEach((resolve) => resolve(context));
    this.contextWaiters.clear();
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
    this.dspRack = this.createDspRack(this.context, master);

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
      if (this.dspRack) {
        this.connectDspSends(name, bus, this.dspRack);
      }
    });

    if (this.dspRack && this.currentEnvironment) {
      this.applyEnvironmentPreset(
        this.context,
        this.dspRack,
        this.currentEnvironment,
        0,
      );
    }
  }

  private createDspRack(context: AudioContext, master: AudioBus): AudioDspRack {
    const reverbInput = context.createGain();
    const reverbPreDelay = context.createDelay(0.5);
    const convolver = context.createConvolver();
    const reverbTone = context.createBiquadFilter();

    reverbTone.type = "lowpass";
    reverbTone.frequency.value = 12000;
    reverbInput.connect(reverbPreDelay);
    reverbPreDelay.connect(convolver);
    convolver.connect(reverbTone);
    reverbTone.connect(master.gain);

    const echoInput = context.createGain();
    const echoDelay = context.createDelay(1.5);
    const echoTone = context.createBiquadFilter();
    const echoFeedback = context.createGain();

    echoTone.type = "lowpass";
    echoTone.frequency.value = 5000;
    echoFeedback.gain.value = 0;
    echoInput.connect(echoDelay);
    echoDelay.connect(echoTone);
    echoTone.connect(master.gain);
    echoTone.connect(echoFeedback);
    echoFeedback.connect(echoDelay);

    return {
      reverbInput,
      reverbPreDelay,
      convolver,
      reverbTone,
      echoInput,
      echoDelay,
      echoTone,
      echoFeedback,
      busSends: new Map(),
    };
  }

  private connectDspSends(
    name: AudioBusName,
    bus: AudioBus,
    rack: AudioDspRack,
  ): void {
    const reverb = this.context?.createGain();
    const echo = this.context?.createGain();
    if (!reverb || !echo) {
      return;
    }

    reverb.gain.value = 0;
    echo.gain.value = 0;
    bus.gain.connect(reverb);
    bus.gain.connect(echo);
    reverb.connect(rack.reverbInput);
    echo.connect(rack.echoInput);
    rack.busSends.set(name, { reverb, echo });
  }

  private applyEnvironmentPreset(
    context: AudioContext,
    rack: AudioDspRack,
    preset: AudioEnvironmentPreset,
    fadeSeconds: number,
  ): void {
    rack.convolver.buffer = this.createImpulseResponse(context, preset.reverb);

    this.rampParam(
      context,
      rack.reverbPreDelay.delayTime,
      clamp(preset.reverb.preDelay ?? 0, 0, 0.25),
      0,
    );
    this.rampParam(
      context,
      rack.reverbTone.frequency,
      clamp(preset.reverb.tone ?? 12000, 250, 20000),
      fadeSeconds,
    );
    this.rampParam(
      context,
      rack.echoDelay.delayTime,
      clamp(preset.echo.delay, 0, 1.25),
      0,
    );
    this.rampParam(
      context,
      rack.echoFeedback.gain,
      clamp(preset.echo.feedback, 0, 0.75),
      fadeSeconds,
    );
    this.rampParam(
      context,
      rack.echoTone.frequency,
      clamp(preset.echo.tone ?? 5000, 250, 20000),
      fadeSeconds,
    );
    this.applyEnvironmentSends(context, rack, preset, fadeSeconds);
  }

  private applyEnvironmentSends(
    context: AudioContext,
    rack: AudioDspRack,
    preset: AudioEnvironmentPreset,
    fadeSeconds: number,
  ): void {
    rack.busSends.forEach((sends, bus) => {
      const amount = clamp01(preset.sends[bus] ?? 0);
      const reverbWet = clamp01(preset.reverb.wet);
      const echoWet = clamp01(preset.echo.wet);
      this.rampParam(
        context,
        sends.reverb.gain,
        amount * reverbWet * this.dspVolume,
        fadeSeconds,
      );
      this.rampParam(
        context,
        sends.echo.gain,
        amount * echoWet * this.dspVolume,
        fadeSeconds,
      );
    });
  }

  private createImpulseResponse(
    context: AudioContext,
    settings: AudioEnvironmentReverbSettings,
  ): AudioBuffer {
    const duration = clamp(settings.duration, 0.05, 4);
    const decay = clamp(settings.decay, 0.2, 8);
    const length = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(2, length, context.sampleRate);

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      let seed = channel === 0 ? 0x12345678 : 0x87654321;
      for (let i = 0; i < length; i += 1) {
        seed = (1664525 * seed + 1013904223) >>> 0;
        const noise = (seed / 0xffffffff) * 2 - 1;
        const t = i / length;
        data[i] = noise * (1 - t) ** decay;
      }
    }

    return buffer;
  }

  private rampParam(
    context: AudioContext,
    param: AudioParam,
    target: number,
    seconds: number,
  ): void {
    const now = context.currentTime;
    const duration = Math.max(0, seconds);
    param.cancelScheduledValues(now);
    if (duration === 0) {
      param.value = target;
      return;
    }
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(target, now + duration);
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

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
