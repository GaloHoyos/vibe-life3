import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import type { Input } from "../engine/Input";
import type { CameraSystem } from "../render/CameraSystem";
import type { PhysicsWorld } from "./PhysicsWorld";
import { createCapsuleCollider } from "./Colliders";

export interface CharacterControllerOptions {
  position: Vector3;
  radius: number;
  halfHeight: number;
  speed: number;
  jumpSpeed: number;
  eyeHeight: number;
}

export class CharacterController {
  readonly rigidBody: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;

  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly velocity = new Vector3();
  private readonly desiredMovement = new Vector3();
  private grounded = false;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly options: CharacterControllerOptions,
  ) {
    this.rigidBody = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        options.position.x,
        options.position.y,
        options.position.z,
      ),
    );
    this.collider = physics.world.createCollider(
      createCapsuleCollider(options.radius, options.halfHeight),
      this.rigidBody,
    );
    physics.registerCollider(this.collider, { id: "player", kind: "player" });
    this.controller = physics.createCharacterController(0.03);
    this.controller.enableAutostep(0.45, 0.25, true);
    this.controller.enableSnapToGround(0.45);
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

    this.velocity.y += -28 * delta;

    this.desiredMovement.set(
      this.velocity.x * delta,
      this.velocity.y * delta,
      this.velocity.z * delta,
    );

    this.controller.computeColliderMovement(
      this.collider,
      this.desiredMovement,
    );
    const corrected = this.controller.computedMovement();
    const current = this.rigidBody.translation();

    this.rigidBody.setNextKinematicTranslation({
      x: current.x + corrected.x,
      y: current.y + corrected.y,
      z: current.z + corrected.z,
    });

    this.grounded = this.controller.computedGrounded();

    if (this.grounded && this.velocity.y < 0) {
      this.velocity.y = 0;
    }
  }

  getPosition(): Vector3 {
    const position = this.rigidBody.translation();
    return new Vector3(position.x, position.y, position.z);
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
