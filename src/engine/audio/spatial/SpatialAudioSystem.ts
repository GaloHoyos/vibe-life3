import { Matrix4, Object3D, Quaternion, Vector3 } from "three";
import type { AudioBusName, AudioSystem } from "@engine/audio/core/AudioSystem";
import type { SoundManager } from "@engine/audio/core/SoundManager";
import { resolveClipGain } from "@engine/audio/mix/GainStaging";
import { RoleReverbSend } from "@engine/audio/mix/MixProfile";
import type { RaycastSource } from "@engine/physics/Raycast";
import { OcclusionScheduler, sampleOcclusion } from "./Occlusion";
import { SpatialVoice, type SpatialVoiceOptions } from "./SpatialVoice";

/**
 * Registro de todas las voces espaciales vivas y su tick.
 *
 * Reemplaza a `THREE.PositionalAudio`, que fuerza `panningModel = 'HRTF'` (un
 * convolver por disparo) y obliga a colgar cada voz del scene graph. Acá el
 * grafo de audio es propio, las voces son rastreables —`clear()` frena
 * absolutamente todo— y el listener se maneja a mano en vez de depender de que
 * el renderer actualice la matriz de la cámara.
 */

export interface SpatialPlayOptions {
  refDistance?: number;
  maxDistance?: number;
  rolloffFactor?: number;
  /** Multiplicador sobre la ganancia normalizada del clip. */
  volume?: number;
  loop?: boolean;
  playbackRate?: number;
  lowpassFrequency?: number;
  panningModel?: PanningModelType;
  /** Bus del mixer. Default: el del clip. */
  bus?: AudioBusName;
  /**
   * Id de física del propio emisor. Los NPCs grandes son multi-collider (el
   * strider tiene cápsula raíz + 11 seguidores): sin esto el rayo de oclusión
   * choca contra el cuerpo que emite y todo suena tapado.
   */
  excludeId?: string;
  /** Envío al retorno de reverb (0..1). Default: el del rol del clip. */
  reverbSend?: number;
}

export interface SpatialSoundHandle {
  setVolume(value: number): void;
  setPlaybackRate(value: number): void;
  setLowpassFrequency(value: number): void;
  isReady(): boolean;
  dispose(): void;
}

/**
 * Acoplamiento de una posición con el espacio del oyente, 0..1: 1 = mismo
 * recinto, ~0.35 a través de un vano abierto, ~0 del otro lado de un muro.
 */
export type WetResolver = (position: Vector3) => number;

type VoiceAnchor =
  | { readonly kind: "static"; readonly position: Vector3 }
  | { readonly kind: "object"; readonly object: Object3D };

interface LiveVoice {
  readonly voice: SpatialVoice;
  readonly anchor: VoiceAnchor;
  readonly loop: boolean;
  readonly startedAt: number;
  /** Envío base al retorno, según el rol del clip. */
  readonly reverbSend: number;
  /** Ignora el propio emisor al sondear oclusión (NPCs multi-collider). */
  readonly excludeId: string | undefined;
  readonly maxDistance: number;
  disposed: boolean;
}

/** Tope de voces espaciales simultáneas. */
const MaxVoices = 48;
/** Sondeos de oclusión por frame, repartidos en round-robin entre las voces. */
const ProbesPerFrame = 3;
/** Constante de suavizado del listener: sin esto cada frame es un salto. */
const ListenerSmoothing = 0.01;

const listenerPosition = new Vector3();
const listenerQuaternion = new Quaternion();
const listenerScale = new Vector3();
const listenerForward = new Vector3();
const listenerUp = new Vector3();
const voicePosition = new Vector3();

export class SpatialAudioSystem {
  private readonly voices: LiveVoice[] = [];
  private readonly byObject = new Map<Object3D, LiveVoice[]>();
  private readonly attachGeneration = new WeakMap<Object3D, number>();
  private readonly scheduler = new OcclusionScheduler(ProbesPerFrame);
  private raycast: RaycastSource | null = null;
  private wetResolver: WetResolver | null = null;
  private epoch = 0;

  constructor(
    private readonly audioSystem: AudioSystem,
    private readonly sounds: SoundManager,
    private readonly camera: Object3D,
  ) {}

  /** Sin raycast el sistema funciona igual, pero sin oclusión. */
  setRaycast(raycast: RaycastSource | null): void {
    this.raycast = raycast;
  }

  /** Lo instala el sistema de espacios acústicos; sin él las voces van secas. */
  setWetResolver(resolver: WetResolver | null): void {
    this.wetResolver = resolver;
  }

  playAt(
    soundId: string,
    position: Vector3,
    options: SpatialPlayOptions = {},
  ): void {
    void this.spawn(soundId, { kind: "static", position: position.clone() }, options);
  }

  /** One-shot que sigue a un objeto en movimiento (disparo de un NPC en marcha). */
  playFollowing(
    soundId: string,
    object: Object3D,
    options: SpatialPlayOptions = {},
  ): void {
    void this.spawn(soundId, { kind: "object", object }, options);
  }

  attachToObject(
    soundId: string,
    object: Object3D,
    options: SpatialPlayOptions = {},
  ): void {
    void this.spawn(soundId, { kind: "object", object }, options);
  }

  /** Loop con parámetros vivos: motores, rotores, maquinaria. */
  attachControllable(
    soundId: string,
    object: Object3D,
    options: SpatialPlayOptions = {},
  ): SpatialSoundHandle {
    let live: LiveVoice | null = null;
    let volume = options.volume ?? 1;
    // El caller modula `volume` por telemetría; la nivelación del clip es un
    // factor aparte que multiplica esa modulación.
    let clipGain = 1;
    let playbackRate = options.playbackRate ?? 1;
    let lowpassFrequency = options.lowpassFrequency;
    let disposed = false;

    void this.spawn(
      soundId,
      { kind: "object", object },
      { ...options, loop: options.loop ?? true },
      (spawned, gain) => {
        if (disposed) {
          return false;
        }
        live = spawned;
        clipGain = gain;
        spawned.voice.setGain(clipGain * volume);
        spawned.voice.setPlaybackRate(playbackRate);
        if (lowpassFrequency !== undefined) {
          spawned.voice.setLowpassFrequency(lowpassFrequency);
        }
        return true;
      },
    );

    return {
      setVolume: (value) => {
        volume = Math.max(0, value);
        live?.voice.setGain(clipGain * volume);
      },
      setPlaybackRate: (value) => {
        playbackRate = value;
        live?.voice.setPlaybackRate(value);
      },
      setLowpassFrequency: (value) => {
        lowpassFrequency = value;
        live?.voice.setLowpassFrequency(value);
      },
      isReady: () => live !== null,
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        if (live) {
          this.release(live);
        }
      },
    };
  }

  /** Frena y suelta todo, incluidas las voces sin objeto (recarga de nivel). */
  clear(): void {
    this.epoch += 1;
    this.voices.slice().forEach((live) => this.release(live));
    this.voices.length = 0;
    this.byObject.clear();
    this.scheduler.reset();
  }

  stopAttached(object: Object3D): void {
    this.attachGeneration.set(
      object,
      (this.attachGeneration.get(object) ?? 0) + 1,
    );
    const entries = this.byObject.get(object);
    if (!entries) {
      return;
    }
    entries.slice().forEach((live) => this.release(live));
    this.byObject.delete(object);
  }

  update(): void {
    const context = this.audioSystem.getContext();
    if (!context) {
      return;
    }

    this.updateListener(context);
    if (this.voices.length === 0) {
      return;
    }

    for (let i = this.voices.length - 1; i >= 0; i -= 1) {
      const live = this.voices[i];
      if (!live || live.disposed) {
        continue;
      }
      this.resolvePosition(live, voicePosition);
      live.voice.setPosition(voicePosition);
      live.voice.setWet(live.reverbSend * this.coupling(voicePosition));
    }

    this.probeOcclusion();
  }

  dispose(): void {
    this.clear();
  }

  private probeOcclusion(): void {
    const raycast = this.raycast;
    if (!raycast) {
      return;
    }

    for (const index of this.scheduler.next(this.voices.length)) {
      const live = this.voices[index];
      if (!live || live.disposed) {
        continue;
      }
      this.resolvePosition(live, voicePosition);
      // Fuera del alcance del panner el sonido ya es inaudible: sondearlo
      // gastaría rayos que le hacen falta a lo que sí se escucha.
      if (listenerPosition.distanceTo(voicePosition) > live.maxDistance) {
        continue;
      }
      live.voice.applyOcclusion(
        sampleOcclusion(raycast, listenerPosition, voicePosition, live.excludeId),
      );
    }
  }

  private updateListener(context: AudioContext | null): void {
    if (!context) {
      return;
    }

    // Se actualiza la matriz acá y no se espera al renderer: hoy el listener
    // funciona de casualidad porque la cámara no tiene padre, y se congelaría
    // en silencio si alguien la colgara de un rig de vehículo.
    this.camera.updateMatrixWorld();
    decomposeListener(this.camera.matrixWorld);

    const listener = context.listener;
    const now = context.currentTime;

    if (listener.positionX) {
      setSmoothed(listener.positionX, listenerPosition.x, now);
      setSmoothed(listener.positionY, listenerPosition.y, now);
      setSmoothed(listener.positionZ, listenerPosition.z, now);
      setSmoothed(listener.forwardX, listenerForward.x, now);
      setSmoothed(listener.forwardY, listenerForward.y, now);
      setSmoothed(listener.forwardZ, listenerForward.z, now);
      setSmoothed(listener.upX, listenerUp.x, now);
      setSmoothed(listener.upY, listenerUp.y, now);
      setSmoothed(listener.upZ, listenerUp.z, now);
      return;
    }

    listener.setPosition(
      listenerPosition.x,
      listenerPosition.y,
      listenerPosition.z,
    );
    listener.setOrientation(
      listenerForward.x,
      listenerForward.y,
      listenerForward.z,
      listenerUp.x,
      listenerUp.y,
      listenerUp.z,
    );
  }

  private async spawn(
    soundId: string,
    anchor: VoiceAnchor,
    options: SpatialPlayOptions,
    onReady?: (live: LiveVoice, clipGain: number) => boolean,
  ): Promise<void> {
    const epoch = this.epoch;
    const generation =
      anchor.kind === "object"
        ? (this.attachGeneration.get(anchor.object) ?? 0)
        : 0;

    this.audioSystem.unlock();
    const clip = this.sounds.getClip(soundId);
    if (!clip) {
      return;
    }
    const buffer = await this.sounds.getBuffer(soundId);
    const context = this.audioSystem.getContext();
    if (!buffer || !context || epoch !== this.epoch) {
      return;
    }
    // El objeto pudo destruirse mientras cargaba el buffer: sin este chequeo
    // arrancaría un loop huérfano imposible de frenar.
    if (
      anchor.kind === "object" &&
      (this.attachGeneration.get(anchor.object) ?? 0) !== generation
    ) {
      return;
    }

    const bus = this.audioSystem.getBus(options.bus ?? clip.bus);
    if (!bus) {
      return;
    }

    const loop = options.loop ?? false;
    if (!this.makeRoom(loop)) {
      return;
    }

    const clipGain = resolveClipGain(clip, options.volume ?? 1);
    const voiceOptions: SpatialVoiceOptions = {
      refDistance: options.refDistance,
      maxDistance: options.maxDistance,
      rolloffFactor: options.rolloffFactor,
      gain: clipGain,
      loop,
      playbackRate: options.playbackRate,
      lowpassFrequency: options.lowpassFrequency,
      panningModel: options.panningModel,
    };

    const voice = new SpatialVoice(context, buffer, bus, voiceOptions);
    const live: LiveVoice = {
      voice,
      anchor,
      loop,
      startedAt: context.currentTime,
      reverbSend: options.reverbSend ?? RoleReverbSend[clip.role],
      excludeId: options.excludeId,
      maxDistance: options.maxDistance ?? 12,
      disposed: false,
    };

    if (onReady && !onReady(live, clipGain)) {
      voice.dispose();
      return;
    }

    this.resolvePosition(live, voicePosition);
    voice.setPosition(voicePosition);
    voice.setWet(live.reverbSend * this.coupling(voicePosition));

    this.voices.push(live);
    if (anchor.kind === "object") {
      const entries = this.byObject.get(anchor.object) ?? [];
      entries.push(live);
      this.byObject.set(anchor.object, entries);
    }

    voice.onEnded(() => this.release(live));
    voice.start();
  }

  /** Roba la voz one-shot más vieja si hace falta lugar. Los loops no se roban. */
  private makeRoom(loop: boolean): boolean {
    if (this.voices.length < MaxVoices) {
      return true;
    }

    let oldest: LiveVoice | null = null;
    for (const live of this.voices) {
      if (live.loop || live.disposed) {
        continue;
      }
      if (!oldest || live.startedAt < oldest.startedAt) {
        oldest = live;
      }
    }

    if (!oldest) {
      return loop;
    }
    this.release(oldest);
    return true;
  }

  /** Sin proveedor de espacios todo comparte el mismo recinto: acople pleno. */
  private coupling(position: Vector3): number {
    return this.wetResolver ? this.wetResolver(position) : 1;
  }

  private resolvePosition(live: LiveVoice, target: Vector3): void {
    if (live.anchor.kind === "static") {
      target.copy(live.anchor.position);
      return;
    }
    target.setFromMatrixPosition(live.anchor.object.matrixWorld);
  }

  private release(live: LiveVoice): void {
    if (live.disposed) {
      return;
    }
    live.disposed = true;
    live.voice.dispose();

    const index = this.voices.indexOf(live);
    if (index >= 0) {
      this.voices.splice(index, 1);
    }

    if (live.anchor.kind !== "object") {
      return;
    }
    const entries = this.byObject.get(live.anchor.object);
    if (!entries) {
      return;
    }
    const remaining = entries.filter((entry) => entry !== live);
    if (remaining.length > 0) {
      this.byObject.set(live.anchor.object, remaining);
    } else {
      this.byObject.delete(live.anchor.object);
    }
  }
}

function decomposeListener(matrix: Matrix4): void {
  matrix.decompose(listenerPosition, listenerQuaternion, listenerScale);
  listenerForward.set(0, 0, -1).applyQuaternion(listenerQuaternion);
  listenerUp.set(0, 1, 0).applyQuaternion(listenerQuaternion);
}

function setSmoothed(param: AudioParam, value: number, now: number): void {
  if (param.setTargetAtTime) {
    param.setTargetAtTime(value, now, ListenerSmoothing);
  } else {
    param.value = value;
  }
}
