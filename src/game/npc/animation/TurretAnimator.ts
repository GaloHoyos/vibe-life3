import { Color, MathUtils, Mesh, MeshStandardMaterial, Object3D } from "three";
import type { AnimationFrame, NpcAnimator } from "./NpcAnimator";
import type { TurretAimState } from "@game/npc/combat/TurretAimState";

const EYE_DORMANT = new Color(0x18ff5a);
const EYE_ACTIVE = new Color(0xff2a12);
/** Duracion (s) del destello de boca por disparo. */
const MUZZLE_FLASH = 0.05;

const tmpColor = new Color();

/**
 * Animador de la torreta de piso. No tiene esqueleto: rota el hijo nombrado
 * `turret-barrel` hacia donde apunta el cañon (leído del `TurretAimState` que
 * escribe `TurretCombat`) y enciende el `turret-eye` (verde dormida → rojo
 * activa) y el `turret-muzzle` (destello por disparo). El `Npc` lo trata vía la
 * interfaz `NpcAnimator`; los métodos de arma/postura humanoide son no-ops.
 *
 * El cuerpo (posición + tumbo 3D) lo posiciona el `Npc` desde `motor.getRotation()`;
 * acá sólo se compone la rotación **local** del cañon (yaw relativo al cuerpo +
 * cabeceo), por eso se le resta el yaw del cuerpo (`snapshot.yaw`).
 */
export class TurretAnimator implements NpcAnimator {
  private readonly barrel: Object3D | null;
  private readonly eyeMaterial: MeshStandardMaterial | null;
  private readonly muzzleMaterial: MeshStandardMaterial | null;
  private enabled = true;
  private dead = false;
  private flashTimer = 0;

  constructor(
    root: Object3D,
    private readonly aim: TurretAimState,
  ) {
    this.barrel = root.getObjectByName("turret-barrel") ?? null;
    if (this.barrel) this.barrel.rotation.order = "YXZ"; // yaw (base) luego cabeceo
    this.eyeMaterial = emissiveOf(root, "turret-eye");
    this.muzzleMaterial = emissiveOf(root, "turret-muzzle");
  }

  updateFromMotor(frame: AnimationFrame): void {
    if (!this.enabled || this.dead) return;
    if (this.flashTimer > 0) this.flashTimer = Math.max(0, this.flashTimer - 1 / 60);
    if (this.barrel) {
      this.barrel.rotation.y = this.aim.barrelYaw - frame.snapshot.yaw;
      this.barrel.rotation.x = this.aim.barrelPitch;
    }
    this.applyEye();
    this.applyMuzzle();
  }

  updateStandalone(_delta: number, opts: { dead?: boolean } = {}): void {
    if (!this.enabled) return;
    if (opts.dead) this.dead = true;
    if (this.dead && this.eyeMaterial) this.eyeMaterial.emissiveIntensity = 0;
  }

  notifyShot(): void {
    this.flashTimer = MUZZLE_FLASH;
  }

  notifyDeath(): void {
    this.dead = true;
  }

  disable(): void {
    this.enabled = false;
  }

  // El cañon se apunta vía el estado compartido; el resto es humanoide → no-ops.
  setAiming(): void {}
  setActivity(): void {}
  notifyReload(): void {}
  notifyAttack(): void {}
  notifyHit(): void {}

  private applyEye(): void {
    const mat = this.eyeMaterial;
    if (!mat) return;
    switch (this.aim.phase) {
      case "dormant":
        mat.emissive.copy(EYE_DORMANT);
        mat.emissiveIntensity = 0.4;
        break;
      case "deploying":
        mat.emissive.copy(tmpColor.copy(EYE_DORMANT).lerp(EYE_ACTIVE, this.aim.eyeLevel));
        mat.emissiveIntensity = MathUtils.lerp(0.4, 2.6, this.aim.eyeLevel);
        break;
      case "active":
        mat.emissive.copy(EYE_ACTIVE);
        mat.emissiveIntensity = 2.6;
        break;
      case "tipped":
        mat.emissive.copy(EYE_ACTIVE);
        mat.emissiveIntensity = this.aim.eyeLevel * 2.6;
        break;
      case "inert":
      case "dead":
        mat.emissiveIntensity = 0;
        break;
    }
  }

  private applyMuzzle(): void {
    const mat = this.muzzleMaterial;
    if (!mat) return;
    mat.emissiveIntensity = this.flashTimer > 0 ? 6 : 0;
  }
}

function emissiveOf(root: Object3D, name: string): MeshStandardMaterial | null {
  const node = root.getObjectByName(name);
  if (node instanceof Mesh && node.material instanceof MeshStandardMaterial) {
    return node.material;
  }
  return null;
}
