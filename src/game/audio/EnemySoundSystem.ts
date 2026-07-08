import type { Object3D, Vector3 } from "three";
import type { GameEventBus } from "@game/GameEvents";
import type { CharacterId } from "@engine/characters/CharacterDefinition";
import type { SoundManager } from "@engine/audio/core/SoundManager";
import type { PositionalSoundManager } from "@engine/audio/core/PositionalSoundManager";
import { EnemyAudio, type SoundRef } from "@game/config/audio.config";

/**
 * Reproduce vocalizaciones / impacto de NPCs reaccionando a eventos del bus.
 *
 * Indexa la tabla declarativa `EnemyAudio` por `characterId` (presente
 * en el payload de los eventos `npc.*`). Si el NPC está registrado como actor
 * (`registerActor`), el sonido se reproduce **siguiendo su mesh** en 3D — así
 * un enemigo en movimiento (gunship, manhack) no deja el sonido clavado donde
 * empezó. Si no, cae al ancla estático (`position`) o a 2D. Los voladores con
 * `flightLoop` reciben además un loop de motor atado al mesh mientras viven.
 */
export class EnemySoundSystem {
  private readonly targets = new Map<string, Object3D>();

  constructor(
    eventBus: GameEventBus,
    private readonly sounds: SoundManager,
    private readonly positional: PositionalSoundManager,
  ) {
    eventBus.on("npc.alert", ({ id, characterId, position }) =>
      this.playSound(EnemyAudio[characterId]?.alert, position, id),
    );
    eventBus.on("npc.attack", ({ id, characterId, position }) =>
      this.playSound(EnemyAudio[characterId]?.attack, position, id),
    );
    eventBus.on("npc.charge", ({ id, characterId, position }) =>
      this.playSound(EnemyAudio[characterId]?.charge, position, id),
    );
    eventBus.on("npc.damaged", ({ id, characterId, point }) =>
      this.playSound(EnemyAudio[characterId]?.damaged, point, id),
    );
    eventBus.on("npc.killed", ({ id, characterId, position }) => {
      this.playSound(EnemyAudio[characterId]?.killed, position, id);
      this.unregisterActor(id);
    });
    eventBus.on("npc.footstep", ({ id, characterId, position }) =>
      this.playSound(EnemyAudio[characterId]?.footstep, position, id),
    );
  }

  /**
   * Registra el mesh del NPC como fuente 3D para que sus vocalizaciones lo
   * sigan. Si su familia tiene `flightLoop`, ata el loop de motor al mesh.
   */
  registerActor(id: string, object: Object3D, characterId: CharacterId): void {
    this.targets.set(id, object);
    const loop = EnemyAudio[characterId]?.flightLoop;
    if (loop && this.sounds.hasSound(loop)) {
      this.positional.attachToObject(loop, object, {
        bus: "enemies",
        loop: true,
        refDistance: 6,
        maxDistance: 60,
        rolloffFactor: 1,
      });
    }
  }

  /** Frena el loop de motor y deja de seguir al NPC (muerte / despawn). */
  unregisterActor(id: string): void {
    const object = this.targets.get(id);
    if (object) {
      this.positional.stopAttached(object);
      this.targets.delete(id);
    }
  }

  /** Limpia todos los actores (teardown de nivel; el positional ya frena loops). */
  clearActors(): void {
    this.targets.clear();
  }

  private playSound(
    soundRef: SoundRef | undefined,
    position?: Vector3,
    id?: string,
  ): void {
    const soundId = this.pickAvailable(soundRef);
    if (!soundId) {
      return;
    }
    const target = id ? this.targets.get(id) : undefined;
    if (target) {
      this.positional.playFollowing(soundId, target, {
        bus: "enemies",
        refDistance: 4,
        maxDistance: 45,
        rolloffFactor: 1.1,
      });
      return;
    }
    if (position) {
      this.positional.playAt(soundId, position.clone(), {
        bus: "enemies",
        refDistance: 4,
        maxDistance: 45,
        rolloffFactor: 1.1,
      });
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
