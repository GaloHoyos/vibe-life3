import { Vector3 } from 'three';

export class CombatAI {
  constructor(private readonly moveSpeed: number) {}

  computeChaseVelocity(selfPosition: Vector3, targetPosition: Vector3): Vector3 {
    const direction = targetPosition.clone().sub(selfPosition);
    direction.y = 0;

    if (direction.lengthSq() < 0.05) {
      return new Vector3();
    }

    return direction.normalize().multiplyScalar(this.moveSpeed);
  }
}
