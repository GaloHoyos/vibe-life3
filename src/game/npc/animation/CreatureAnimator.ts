import { MathUtils, Object3D, Vector3 } from "three";
import type { AnimationFrame, NpcAnimator } from "./NpcAnimator";

export type SpinAxis = "x" | "y" | "z";

export interface CreatureAnimConfig {
  /** Amplitud (m) del bob vertical del cuerpo. */
  bobAmplitude: number;
  /** Frecuencia (Hz) del bob. */
  bobFrequency: number;
  /** Inclinacion (rad por m/s) hacia donde se mueve. 0 = sin banking. */
  bankStrength: number;
  /** Giro continuo de un hijo nombrado (ej. la cuchilla del manhack). */
  spin?: { childName: string; axis: SpinAxis; speed: number };
  /** Como muere: `tumble` (vuelca), `drop` (cae), o `none` (lo maneja la fisica del cuerpo). */
  death: "tumble" | "drop" | "none";
  /** Distancia (m) que cae el cuerpo al morir con `death: 'drop'`. */
  dropDistance?: number;
}

const TAU = Math.PI * 2;
const LUNGE_DURATION = 0.22;
const LUNGE_DISTANCE = 0.25;
const HIT_DURATION = 0.18;
const MAX_BANK = 0.5;
const DROP_GRAVITY = 18;

/**
 * Animador liviano para NPCs no-humanoides (headcrab, manhack). No asume
 * esqueleto: anima el transform del root visual interno (bob, banking, spin de
 * un hijo) y una muerte simple (vuelco o caida). El `Npc` lo trata via la
 * interfaz `NpcAnimator`; los metodos de arma/postura son no-ops.
 *
 * El root visual interno vive dentro del Group que el motor posiciona, asi que
 * mover/rotar acá no pelea con la locomocion: el motor maneja la posicion world
 * y el yaw de facing; este animador solo compone el offset local.
 */
export class CreatureAnimator implements NpcAnimator {
  private readonly base: Vector3;
  private readonly baseScale: Vector3;
  private readonly baseRotX: number;
  private readonly baseRotZ: number;
  private readonly spinChild: Object3D | null;
  private readonly localVelocity = new Vector3();

  private enabled = true;
  private dead = false;
  private currentPitch = 0;
  private currentRoll = 0;
  private lungeElapsed = LUNGE_DURATION;
  private hitElapsed = HIT_DURATION;
  private dropOffset = 0;
  private dropVelocity = 0;
  private deathRoll = 0;

  constructor(
    private readonly root: Object3D,
    private readonly config: CreatureAnimConfig,
  ) {
    this.base = root.position.clone();
    this.baseScale = root.scale.clone();
    this.baseRotX = root.rotation.x;
    this.baseRotZ = root.rotation.z;
    this.spinChild = config.spin ? root.getObjectByName(config.spin.childName) ?? null : null;
  }

  updateFromMotor(frame: AnimationFrame): void {
    if (!this.enabled || this.dead) return;
    const t = performance.now() / 1000;

    this.computeLocalVelocity(frame.snapshot.velocity, frame.snapshot.yaw);
    const targetRoll = MathUtils.clamp(
      -this.localVelocity.x * this.config.bankStrength,
      -MAX_BANK,
      MAX_BANK,
    );
    const targetPitch = MathUtils.clamp(
      this.localVelocity.z * this.config.bankStrength * 0.5,
      -MAX_BANK,
      MAX_BANK,
    );
    this.currentRoll += (targetRoll - this.currentRoll) * 0.15;
    this.currentPitch += (targetPitch - this.currentPitch) * 0.15;

    const bob = this.config.bobAmplitude * Math.sin(t * this.config.bobFrequency * TAU);
    const lunge = this.lungeOffset();

    this.root.position.set(this.base.x, this.base.y + bob, this.base.z + lunge);
    const squash = this.hitSquash();
    this.root.rotation.x = this.baseRotX + this.currentPitch;
    this.root.rotation.z = this.baseRotZ + this.currentRoll;
    this.root.scale.copy(this.baseScale).multiplyScalar(squash);

    this.tickSpin(t);
  }

  updateStandalone(delta: number, opts: { dead?: boolean } = {}): void {
    if (!this.enabled) return;
    if (opts.dead) this.dead = true;
    if (!this.dead) return;
    // `none`: el cuerpo dinamico (manhack) cae solo por fisica; nada que animar.
    if (this.config.death === "none") return;

    if (this.config.death === "drop") {
      const limit = this.config.dropDistance ?? 1.2;
      this.dropVelocity += DROP_GRAVITY * delta;
      this.dropOffset = Math.min(limit, this.dropOffset + this.dropVelocity * delta);
      this.deathRoll += delta * 6;
      this.root.position.set(this.base.x, this.base.y - this.dropOffset, this.base.z);
      this.root.rotation.x = this.baseRotX + this.deathRoll * 0.6;
      this.root.rotation.z = this.baseRotZ + this.deathRoll;
      this.tickSpin(performance.now() / 1000, 2.5);
    } else {
      this.deathRoll = Math.min(Math.PI * 0.55, this.deathRoll + delta * 4);
      this.dropOffset = Math.min(0.2, this.dropOffset + delta * 0.6);
      this.root.position.set(this.base.x, this.base.y - this.dropOffset, this.base.z);
      this.root.rotation.x = this.baseRotX + this.deathRoll;
    }
  }

  notifyAttack(): void {
    this.lungeElapsed = 0;
  }

  notifyHit(): void {
    this.hitElapsed = 0;
  }

  notifyDeath(): void {
    this.dead = true;
  }

  disable(): void {
    this.enabled = false;
  }

  // Criaturas sin arma ni postura: no-ops.
  setAiming(): void {}
  setActivity(): void {}
  notifyShot(): void {}
  notifyReload(): void {}

  private lungeOffset(): number {
    if (this.lungeElapsed >= LUNGE_DURATION) return 0;
    this.lungeElapsed += 1 / 60;
    const progress = MathUtils.clamp(this.lungeElapsed / LUNGE_DURATION, 0, 1);
    return Math.sin(progress * Math.PI) * LUNGE_DISTANCE;
  }

  private hitSquash(): number {
    if (this.hitElapsed >= HIT_DURATION) return 1;
    this.hitElapsed += 1 / 60;
    const progress = MathUtils.clamp(this.hitElapsed / HIT_DURATION, 0, 1);
    return 1 - Math.sin(progress * Math.PI) * 0.12;
  }

  private tickSpin(t: number, multiplier = 1): void {
    const spin = this.config.spin;
    if (!spin || !this.spinChild) return;
    this.spinChild.rotation[spin.axis] = (t * spin.speed * multiplier) % TAU;
  }

  private computeLocalVelocity(velocity: Vector3, yaw: number): void {
    const cos = Math.cos(-yaw);
    const sin = Math.sin(-yaw);
    this.localVelocity.set(
      velocity.x * cos - velocity.z * sin,
      velocity.y,
      velocity.x * sin + velocity.z * cos,
    );
  }
}
