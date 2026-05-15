import { MathUtils, Vector2 } from 'three';
import type { RecoilDefinition } from './WeaponDefinition';

export class Recoil {
  readonly offset = new Vector2();

  add(definition: RecoilDefinition): void {
    this.offset.x += (Math.random() - 0.5) * definition.horizontal;
    this.offset.y += definition.vertical;
  }

  update(delta: number, recovery = 10): void {
    this.offset.x = MathUtils.damp(this.offset.x, 0, recovery, delta);
    this.offset.y = MathUtils.damp(this.offset.y, 0, recovery, delta);
  }
}
