import { Object3D, Vector3 } from 'three';
import type { Damageable } from '../engine/GameObject';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { BoneMapper } from './BoneMapper';
import { PhysicalSkeleton } from './PhysicalSkeleton';
import { RagdollBuilder } from './RagdollBuilder';
import type { RagdollConfig } from './RagdollDefinition';
import type { RagdollController } from './RagdollController';

export interface RagdollSystemOptions {
  id: string;
  root: Object3D;
  physics: PhysicsWorld;
  mapper: BoneMapper;
  config?: Partial<RagdollConfig>;
  owner?: Damageable;
}

export class RagdollSystem {
  private readonly builder = new RagdollBuilder();
  private sensorSkeleton: PhysicalSkeleton | null = null;
  private controller: RagdollController | null = null;

  constructor(private readonly options: RagdollSystemOptions) {}

  ensureBuilt(): RagdollController {
    if (this.controller) {
      return this.controller;
    }

    this.controller = this.builder.build({
      id: this.options.id,
      root: this.options.root,
      mapper: this.options.mapper,
      physics: this.options.physics,
      config: this.options.config,
      owner: this.options.owner,
    });

    return this.controller;
  }

  ensureLiveSensors(): PhysicalSkeleton | null {
    if (this.sensorSkeleton || !(this.options.config?.bodyPartCollisions ?? true)) {
      return this.sensorSkeleton;
    }

    if (!this.options.mapper.hasSkeleton()) {
      return null;
    }

    this.sensorSkeleton = new PhysicalSkeleton({
      id: this.options.id,
      mapper: this.options.mapper,
      physics: this.options.physics,
      config: this.options.config,
      owner: this.options.owner,
    });

    return this.sensorSkeleton;
  }

  activate(hitDirection?: Vector3, currentVelocity?: Vector3, hitPartName?: string): RagdollController {
    this.sensorSkeleton?.setEnabled(false);
    const controller = this.ensureBuilt();
    controller.setPassive();
    controller.clampDeathVelocity(currentVelocity);
    controller.applyImpulse(hitDirection ?? new Vector3(), this.options.config?.impulseScale ?? 0.35, hitPartName);
    return controller;
  }

  updateLiveSensors(): void {
    this.sensorSkeleton?.updateFromVisualPose();
  }

  update(delta = 0): void {
    this.controller?.update(delta);
  }

  isActive(): boolean {
    return this.controller?.isActive() ?? false;
  }

  getBodyCount(): number {
    return (this.controller?.getBodyCount() ?? 0) + (this.sensorSkeleton?.getBodyCount() ?? 0);
  }
}
