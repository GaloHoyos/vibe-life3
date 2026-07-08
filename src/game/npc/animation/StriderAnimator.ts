import {
  AdditiveBlending,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import type { StriderWalkerMotor } from "@engine/physics/character/StriderWalkerMotor";
import type { AnimationFrame, NpcAnimator } from "./NpcAnimator";

const Y_AXIS = new Vector3(0, 1, 0);
const tmpDir = new Vector3();
const tmpCenter = new Vector3();
const tmpQuat = new Quaternion();
const tmpHip = new Vector3();
const tmpKnee = new Vector3();
const tmpFoot = new Vector3();

/** Azul-cyan de energía del cañón (matchea el ojo del strider). */
const CANNON_ENERGY_COLOR = 0x53c8ff;
/** Segundos de la rampa de carga (≈ CANNON_CHARGE del combate). */
const CHARGE_RAMP_TIME = 1.1;
/** Duración del flash de disparo (matchea notifyCannonShot). */
const CANNON_FLASH_TIME = 0.18;
const CHARGE_LIGHT_PEAK = 7;
const FLASH_LIGHT_PEAK = 16;
/** Esfera de energía compartida (additive). Vive lo que dura la app. */
const CHARGE_ORB_GEOMETRY = new SphereGeometry(1, 16, 12);

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
  private charging = false;
  private hitPulse = 0;

  private chargeOrb: Mesh | null = null;
  private chargeOrbMaterial: MeshBasicMaterial | null = null;
  private chargeLight: PointLight | null = null;

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
    this.attachCannonChargeFx(root.getObjectByName("strider-cannon-muzzle") ?? null);
  }

  /**
   * Orbe de energía + luz cyan en la boca del cañón. Parentados al nodo del
   * muzzle, así siguen al strider sin recalcular posición por frame. La luz suma
   * 1 al conteo del strider (boss raro): hitch de recompile de un frame al
   * spawnear, aceptable.
   */
  private attachCannonChargeFx(cannonMuzzle: Object3D | null): void {
    if (!cannonMuzzle) return;
    const orbMaterial = new MeshBasicMaterial({
      color: CANNON_ENERGY_COLOR,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const orb = new Mesh(CHARGE_ORB_GEOMETRY, orbMaterial);
    orb.visible = false;
    orb.renderOrder = 42;
    cannonMuzzle.add(orb);
    this.chargeOrb = orb;
    this.chargeOrbMaterial = orbMaterial;

    const light = new PointLight(CANNON_ENERGY_COLOR, 0, 16, 2);
    cannonMuzzle.add(light);
    this.chargeLight = light;
  }

  updateFromMotor(frame: AnimationFrame): void {
    if (!this.enabled || this.dead) return;
    const delta = frame.delta;
    this.minigunFlash = Math.max(0, this.minigunFlash - delta);
    this.cannonFlash = Math.max(0, this.cannonFlash - delta);
    this.hitPulse = Math.max(0, this.hitPulse - delta);
    // El cañon "carga" de a poco durante el telegraph (sube hasta 1 al disparar)
    // y se descarga rapido si se interrumpe. notifyCannonShot lo resetea.
    this.charge = this.charging
      ? Math.min(1, this.charge + delta / CHARGE_RAMP_TIME)
      : Math.max(0, this.charge - delta * 4);
    this.updateCannonCharge();

    if (this.body) {
      const localSideSpeed =
        frame.snapshot.velocity.x * Math.cos(-frame.snapshot.yaw) -
        frame.snapshot.velocity.z * Math.sin(-frame.snapshot.yaw);
      // Roll lateral sutil al strafe (peso). Bajo a proposito: de mas se lee como
      // un tilt raro al caminar/orbitar.
      const targetRoll = Math.max(-0.07, Math.min(0.07, -localSideSpeed * 0.01));
      this.body.rotation.z += (targetRoll - this.body.rotation.z) * Math.min(1, delta * 8);
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
    this.charging = false;
    this.updateCannonCharge();
    this.root.rotation.z += delta * 0.08;
    this.applyMaterials(true);
  }

  notifyShot(): void {
    this.minigunFlash = 0.06;
  }

  notifyCannonCharge(): void {
    this.charging = true;
  }

  notifyCannonShot(): void {
    this.charging = false;
    this.cannonFlash = CANNON_FLASH_TIME;
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
    if (this.chargeLight) {
      this.chargeLight.intensity = 0;
      this.chargeLight.removeFromParent();
      this.chargeLight = null;
    }
    if (this.chargeOrb) {
      this.chargeOrb.removeFromParent();
      this.chargeOrb = null;
    }
    if (this.chargeOrbMaterial) {
      this.chargeOrbMaterial.dispose();
      this.chargeOrbMaterial = null;
    }
  }

  setAiming(): void {}
  setActivity(): void {}
  notifyReload(): void {}

  /** Orbe de energía + luz cyan, manejados por el nivel de carga y el flash. */
  private updateCannonCharge(): void {
    const flash = this.cannonFlash > 0 ? this.cannonFlash / CANNON_FLASH_TIME : 0;
    if (this.chargeOrb && this.chargeOrbMaterial) {
      this.chargeOrb.scale.setScalar(0.12 + this.charge * 0.5 + flash * 0.3);
      this.chargeOrbMaterial.opacity = Math.min(0.9, this.charge * 0.9 + flash);
      this.chargeOrb.visible = this.charge > 0.01 || flash > 0;
    }
    if (this.chargeLight) {
      this.chargeLight.intensity = this.charge * CHARGE_LIGHT_PEAK + flash * FLASH_LIGHT_PEAK;
    }
  }

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
