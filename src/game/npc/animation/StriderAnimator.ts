import { Mesh, MeshStandardMaterial, Object3D, Quaternion, Vector3 } from "three";
import type { StriderWalkerMotor } from "@engine/physics/character/StriderWalkerMotor";
import type { AnimationFrame, NpcAnimator } from "./NpcAnimator";

const Y_AXIS = new Vector3(0, 1, 0);
const tmpDir = new Vector3();
const tmpCenter = new Vector3();
const tmpQuat = new Quaternion();
const tmpHip = new Vector3();
const tmpKnee = new Vector3();
const tmpFoot = new Vector3();

export class StriderAnimator implements NpcAnimator {
  private readonly eyeMaterial: MeshStandardMaterial | null;
  private readonly minigunMaterial: MeshStandardMaterial | null;
  private readonly cannonMaterial: MeshStandardMaterial | null;
  private readonly body: Object3D | null;
  private readonly legNodes: Array<{
    upper: Object3D | null;
    lower: Object3D | null;
    foot: Object3D | null;
    hip: Object3D | null;
  }>;

  private enabled = true;
  private dead = false;
  private minigunFlash = 0;
  private cannonFlash = 0;
  private charge = 0;
  private hitPulse = 0;

  constructor(
    private readonly root: Object3D,
    private readonly motor: StriderWalkerMotor,
  ) {
    this.eyeMaterial = emissiveOf(root, "strider-eye");
    this.minigunMaterial = emissiveOf(root, "strider-minigun-muzzle");
    this.cannonMaterial = emissiveOf(root, "strider-cannon-muzzle");
    this.body = root.getObjectByName("strider-body") ?? null;
    this.legNodes = ["left", "right", "rear"].map((name) => ({
      upper: root.getObjectByName(`strider-leg-${name}-upper`) ?? null,
      lower: root.getObjectByName(`strider-leg-${name}-lower`) ?? null,
      foot: root.getObjectByName(`strider-leg-${name}-foot`) ?? null,
      hip: root.getObjectByName(`strider-leg-${name}-hip`) ?? null,
    }));
  }

  updateFromMotor(frame: AnimationFrame): void {
    if (!this.enabled || this.dead) return;
    this.minigunFlash = Math.max(0, this.minigunFlash - 1 / 60);
    this.cannonFlash = Math.max(0, this.cannonFlash - 1 / 60);
    this.charge = Math.max(0, this.charge - 1 / 60);
    this.hitPulse = Math.max(0, this.hitPulse - 1 / 60);

    if (this.body) {
      const localSideSpeed =
        frame.snapshot.velocity.x * Math.cos(-frame.snapshot.yaw) -
        frame.snapshot.velocity.z * Math.sin(-frame.snapshot.yaw);
      this.body.rotation.z = Math.max(-0.12, Math.min(0.12, -localSideSpeed * 0.018));
    }

    const legs = this.motor.getLegSnapshots();
    for (let i = 0; i < legs.length; i += 1) {
      const leg = legs[i];
      const nodes = this.legNodes[i];
      worldToLocal(tmpHip, leg.hip, frame.snapshot.position, frame.snapshot.yaw);
      worldToLocal(tmpKnee, leg.knee, frame.snapshot.position, frame.snapshot.yaw);
      worldToLocal(tmpFoot, leg.foot, frame.snapshot.position, frame.snapshot.yaw);
      if (nodes.hip) nodes.hip.position.copy(tmpHip);
      if (nodes.upper) placeSegment(nodes.upper, tmpHip, tmpKnee, 1);
      if (nodes.lower) placeSegment(nodes.lower, tmpKnee, tmpFoot, 1);
      if (nodes.foot) {
        nodes.foot.position.copy(tmpFoot);
        nodes.foot.quaternion.identity();
      }
    }
    this.applyMaterials(false);
  }

  updateStandalone(delta: number, opts: { dead?: boolean } = {}): void {
    if (!this.enabled) return;
    if (opts.dead) this.dead = true;
    if (!this.dead) return;
    this.minigunFlash = 0;
    this.cannonFlash = 0;
    this.charge = 0;
    this.root.rotation.z += delta * 0.08;
    this.applyMaterials(true);
  }

  notifyShot(): void {
    this.minigunFlash = 0.06;
  }

  notifyCannonCharge(): void {
    this.charge = 1.4;
  }

  notifyCannonShot(): void {
    this.cannonFlash = 0.18;
    this.charge = 0;
  }

  notifyAttack(): void {
    this.hitPulse = 0.28;
  }

  notifyHit(): void {
    this.hitPulse = 0.22;
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

  private applyMaterials(dead: boolean): void {
    if (this.eyeMaterial) {
      this.eyeMaterial.emissiveIntensity = dead
        ? 0.15
        : 1.6 + this.charge * 3.5 + this.hitPulse * 2.5;
    }
    if (this.minigunMaterial) {
      this.minigunMaterial.emissiveIntensity = this.minigunFlash > 0 ? 8 : 0;
    }
    if (this.cannonMaterial) {
      this.cannonMaterial.emissiveIntensity = this.cannonFlash > 0 ? 12 : this.charge * 5;
    }
  }
}

function emissiveOf(root: Object3D, name: string): MeshStandardMaterial | null {
  const node = root.getObjectByName(name);
  if (node instanceof Mesh && node.material instanceof MeshStandardMaterial) return node.material;
  return null;
}

function placeSegment(node: Object3D, start: Vector3, end: Vector3, baseLength: number): void {
  tmpDir.copy(end).sub(start);
  const length = Math.max(tmpDir.length(), 0.001);
  tmpCenter.copy(start).add(end).multiplyScalar(0.5);
  node.position.copy(tmpCenter);
  tmpDir.divideScalar(length);
  tmpQuat.setFromUnitVectors(Y_AXIS, tmpDir);
  node.quaternion.copy(tmpQuat);
  node.scale.y = length / Math.max(baseLength, 0.001);
}

function worldToLocal(out: Vector3, point: Vector3, origin: Vector3, yaw: number): Vector3 {
  const x = point.x - origin.x;
  const y = point.y - origin.y;
  const z = point.z - origin.z;
  const sin = Math.sin(-yaw);
  const cos = Math.cos(-yaw);
  return out.set(x * cos + z * sin, y, -x * sin + z * cos);
}
