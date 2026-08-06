import type { SoundManager } from "@engine/audio/core/SoundManager";
import type { GameEventBus } from "@game/GameEvents";
import {
  PlayerAudio,
  PlayerDamageVoice,
  PlayerHazardAudio,
  PlayerVoiceConfig,
} from "@game/config/audio.config";
import type { Disposable } from "@shared/types/lifecycle";
import { pickSound } from "./SoundPool";

/**
 * Gordon tiene cuerpo. El traje diagnostica (`HevSuitSoundSystem`), pero el
 * que se queja al recibir un golpe, se quema y se ahoga es él — y a vida
 * crítica se le escucha el corazón, como en Half-Life.
 *
 * El quejido no acompaña cada bala: por debajo de `minDamage` calla, y tiene
 * una ventana de no-repetición para no convertirse en una ametralladora de
 * gruñidos bajo fuego sostenido.
 */
export class PlayerSoundSystem implements Disposable {
  private readonly disposers: Array<() => void> = [];
  private lastVoiceAt = Number.NEGATIVE_INFINITY;
  private healthPercent = 100;
  private alive = true;
  private nextHeartbeatAt = 0;
  private elapsed = 0;

  constructor(
    eventBus: GameEventBus,
    private readonly sounds: SoundManager,
  ) {
    this.disposers.push(
      eventBus.on("player.health.changed", ({ current, max }) => {
        this.healthPercent = max > 0 ? (current / max) * 100 : 0;
        this.alive = current > 0;
      }),
      eventBus.on("player.damaged", ({ amount, damageType }) => {
        if (amount < PlayerVoiceConfig.minDamage) {
          return;
        }
        this.speak(
          damageType ? PlayerDamageVoice[damageType] ?? PlayerAudio.pain : PlayerAudio.pain,
        );
      }),
      eventBus.on("player.hazard", ({ kind, amount }) => {
        this.playWorld(PlayerHazardAudio[kind]);
        if (kind === "fire") {
          this.speak(PlayerAudio.burn);
        }
        // El vacío no quema ni electrocuta: mata. Sólo el grito de caída.
        if (kind === "void" && amount > 0) {
          this.speak(PlayerAudio.fall);
        }
      }),
      eventBus.on("player.dead", () => {
        this.alive = false;
      }),
    );
  }

  update(delta: number): void {
    this.elapsed += delta;
    if (!this.alive || this.healthPercent > PlayerVoiceConfig.heartbeatHealthPercent) {
      return;
    }
    if (this.elapsed < this.nextHeartbeatAt) {
      return;
    }
    this.nextHeartbeatAt = this.elapsed + PlayerVoiceConfig.heartbeatSeconds;
    const soundId = pickSound(this.sounds, PlayerAudio.heartbeat);
    if (soundId) {
      this.sounds.play(soundId, { bus: "voice" });
    }
  }

  private speak(ref: readonly string[] | string | undefined): void {
    if (this.elapsed - this.lastVoiceAt < PlayerVoiceConfig.repeatSeconds) {
      return;
    }
    const soundId = pickSound(this.sounds, ref);
    if (!soundId) {
      return;
    }
    this.lastVoiceAt = this.elapsed;
    this.sounds.play(soundId, { bus: "voice", detune: (Math.random() * 2 - 1) * 90 });
  }

  private playWorld(ref: readonly string[] | string | undefined): void {
    const soundId = pickSound(this.sounds, ref);
    if (soundId) {
      this.sounds.play(soundId, { bus: "world" });
    }
  }

  dispose(): void {
    this.disposers.forEach((dispose) => dispose());
    this.disposers.length = 0;
  }
}
