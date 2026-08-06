import { sliderToGain } from "@engine/audio/mix/GainStaging";
import { ReverbRack } from "@engine/audio/dsp/ReverbRack";
import { AudioBus } from "./AudioBus";

export type AudioBusName =
  | "master"
  | "music"
  | "voice"
  | "ambience"
  | "ui"
  | "sfx"
  | "weapons"
  | "vehicles"
  | "enemies"
  | "footsteps"
  | "world";

/**
 * Árbol del mixer. `sfx` es un grupo, no una hoja: agrupa todo lo que produce
 * el mundo para que un solo fader de "efectos" signifique algo. Antes era una
 * hoja plana que usaba un único clip de 215.
 */
const BusParents: Readonly<Record<Exclude<AudioBusName, "master">, AudioBusName>> =
  {
    music: "master",
    voice: "master",
    ambience: "master",
    ui: "master",
    sfx: "master",
    weapons: "sfx",
    enemies: "sfx",
    vehicles: "sfx",
    footsteps: "sfx",
    world: "sfx",
  };

/** Buses hijos en orden de creación: un padre siempre existe antes que su hijo. */
const BusOrder: readonly Exclude<AudioBusName, "master">[] = [
  "music",
  "voice",
  "ambience",
  "ui",
  "sfx",
  "weapons",
  "enemies",
  "vehicles",
  "footsteps",
  "world",
];

/**
 * Posición de cada fader (0..1), no ganancia: `sliderToGain` aplica la curva.
 *
 * Casi todo arranca en la unidad a propósito. La mezcla la definen los
 * objetivos de sonoridad por rol (`MixProfile`); los faders son preferencia
 * del jugador. Los que bajan de 1 son decisiones de mezcla explícitas: música y
 * ambiente ceden lugar a la acción, la interfaz no compite con el mundo, y el
 * master reserva margen para el limiter.
 */
const defaultVolumes: Record<AudioBusName, number> = {
  master: 0.9,
  music: 0.85,
  voice: 1,
  ambience: 0.85,
  ui: 0.8,
  sfx: 1,
  weapons: 1,
  vehicles: 1,
  enemies: 1,
  footsteps: 1,
  world: 1,
};

const storageKey = "hl3.audio.mix.v2";
/** Esquema viejo: ganancia lineal directa, con `dialogue` en vez de `voice`. */
const legacyStorageKey = "hl3.audio.volumes";

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
    voice: 1,
    ambience: 1,
    ui: 1,
    sfx: 1,
    weapons: 1,
    vehicles: 1,
    enemies: 1,
    footsteps: 1,
    world: 1,
  };
  private limiter: DynamicsCompressorNode | null = null;
  private reverbRack: ReverbRack | null = null;
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
    this.reverbRack?.dispose();
    this.reverbRack = null;
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

  /** Retorno de efectos del mixer; lo maneja el sistema de espacios acústicos. */
  getReverbRack(): ReverbRack | null {
    return this.reverbRack;
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

    const muted = bus === "master" && this.muted;
    const target = muted
      ? 0
      : sliderToGain(this.volumes[bus]) * this.duckFactors[bus];

    // El aux sigue al fader para que el wet arrastre los mismos volúmenes.
    this.rampGain(node.gain.gain, target, rampSeconds);
    this.rampGain(node.auxGain.gain, target, rampSeconds);
  }

  private rampGain(param: AudioParam, target: number, rampSeconds: number): void {
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

    // Red de seguridad, no compresor de mezcla: umbral alto y ratio casi
    // brick-wall para que solo actúe en los picos. Un umbral bajo con ratio
    // moderado agacharía música y diálogo en cada tiroteo (pumping).
    const limiter = this.context.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 2;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    limiter.connect(this.context.destination);
    this.limiter = limiter;

    const master = new AudioBus("master", this.context, limiter);
    this.buses.set("master", master);

    // El retorno entra al limiter y no al master: el wet ya arrastró la cadena
    // de faders por el camino aux, aplicarle master otra vez lo duplicaría.
    const rack = new ReverbRack(this.context, limiter);
    master.auxGain.connect(rack.getInput());
    this.reverbRack = rack;

    BusOrder.forEach((name) => {
      const parent = this.buses.get(BusParents[name]);
      this.buses.set(
        name,
        new AudioBus(name, this.context as AudioContext, parent),
      );
    });

    (["master", ...BusOrder] as AudioBusName[]).forEach((name) => {
      this.applyBusGain(name);
    });
  }

  private loadSavedVolumes(): void {
    const raw = window.localStorage.getItem(storageKey);
    if (raw) {
      this.applySavedVolumes(raw, storageKey, (value) => value);
      return;
    }

    const legacy = window.localStorage.getItem(legacyStorageKey);
    if (!legacy) {
      return;
    }

    // El esquema viejo guardaba ganancia lineal; ahora se guarda posición de
    // fader. `sqrt` es la inversa de la curva, así el jugador conserva el
    // volumen que tenía en vez de encontrarse todo más bajo tras el update.
    this.applySavedVolumes(legacy, legacyStorageKey, Math.sqrt);
    window.localStorage.removeItem(legacyStorageKey);
    this.saveVolumes();
  }

  private applySavedVolumes(
    raw: string,
    key: string,
    convert: (value: number) => number,
  ): void {
    try {
      const parsed = JSON.parse(raw) as Partial<Record<string, number>>;
      Object.entries(parsed).forEach(([name, value]) => {
        // El bus de diálogo se fusionó con la voz del traje HEV.
        const bus = (name === "dialogue" ? "voice" : name) as AudioBusName;
        if (typeof value === "number" && bus in this.volumes) {
          this.volumes[bus] = clamp01(convert(value));
        }
      });
    } catch {
      window.localStorage.removeItem(key);
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
