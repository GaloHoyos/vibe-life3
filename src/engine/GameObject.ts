import type { Vector3 } from 'three';

export interface Damageable {
  applyDamage(amount: number, hitDirection?: Vector3): void;
  isAlive(): boolean;
}

export interface Disposable {
  dispose(): void;
}

export interface Updatable {
  update(delta: number): void;
}
