import type { Vector3 } from 'three';

export interface Damageable {
  /** `attackerId` permite al receptor reaccionar contra quien lo daño (aggro). */
  applyDamage(
    amount: number,
    hitDirection?: Vector3,
    hitPartName?: string,
    attackerId?: string,
    hitPoint?: Vector3,
  ): void;
  isAlive(): boolean;
}

export interface Disposable {
  dispose(): void;
}

export interface Updatable {
  update(delta: number): void;
}
