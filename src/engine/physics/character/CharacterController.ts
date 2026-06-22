import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import type { CameraSystem } from "@engine/render/CameraSystem";
import { KinematicCharacterBase } from "./KinematicCharacterBase";
import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";

const PlayerGravity = 28;

/**
 * Snapshot de input de movimiento. El binding de teclas se resuelve fuera
 * (en `game/`) y se pasa este struct por frame â€” asÃ­ `engine/` no conoce
 * acciones especÃ­ficas del juego ni sus bindings.
 */
export interface MovementInput {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jumpPressed: boolean;
  sprintDown: boolean;
  crouchDown: boolean;
}

export interface CharacterControllerOptions {
  position: Vector3;
  radius: number;
  standingHalfHeight: number;
  crouchHalfHeight: number;
  standingEyeHeight: number;
  crouchEyeHeight: number;
  walkSpeed: number;
  sprintSpeed: number;
  crouchSpeed: number;
  jumpSpeed: number;
  groundAccelerate: number;
  airAccelerate: number;
  maxAirWishSpeed: number;
  friction: number;
  stopSpeed: number;
  crouchTransitionTime: number;
}

type MoveState = "walk" | "sprint" | "crouch";

const TMP_MOVE_INPUT = new Vector3();
const TMP_STAND_UP = { x: 0, y: 1, z: 0 } as const;

/**
 * Character controller del jugador estilo Half-Life 2.
 *
 * WASD + salto + sprint (Shift) + crouch (Ctrl). El movimiento se basa en
 * `friction` (cuando hay grounded) + `accelerate` (ground o air): la velocidad
 * NO se reemplaza por frame, asÃ­ que en el aire se preserva el momentum y el
 * input solo ajusta la direcciÃ³n dentro de un `maxAirWishSpeed` cap.
 */
export class CharacterController extends KinematicCharacterBase {
  private currentHalfHeight: number;
  private crouchProgress = 0;
  private wantsCrouch = false;
  private wantsSprint = false;
  private moveState: MoveState = "walk";
  private readonly tmpEye = new Vector3();
  private readonly tmpWishDir = new Vector3();
  private readonly tmpImpulse = new Vector3();
  private readonly tmpRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, TMP_STAND_UP);

  constructor(
    physics: PhysicsWorld,
    private readonly options: CharacterControllerOptions,
  ) {
    super(physics, {
      physics,
      position: options.position,
      radius: options.radius,
      halfHeight: options.standingHalfHeight,
      metadata: { id: "player", kind: "player" },
    });
    this.currentHalfHeight = options.standingHalfHeight;
  }

  update(delta: number, move: MovementInput, cameraSystem: CameraSystem): void {
    this.wantsSprint = move.sprintDown;
    this.wantsCrouch = move.crouchDown;

    const wishDir = this.computeWishDir(move, cameraSystem);
    const wantsMove = wishDir.lengthSq() > 0;

    this.updateCrouch(delta);
    this.moveState = this.computeMoveState(wantsMove);

    const wishSpeed = this.getWishSpeed();

    if (this.grounded) {
      this.applyFriction(delta);
      this.accelerate(wishDir, wishSpeed, this.options.groundAccelerate, delta);
    } else {
      const airWishSpeed = Math.min(wishSpeed, this.options.maxAirWishSpeed);
      this.accelerate(wishDir, airWishSpeed, this.options.airAccelerate, delta);
    }

    if (this.grounded && move.jumpPressed) {
      this.velocity.y = this.options.jumpSpeed;
      this.grounded = false;
    }

    this.velocity.y += -PlayerGravity * delta;

    this.stepMovement(delta);
  }

  getEyePosition(): Vector3 {
    const eyeOffset = lerp(
      this.options.standingEyeHeight,
      this.options.crouchEyeHeight,
      this.crouchProgress,
    );
    const p = this.body.translation();
    return this.tmpEye.set(p.x, p.y + eyeOffset, p.z);
  }

  applyImpulse(direction: Vector3, strength: number): void {
    if (strength <= 0) {
      return;
    }

    this.tmpImpulse.copy(direction).normalize().multiplyScalar(strength);
    this.velocity.x += this.tmpImpulse.x;
    this.velocity.y += Math.max(0, this.tmpImpulse.y * 0.6);
    this.velocity.z += this.tmpImpulse.z;
  }

  /** Intensidad horizontal normalizada por `walkSpeed` (sprint â‰ˆ 1.5, crouch â‰ˆ 0.4). */
  getMoveIntensity(): number {
    const horizontal = Math.hypot(this.velocity.x, this.velocity.z);
    return horizontal / this.options.walkSpeed;
  }

  isCrouched(): boolean {
    return this.crouchProgress > 0.5;
  }

  isSprinting(): boolean {
    return this.moveState === "sprint";
  }

  private computeWishDir(move: MovementInput, cameraSystem: CameraSystem): Vector3 {
    const moveInput = readMoveInput(move);
    const forward = cameraSystem.getPlanarForward();
    const right = cameraSystem.getPlanarRight();
    this.tmpWishDir
      .set(0, 0, 0)
      .addScaledVector(forward, moveInput.z)
      .addScaledVector(right, moveInput.x);

    if (this.tmpWishDir.lengthSq() > 1) {
      this.tmpWishDir.normalize();
    }

    return this.tmpWishDir;
  }

  private computeMoveState(wantsMove: boolean): MoveState {
    if (this.crouchProgress > 0.5) {
      return "crouch";
    }

    if (this.wantsSprint && wantsMove && this.grounded) {
      return "sprint";
    }

    return "walk";
  }

  private getWishSpeed(): number {
    switch (this.moveState) {
      case "crouch":
        return this.options.crouchSpeed;
      case "sprint":
        return this.options.sprintSpeed;
      case "walk":
        return this.options.walkSpeed;
    }
  }

  private applyFriction(delta: number): void {
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (speed < 0.05) {
      this.velocity.x = 0;
      this.velocity.z = 0;
      return;
    }

    const control =
      speed < this.options.stopSpeed ? this.options.stopSpeed : speed;
    const drop = control * this.options.friction * delta;
    const newSpeed = Math.max(0, speed - drop);
    const scale = newSpeed / speed;
    this.velocity.x *= scale;
    this.velocity.z *= scale;
  }

  /** Quake-style accelerate: empuja la velocidad horizontal hacia `wishDir * wishSpeed`. */
  private accelerate(
    wishDir: Vector3,
    wishSpeed: number,
    accel: number,
    delta: number,
  ): void {
    if (wishSpeed <= 0 || wishDir.lengthSq() === 0) {
      return;
    }

    const currentSpeed =
      this.velocity.x * wishDir.x + this.velocity.z * wishDir.z;
    const addSpeed = wishSpeed - currentSpeed;
    if (addSpeed <= 0) {
      return;
    }

    let accelSpeed = accel * wishSpeed * delta;
    if (accelSpeed > addSpeed) {
      accelSpeed = addSpeed;
    }

    this.velocity.x += wishDir.x * accelSpeed;
    this.velocity.z += wishDir.z * accelSpeed;
  }

  private updateCrouch(delta: number): void {
    const targetProgress = this.wantsCrouch ? 1 : this.canStand() ? 0 : 1;
    if (targetProgress === this.crouchProgress) {
      return;
    }

    const transitionRate = 1 / Math.max(this.options.crouchTransitionTime, 0.001);
    const direction = Math.sign(targetProgress - this.crouchProgress);
    const next = this.crouchProgress + direction * transitionRate * delta;
    this.crouchProgress =
      direction > 0 ? Math.min(targetProgress, next) : Math.max(targetProgress, next);

    const newHalfHeight = lerp(
      this.options.standingHalfHeight,
      this.options.crouchHalfHeight,
      this.crouchProgress,
    );
    const halfHeightDelta = newHalfHeight - this.currentHalfHeight;
    if (halfHeightDelta === 0) {
      return;
    }

    this.collider.setHalfHeight(newHalfHeight);
    if (this.grounded) {
      // Crouch normal: bajamos el centro para que los pies queden anclados.
      const t = this.body.translation();
      this.body.setTranslation(
        { x: t.x, y: t.y + halfHeightDelta, z: t.z },
        true,
      );
    }
    // Crouch jump (HL1/HL2): en el aire NO trasladamos el cuerpo, asÃ­ los pies
    // suben por la cÃ¡psula achicada y se gana clearance para subir bordes que
    // un salto normal no alcanza. La cÃ¡mara baja vÃ­a `eyeOffset` interpolado.
    this.currentHalfHeight = newHalfHeight;
  }

  private canStand(): boolean {
    if (this.crouchProgress <= 0) {
      return true;
    }

    const clearance =
      2 * (this.options.standingHalfHeight - this.currentHalfHeight);
    if (clearance <= 0.001) {
      return true;
    }

    const t = this.body.translation();
    const headY = t.y + this.currentHalfHeight + this.options.radius;
    const r = this.options.radius * 0.6;
    const probes: ReadonlyArray<readonly [number, number]> = [
      [0, 0],
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ];

    for (const [dx, dz] of probes) {
      this.tmpRay.origin.x = t.x + dx;
      this.tmpRay.origin.y = headY;
      this.tmpRay.origin.z = t.z + dz;
      const hit = this.physics.world.castRay(
        this.tmpRay,
        clearance + 0.05,
        true,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        undefined,
        this.body,
      );
      if (hit !== null) {
        return false;
      }
    }

    return true;
  }

}

function readMoveInput(move: MovementInput): Vector3 {
  TMP_MOVE_INPUT.set(0, 0, 0);
  if (move.forward) TMP_MOVE_INPUT.z += 1;
  if (move.back) TMP_MOVE_INPUT.z -= 1;
  if (move.left) TMP_MOVE_INPUT.x -= 1;
  if (move.right) TMP_MOVE_INPUT.x += 1;
  return TMP_MOVE_INPUT;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
