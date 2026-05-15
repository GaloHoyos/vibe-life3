import { Vector3 } from "three";

export class Perception {
  constructor(private readonly alertDistance: number) {}

  canSense(selfPosition: Vector3, targetPosition: Vector3): boolean {
    return (
      selfPosition.distanceToSquared(targetPosition) <=
      this.alertDistance * this.alertDistance
    );
  }
}
