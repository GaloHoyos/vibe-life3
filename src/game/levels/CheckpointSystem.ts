import { Box3, Vector3 } from "three";
import type { GameEventBus } from "@game/GameEvents";
import type { VectorTuple } from "@shared/math/VectorTuple";
import { tupleToVector3 } from "@shared/math/VectorTuple";
import type { WeaponId } from "@game/gameplay/weapons/core/WeaponDefinition";
import type { WeaponLoadoutEntry } from "@game/gameplay/weapons/core/WeaponController";

export interface CheckpointDefinition {
  id: string;
  /** Volumen que el jugador cruza para activar el punto de control. */
  position: VectorTuple;
  size: VectorTuple;
  /**
   * Punto de reaparición. Si se omite, se usa `position` (centro del volumen).
   * Conviene fijarlo a un piso despejado para que el jugador no caiga raro.
   */
  respawn?: VectorTuple;
}

/**
 * Estado del jugador capturado al cruzar un checkpoint. Serializable a JSON
 * (va a `sessionStorage` para sobrevivir el reload del respawn).
 */
export interface CheckpointSnapshot {
  position: [number, number, number];
  health: number;
  armor: number;
  weapons: WeaponLoadoutEntry[];
  activeWeaponId: WeaponId | null;
  /** Orientación (yaw, rad) a restaurar. Lo usa la transición de niveles para
   *  conservar hacia dónde mirabas. Opcional: los checkpoints no lo capturan. */
  yaw?: number;
}

interface RuntimeCheckpoint {
  definition: CheckpointDefinition;
  bounds: Box3;
  respawn: Vector3;
  active: boolean;
}

/**
 * Volúmenes invisibles que marcan puntos de control. Espeja `TriggerSystem`:
 * al cruzar uno por primera vez emite `checkpoint.reached` con el punto de
 * reaparición; `Game` captura ahí el snapshot del jugador. Un checkpoint solo
 * dispara una vez por carga de nivel.
 */
export class CheckpointSystem {
  private readonly checkpoints: RuntimeCheckpoint[] = [];

  constructor(private readonly eventBus: GameEventBus) {}

  addCheckpoint(definition: CheckpointDefinition): void {
    const position = tupleToVector3(definition.position);
    const halfSize = tupleToVector3(definition.size).multiplyScalar(0.5);
    this.checkpoints.push({
      definition,
      bounds: new Box3(position.clone().sub(halfSize), position.clone().add(halfSize)),
      respawn: definition.respawn ? tupleToVector3(definition.respawn) : position,
      active: true,
    });
  }

  clear(): void {
    this.checkpoints.length = 0;
  }

  update(playerPosition: Vector3): void {
    this.checkpoints.forEach((checkpoint) => {
      if (!checkpoint.active || !checkpoint.bounds.containsPoint(playerPosition)) {
        return;
      }
      checkpoint.active = false;
      this.eventBus.emit("checkpoint.reached", {
        id: checkpoint.definition.id,
        position: checkpoint.respawn.clone(),
      });
    });
  }
}
