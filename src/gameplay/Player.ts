import { Scene, Vector3 } from 'three';
import type { AssetManager } from '../assets/AssetManager';
import type { GameEventBus } from '../engine/GameEvents';
import type { Input } from '../engine/Input';
import type { CameraSystem } from '../render/CameraSystem';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { Raycast } from '../physics/Raycast';
import { CharacterController } from '../physics/CharacterController';
import { Health } from './Health';
import { WeaponController } from './weapons/WeaponController';

export class Player {
  readonly health = new Health(100);
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
    this.controller = new CharacterController(physics, {
      position: startPosition,
      radius: 0.35,
      halfHeight: 0.7,
      speed: 6.2,
      jumpSpeed: 9.2,
      eyeHeight: 0.62,
    });
    this.weapons = new WeaponController(eventBus, raycast, assets, scene);
    this.eventBus.emit('player.healthChanged', {
      current: this.health.current,
      max: this.health.max,
    });
    this.eventBus.emit('player.health.changed', {
      current: this.health.current,
      max: this.health.max,
    });
  }

  update(delta: number, input: Input, cameraSystem: CameraSystem, elapsed: number): void {
    this.controller.update(delta, input, cameraSystem);
    this.weapons.update(delta, input, cameraSystem, elapsed, this.getInputSpeed(input));
  }

  getPosition(): Vector3 {
    return this.controller.getPosition();
  }

  getEyePosition(): Vector3 {
    return this.controller.getEyePosition();
  }

  dispose(): void {
    this.weapons.dispose();
  }

  private getInputSpeed(input: Input): number {
    return Number(input.isKeyDown('KeyW') || input.isKeyDown('KeyA') || input.isKeyDown('KeyS') || input.isKeyDown('KeyD'));
  }
}
