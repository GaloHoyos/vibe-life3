import { Scene, Vector3 } from "three";
import type { AssetManager } from "../../engine/assets/AssetManager";
import type { GameEventBus } from "../GameEvents";
import type { Input } from "../../engine/Input";
import type { CameraSystem } from "../../engine/render/CameraSystem";
import type { PhysicsWorld } from "../../engine/physics/PhysicsWorld";
import type { Raycast } from "../../engine/physics/Raycast";
import { CharacterController } from "../../engine/physics/CharacterController";
import type { Damageable } from "../../shared/types/lifecycle";
import { PlayerConfig } from "../config/gameplay.config";
import { PlayerHealth } from "./PlayerHealth";
import { WeaponController } from "./weapons/WeaponController";

export class Player implements Damageable {
  readonly health: PlayerHealth;
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
    this.controller = new CharacterController(physics, {
      position: startPosition,
      radius: PlayerConfig.collider.radius,
      halfHeight: PlayerConfig.collider.halfHeight,
      speed: PlayerConfig.movement.speed,
      jumpSpeed: PlayerConfig.movement.jumpSpeed,
      eyeHeight: PlayerConfig.collider.eyeHeight,
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
    cameraSystem: CameraSystem,
    elapsed: number,
  ): void {
    if (this.health.isDead) {
      return;
    }

    this.controller.update(delta, input, cameraSystem);
    this.weapons.update(
      delta,
      input,
      cameraSystem,
      elapsed,
      this.getInputSpeed(input),
    );
  }

  getPosition(): Vector3 {
    return this.controller.getPosition();
  }

  getEyePosition(): Vector3 {
    return this.controller.getEyePosition();
  }

  getMoveIntensity(input: Input): number {
    return this.getInputSpeed(input);
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

  private getInputSpeed(input: Input): number {
    return Number(
      input.isKeyDown("KeyW") ||
        input.isKeyDown("KeyA") ||
        input.isKeyDown("KeyS") ||
        input.isKeyDown("KeyD"),
    );
  }
}
