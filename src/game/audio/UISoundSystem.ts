import type { GameEventBus } from "@game/GameEvents";
import type { SoundManager } from "@engine/audio/core/SoundManager";
import {
  PickupAudio,
  UiAudio,
  WeaponSelectorAudio,
  type SoundRef,
} from "@game/config/audio.config";
import type { Disposable } from "@shared/types/lifecycle";
import { firstSound } from "./SoundPool";

/**
 * Interfaz y recogidas. Cada pickup suena a lo que es —el chasquido del
 * cargador, la batería del traje, el botiquín— en vez de compartir un único
 * "ding"; y el selector de armas usa los cuatro sonidos originales del HUD de
 * HL2, que dependen de si el jugador confirma, cancela o le niegan el arma.
 */
export class UISoundSystem implements Disposable {
  private readonly disposers: Array<() => void> = [];

  constructor(
    eventBus: GameEventBus,
    private readonly sounds: SoundManager,
  ) {
    this.disposers.push(
      eventBus.on("player.pickup.health", () => this.play(PickupAudio.health)),
      eventBus.on("player.pickup.armor", () => this.play(PickupAudio.armor)),
      eventBus.on("player.pickup.ammo", () => this.play(PickupAudio.ammo)),
      eventBus.on("player.pickup.weapon", () => this.play(PickupAudio.weapon)),
      eventBus.on("weapon.selector.opened", () => this.play(WeaponSelectorAudio.open)),
      eventBus.on("weapon.selector.cycled", () => this.play(WeaponSelectorAudio.cycle)),
      eventBus.on("weapon.selector.closed", ({ committed }) =>
        this.play(
          committed ? WeaponSelectorAudio.confirm : WeaponSelectorAudio.cancel,
        ),
      ),
      eventBus.on("ui.sound", ({ cue }) => this.play(UiAudio[cue])),
    );
  }

  private play(ref: SoundRef): void {
    const soundId = firstSound(this.sounds, ref);
    if (soundId) {
      this.sounds.play(soundId, { bus: "ui" });
    }
  }

  dispose(): void {
    this.disposers.forEach((dispose) => dispose());
    this.disposers.length = 0;
  }
}
