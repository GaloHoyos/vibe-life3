import type { GameEventBus } from "@game/GameEvents";
import type { SoundManager } from "@engine/audio/core/SoundManager";
import { WeaponAudio, type SoundRef } from "@game/config/audio.config";
import { pickSound } from "./SoundPool";

/**
 * Reproduce sonidos de arma reaccionando a eventos del bus.
 *
 * Indexa la tabla declarativa `WeaponAudio` por `weaponName` (display name).
 * Para agregar un arma con sonidos nuevos: declarar el clip en
 * `AudioClipCatalog` y registrar la entrada en `WeaponAudio`.
 */
export class WeaponSoundSystem {
  constructor(
    eventBus: GameEventBus,
    private readonly sounds: SoundManager,
  ) {
    eventBus.on("weapon.fired", ({ weaponName }) =>
      this.playSound(WeaponAudio[weaponName]?.shot),
    );
    eventBus.on("weapon.alternate.fired", ({ weaponName }) =>
      this.playSound(WeaponAudio[weaponName]?.altShot),
    );
    eventBus.on("weapon.reloaded", ({ weaponName }) =>
      this.playSound(WeaponAudio[weaponName]?.reload),
    );
    eventBus.on("weapon.empty", ({ weaponName }) =>
      this.playSound(WeaponAudio[weaponName]?.empty),
    );
    eventBus.on("weapon.cocked", ({ weaponName }) =>
      this.playSound(WeaponAudio[weaponName]?.cock),
    );
    eventBus.on("weapon.hit", ({ weaponName, surfaceKind }) => {
      if (!surfaceKind) {
        return;
      }
      this.playSound(WeaponAudio[weaponName]?.hit?.[surfaceKind]);
    });
  }

  private playSound(soundRef: SoundRef | undefined): void {
    const soundId = pickSound(this.sounds, soundRef);
    if (!soundId) {
      return;
    }
    this.sounds.play(soundId, { bus: "weapons" });
  }
}
