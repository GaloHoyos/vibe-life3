import { Vector3 } from "three";
import type { Raycast } from "../physics/Raycast";

export interface PerceptionConfig {
  /** Distancia máxima de visión, en metros. */
  viewDistance: number;
  /** Ángulo total del cono de visión (radianes). Default ~120°. */
  viewConeRadians: number;
  /** Radio de audición — alertas que vengan de adentro despiertan al NPC. */
  hearingRadius: number;
  /** Cuánto tiempo (s) mantiene memoria de la última posición vista del target. */
  memoryDuration: number;
  /** Offset del raycast desde la base del NPC (ojos). */
  eyeHeight: number;
}

export interface PerceptionTarget {
  /** ID del physics body / NPC al que pertenece este target. */
  id: string;
  position: Vector3;
}

export interface PerceptionResult {
  /** El target está visible AHORA (LOS clara + dentro del cono + dentro de rango). */
  visible: boolean;
  /** El NPC tiene memoria reciente de dónde lo vio por última vez. */
  hasMemory: boolean;
  /** Última posición conocida (válida si `hasMemory` o `visible`). */
  lastKnownPosition: Vector3 | null;
  /** Edad de la memoria, en segundos. 0 si visible ahora. */
  memoryAge: number;
}

/**
 * Componente de percepción por NPC.
 *
 * Tracking de un único target principal (el threat actual). En cada
 * `sense()`, evalúa LOS + cono + distancia y refresca la memoria. Si
 * pierde visión, conserva la última posición conocida hasta que el
 * `memoryDuration` se cumpla.
 *
 * Independiente del FSM — la AI decide qué hacer con esta información.
 */
export class Perception {
  private readonly lastKnown = new Vector3();
  private hasMemory = false;
  private memoryAge = 0;
  private visibleNow = false;

  constructor(
    private readonly config: PerceptionConfig,
    private readonly raycast: Raycast,
  ) {}

  /**
   * Evalúa visibilidad del target desde la posición del NPC mirando
   * en `forward`. Actualiza memoria internamente.
   *
   * @param targetId - ID esperado del collider hit (para validar LOS clara).
   */
  sense(
    delta: number,
    npcPosition: Vector3,
    npcForward: Vector3,
    target: PerceptionTarget,
  ): PerceptionResult {
    this.memoryAge += delta;

    const fromEyes = npcPosition.clone();
    fromEyes.y += this.config.eyeHeight;
    const toTarget = target.position.clone().sub(fromEyes);
    const distance = toTarget.length();

    let visible = false;
    if (distance <= this.config.viewDistance && distance > 0.05) {
      const direction = toTarget.clone().divideScalar(distance);
      const facingDot = direction.clone().setY(0).normalize().dot(
        npcForward.clone().setY(0).normalize(),
      );
      const minCosCone = Math.cos(this.config.viewConeRadians / 2);
      if (facingDot >= minCosCone) {
        const hit = this.raycast.cast(fromEyes, direction, distance + 0.3);
        if (hit && hit.metadata?.id === target.id) {
          visible = true;
        }
      }
    }

    if (visible) {
      this.lastKnown.copy(target.position);
      this.hasMemory = true;
      this.memoryAge = 0;
    } else if (this.hasMemory && this.memoryAge > this.config.memoryDuration) {
      this.hasMemory = false;
    }

    this.visibleNow = visible;
    return {
      visible,
      hasMemory: this.hasMemory,
      lastKnownPosition: this.hasMemory || visible ? this.lastKnown.clone() : null,
      memoryAge: this.memoryAge,
    };
  }

  /** Alerta externa (disparo cercano, otro NPC gritó "ahí está"). */
  notifyAlert(position: Vector3): void {
    this.lastKnown.copy(position);
    this.hasMemory = true;
    this.memoryAge = 0;
  }

  isVisibleNow(): boolean {
    return this.visibleNow;
  }

  hasRecentMemory(): boolean {
    return this.hasMemory;
  }

  getLastKnown(): Vector3 | null {
    return this.hasMemory ? this.lastKnown.clone() : null;
  }

  clearMemory(): void {
    this.hasMemory = false;
    this.memoryAge = Infinity;
    this.visibleNow = false;
  }
}
