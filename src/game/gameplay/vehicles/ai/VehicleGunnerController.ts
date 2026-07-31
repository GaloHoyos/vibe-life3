import { MathUtils, Vector3 } from 'three';
import type { VehicleMountedWeaponPreset } from '@game/config/vehicles.config';
import type { VehicleGunnerProfile } from '@game/config/vehicleAi.config';
import { clamp, normalizeAngle } from './VehicleAiMath';

export interface VehicleGunnerInput {
  delta: number;
  /**
   * Dirección al blanco en espacio LOCAL del vehículo, normalizada. `null` si no
   * hay blanco: la torreta pasa a barrido de reposo.
   */
  targetLocalDirection: Vector3 | null;
  /** LOS confirmada. Sin LOS apunta al último-visto pero no dispara. */
  visible: boolean;
  distance: number;
  /** Arma habilitada, artillero vivo y zona de arma operativa. */
  ready: boolean;
}

export interface VehicleGunnerOutput {
  /** Ángulos de la torreta, ya dentro de los límites del preset. */
  yaw: number;
  pitch: number;
  /** Dirección de disparo en espacio local: sale del cañón, con dispersión. */
  fireLocalDirection: Vector3 | null;
  /** El blanco quedó dentro del cono de disparo. */
  onTarget: boolean;
  /** El blanco pide más recorrido del que la torreta tiene. */
  atTraverseLimit: boolean;
}

/** Amplitud y periodo del barrido de reposo. */
const IDLE_SWEEP_FRACTION = 0.55;
const IDLE_SWEEP_SECONDS = 7;
/** La adquisición se enfría a la mitad de velocidad al perder de vista. */
const ACQUISITION_DECAY = 0.5;

/**
 * Artillero de vehículo, calcado del APC de HL2: la torreta gira a velocidad
 * limitada, sólo dispara con el cañón alineado (`m_bInFiringCone`), tira en
 * ráfagas con pausa (10 tiros y 2 s en el APC), tarda en adquirir y su puntería
 * se cierra con el tiempo en blanco.
 *
 * Antes de esto el vehículo hacía snap con la torreta y disparaba cada frame que
 * el blanco estuviera en rango, atravesando paredes.
 */
export class VehicleGunnerController {
  private yaw = 0;
  private pitch = 0;
  private acquisition = 0;
  private timeOnTarget = 0;
  private shotsInBurst = 0;
  private burstPause = 0;
  private sweepPhase = 0;
  private previousDesiredYaw: number | null = null;
  private previousDesiredPitch = 0;
  private angularRate = 0;
  private shotCooldown = 0;

  constructor(
    private readonly preset: VehicleMountedWeaponPreset,
    private profile: VehicleGunnerProfile,
    private readonly random: () => number = Math.random,
  ) {}

  setProfile(profile: VehicleGunnerProfile): void {
    this.profile = profile;
  }

  getYaw(): number {
    return this.yaw;
  }

  getPitch(): number {
    return this.pitch;
  }

  getSpread(): number {
    const decay = Math.exp(-this.timeOnTarget / Math.max(0.05, this.profile.tightenSeconds));
    const tracked = this.profile.minSpread +
      (this.profile.initialSpread - this.profile.minSpread) * decay;
    return tracked + this.angularRate * this.profile.angularRateGain;
  }

  update(input: VehicleGunnerInput): VehicleGunnerOutput {
    const delta = Math.max(0, Math.min(input.delta, 0.25));
    this.shotCooldown = Math.max(0, this.shotCooldown - delta);
    if (this.burstPause > 0) this.burstPause = Math.max(0, this.burstPause - delta);

    if (!input.targetLocalDirection) {
      this.idle(delta);
      return {
        yaw: this.yaw,
        pitch: this.pitch,
        fireLocalDirection: null,
        onTarget: false,
        atTraverseLimit: false,
      };
    }

    const direction = input.targetLocalDirection;
    const desiredYaw = Math.atan2(direction.x, direction.z);
    const desiredPitch = Math.asin(clamp(direction.y, -1, 1));
    this.updateAngularRate(delta, desiredYaw, desiredPitch);

    const clampedYaw = clamp(desiredYaw, -this.preset.yawLimit, this.preset.yawLimit);
    const clampedPitch = clamp(desiredPitch, this.preset.pitchMin, this.preset.pitchMax);
    const atTraverseLimit =
      Math.abs(clampedYaw - desiredYaw) > 1e-3 || Math.abs(clampedPitch - desiredPitch) > 1e-3;

    const traverse = this.preset.traverseSpeed * this.profile.traverseFactor * delta;
    this.yaw = approachAngle(this.yaw, clampedYaw, traverse);
    this.pitch = approachAngle(this.pitch, clampedPitch, traverse);
    this.sweepPhase = 0;

    // El error se mide contra la dirección REAL al blanco, no contra la clampeada:
    // un blanco fuera del recorrido nunca queda "en el cono".
    const aimError = Math.hypot(
      normalizeAngle(desiredYaw - this.yaw),
      desiredPitch - this.pitch,
    );
    const onTarget = aimError <= this.preset.firingConeRadians;

    if (input.visible) {
      this.acquisition = Math.min(
        this.profile.acquisitionSeconds,
        this.acquisition + delta,
      );
      this.timeOnTarget += onTarget ? delta : 0;
    } else {
      this.acquisition = Math.max(0, this.acquisition - delta * ACQUISITION_DECAY);
      this.timeOnTarget = 0;
    }

    const fire = this.shouldFire(input, onTarget);
    if (!fire) {
      return {
        yaw: this.yaw,
        pitch: this.pitch,
        fireLocalDirection: null,
        onTarget,
        atTraverseLimit,
      };
    }

    this.shotsInBurst += 1;
    this.shotCooldown = 1 / Math.max(0.1, this.preset.fireRate);
    if (this.shotsInBurst >= this.preset.burstSize) {
      this.shotsInBurst = 0;
      // Jitter en la pausa para que la ráfaga no suene a metrónomo.
      this.burstPause = this.preset.burstPauseSeconds * (0.8 + this.random() * 0.45);
    }

    return {
      yaw: this.yaw,
      pitch: this.pitch,
      fireLocalDirection: this.shotDirection(),
      onTarget,
      atTraverseLimit,
    };
  }

  reset(): void {
    this.acquisition = 0;
    this.timeOnTarget = 0;
    this.shotsInBurst = 0;
    this.burstPause = 0;
    this.previousDesiredYaw = null;
    this.previousDesiredPitch = 0;
    this.angularRate = 0;
    this.shotCooldown = 0;
  }

  private shouldFire(input: VehicleGunnerInput, onTarget: boolean): boolean {
    if (!input.ready || !input.visible || !onTarget) return false;
    if (input.distance > this.preset.range) return false;
    if (this.acquisition < this.profile.acquisitionSeconds) return false;
    if (this.burstPause > 0 || this.shotCooldown > 0) return false;
    return true;
  }

  private shotDirection(): Vector3 {
    const spread = this.getSpread();
    // Offset uniforme dentro del cono de dispersión, aplicado sobre la dirección
    // real del cañón: los impactos de una ráfaga dibujan un cono, como el APC.
    const angle = this.random() * Math.PI * 2;
    const magnitude = Math.sqrt(this.random()) * spread;
    const yaw = this.yaw + Math.cos(angle) * magnitude;
    const pitch = clamp(
      this.pitch + Math.sin(angle) * magnitude,
      -Math.PI / 2 + 1e-3,
      Math.PI / 2 - 1e-3,
    );
    const horizontal = Math.cos(pitch);
    return new Vector3(
      Math.sin(yaw) * horizontal,
      Math.sin(pitch),
      Math.cos(yaw) * horizontal,
    );
  }

  private idle(delta: number): void {
    this.acquisition = Math.max(0, this.acquisition - delta * ACQUISITION_DECAY);
    this.timeOnTarget = 0;
    this.shotsInBurst = 0;
    this.previousDesiredYaw = null;
    this.angularRate = 0;
    this.sweepPhase += delta / IDLE_SWEEP_SECONDS;
    const sweep = Math.sin(this.sweepPhase * Math.PI * 2) *
      this.preset.yawLimit * IDLE_SWEEP_FRACTION;
    const traverse = this.preset.traverseSpeed * this.profile.traverseFactor * delta * 0.35;
    this.yaw = approachAngle(this.yaw, sweep, traverse);
    this.pitch = approachAngle(this.pitch, 0, traverse);
  }

  private updateAngularRate(delta: number, desiredYaw: number, desiredPitch: number): void {
    if (this.previousDesiredYaw === null || delta <= 1e-4) {
      this.previousDesiredYaw = desiredYaw;
      this.previousDesiredPitch = desiredPitch;
      return;
    }
    const instant = Math.hypot(
      normalizeAngle(desiredYaw - this.previousDesiredYaw),
      desiredPitch - this.previousDesiredPitch,
    ) / delta;
    this.angularRate = MathUtils.lerp(this.angularRate, instant, Math.min(1, delta * 6));
    this.previousDesiredYaw = desiredYaw;
    this.previousDesiredPitch = desiredPitch;
  }
}

function approachAngle(current: number, target: number, maximumStep: number): number {
  const difference = normalizeAngle(target - current);
  if (Math.abs(difference) <= maximumStep) return target;
  return normalizeAngle(current + Math.sign(difference) * maximumStep);
}
