import {
  AudioContext as ThreeAudioContext,
  AudioListener,
  Object3D,
  PositionalAudio,
  Vector3,
} from "three";
import type { AudioBusName, AudioSystem } from "./AudioSystem";
import type { SoundManager } from "./SoundManager";

export interface PositionalAudioOptions {
  refDistance?: number;
  maxDistance?: number;
  rolloffFactor?: number;
  volume?: number;
  loop?: boolean;
  /** Bus del mixer al que rutear la salida (respeta volúmenes de usuario). Default `sfx`. */
  bus?: AudioBusName;
}

interface AttachedSound {
  audio: PositionalAudio;
  object: Object3D;
}

/**
 * Reproduce clips como `PositionalAudio` de Three.js, atachados a un
 * `Object3D` para que la atenuación / dirección sigan al objeto en el
 * mundo. Mantiene un mapa por objeto para poder limpiar al destruir.
 */
export class PositionalSoundManager {
  private listener: AudioListener | null = null;
  private readonly attached = new Map<Object3D, AttachedSound[]>();
  /**
   * `attachToObject` es async (espera el buffer): si `stopAttached` llega
   * durante la carga, un loop huérfano arrancaría sobre un objeto ya sacado
   * de escena y no habría forma de frenarlo. La generación por objeto (y el
   * epoch global para `clear`) invalidan esos attaches en vuelo.
   */
  private readonly attachGeneration = new WeakMap<Object3D, number>();
  private epoch = 0;

  constructor(
    private readonly audioSystem: AudioSystem,
    private readonly sounds: SoundManager,
    private readonly scene: Object3D,
    private readonly camera: Object3D,
  ) {}

  playAt(
    soundId: string,
    position: Vector3,
    options: PositionalAudioOptions = {},
  ): void {
    void this.spawnAudio(soundId, options, (audio) => {
      const anchor = new Object3D();
      anchor.position.copy(position);
      anchor.add(audio);
      this.scene.add(anchor);
      audio.onEnded = () => {
        anchor.remove(audio);
        anchor.removeFromParent();
      };
      return true;
    });
  }

  /**
   * One-shot posicional que **sigue** a un objeto en movimiento (a diferencia
   * de `playAt`, que fija un ancla estático). Se auto-desacopla al terminar.
   * Ideal para sonidos de NPCs que se mueven mientras suenan (e.g. el disparo
   * del gunship en pleno vuelo).
   */
  playFollowing(
    soundId: string,
    object: Object3D,
    options: PositionalAudioOptions = {},
  ): void {
    void this.spawnAudio(soundId, options, (audio) => {
      object.add(audio);
      audio.onEnded = () => {
        object.remove(audio);
      };
      return true;
    });
  }

  attachToObject(
    soundId: string,
    object: Object3D,
    options: PositionalAudioOptions = {},
  ): void {
    const generation = this.attachGeneration.get(object) ?? 0;
    void this.spawnAudio(soundId, options, (audio) => {
      if ((this.attachGeneration.get(object) ?? 0) !== generation) {
        return false;
      }
      object.add(audio);
      if (!this.attached.has(object)) {
        this.attached.set(object, []);
      }
      this.attached.get(object)?.push({ audio, object });
      return true;
    });
  }

  /** Frena y desacopla todos los sonidos atachados (recarga de nivel in-place). */
  clear(): void {
    this.epoch += 1;
    this.attached.forEach((entries) => {
      entries.forEach((entry) => {
        entry.audio.stop();
        entry.object.remove(entry.audio);
      });
    });
    this.attached.clear();
  }

  stopAttached(object: Object3D): void {
    this.attachGeneration.set(
      object,
      (this.attachGeneration.get(object) ?? 0) + 1,
    );
    const entries = this.attached.get(object);
    if (!entries) {
      return;
    }

    entries.forEach((entry) => {
      entry.audio.stop();
      entry.object.remove(entry.audio);
    });
    this.attached.delete(object);
  }

  /** `onReady` decide si el sonido sigue vigente; si devuelve false no suena. */
  private async spawnAudio(
    soundId: string,
    options: PositionalAudioOptions,
    onReady: (audio: PositionalAudio) => boolean,
  ): Promise<void> {
    const epoch = this.epoch;
    this.audioSystem.unlock();
    const buffer = await this.sounds.getBuffer(soundId);
    if (!buffer || epoch !== this.epoch) {
      return;
    }

    const listener = this.ensureListener();
    if (!listener) {
      return;
    }

    const audio = new PositionalAudio(listener);
    audio.setBuffer(buffer);
    audio.setLoop(options.loop ?? false);
    audio.setRefDistance(options.refDistance ?? 1.2);
    audio.setMaxDistance(options.maxDistance ?? 12);
    audio.setRolloffFactor(options.rolloffFactor ?? 1.2);
    audio.setVolume(options.volume ?? 1);
    this.routeToBus(audio, options.bus ?? "sfx");
    if (!onReady(audio)) {
      return;
    }
    audio.play();
  }

  private ensureListener(): AudioListener | null {
    if (this.listener) {
      return this.listener;
    }

    // `AudioListener` pide el singleton de Three en su constructor. Crearlo
    // durante el bootstrap construiría un segundo AudioContext fuera de un
    // gesto; por eso se instancia recién cuando AudioSystem ya fue desbloqueado.
    const context = this.audioSystem.getContext();
    if (!context) {
      return null;
    }
    ThreeAudioContext.setContext(context);
    this.listener = new AudioListener();
    this.camera.add(this.listener);
    return this.listener;
  }

  /**
   * Rerutea la salida del `PositionalAudio` al gain del bus del mixer en vez
   * de al listener → destino. Se reconecta desde `audio.gain` (no desde el
   * panner que devuelve `getOutput()`): así la cadena queda
   * `source → panner → gain → bus.gain`, la espacialización la sigue haciendo
   * el `PannerNode`, `setVolume` (que escribe en `gain`) mantiene efecto, y el
   * volumen pasa por el bus (respeta el slider del usuario).
   */
  private routeToBus(audio: PositionalAudio, busName: AudioBusName): void {
    const bus = this.audioSystem.getBus(busName);
    if (!bus) {
      return;
    }
    audio.gain.disconnect();
    audio.gain.connect(bus.gain);
  }
}
