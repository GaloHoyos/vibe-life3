import { Vector3 } from "three";
import type { PositionalSoundManager } from "@engine/audio/core/PositionalSoundManager";
import type { SoundManager } from "@engine/audio/core/SoundManager";
import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import {
  MaterialImpacts,
  SurfaceImpactMaterial,
  type ImpactMaterial,
} from "@game/config/audio.config";
import { pickSound } from "./SoundPool";

/**
 * El mundo físico suena cuando choca. Un bidón que cae de una pasarela, una
 * caja empujada contra la pared, todo lo que la gravity gun manda a volar: sin
 * esto la física es muda y el juego se siente hueco.
 *
 * Detecta el choque por frenada: un cuerpo que venía rápido y perdió de golpe
 * la mayor parte de su velocidad acaba de pegar contra algo. Es una heurística,
 * pero no depende de opt-in por collider (los `CONTACT_FORCE_EVENTS` de Rapier
 * ya los consume el sistema de vehículos, y su cola es de un solo lector).
 */
export class PropCollisionSoundSystem {
  /** Velocidad del frame anterior por cuerpo, para medir la frenada. */
  private readonly lastSpeed = new Map<number, number>();
  private readonly cooldowns = new Map<number, number>();
  private readonly tmpPosition = new Vector3();

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly sounds: SoundManager,
    private readonly positional: PositionalSoundManager,
  ) {}

  update(elapsed: number): void {
    // Sólo lecturas dentro del forEach: tocar el set de cuerpos acá corrompe
    // el iterador WASM de Rapier.
    this.physics.world.bodies.forEach((body) => {
      const handle = body.handle;
      if (!body.isDynamic() || !body.isEnabled()) {
        this.lastSpeed.delete(handle);
        return;
      }
      // Un prop sostenido frena contra el jugador todo el tiempo.
      if (this.physics.isHeldBody(handle)) {
        this.lastSpeed.set(handle, 0);
        return;
      }

      const velocity = body.linvel();
      const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
      const previous = this.lastSpeed.get(handle) ?? speed;
      this.lastSpeed.set(handle, speed);

      const deceleration = previous - speed;
      if (
        previous < CollisionTuning.minSpeed ||
        deceleration < previous * CollisionTuning.stopRatio
      ) {
        return;
      }

      const until = this.cooldowns.get(handle);
      if (until !== undefined && elapsed < until) {
        return;
      }

      const collider = body.numColliders() > 0 ? body.collider(0) : null;
      const metadata = collider
        ? this.physics.getColliderMetadata(collider)
        : undefined;
      if (metadata?.kind !== "dynamic") {
        return;
      }

      const material: ImpactMaterial = metadata.surface
        ? SurfaceImpactMaterial[metadata.surface]
        : "metal";
      const map = MaterialImpacts[material];
      const soundId = pickSound(
        this.sounds,
        previous >= CollisionTuning.hardSpeed ? map.hard : map.soft,
      );
      if (!soundId) {
        return;
      }

      this.cooldowns.set(handle, elapsed + CollisionTuning.cooldown);
      const translation = body.translation();
      this.tmpPosition.set(translation.x, translation.y, translation.z);
      this.positional.playAt(soundId, this.tmpPosition.clone(), {
        bus: "world",
        // Un golpe fuerte se oye de lejos; uno flojo, apenas.
        volume: Math.min(1, 0.35 + previous / CollisionTuning.fullVolumeSpeed),
        refDistance: 3,
        maxDistance: 45,
        rolloffFactor: 1.2,
        playbackRate: 0.9 + Math.random() * 0.2,
      });
    });
  }

  /** Transición de nivel: los handles del mundo viejo dejan de valer. */
  clear(): void {
    this.lastSpeed.clear();
    this.cooldowns.clear();
  }
}

const CollisionTuning = {
  /** Por debajo de esto el prop se está acomodando, no chocando. */
  minSpeed: 2.2,
  /** Fracción de la velocidad que hay que perder en un frame para ser choque. */
  stopRatio: 0.45,
  /** Sobre esta velocidad el golpe usa la variante fuerte. */
  hardSpeed: 7,
  /** Velocidad a la que el golpe ya suena a volumen pleno. */
  fullVolumeSpeed: 14,
  /** Silencio por cuerpo tras un golpe: evita el zumbido del que rueda. */
  cooldown: 0.16,
} as const;
