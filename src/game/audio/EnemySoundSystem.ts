import type { GameEventBus } from "@game/GameEvents";
import type { SoundManager } from "@engine/audio/core/SoundManager";
import { EnemyAudio, type SoundRef } from "@game/config/audio.config";

/**
 * Reproduce vocalizaciones / impacto de NPCs reaccionando a eventos del bus.
 *
 * Indexa la tabla declarativa `EnemyAudio` por `characterId` (presente
 * en el payload de los eventos `npc.*`). Para agregar una familia nueva
 * de enemigos: declarar los clips en `AudioClipCatalog` y una entrada
 * en `EnemyAudio` con su `CharacterId`.
 */
export class EnemySoundSystem {
  constructor(
    eventBus: GameEventBus,
    private readonly sounds: SoundManager,
  ) {
    eventBus.on("npc.alert", ({ characterId }) =>
      this.playSound(EnemyAudio[characterId]?.alert),
    );
    eventBus.on("npc.attack", ({ characterId }) =>
      this.playSound(EnemyAudio[characterId]?.attack),
    );
    eventBus.on("npc.damaged", ({ characterId }) =>
      this.playSound(EnemyAudio[characterId]?.damaged),
    );
    eventBus.on("npc.killed", ({ characterId }) =>
      this.playSound(EnemyAudio[characterId]?.killed),
    );
    eventBus.on("npc.footstep", ({ characterId }) =>
      this.playSound(EnemyAudio[characterId]?.footstep),
    );
  }

  private playSound(soundRef: SoundRef | undefined): void {
    const soundId = this.pickAvailable(soundRef);
    if (!soundId) {
      return;
    }
    this.sounds.play(soundId, { bus: "enemies" });
  }

  private pickAvailable(soundRef: SoundRef | undefined): string | null {
    if (!soundRef) {
      return null;
    }
    const candidates = typeof soundRef === "string" ? [soundRef] : soundRef;
    const available = candidates.filter((soundId) => this.sounds.hasSound(soundId));
    if (available.length === 0) {
      return null;
    }
    return available[Math.floor(Math.random() * available.length)] ?? null;
  }
}
