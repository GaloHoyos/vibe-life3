import { MathUtils, Object3D, Vector3 } from 'three';

export interface ActiveRagdollConfig {
  swayStrength: number;
  turnLagStrength: number;
  flinchStrength: number;
  stumbleLean: number;
}

export interface ActiveRagdollUpdate {
  velocity: Vector3;
  acceleration: Vector3;
  yawDelta: number;
  balanceIntensity: number;
  deltaTime: number;
}

export class ActiveRagdollController {
  private readonly flinch = new Vector3();
  private flinchTimer = 0;

  constructor(
    private readonly root: Object3D,
    private readonly config: ActiveRagdollConfig,
  ) {}

  update(update: ActiveRagdollUpdate): void {
    const lateralSway = MathUtils.clamp(-update.acceleration.x * 0.015, -0.18, 0.18);
    const forwardLean = MathUtils.clamp(update.velocity.length() * 0.025, 0, 0.12);
    const turnLag = MathUtils.clamp(-update.yawDelta * this.config.turnLagStrength, -0.18, 0.18);
    const stumble = update.balanceIntensity * this.config.stumbleLean;

    this.root.rotation.x += forwardLean + stumble;
    this.root.rotation.z += lateralSway * this.config.swayStrength + turnLag;

    if (this.flinchTimer > 0) {
      this.flinchTimer = Math.max(0, this.flinchTimer - update.deltaTime);
      const t = Math.sin((this.flinchTimer / 0.28) * Math.PI);
      this.root.rotation.x -= this.flinch.z * this.config.flinchStrength * t;
      this.root.rotation.z += this.flinch.x * this.config.flinchStrength * t;
    }
  }

  flinchFrom(direction: Vector3, strength: number): void {
    if (direction.lengthSq() <= 0.001) {
      return;
    }

    this.flinch.copy(direction).normalize().multiplyScalar(strength);
    this.flinchTimer = 0.28;
  }
}
