import { Vector3 } from "three";
import type { Raycast } from "@engine/physics/Raycast";

export interface PerceptionConfig {
  /** Distancia mÃ¡xima de visiÃ³n, en metros. */
  viewDistance: number;
  /** Ãngulo total del cono de visiÃ³n (radianes). Default ~120Â°. */
  viewConeRadians: number;
  /** Radio de audiciÃ³n â€” alertas que vengan de adentro despiertan al NPC. */
  hearingRadius: number;
  /** CuÃ¡nto tiempo (s) mantiene memoria de la Ãºltima posiciÃ³n vista del target. */
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
  /** El target estÃ¡ visible AHORA (LOS clara + dentro del cono + dentro de rango). */
  visible: boolean;
  /** El NPC tiene memoria reciente de dÃ³nde lo vio por Ãºltima vez. */
  hasMemory: boolean;
  /** Ãšltima posiciÃ³n conocida (vÃ¡lida si `hasMemory` o `visible`). */
  lastKnownPosition: Vector3 | null;
  /** Edad de la memoria, en segundos. 0 si visible ahora. */
  memoryAge: number;
}

/**
 * Componente de percepciÃ³n por NPC.
 *
 * Tracking de un Ãºnico target principal (el threat actual). En cada
 * `sense()`, evalÃºa LOS + cono + distancia y refresca la memoria. Si
 * pierde visiÃ³n, conserva la Ãºltima posiciÃ³n conocida hasta que el
 * `memoryDuration` se cumpla.
 *
 * Independiente del FSM â€” la AI decide quÃ© hacer con esta informaciÃ³n.
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
   * EvalÃºa visibilidad del target desde la posiciÃ³n del NPC mirando
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
    this.advance(delta);
    const visible = this.canSee(npcPosition, npcForward, target);

    if (visible) {
      this.lastKnown.copy(target.position);
      this.hasMemory = true;
      this.memoryAge = 0;
    }

    this.visibleNow = visible;
    return {
      visible,
      hasMemory: this.hasMemory,
      lastKnownPosition: this.hasMemory || visible ? this.lastKnown.clone() : null,
      memoryAge: this.memoryAge,
    };
  }

  canSee(
    npcPosition: Vector3,
    npcForward: Vector3,
    target: PerceptionTarget,
  ): boolean {
    this.tmpFromEyes.copy(npcPosition);
    this.tmpFromEyes.y += this.config.eyeHeight;
    this.tmpToTarget.copy(target.position).sub(this.tmpFromEyes);
    const distance = this.tmpToTarget.length();

    if (distance > this.config.viewDistance || distance <= 0.05) {
      return false;
    }

    this.tmpDirection.copy(this.tmpToTarget).divideScalar(distance);
    this.tmpDirHoriz.copy(this.tmpDirection);
    this.tmpDirHoriz.y = 0;
    this.tmpDirHoriz.normalize();
    this.tmpFwdHoriz.copy(npcForward);
    this.tmpFwdHoriz.y = 0;
    this.tmpFwdHoriz.normalize();
    const facingDot = this.tmpDirHoriz.dot(this.tmpFwdHoriz);
    const minCosCone = Math.cos(this.config.viewConeRadians / 2);
    if (facingDot < minCosCone) {
      return false;
    }

    const hit = this.raycast.cast(
      this.tmpFromEyes,
      this.tmpDirection,
      distance + 0.3,
    );
    return hit?.metadata?.id === target.id;
  }

  advance(delta: number): void {
    this.memoryAge += delta;
    if (this.hasMemory && this.memoryAge > this.config.memoryDuration) {
      this.hasMemory = false;
      this.visibleNow = false;
    }
  }

  /** Alerta externa (disparo cercano, otro NPC gritÃ³ "ahÃ­ estÃ¡"). */
  notifyAlert(position: Vector3): void {
    this.lastKnown.copy(position);
    this.hasMemory = true;
    this.memoryAge = 0;
  }

  /**
   * Avanza el envejecimiento de la memoria sin evaluar LOS. Ãštil cuando el NPC
   * dejÃ³ de tener un target (perdiÃ³ pickThreat) pero querÃ©s seguir respetando
   * `memoryDuration` para que pueda investigar el Ãºltimo lugar conocido.
   */
  tickMemory(delta: number): void {
    this.advance(delta);
    this.visibleNow = false;
  }

  isVisibleNow(): boolean {
    return this.visibleNow;
  }

  hasRecentMemory(): boolean {
    return this.hasMemory;
  }

  getMemoryAge(): number {
    return this.memoryAge;
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
