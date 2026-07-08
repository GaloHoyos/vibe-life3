import { MathUtils, Mesh, MeshStandardMaterial, Object3D, Vector3 } from "three";
import type { AnimationFrame, NpcAnimator } from "./NpcAnimator";

const MUZZLE_FLASH = 0.07;
const ROTOR_SPEED = 42;
const MAX_BANK = 0.34;
const tmpLocalVelocity = new Vector3();

export class GunshipAnimator implements NpcAnimator {
  private readonly rotor: Object3D | null;
  private readonly eyeMaterial: MeshStandardMaterial | null;
  private readonly muzzleMaterial: MeshStandardMaterial | null;
  private readonly baseRotX: number;
  private readonly baseRotZ: number;

  private enabled = true;
  private dead = false;
  private flashTimer = 0;
  private rotorPhase = 0;
  private currentPitch = 0;
  private currentRoll = 0;

  constructor(private readonly root: Object3D) {
    this.rotor = root.getObjectByName("gunship-rotor") ?? null;
    this.eyeMaterial = emissiveOf(root, "gunship-eye");
    this.muzzleMaterial = emissiveOf(root, "gunship-muzzle");
    this.baseRotX = root.rotation.x;
    this.baseRotZ = root.rotation.z;
  }

  updateFromMotor(frame: AnimationFrame): void {
    if (!this.enabled || this.dead) return;
    this.flashTimer = Math.max(0, this.flashTimer - 1 / 60);
    this.rotorPhase += ROTOR_SPEED * (1 / 60);
    if (this.rotor) this.rotor.rotation.z = this.rotorPhase;

    computeLocalVelocity(tmpLocalVelocity, frame.snapshot.velocity, frame.snapshot.yaw);
    const targetRoll = MathUtils.clamp(-tmpLocalVelocity.x * 0.045, -MAX_BANK, MAX_BANK);
    const targetPitch = MathUtils.clamp(tmpLocalVelocity.z * 0.018, -0.18, 0.18);
    this.currentRoll += (targetRoll - this.currentRoll) * 0.12;
    this.currentPitch += (targetPitch - this.currentPitch) * 0.12;

    this.root.rotation.x = this.baseRotX + this.currentPitch;
    this.root.rotation.z = this.baseRotZ + this.currentRoll;
    this.applyMaterials(false);
  }

  updateStandalone(delta: number, opts: { dead?: boolean } = {}): void {
    if (!this.enabled) return;
    if (opts.dead) this.dead = true;
    if (!this.dead) return;
    this.flashTimer = 0;
    this.rotorPhase += ROTOR_SPEED * 0.18 * delta;
    if (this.rotor) this.rotor.rotation.z = this.rotorPhase;
    this.applyMaterials(true);
  }

  notifyShot(): void {
    this.flashTimer = MUZZLE_FLASH;
  }

  notifyHit(): void {
    if (this.eyeMaterial) this.eyeMaterial.emissiveIntensity = 2.6;
  }

  notifyDeath(): void {
    this.dead = true;
  }

  disable(): void {
    this.enabled = false;
  }

  setAiming(): void {}
  setActivity(): void {}
  notifyReload(): void {}
  notifyAttack(): void {}

  private applyMaterials(dead: boolean): void {
    if (this.eyeMaterial) {
      this.eyeMaterial.emissiveIntensity = dead ? 0.15 + Math.random() * 0.8 : 1.7;
    }
    if (this.muzzleMaterial) {
      this.muzzleMaterial.emissiveIntensity = this.flashTimer > 0 ? 8 : 0;
    }
  }
}

function emissiveOf(root: Object3D, name: string): MeshStandardMaterial | null {
  const node = root.getObjectByName(name);
  if (node instanceof Mesh && node.material instanceof MeshStandardMaterial) return node.material;
  return null;
}

function computeLocalVelocity(out: Vector3, velocity: Vector3, yaw: number): void {
  const cos = Math.cos(-yaw);
  const sin = Math.sin(-yaw);
  out.set(
    velocity.x * cos - velocity.z * sin,
    velocity.y,
    velocity.x * sin + velocity.z * cos,
  );
}
