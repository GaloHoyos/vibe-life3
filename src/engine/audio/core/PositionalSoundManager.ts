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
  private readonly listener: AudioListener;
  private readonly attached = new Map<Object3D, AttachedSound[]>();

  constructor(
    private readonly audioSystem: AudioSystem,
    private readonly sounds: SoundManager,
    private readonly scene: Object3D,
    camera: Object3D,
  ) {
    // El `AudioListener` de Three usa su `AudioContext` singleton; forzarlo al
    // mismo contexto que los buses del mixer para poder conectar el panner al
    // bus.gain (conectar nodos entre contextos distintos lanza DOMException).
    const context = this.audioSystem.getContext();
    if (context) {
      ThreeAudioContext.setContext(context);
    }
    this.listener = new AudioListener();
    camera.add(this.listener);
  }

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
    });
  }

  attachToObject(
    soundId: string,
    object: Object3D,
    options: PositionalAudioOptions = {},
  ): void {
    void this.spawnAudio(soundId, options, (audio) => {
      object.add(audio);
      if (!this.attached.has(object)) {
        this.attached.set(object, []);
      }
      this.attached.get(object)?.push({ audio, object });
    });
  }

  /** Frena y desacopla todos los sonidos atachados (recarga de nivel in-place). */
  clear(): void {
    this.attached.forEach((entries) => {
      entries.forEach((entry) => {
        entry.audio.stop();
        entry.object.remove(entry.audio);
      });
    });
    this.attached.clear();
  }

  stopAttached(object: Object3D): void {
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

  private async spawnAudio(
    soundId: string,
    options: PositionalAudioOptions,
    onReady: (audio: PositionalAudio) => void,
  ): Promise<void> {
    this.audioSystem.unlock();
    const buffer = await this.sounds.getBuffer(soundId);
    if (!buffer) {
      return;
    }

    const audio = new PositionalAudio(this.listener);
    audio.setBuffer(buffer);
    audio.setLoop(options.loop ?? false);
    audio.setRefDistance(options.refDistance ?? 1.2);
    audio.setMaxDistance(options.maxDistance ?? 12);
    audio.setRolloffFactor(options.rolloffFactor ?? 1.2);
    audio.setVolume(options.volume ?? 1);
    this.routeToBus(audio, options.bus ?? "sfx");
    audio.play();

    onReady(audio);
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
