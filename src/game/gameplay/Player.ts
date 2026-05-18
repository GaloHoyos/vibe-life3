import { Scene, Vector3 } from "three";
import type { AssetManager } from "../../engine/assets/AssetManager";
import type { GameEventBus } from "../GameEvents";
import type { Input } from "../../engine/Input";
import type { CameraSystem } from "../../engine/render/CameraSystem";
import type { PhysicsWorld } from "../../engine/physics/PhysicsWorld";
import type { Raycast } from "../../engine/physics/Raycast";
import {
  CharacterController,
  type MovementInput,
} from "../../engine/physics/CharacterController";
import type { Damageable } from "../../shared/types/lifecycle";
import { PlayerConfig } from "../config/gameplay.config";
import type { Controls } from "./Controls";
import { PlayerHealth } from "./PlayerHealth";
import { Stamina } from "./Stamina";
import { WeaponController } from "./weapons/WeaponController";

export class Player implements Damageable {
  readonly health: PlayerHealth;
  readonly stamina: Stamina;
  readonly controller: CharacterController;
  readonly weapons: WeaponController;

  constructor(
    startPosition: Vector3,
    physics: PhysicsWorld,
    raycast: Raycast,
    assets: AssetManager,
    scene: Scene,
    private readonly eventBus: GameEventBus,
  ) {
    this.health = new PlayerHealth(
      eventBus,
      PlayerConfig.vitals.maxHealth,
      PlayerConfig.vitals.armorMax,
    );
    this.stamina = new Stamina(eventBus);
    this.controller = new CharacterController(physics, {
      position: startPosition,
      radius: PlayerConfig.collider.radius,
      standingHalfHeight: PlayerConfig.collider.standingHalfHeight,
      crouchHalfHeight: PlayerConfig.collider.crouchHalfHeight,
      standingEyeHeight: PlayerConfig.collider.standingEyeHeight,
      crouchEyeHeight: PlayerConfig.collider.crouchEyeHeight,
      walkSpeed: PlayerConfig.movement.walkSpeed,
      sprintSpeed: PlayerConfig.movement.sprintSpeed,
      crouchSpeed: PlayerConfig.movement.crouchSpeed,
      jumpSpeed: PlayerConfig.movement.jumpSpeed,
      groundAccelerate: PlayerConfig.movement.groundAccelerate,
      airAccelerate: PlayerConfig.movement.airAccelerate,
      maxAirWishSpeed: PlayerConfig.movement.maxAirWishSpeed,
      friction: PlayerConfig.movement.friction,
      stopSpeed: PlayerConfig.movement.stopSpeed,
      crouchTransitionTime: PlayerConfig.movement.crouchTransitionTime,
    });
    physics.registerCollider(this.controller.collider, {
      id: "player",
      kind: "player",
      damageable: this,
    });
    this.weapons = new WeaponController(eventBus, raycast, assets, scene);
  }

  update(
    delta: number,
    input: Input,
    controls: Controls,
    cameraSystem: CameraSystem,
    elapsed: number,
  ): void {
    if (this.health.isDead) {
      return;
    }

    this.controller.update(
      delta,
      readMovement(controls, this.stamina),
      cameraSystem,
    );
    this.weapons.update(
      delta,
      input,
      controls,
      cameraSystem,
      elapsed,
      this.controller.getMoveIntensity(),
    );
    this.stamina.tick(delta, this.controller.isSprinting());
  }

  getPosition(): Vector3 {
    return this.controller.getPosition();
  }

  getEyePosition(): Vector3 {
    return this.controller.getEyePosition();
  }

  getMoveIntensity(): number {
    return this.controller.getMoveIntensity();
  }

  dispose(): void {
    this.weapons.dispose();
  }

  applyDamage(amount: number, hitDirection?: Vector3): void {
    this.health.takeDamage(amount, "npc", hitDirection);
  }

  applyKnockback(direction: Vector3, strength: number): void {
    this.controller.applyImpulse(direction, strength);
  }

  isAlive(): boolean {
    return this.health.isAlive();
  }
}

function readMovement(controls: Controls, stamina: Stamina): MovementInput {
  return {
    forward: controls.isDown("moveForward"),
    back: controls.isDown("moveBack"),
    left: controls.isDown("moveLeft"),
    right: controls.isDown("moveRight"),
    jumpPressed: controls.wasPressed("jump"),
    sprintDown: controls.isDown("sprint") && !stamina.isDepleted(),
    crouchDown: controls.isDown("crouch"),
  };
}
