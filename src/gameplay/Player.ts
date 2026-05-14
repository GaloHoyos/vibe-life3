import { Vector3 } from 'three';
import type { GameEventBus } from '../engine/GameEvents';
import type { Input } from '../engine/Input';
import type { CameraSystem } from '../render/CameraSystem';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { Raycast } from '../physics/Raycast';
import { CharacterController } from '../physics/CharacterController';
import { Health } from './Health';
import { Inventory } from './Inventory';
import { Pistol } from './weapons/Pistol';

export class Player {
  readonly health = new Health(100);
  readonly inventory = new Inventory();
  readonly controller: CharacterController;

  constructor(
    startPosition: Vector3,
    physics: PhysicsWorld,
    raycast: Raycast,
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
    this.inventory.addWeapon(new Pistol({ eventBus, raycast }));
    this.eventBus.emit('player.healthChanged', {
      current: this.health.current,
      max: this.health.max,
    });
    const activeWeapon = this.inventory.getActiveWeapon();
    this.eventBus.emit('ammo.changed', {
      current: activeWeapon?.getAmmo() ?? 0,
      reserve: activeWeapon?.getReserveAmmo() ?? 0,
    });
  }

  update(delta: number, input: Input, cameraSystem: CameraSystem, elapsed: number): void {
    this.controller.update(delta, input, cameraSystem);

    if (input.wasMousePressed(0)) {
      this.inventory
        .getActiveWeapon()
        ?.tryFire(cameraSystem.camera.position.clone(), cameraSystem.getForwardDirection(), elapsed);
    }
  }

  getPosition(): Vector3 {
    return this.controller.getPosition();
  }

  getEyePosition(): Vector3 {
    return this.controller.getEyePosition();
  }
}
