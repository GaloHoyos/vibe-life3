import type { Vector3 } from "three";
import type {
  AnimationActivity,
  GestureId,
  WeaponHandedness,
} from "@engine/animation/AnimationInput";
import type { CharacterMotorSnapshot } from "@engine/physics/character/CharacterMotor";

export interface AnimationFrame {
  snapshot: CharacterMotorSnapshot;
  lookTarget: Vector3;
  balanceIsStumbling: boolean;
  /** Segundos del frame; los decays temporales (flashes) deben usar esto. */
  delta: number;
}

/**
 * Superficie que el runtime `Npc` (y las closures de combat) consume del
 * animador, agnostica de si el cuerpo es humanoide (`NpcAnimationBridge`) o
 * una criatura no-humanoide (`CreatureAnimator`). Mantenerla minima: solo lo
 * que el `Npc` invoca. El bridge humanoide expone ademas `setCrouch`/
 * `setLeanSide`, que el runtime no usa y por eso quedan fuera de la interfaz.
 */
export interface NpcAnimator {
  updateFromMotor(frame: AnimationFrame): void;
  updateStandalone(delta: number, opts?: { dead?: boolean }): void;
  setAiming(target: Vector3 | null, pose?: WeaponHandedness): void;
  setActivity(activity: AnimationActivity): void;
  setCrouch?(amount: number): void;
  notifyShot(): void;
  notifyReload(duration: number): void;
  notifyAttack(): void;
  /** Dispara un gesto procedural nombrado (secuencias guionadas). Opcional. */
  playGesture?(id: GestureId, duration: number): void;
  notifyHit(direction: Vector3, intensityFraction: number): void;
  notifyDeath(
    direction: Vector3 | undefined,
    velocity: Vector3,
    partName: string | undefined,
  ): void;
  disable(): void;
}
