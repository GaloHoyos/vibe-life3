import { Vector3 } from 'three';
import type { RaycastSource } from '@engine/physics/Raycast';

export interface PerceptionTarget {
  id: string;
  position: Vector3;
  isAlive: boolean;
}

export interface PerceptionConfig {
  /** Distancia maxima a la que el NPC puede detectar visualmente. */
  visionRange: number;
  /** Cono de vision en radianes (apertura total: pi = 180 grados). */
  visionConeRadians: number;
  /**
   * Radio en metros dentro del cual se ignora el cono de vision: el NPC
   * "siente" al threat 360 grados (analogo a oirlo cerca). El raycast LOS
   * sigue aplicandose, asi que paredes lo bloquean.
   */
  hearingRadius: number;
  /** Tiempo en segundos que se conserva memoria tras perder LOS. */
  memoryTime: number;
  /**
   * Offset vertical del "ojo" desde el ORIGEN del cuerpo (centro de la cápsula,
   * lo que devuelve `motor.getPosition()`), NO desde los pies. Para un humanoide
   * ~0.62 (igual que `standingEyeHeight` del player); authorearlo como altura
   * desde el piso (~1.6) pone el ojo medio metro sobre la cabeza.
   */
  eyeHeight: number;
}

export interface PerceptionSnapshot {
  visibleNow: boolean;
  hasMemory: boolean;
  memoryAge: number;
  lastKnownPosition: Vector3 | null;
}

const tmpFrom = new Vector3();
const tmpDir = new Vector3();

/**
 * Sistema de percepcion por NPC: chequea LOS contra un target dado el cono
 * de vision y el rango. Mantiene memoria temporal del ultimo lastKnown
 * tras perder LOS para alimentar `LostEnemy` / `Pursue` schedules.
 *
 * Stateless wrt al frame: el caller invoca `update(self, facing, target,
 * delta, raycast)` y recibe un snapshot. La memoria persiste entre frames
 * en `lastKnown` y `memoryAge`.
 */
export class PerceptionSystem {
  private lastKnown: Vector3 | null = null;
  private memoryAge = Infinity;

  /**
   * `selfId`: id del NPC dueño, para que el LOS excluya sus propios colliders
   * (los cuerpos grandes/multi-collider arrancan el ray dentro de si mismos).
   */
  constructor(
    private readonly config: PerceptionConfig,
    private readonly selfId?: string,
  ) {}

  update(
    self: Vector3,
    facing: Vector3,
    target: PerceptionTarget | null,
    delta: number,
    raycast: RaycastSource,
  ): PerceptionSnapshot {
    this.memoryAge += delta;
    if (!target || !target.isAlive) {
      return this.snapshot(false);
    }
    const visible = this.isVisible(self, facing, target, raycast);
    if (visible) {
      if (!this.lastKnown) this.lastKnown = target.position.clone();
      else this.lastKnown.copy(target.position);
      this.memoryAge = 0;
    } else if (this.memoryAge >= this.config.memoryTime) {
      this.lastKnown = null;
    }
    return this.snapshot(visible);
  }

  reset(): void {
    this.lastKnown = null;
    this.memoryAge = Infinity;
  }

  private snapshot(visible: boolean): PerceptionSnapshot {
    return {
      visibleNow: visible,
      hasMemory: this.lastKnown !== null,
      memoryAge: this.memoryAge,
      lastKnownPosition: this.lastKnown ? this.lastKnown.clone() : null,
    };
  }

  private isVisible(
    self: Vector3,
    facing: Vector3,
    targetActor: PerceptionTarget,
    raycast: RaycastSource,
  ): boolean {
    return isTargetVisible(this.config, self, facing, targetActor, raycast, this.selfId);
  }
}

/**
 * Chequeo de vision standalone (rango + cono/oido + LOS fisico), sin memoria.
 * Lo usa `PerceptionSystem` internamente y la seleccion de threat de los NPCs
 * para puntuar candidatos sin instanciar percepcion por candidato.
 */
export function isTargetVisible(
  config: PerceptionConfig,
  self: Vector3,
  facing: Vector3,
  targetActor: PerceptionTarget,
  raycast: RaycastSource,
  /** Id del observador, para excluir sus propios colliders del LOS. */
  selfId?: string,
): boolean {
  const target = targetActor.position;
  const dx = target.x - self.x;
  const dz = target.z - self.z;
  const distSq = dx * dx + dz * dz;
  if (distSq > config.visionRange * config.visionRange) return false;
  const dist = Math.sqrt(distSq);
  if (dist < 1e-3) return true;
  const withinHearing = dist <= config.hearingRadius;
  if (!withinHearing) {
    const halfCos = Math.cos(config.visionConeRadians / 2);
    const facingDot = (facing.x * dx + facing.z * dz) / dist;
    if (facingDot < halfCos) return false;
  }
  tmpFrom.set(self.x, self.y + config.eyeHeight, self.z);
  tmpDir.set(target.x - tmpFrom.x, target.y + 1.0 - tmpFrom.y, target.z - tmpFrom.z);
  const losDist = tmpDir.length();
  if (losDist < 1e-3) return true;
  const hit = raycast.cast(tmpFrom, tmpDir, losDist - 0.1, undefined, selfId);
  if (!hit) return true;
  // El ray puede pegar en la capsula o en un hitbox del propio target (player u
  // otro NPC): eso sigue siendo linea de vision valida (los hitboxes vivos tienen
  // id derivado, asi que comparamos por ownerId). Cualquier otro hit la bloquea.
  return (hit.metadata?.ownerId ?? hit.metadata?.id) === targetActor.id;
}
