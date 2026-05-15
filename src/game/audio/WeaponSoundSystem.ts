import type { GameEventBus } from "../GameEvents";
import type { SoundManager } from "../../engine/audio/SoundManager";
import { WeaponAudio } from "../config/audio.config";

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
    eventBus.on("weapon.reloaded", ({ weaponName }) =>
      this.playSound(WeaponAudio[weaponName]?.reload),
    );
    eventBus.on("weapon.empty", ({ weaponName }) =>
      this.playSound(WeaponAudio[weaponName]?.empty),
    );
    eventBus.on("weapon.hit", ({ weaponName, surfaceKind }) => {
      if (!surfaceKind) {
        return;
      }
      this.playSound(WeaponAudio[weaponName]?.hit?.[surfaceKind]);
    });
  }

  private playSound(soundId: string | undefined): void {
    if (!soundId || !this.sounds.hasSound(soundId)) {
      return;
    }
    this.sounds.play(soundId, { bus: "weapons" });
  }
}
