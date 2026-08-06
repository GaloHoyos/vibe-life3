import { Vector3 } from "three";
import type { PositionalSoundManager } from "@engine/audio/core/PositionalSoundManager";
import type { SoundManager } from "@engine/audio/core/SoundManager";
import type { GameEventBus } from "@game/GameEvents";
import {
  CarryAudio,
  ImpactAudioConfig,
  MaterialImpacts,
  RicochetSounds,
  SurfaceBulletImpacts,
  SurfaceImpactMaterial,
  WeaponAudio,
  type ImpactMaterial,
} from "@game/config/audio.config";
import type { SurfaceType } from "@shared/types/Surface";
import type { Disposable } from "@shared/types/lifecycle";
import { pickSound } from "./SoundPool";

/**
 * El material devuelve el golpe. Una bala contra chapa no suena como contra
 * hormigón, y eso —no el fogonazo— es lo que le dice al jugador contra qué
 * está disparando y si le está pegando a algo vivo.
 *
 * El arma tiene la última palabra: si `WeaponAudio[...].hit` declara un sonido
 * para esa superficie (la ballesta que clava, la palanca que revienta carne),
 * lo reproduce `WeaponSoundSystem` y acá no se agrega nada encima.
 */
export class ImpactSoundSystem implements Disposable {
  private readonly disposers: Array<() => void> = [];

  constructor(
    eventBus: GameEventBus,
    private readonly sounds: SoundManager,
    private readonly positional: PositionalSoundManager,
  ) {
    this.disposers.push(
      eventBus.on("weapon.hit", ({ weaponName, surfaceKind, surface, point, normal }) => {
        if (surfaceKind && WeaponAudio[weaponName]?.hit?.[surfaceKind]) {
          return;
        }
        const material = materialFor(surfaceKind, surface);
        this.playImpact(SurfaceBulletImpacts[material], point);
        this.playRicochet(material, point, normal);
      }),
      // Un prop lanzado contra alguien: lo que suena es el cuerpo, no el prop.
      eventBus.on("prop.impact", ({ point, damage }) => {
        const map = MaterialImpacts.flesh;
        this.playImpact(damage >= 20 ? map.hard : map.soft, point);
      }),
      eventBus.on("carry.grabbed", () => this.play2d(CarryAudio.grab)),
      eventBus.on("carry.dropped", ({ reason }) => {
        // Soltar a propósito suena; que se caiga por distancia o por cruzar un
        // portal ya tiene su propio feedback y no merece otro golpe.
        if (reason === "manual" || reason === "weapon") {
          this.play2d(CarryAudio.drop);
        }
      }),
      eventBus.on("carry.pushed", () => this.play2d(CarryAudio.push)),
    );
  }

  private playImpact(ref: readonly string[], point: Vector3): void {
    const soundId = pickSound(this.sounds, ref);
    if (!soundId) {
      return;
    }
    this.positional.playAt(soundId, point.clone(), {
      bus: "world",
      refDistance: 3,
      maxDistance: 40,
      rolloffFactor: 1.2,
      // Dos balas contra la misma pared no son la misma grabación.
      volume: 0.85 + Math.random() * 0.3,
      playbackRate: 0.9 + Math.random() * 0.2,
    });
  }

  /**
   * El rebote sale despedido de la superficie, así que nace un poco por delante
   * del punto de impacto: es el sonido que se aleja, no el del golpe.
   */
  private playRicochet(
    material: ImpactMaterial,
    point: Vector3,
    normal: Vector3 | undefined,
  ): void {
    if (!HARD_MATERIALS.has(material)) {
      return;
    }
    if (Math.random() > ImpactAudioConfig.ricochetChance) {
      return;
    }
    const soundId = pickSound(this.sounds, RicochetSounds);
    if (!soundId) {
      return;
    }
    const origin = point.clone();
    if (normal) {
      origin.addScaledVector(normal, 0.6);
    }
    this.positional.playAt(soundId, origin, {
      bus: "weapons",
      refDistance: 2,
      maxDistance: ImpactAudioConfig.ricochetMaxDistance,
      rolloffFactor: 1.4,
      playbackRate: 0.85 + Math.random() * 0.35,
    });
  }

  private play2d(ref: readonly string[] | string): void {
    const soundId = pickSound(this.sounds, ref);
    if (soundId) {
      this.sounds.play(soundId, { bus: "world", volumeJitter: 0.12 });
    }
  }

  dispose(): void {
    this.disposers.forEach((dispose) => dispose());
    this.disposers.length = 0;
  }
}

/** Sólo lo rígido devuelve un rebote; la carne y la madera se lo tragan. */
const HARD_MATERIALS: ReadonlySet<ImpactMaterial> = new Set<ImpactMaterial>([
  "concrete",
  "metal",
  "tile",
]);

/**
 * Qué material acústico corresponde al blanco. Los actores mandan sobre la
 * geometría: un combine parado sobre hormigón sigue siendo carne blindada.
 */
function materialFor(
  kind: string | undefined,
  surface: SurfaceType | undefined,
): ImpactMaterial {
  switch (kind) {
    case "npc":
    case "player":
    case "ragdoll":
      return "flesh";
    case "weaponPickup":
      return "metal";
    case "door":
      return "metal";
    default:
      return surface ? SurfaceImpactMaterial[surface] : "concrete";
  }
}
