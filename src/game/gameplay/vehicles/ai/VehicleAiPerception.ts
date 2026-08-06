import { Vector3 } from 'three';
import {
  isTargetVisible,
  PerceptionSystem,
  type PerceptionConfig,
  type PerceptionTarget,
} from '@engine/ai/perception/PerceptionSystem';
import type { PhysicsMetadata } from '@engine/physics/PhysicsWorld';
import type { RaycastSource } from '@engine/physics/Raycast';
import type { VehiclePresetDefinition } from '@game/config/vehicles.config';
import {
  VEHICLE_PERCEPTION,
  VEHICLE_THREAT_MEMORY_SECONDS,
} from '@game/config/vehicleAi.config';
import type { VehicleAiTarget, VehicleNavPoint } from './VehicleAiTypes';

/** Cuántos candidatos se testean con raycast por reevaluación de blanco. */
const MAX_LOS_CANDIDATES = 4;
/** Suavizado de la velocidad estimada del blanco. */
const VELOCITY_SMOOTHING = 8;

export interface VehiclePerceptionSnapshot {
  targetId: string | null;
  /** Posición vista ahora, o el último-visto si ya no hay LOS. */
  position: Vector3 | null;
  velocity: Vector3 | null;
  visible: boolean;
  /** Segundos desde la última LOS confirmada. */
  memoryAge: number;
  hasMemory: boolean;
}

export function vehiclePerceptionConfig(
  preset: VehiclePresetDefinition,
): PerceptionConfig {
  const weaponRange = preset.weapon?.range ?? 0;
  return {
    visionRange: weaponRange > 0
      ? weaponRange * VEHICLE_PERCEPTION.visionRangeFactor
      : VEHICLE_PERCEPTION.unarmedVisionRange,
    visionConeRadians: VEHICLE_PERCEPTION.visionConeRadians,
    hearingRadius: VEHICLE_PERCEPTION.hearingRadius,
    memoryTime: VEHICLE_THREAT_MEMORY_SECONDS,
    // El origen del cuerpo del vehículo es su centro de colisión, así que el
    // "ojo" de la tripulación va apenas arriba de la mitad del casco.
    eyeHeight: Math.max(0.4, preset.body.size[1] * 0.35),
  };
}

/**
 * Percepción por vehículo: LOS real, cono, memoria del último-visto e histéresis
 * de blanco. Antes de esto la torreta elegía al hostil más cercano del nivel
 * atravesando paredes, y podía alternar de blanco cada frame entre dos
 * enemigos equidistantes.
 *
 * Reusa `PerceptionSystem` del engine; acá sólo vive la selección de blanco y la
 * estimación de velocidad.
 */
export class VehicleAiPerception {
  private readonly perception: PerceptionSystem;
  private readonly position = new Vector3();
  private readonly velocity = new Vector3();
  private readonly previousPosition = new Vector3();
  private targetId: string | null = null;
  private retargetCountdown = 0;
  private tracking = false;
  private intel: { targetId: string; position: Vector3; age: number } | null = null;

  constructor(
    private readonly vehicleId: string,
    private readonly config: PerceptionConfig,
    private readonly losFilter?: (metadata: PhysicsMetadata | undefined) => boolean,
  ) {
    this.perception = new PerceptionSystem(config, vehicleId, losFilter);
  }

  /** El caller marca al vehículo como "caliente" (oyó disparos, recibió daño). */
  setAlert(alert: boolean): void {
    this.perception.setAlert(alert);
  }

  /** Records a heard position or allied report without turning it into LOS. */
  rememberIntel(targetId: string, position: Vector3): void {
    this.intel = { targetId, position: position.clone(), age: 0 };
    if (this.targetId === null) this.targetId = targetId;
    this.perception.setAlert(true);
  }

  update(
    delta: number,
    self: Vector3,
    facing: Vector3,
    candidates: readonly PerceptionTarget[],
    raycast: RaycastSource,
    preferredTargetId: string | null = null,
  ): VehiclePerceptionSnapshot {
    if (this.intel) {
      this.intel.age += delta;
      if (this.intel.age >= this.config.memoryTime) this.intel = null;
    }
    this.retargetCountdown -= delta;
    const current = candidates.find((entry) => entry.id === this.targetId) ?? null;
    const preferred = preferredTargetId === null
      ? null
      : candidates.find(
        (entry) => entry.id === preferredTargetId && entry.isAlive,
      ) ?? null;
    if (
      !current ||
      !current.isAlive ||
      this.retargetCountdown <= 0 ||
      this.targetId === null ||
      (preferred !== null && preferred.id !== this.targetId)
    ) {
      this.retargetCountdown = VEHICLE_PERCEPTION.retargetSeconds;
      this.selectTarget(
        self,
        facing,
        candidates,
        raycast,
        current,
        preferred,
      );
    }

    const target = candidates.find((entry) => entry.id === this.targetId) ?? null;
    const snapshot = this.perception.update(self, facing, target, delta, raycast);
    if (snapshot.visibleNow && target) {
      this.trackPosition(target.position, delta);
      this.intel = null;
    } else if (snapshot.lastKnownPosition) {
      this.position.copy(snapshot.lastKnownPosition);
      // Sin LOS la velocidad deja de ser información: el último-visto es un
      // punto, no una trayectoria.
      this.velocity.multiplyScalar(Math.max(0, 1 - delta * 2));
    } else if (this.intel) {
      this.targetId = this.intel.targetId;
      this.position.copy(this.intel.position);
      this.velocity.set(0, 0, 0);
      this.tracking = true;
      return {
        targetId: this.targetId,
        position: this.position.clone(),
        velocity: this.velocity.clone(),
        visible: false,
        memoryAge: this.intel.age,
        hasMemory: true,
      };
    } else {
      this.tracking = false;
      this.targetId = null;
      this.velocity.set(0, 0, 0);
    }

    return {
      targetId: this.targetId,
      position: this.tracking ? this.position : null,
      velocity: this.tracking ? this.velocity : null,
      visible: snapshot.visibleNow,
      memoryAge: snapshot.memoryAge,
      hasMemory: snapshot.hasMemory,
    };
  }

  reset(): void {
    this.perception.reset();
    this.targetId = null;
    this.retargetCountdown = 0;
    this.tracking = false;
    this.intel = null;
    this.velocity.set(0, 0, 0);
  }

  /** Forma que consume el cerebro; el artillero usa el snapshot con `Vector3`. */
  toBrainTarget(snapshot: VehiclePerceptionSnapshot): VehicleAiTarget | null {
    if (!snapshot.targetId || !snapshot.position) return null;
    const position: VehicleNavPoint = [
      snapshot.position.x,
      snapshot.position.y,
      snapshot.position.z,
    ];
    const velocity: VehicleNavPoint = snapshot.velocity
      ? [snapshot.velocity.x, snapshot.velocity.y, snapshot.velocity.z]
      : [0, 0, 0];
    return {
      id: snapshot.targetId,
      position,
      velocity,
      visible: snapshot.visible,
      memoryAge: snapshot.memoryAge,
    };
  }

  private selectTarget(
    self: Vector3,
    facing: Vector3,
    candidates: readonly PerceptionTarget[],
    raycast: RaycastSource,
    current: PerceptionTarget | null,
    preferred: PerceptionTarget | null,
  ): void {
    if (
      preferred &&
      isTargetVisible(
        this.config,
        self,
        facing,
        preferred,
        raycast,
        this.vehicleId,
        this.losFilter,
      )
    ) {
      if (preferred.id !== this.targetId) {
        this.switchTo(preferred.id, candidates);
      }
      return;
    }

    const ranked = candidates
      .filter((entry) => entry.isAlive && entry.id !== preferred?.id)
      .map((entry) => ({
        entry,
        distanceSq: entry.position.distanceToSquared(self),
      }))
      .sort((a, b) => a.distanceSq - b.distanceSq)
      .slice(0, MAX_LOS_CANDIDATES);

    let best: { id: string; distanceSq: number } | null = null;
    for (const candidate of ranked) {
      const visible = isTargetVisible(
        this.config,
        self,
        facing,
        candidate.entry,
        raycast,
        this.vehicleId,
        this.losFilter,
      );
      if (!visible) continue;
      if (!best || candidate.distanceSq < best.distanceSq) {
        best = { id: candidate.entry.id, distanceSq: candidate.distanceSq };
      }
    }

    if (!best) {
      // Sin nadie a la vista se conserva el blanco actual mientras dure su
      // memoria; `PerceptionSystem` la deja caer sola al expirar.
      if (!current || !current.isAlive) this.targetId = null;
      return;
    }
    if (best.id === this.targetId) return;
    const effectiveCurrent = current?.id === preferred?.id ? null : current;
    if (!effectiveCurrent || !effectiveCurrent.isAlive) {
      this.switchTo(best.id, candidates);
      return;
    }
    // Histéresis: robar el blanco cuesta estar sensiblemente más cerca.
    const currentDistanceSq = effectiveCurrent.position.distanceToSquared(self);
    const advantage = VEHICLE_PERCEPTION.retargetAdvantage ** 2;
    if (best.distanceSq < currentDistanceSq * advantage) {
      this.switchTo(best.id, candidates);
    }
  }

  private switchTo(id: string, candidates: readonly PerceptionTarget[]): void {
    this.targetId = id;
    this.perception.reset();
    this.tracking = false;
    this.velocity.set(0, 0, 0);
    const target = candidates.find((entry) => entry.id === id);
    if (target) this.previousPosition.copy(target.position);
  }

  private trackPosition(position: Vector3, delta: number): void {
    if (!this.tracking) {
      this.tracking = true;
      this.position.copy(position);
      this.previousPosition.copy(position);
      this.velocity.set(0, 0, 0);
      return;
    }
    if (delta > 1e-4) {
      const instant = position.clone().sub(this.previousPosition).divideScalar(delta);
      const alpha = Math.min(1, delta * VELOCITY_SMOOTHING);
      this.velocity.lerp(instant, alpha);
    }
    this.previousPosition.copy(position);
    this.position.copy(position);
  }
}
