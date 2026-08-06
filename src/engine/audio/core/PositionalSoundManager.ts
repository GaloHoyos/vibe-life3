import type { Object3D, Vector3 } from "three";
import type {
  SpatialAudioSystem,
  SpatialPlayOptions,
} from "@engine/audio/spatial/SpatialAudioSystem";

/**
 * Fachada estable sobre `SpatialAudioSystem`. Los sistemas de juego siguen
 * pidiendo "reproducí este clip acá" sin saber cómo está armado el grafo de
 * audio, y el reemplazo de `THREE.PositionalAudio` no tocó ni un call site.
 */

export type PositionalAudioOptions = SpatialPlayOptions;

export interface ControllablePositionalSound {
  setVolume(value: number): void;
  setPlaybackRate(value: number): void;
  setLowpassFrequency(value: number): void;
  isReady(): boolean;
  dispose(): void;
}

export class PositionalSoundManager {
  constructor(private readonly spatial: SpatialAudioSystem) {}

  playAt(
    soundId: string,
    position: Vector3,
    options: PositionalAudioOptions = {},
  ): void {
    this.spatial.playAt(soundId, position, options);
  }

  /**
   * One-shot posicional que **sigue** a un objeto en movimiento (a diferencia
   * de `playAt`, que fija un punto). Ideal para sonidos de NPCs que se mueven
   * mientras suenan, como el disparo del gunship en pleno vuelo.
   */
  playFollowing(
    soundId: string,
    object: Object3D,
    options: PositionalAudioOptions = {},
  ): void {
    this.spatial.playFollowing(soundId, object, options);
  }

  attachToObject(
    soundId: string,
    object: Object3D,
    options: PositionalAudioOptions = {},
  ): void {
    this.spatial.attachToObject(soundId, object, options);
  }

  /**
   * Loop posicional con parámetros vivos. Motores, rotores y maquinaria
   * actualizan gain/pitch/filtro sin recrear la voz por frame.
   */
  attachControllable(
    soundId: string,
    object: Object3D,
    options: PositionalAudioOptions = {},
  ): ControllablePositionalSound {
    return this.spatial.attachControllable(soundId, object, options);
  }

  /** Frena y suelta todas las voces espaciales (recarga de nivel). */
  clear(): void {
    this.spatial.clear();
  }

  stopAttached(object: Object3D): void {
    this.spatial.stopAttached(object);
  }
}
