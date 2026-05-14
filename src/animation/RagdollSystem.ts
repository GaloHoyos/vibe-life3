import { Object3D, Vector3 } from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { BoneMapper } from './BoneMapper';
import { RagdollBuilder } from './RagdollBuilder';
import type { RagdollConfig } from './RagdollDefinition';
import type { RagdollController } from './RagdollController';

export interface RagdollSystemOptions {
  id: string;
  root: Object3D;
  physics: PhysicsWorld;
  mapper: BoneMapper;
  config?: Partial<RagdollConfig>;
}

export class RagdollSystem {
  private readonly builder = new RagdollBuilder();
  private controller: RagdollController | null = null;

  constructor(private readonly options: RagdollSystemOptions) {}

  activate(hitDirection?: Vector3, currentVelocity?: Vector3): RagdollController {
    if (this.controller) {
      return this.controller;
    }

    this.controller = this.builder.build({
      id: this.options.id,
      root: this.options.root,
      mapper: this.options.mapper,
      physics: this.options.physics,
      config: this.options.config,
      hitDirection,
      currentVelocity,
    });

    return this.controller;
  }

  update(delta = 0): void {
    this.controller?.update(delta);
  }

  isActive(): boolean {
    return this.controller?.isActive() ?? false;
  }

  getBodyCount(): number {
    return this.controller?.getBodyCount() ?? 0;
  }
}
