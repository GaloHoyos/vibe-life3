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
  private readonly tmpFromEyes = new Vector3();
  private readonly tmpToTarget = new Vector3();
  private readonly tmpDirection = new Vector3();
  private readonly tmpDirHoriz = new Vector3();
  private readonly tmpFwdHoriz = new Vector3();
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

    this.tmpFromEyes.copy(npcPosition);
    this.tmpFromEyes.y += this.config.eyeHeight;
    this.tmpToTarget.copy(target.position).sub(this.tmpFromEyes);
    const distance = this.tmpToTarget.length();

    let visible = false;
    if (distance <= this.config.viewDistance && distance > 0.05) {
      this.tmpDirection.copy(this.tmpToTarget).divideScalar(distance);
      this.tmpDirHoriz.copy(this.tmpDirection);
      this.tmpDirHoriz.y = 0;
      this.tmpDirHoriz.normalize();
      this.tmpFwdHoriz.copy(npcForward);
      this.tmpFwdHoriz.y = 0;
      this.tmpFwdHoriz.normalize();
      const facingDot = this.tmpDirHoriz.dot(this.tmpFwdHoriz);
      const minCosCone = Math.cos(this.config.viewConeRadians / 2);
      if (facingDot >= minCosCone) {
        const hit = this.raycast.cast(
          this.tmpFromEyes,
          this.tmpDirection,
          distance + 0.3,
        );
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

  /**
   * Avanza el envejecimiento de la memoria sin evaluar LOS. Útil cuando el NPC
   * dejó de tener un target (perdió pickThreat) pero querés seguir respetando
   * `memoryDuration` para que pueda investigar el último lugar conocido.
   */
  tickMemory(delta: number): void {
    this.memoryAge += delta;
    if (this.hasMemory && this.memoryAge > this.config.memoryDuration) {
      this.hasMemory = false;
    }
    this.visibleNow = false;
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
