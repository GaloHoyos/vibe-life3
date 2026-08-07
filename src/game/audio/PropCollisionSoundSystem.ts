import type { PositionalSoundManager } from "@engine/audio/core/PositionalSoundManager";
import type { SoundManager } from "@engine/audio/core/SoundManager";
import {
  MaterialImpacts,
  SurfaceImpactMaterial,
  type ImpactMaterial,
} from "@game/config/audio.config";
import type { PropContactMonitor } from "@game/gameplay/props/PropContactMonitor";
import { pickSound } from "./SoundPool";

/**
 * El mundo físico suena cuando choca. Un bidón que cae de una pasarela, una
 * caja empujada contra la pared, todo lo que la gravity gun manda a volar: sin
 * esto la física es muda y el juego se siente hueco.
 *
 * La detección del choque no vive acá: la publica `PropContactMonitor`, que es
 * el mismo que alimenta el daño por impacto. Este sistema sólo elige el clip
 * según el material del prop y la energía del golpe.
 */
export class PropCollisionSoundSystem {
  constructor(
    private readonly contacts: PropContactMonitor,
    private readonly sounds: SoundManager,
    private readonly positional: PositionalSoundManager,
  ) {}

  update(): void {
    for (const contact of this.contacts.contacts()) {
      const material: ImpactMaterial = contact.metadata.surface
        ? SurfaceImpactMaterial[contact.metadata.surface]
        : "metal";
      const map = MaterialImpacts[material];
      const soundId = pickSound(
        this.sounds,
        contact.speed >= CollisionTuning.hardSpeed ? map.hard : map.soft,
      );
      if (!soundId) continue;

      this.positional.playAt(soundId, contact.position.clone(), {
        bus: "world",
        // Un golpe fuerte se oye de lejos; uno flojo, apenas.
        volume: Math.min(1, 0.35 + contact.speed / CollisionTuning.fullVolumeSpeed),
        refDistance: 3,
        maxDistance: 45,
        rolloffFactor: 1.2,
        playbackRate: 0.9 + Math.random() * 0.2,
      });
    }
  }
}

const CollisionTuning = {
  /** Sobre esta velocidad el golpe usa la variante fuerte. */
  hardSpeed: 7,
  /** Velocidad a la que el golpe ya suena a volumen pleno. */
  fullVolumeSpeed: 14,
} as const;
