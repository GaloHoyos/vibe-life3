import {
  Euler,
  MathUtils,
  Object3D,
  Quaternion,
  Vector3,
} from "three";
import type { Input } from "@engine/input/Input";
import type { CameraSystem } from "@engine/render/CameraSystem";
import type { VehiclePresetDefinition } from "@game/config/vehicles.config";

const CAMERA_FORWARD_FIX = new Quaternion().setFromAxisAngle(
  new Vector3(0, 1, 0),
  Math.PI,
);
const ZERO = new Vector3();
const IDENTITY = new Quaternion();

/**
 * Cámara vehicular exclusivamente en primera persona. El eye attachment es
 * autoritativo; una primavera críticamente amortiguada absorbe vibración del
 * solver sin introducir retraso perceptible en el mouse.
 */
export class VehicleCameraRig {
  private anchor: Object3D | null = null;
  private config: VehiclePresetDefinition["camera"] | null = null;
  private localYaw = 0;
  private localPitch = 0;
  private blendRemaining = 0;
  private blendDuration = 0;
  private shake = 0;
  private shakePhase = 0;

  private readonly position = new Vector3();
  /** Residual cámara→anchor y su velocidad, ambos en espacio del anchor. */
  private readonly localOffset = new Vector3();
  private readonly localOffsetVelocity = new Vector3();
  private readonly targetPosition = new Vector3();
  private readonly rotationResidual = new Quaternion();
  private readonly blendStartPosition = new Vector3();
  private readonly targetQuaternion = new Quaternion();
  private readonly smoothedQuaternion = new Quaternion();
  private readonly blendStartQuaternion = new Quaternion();
  private readonly anchorQuaternion = new Quaternion();
  private readonly yawOnlyQuaternion = new Quaternion();
  private readonly localQuaternion = new Quaternion();
  private readonly euler = new Euler(0, 0, 0, "YXZ");
  private readonly aimDirection = new Vector3();

  begin(
    anchor: Object3D,
    config: VehiclePresetDefinition["camera"],
    camera: CameraSystem,
  ): void {
    this.anchor = anchor;
    this.config = config;
    this.localYaw = 0;
    this.localPitch = 0;
    this.blendDuration = Math.max(0.001, config.enterBlendSeconds);
    this.blendRemaining = this.blendDuration;
    this.blendStartPosition.copy(camera.camera.position);
    this.blendStartQuaternion.copy(camera.camera.quaternion);
    this.localOffsetVelocity.set(0, 0, 0);
    this.rotationResidual.identity();
    this.updateTargetPose();
    // El residual arranca en cero: el blend de entrada es el que trae la cámara
    // desde donde estaba el jugador a pie.
    this.localOffset.set(0, 0, 0);
    this.position.copy(this.targetPosition);
    this.smoothedQuaternion.copy(this.targetQuaternion);
  }

  end(camera: CameraSystem): void {
    const direction = camera.camera.getWorldDirection(this.aimDirection);
    const yaw = Math.atan2(-direction.x, -direction.z);
    const pitch = Math.asin(MathUtils.clamp(direction.y, -1, 1));
    camera.setLook(yaw, pitch);
    camera.applyZoom(camera.defaultFov, 1);
    this.anchor = null;
    this.config = null;
    this.localOffset.set(0, 0, 0);
    this.localOffsetVelocity.set(0, 0, 0);
    this.rotationResidual.identity();
    this.shake = 0;
  }

  update(
    delta: number,
    input: Input,
    camera: CameraSystem,
    speed: number,
  ): void {
    if (!this.anchor || !this.config) return;
    const mouse = input.getMouseDelta();
    this.localYaw = MathUtils.clamp(
      this.localYaw - mouse.x * 0.0022,
      -this.config.maxYaw,
      this.config.maxYaw,
    );
    this.localPitch = MathUtils.clamp(
      this.localPitch - mouse.y * 0.0022,
      this.config.minPitch,
      this.config.maxPitch,
    );
    this.updateTargetPose();

    const dt = Math.min(Math.max(delta, 0), 0.1);
    // El anchor es autoritativo: la cámara es `anchor + residual`, donde el
    // residual es estado propio que decae a cero. Un resorte que persigue la
    // posición mundial del anchor arrastra un error estacionario de 2·v/ω — a
    // 25 m/s con ω=12 son 4,17 m, la cámara colgada atrás del chasis. Acá el
    // movimiento del vehículo NUNCA entra al residual, así que sólo se amortigua
    // lo que perturba la cabina (blend de entrada, sacudón de impacto).
    springVector(
      this.localOffset,
      this.localOffsetVelocity,
      ZERO,
      this.config.positionDamping,
      dt,
    );
    this.position
      .copy(this.localOffset)
      .applyQuaternion(this.anchorQuaternion)
      .add(this.targetPosition);

    // Mismo criterio para la orientación: girar sostenido no debe dejar la
    // cámara mirando donde el vehículo ya no apunta.
    this.rotationResidual.slerp(
      IDENTITY,
      1 - Math.exp(-this.config.rotationDamping * dt),
    );
    this.smoothedQuaternion
      .copy(this.targetQuaternion)
      .multiply(this.rotationResidual)
      .normalize();

    let position = this.position;
    let rotation = this.smoothedQuaternion;
    if (this.blendRemaining > 0) {
      this.blendRemaining = Math.max(0, this.blendRemaining - dt);
      const t = smoothstep(1 - this.blendRemaining / this.blendDuration);
      position = this.blendStartPosition.clone().lerp(this.position, t);
      rotation = this.blendStartQuaternion.clone().slerp(this.smoothedQuaternion, t);
    }

    this.shake = Math.max(0, this.shake - dt * 1.8);
    this.shakePhase += dt * 31;
    if (this.shake > 0) {
      const amplitude = this.shake * this.shake * 0.055;
      position = position.clone().add(
        new Vector3(
          Math.sin(this.shakePhase * 1.17) * amplitude,
          Math.sin(this.shakePhase * 1.71 + 1.3) * amplitude,
          Math.cos(this.shakePhase * 1.43) * amplitude,
        ),
      );
      const shakeRotation = new Quaternion().setFromEuler(
        new Euler(
          Math.sin(this.shakePhase * 1.31) * amplitude * 0.55,
          Math.cos(this.shakePhase * 1.63) * amplitude * 0.45,
          0,
        ),
      );
      rotation = rotation.clone().multiply(shakeRotation);
    }

    camera.camera.position.copy(position);
    camera.camera.quaternion.copy(rotation);
    const speed01 = MathUtils.clamp(Math.abs(speed) / 34, 0, 1);
    camera.applyZoom(
      camera.defaultFov + this.config.speedFovGain * speed01,
      dt,
    );
  }

  addImpact(intensity: number): void {
    this.shake = MathUtils.clamp(
      Math.max(this.shake, intensity),
      0,
      1.4,
    );
  }

  getAimDirection(out = new Vector3()): Vector3 {
    return out.set(0, 0, -1).applyQuaternion(this.targetQuaternion).normalize();
  }

  getLocalAim(): { yaw: number; pitch: number } {
    return { yaw: this.localYaw, pitch: this.localPitch };
  }

  isActive(): boolean {
    return this.anchor !== null;
  }

  private updateTargetPose(): void {
    if (!this.anchor || !this.config) return;
    this.anchor.getWorldPosition(this.targetPosition);
    this.anchor.getWorldQuaternion(this.anchorQuaternion);

    // Conserva yaw completo pero atenúa pitch/roll del chasis: la cabina se
    // siente física sin hacer que baches o peraltes mareen al jugador.
    this.euler.setFromQuaternion(this.anchorQuaternion, "YXZ");
    this.euler.x *= 0.38;
    this.euler.z *= 0.3;
    this.yawOnlyQuaternion
      .setFromEuler(this.euler)
      .multiply(CAMERA_FORWARD_FIX);

    this.localQuaternion.setFromEuler(
      this.euler.set(this.localPitch, this.localYaw, 0, "YXZ"),
    );
    this.targetQuaternion
      .copy(this.yawOnlyQuaternion)
      .multiply(this.localQuaternion)
      .normalize();

    if (this.targetPosition.y < -10_000) {
      this.targetPosition.y = -10_000;
    }
  }
}

function springVector(
  value: Vector3,
  velocity: Vector3,
  target: Vector3,
  frequency: number,
  delta: number,
): void {
  const omega = Math.max(0.01, frequency);
  const f = 1 + 2 * delta * omega;
  const oo = omega * omega;
  const hoo = delta * oo;
  const hhoo = delta * hoo;
  const inv = 1 / (f + hhoo);
  const tx = target.x;
  const ty = target.y;
  const tz = target.z;
  const x = value.x;
  const y = value.y;
  const z = value.z;
  value.set(
    (f * x + delta * velocity.x + hhoo * tx) * inv,
    (f * y + delta * velocity.y + hhoo * ty) * inv,
    (f * z + delta * velocity.z + hhoo * tz) * inv,
  );
  velocity.set(
    (velocity.x + hoo * (tx - x)) * inv,
    (velocity.y + hoo * (ty - y)) * inv,
    (velocity.z + hoo * (tz - z)) * inv,
  );
}

function smoothstep(t: number): number {
  const x = MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}
