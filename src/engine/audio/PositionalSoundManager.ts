import { AudioListener, Object3D, PositionalAudio, Vector3 } from "three";
import type { AudioSystem } from "./AudioSystem";
import type { SoundManager } from "./SoundManager";

export interface PositionalAudioOptions {
  refDistance?: number;
  maxDistance?: number;
  rolloffFactor?: number;
  volume?: number;
  loop?: boolean;
}

interface AttachedSound {
  audio: PositionalAudio;
  object: Object3D;
}

export class PositionalSoundManager {
  private readonly listener: AudioListener;
  private readonly attached = new Map<Object3D, AttachedSound[]>();

  constructor(
    private readonly audioSystem: AudioSystem,
    private readonly sounds: SoundManager,
    private readonly scene: Object3D,
    camera: Object3D,
  ) {
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
    audio.play();

    onReady(audio);
  }
}
