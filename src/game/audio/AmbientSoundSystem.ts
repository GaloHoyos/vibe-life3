import { Object3D, Vector3 } from "three";
import type { PositionalSoundManager } from "@engine/audio/core/PositionalSoundManager";
import type { SoundManager } from "@engine/audio/core/SoundManager";
import { tupleToVector3 } from "@shared/math/VectorTuple";
import type { VectorTuple } from "@shared/math/VectorTuple";

/**
 * Fuentes de sonido ancladas a un punto del mundo (`ambient_generic`): el
 * generador de la esquina, la radio del refugio, la gotera del túnel.
 *
 * Suenan como cualquier otra voz espacial —se atenúan con la distancia, las
 * tapa la geometría, arrastran la reverb del recinto— así que el jugador puede
 * caminar hacia ellas y ubicarlas. Se prenden y apagan por entity I/O.
 */

export interface AmbientSoundDefinition {
  readonly id: string;
  readonly sound: string;
  readonly position: VectorTuple;
  readonly radius?: number;
  readonly loop?: boolean;
  readonly startDisabled?: boolean;
}

const DefaultRadius = 24;
/** Fracción del radio donde el sonido todavía está a volumen pleno. */
const RefDistanceRatio = 0.12;

interface AmbientEmitter {
  readonly definition: AmbientSoundDefinition;
  /** Ancla en el mundo: las voces espaciales siguen a un `Object3D`. */
  readonly anchor: Object3D;
  playing: boolean;
}

export class AmbientSoundSystem {
  private readonly emitters = new Map<string, AmbientEmitter>();

  constructor(
    private readonly sounds: SoundManager,
    private readonly positional: PositionalSoundManager,
  ) {}

  load(definitions: readonly AmbientSoundDefinition[]): void {
    this.clear();
    for (const definition of definitions) {
      if (!this.sounds.hasSound(definition.sound)) {
        console.warn(
          `[AmbientSoundSystem] '${definition.id}' referencia un clip inexistente: ${definition.sound}`,
        );
        continue;
      }
      const anchor = new Object3D();
      anchor.position.copy(tupleToVector3(definition.position));
      // Las voces leen `matrixWorld`, y el ancla no está en la escena.
      anchor.updateMatrixWorld();
      const emitter: AmbientEmitter = { definition, anchor, playing: false };
      this.emitters.set(definition.id, emitter);
      if (!definition.startDisabled) {
        this.start(emitter);
      }
    }
  }

  play(id: string): void {
    const emitter = this.emitters.get(id);
    if (emitter) {
      this.start(emitter);
    }
  }

  stop(id: string): void {
    const emitter = this.emitters.get(id);
    if (!emitter || !emitter.playing) {
      return;
    }
    emitter.playing = false;
    this.positional.stopAttached(emitter.anchor);
  }

  toggle(id: string): void {
    const emitter = this.emitters.get(id);
    if (!emitter) {
      return;
    }
    if (emitter.playing) {
      this.stop(id);
    } else {
      this.start(emitter);
    }
  }

  positionOf(id: string): Vector3 | null {
    const emitter = this.emitters.get(id);
    return emitter ? emitter.anchor.position.clone() : null;
  }

  clear(): void {
    this.emitters.forEach((emitter) => {
      if (emitter.playing) {
        this.positional.stopAttached(emitter.anchor);
      }
    });
    this.emitters.clear();
  }

  private start(emitter: AmbientEmitter): void {
    if (emitter.playing) {
      return;
    }
    emitter.playing = true;
    const radius = emitter.definition.radius ?? DefaultRadius;
    this.positional.attachToObject(emitter.definition.sound, emitter.anchor, {
      loop: emitter.definition.loop ?? true,
      refDistance: Math.max(0.5, radius * RefDistanceRatio),
      maxDistance: radius,
    });
  }
}
