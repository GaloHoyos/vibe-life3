import { Vector3 } from "three";
import type { PositionalSoundManager } from "@engine/audio/core/PositionalSoundManager";
import type { SoundManager } from "@engine/audio/core/SoundManager";
import type { MaterialKey } from "@engine/render/material/Materials";
import type { GameEventBus } from "@game/GameEvents";
import {
  DoorAudio,
  DoorAudioConfig,
  type DoorSoundKind,
} from "@game/config/audio.config";
import { materialToSurface } from "@game/levels/materialSurface";
import type { DoorDefinition } from "@game/levels/LevelDefinition";
import { tupleToVector3 } from "@shared/math/VectorTuple";
import type { Disposable } from "@shared/types/lifecycle";
import { pickSound } from "./SoundPool";

interface DoorVoice {
  readonly kind: DoorSoundKind;
  readonly position: Vector3;
}

/**
 * Las puertas suenan en dos tiempos, como en HL2: el batiente arranca a
 * moverse y, cuando termina el recorrido, el marco cierra la frase. Ese
 * segundo golpe es lo que hace que una puerta se sienta pesada en vez de
 * teletransportarse.
 *
 * El material y el tamaño del `DoorDefinition` eligen el juego de sonidos, así
 * que un portón de chapa y una puerta de madera no comparten voz sin que el
 * autor del nivel tenga que declarar nada.
 */
export class DoorSoundSystem implements Disposable {
  private readonly doors = new Map<string, DoorVoice>();
  private readonly pendingStops = new Set<ReturnType<typeof setTimeout>>();
  private readonly unsubscribe: () => void;

  constructor(
    eventBus: GameEventBus,
    private readonly sounds: SoundManager,
    private readonly positional: PositionalSoundManager,
  ) {
    this.unsubscribe = eventBus.on("door.opened", ({ id }) => {
      this.playTransition(id);
    });
  }

  load(definitions: readonly DoorDefinition[]): void {
    this.clear();
    for (const definition of definitions) {
      this.doors.set(definition.id, {
        kind: doorSoundKind(definition.material, definition.size),
        position: tupleToVector3(definition.position),
      });
    }
  }

  clear(): void {
    this.pendingStops.forEach((timer) => clearTimeout(timer));
    this.pendingStops.clear();
    this.doors.clear();
  }

  dispose(): void {
    this.unsubscribe();
    this.clear();
  }

  private playTransition(id: string): void {
    const door = this.doors.get(id);
    if (!door) {
      return;
    }
    const map = DoorAudio[door.kind];
    this.playAt(pickSound(this.sounds, map.move), door.position);

    const timer = setTimeout(() => {
      this.pendingStops.delete(timer);
      this.playAt(pickSound(this.sounds, map.stop), door.position);
    }, DoorAudioConfig.stopDelay * 1000);
    this.pendingStops.add(timer);
  }

  private playAt(soundId: string | null, position: Vector3): void {
    if (!soundId) {
      return;
    }
    this.positional.playAt(soundId, position.clone(), {
      bus: "world",
      refDistance: DoorAudioConfig.radius * 0.15,
      maxDistance: DoorAudioConfig.radius,
      rolloffFactor: 1.1,
    });
  }
}

/**
 * Un batiente grande es un portón aunque comparta material con una puerta, y
 * la reja suena a reja aunque el motor sea el mismo.
 */
function doorSoundKind(
  material: MaterialKey,
  size: readonly [number, number, number],
): DoorSoundKind {
  const largest = Math.max(size[0], size[1], size[2]);
  const surface = materialToSurface(material);
  if (surface === "wood") {
    return "wood";
  }
  if (material === "hazard") {
    return "gate";
  }
  if (largest >= DoorAudioConfig.heavySize) {
    return largest >= DoorAudioConfig.heavySize * 1.6 ? "garage" : "metalHeavy";
  }
  return "metal";
}
