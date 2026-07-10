import { Vector3 } from 'three';
import type { RaycastSource } from '@engine/physics/Raycast';

export interface PerceptionTarget {
  id: string;
  position: Vector3;
  isAlive: boolean;
}

/**
 * Deteccion no-binaria opt-in (estilo TLoU/Splinter Cell): en vez de ver
 * instantaneamente, un acumulador 0..1 crece mientras el target este a la
 * vista, mas rapido cuanto mas cerca (instantaneo a quemarropa) y mas rapido
 * en alerta. Da al jugador una ventana para reaccionar/esconderse antes de
 * la deteccion plena.
 */
export interface PerceptionDetectionConfig {
  /** Tiempo (s) hasta deteccion plena en el borde del rango de vision. */
  baseTime: number;
  /** A esta distancia o menos la deteccion es instantanea (quemarropa). */
  instantRange: number;
  /** Umbral 0..1 del acumulador que enciende `suspicious` (el NPC gira/mira). */
  suspicionThreshold: number;
  /** Decaimiento del acumulador (unidades/s) mientras no haya vision cruda. */
  decayRate: number;
  /** Multiplicador de acumulacion en alerta (combate/memoria/daño reciente). */
  alertMultiplier: number;
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
  /** Sin esto, la vision es binaria e instantanea (comportamiento legacy). */
  detection?: PerceptionDetectionConfig;
}

export interface PerceptionSnapshot {
  visibleNow: boolean;
  hasMemory: boolean;
  memoryAge: number;
  lastKnownPosition: Vector3 | null;
  /** Progreso 0..1 del acumulador de deteccion. Sin `detection` es 0 | 1. */
  awareness: number;
  /** El acumulador paso el umbral de sospecha sin llegar a deteccion plena. */
  suspicious: boolean;
  /** Donde se vio al target mientras se acumulaba sospecha. */
  suspectedPosition: Vector3 | null;
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
  private awareness = 0;
  private suspected: Vector3 | null = null;
  private alert = false;

  /**
   * `selfId`: id del NPC dueño, para que el LOS excluya sus propios colliders
   * (los cuerpos grandes/multi-collider arrancan el ray dentro de si mismos).
   */
  constructor(
    private readonly config: PerceptionConfig,
    private readonly selfId?: string,
  ) {}

  /**
   * El caller marca cuando el NPC esta "caliente" (oyo combate, tiene memoria
   * del threat o recibio daño): la acumulacion corre `alertMultiplier` veces
   * mas rapido. Sin `detection` no tiene efecto.
   */
  setAlert(alert: boolean): void {
    this.alert = alert;
  }

  update(
    self: Vector3,
    facing: Vector3,
    target: PerceptionTarget | null,
    delta: number,
    raycast: RaycastSource,
  ): PerceptionSnapshot {
    this.memoryAge += delta;
    if (!target || !target.isAlive) {
      this.decayAwareness(delta);
      return this.snapshot(false);
    }
    const rawVisible = this.isVisible(self, facing, target, raycast);
    const detection = this.config.detection;
    let visible = rawVisible;
    if (detection) {
      if (rawVisible) {
        this.accumulate(self, target.position, delta, detection);
      } else {
        this.decayAwareness(delta);
      }
      visible = rawVisible && this.awareness >= 1;
    } else {
      this.awareness = rawVisible ? 1 : 0;
    }
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
    this.awareness = 0;
    this.suspected = null;
  }

  private accumulate(
    self: Vector3,
    targetPosition: Vector3,
    delta: number,
    detection: PerceptionDetectionConfig,
  ): void {
    const dx = targetPosition.x - self.x;
    const dz = targetPosition.z - self.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const span = Math.max(0.001, this.config.visionRange - detection.instantRange);
    const frac = Math.min(1, Math.max(0, (dist - detection.instantRange) / span));
    const time = detection.baseTime * frac;
    if (time <= 0.001) {
      this.awareness = 1;
    } else {
      const rate = (this.alert ? detection.alertMultiplier : 1) / time;
      this.awareness = Math.min(1, this.awareness + delta * rate);
    }
    if (this.awareness >= detection.suspicionThreshold) {
      if (!this.suspected) this.suspected = targetPosition.clone();
      else this.suspected.copy(targetPosition);
    }
  }

  private decayAwareness(delta: number): void {
    const detection = this.config.detection;
    if (!detection) {
      this.awareness = 0;
      this.suspected = null;
      return;
    }
    this.awareness = Math.max(0, this.awareness - detection.decayRate * delta);
    if (this.awareness < detection.suspicionThreshold) {
      this.suspected = null;
    }
  }

  private snapshot(visible: boolean): PerceptionSnapshot {
    const detection = this.config.detection;
    const suspicious =
      !!detection && !visible && this.awareness >= detection.suspicionThreshold;
    return {
      visibleNow: visible,
      hasMemory: this.lastKnown !== null,
      memoryAge: this.memoryAge,
      lastKnownPosition: this.lastKnown ? this.lastKnown.clone() : null,
      awareness: this.awareness,
      suspicious,
      suspectedPosition: suspicious && this.suspected ? this.suspected.clone() : null,
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
 * Chequeo de vision standalone (rango + cono/oido + LOS fisico), sin memoria
 * ni acumulador. Lo usa `PerceptionSystem` internamente y la seleccion de
 * threat de los NPCs para puntuar candidatos sin instanciar percepcion por
 * candidato.
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
