import { Vector3 } from "three";
import type { Input } from "../Input";
import type { CameraSystem } from "../render/CameraSystem";
import { KinematicCharacterBase } from "./KinematicCharacterBase";
import type { PhysicsWorld } from "./PhysicsWorld";

const PlayerGravity = 28;

export interface CharacterControllerOptions {
  position: Vector3;
  radius: number;
  halfHeight: number;
  speed: number;
  jumpSpeed: number;
  eyeHeight: number;
}

/** Character controller del jugador: WASD + salto + cámara FPS. */
export class CharacterController extends KinematicCharacterBase {
  constructor(
    physics: PhysicsWorld,
    private readonly options: CharacterControllerOptions,
  ) {
    super(physics, {
      physics,
      position: options.position,
      radius: options.radius,
      halfHeight: options.halfHeight,
      metadata: { id: "player", kind: "player" },
    });
  }

  update(delta: number, input: Input, cameraSystem: CameraSystem): void {
    const moveInput = this.readMoveInput(input);
    const forward = cameraSystem.getPlanarForward();
    const right = cameraSystem.getPlanarRight();
    const horizontal = new Vector3()
      .addScaledVector(forward, moveInput.z)
      .addScaledVector(right, moveInput.x);

    if (horizontal.lengthSq() > 1) {
      horizontal.normalize();
    }

    horizontal.multiplyScalar(this.options.speed);
    this.velocity.x = horizontal.x;
    this.velocity.z = horizontal.z;

    if (this.grounded && input.wasKeyPressed("Space")) {
      this.velocity.y = this.options.jumpSpeed;
      this.grounded = false;
    }

    this.velocity.y += -PlayerGravity * delta;

    this.stepMovement(delta);
  }

  getEyePosition(): Vector3 {
    return this.getPosition().add(new Vector3(0, this.options.eyeHeight, 0));
  }

  applyImpulse(direction: Vector3, strength: number): void {
    if (strength <= 0) {
      return;
    }

    const impulse = direction.clone().normalize().multiplyScalar(strength);
    this.velocity.x += impulse.x;
    this.velocity.y += Math.max(0, impulse.y * 0.6);
    this.velocity.z += impulse.z;
  }

  private readMoveInput(input: Input): Vector3 {
    const move = new Vector3();

    if (input.isKeyDown("KeyW")) {
      move.z += 1;
    }

    if (input.isKeyDown("KeyS")) {
      move.z -= 1;
    }

    if (input.isKeyDown("KeyA")) {
      move.x -= 1;
    }

    if (input.isKeyDown("KeyD")) {
      move.x += 1;
    }

    return move;
  }
}
