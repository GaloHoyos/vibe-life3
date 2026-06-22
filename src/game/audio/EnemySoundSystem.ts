import type { GameEventBus } from "@game/GameEvents";
import type { SoundManager } from "@engine/audio/core/SoundManager";
import { EnemyAudio } from "@game/config/audio.config";

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
  }

  private playSound(soundId: string | undefined): void {
    if (!soundId || !this.sounds.hasSound(soundId)) {
      return;
    }
    this.sounds.play(soundId, { bus: "enemies" });
  }
}
