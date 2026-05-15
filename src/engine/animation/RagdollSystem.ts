import { Object3D, Vector3 } from 'three';
import type { Damageable } from '../../shared/types/lifecycle';
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

/**
 * Fachada única para el ragdoll de un personaje. Expone dos modos:
 *
 * 1. **`liveSensors`** — el personaje está vivo. `ensureLiveSensors()`
 *    crea un `PhysicalSkeleton` con bodies *kinematic-sensor* siguiendo
 *    cada hueso. Estos cuerpos se usan SOLO para recibir hits con body
 *    parts; no afectan a la física ni desplazan al `CharacterMotor`.
 *    El esqueleto visual lo conduce el animador procedural.
 *
 * 2. **`passiveRagdoll`** — el personaje murió. `activate(direction, vel,
 *    partName)` desactiva los sensores vivos y construye (lazy) un
 *    `RagdollController` con joints físicos reales. A partir de ahí,
 *    el cuerpo cae y reacciona a impulsos como cualquier rigidbody.
 *
 * La transición es unidireccional: una vez activado el passive ragdoll
 * no se vuelve a sensores. Reutilizar la misma instancia para revivir
 * NPCs no está soportado en el flujo actual.
 */
export class RagdollSystem {
  private readonly builder = new RagdollBuilder();
  private sensorSkeleton: PhysicalSkeleton | null = null;
  private controller: RagdollController | null = null;

  constructor(private readonly options: RagdollSystemOptions) {}

  /** Construye el ragdoll físico real (lazy). Usado al pasar a passiveRagdoll. */
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

  /**
   * Modo `liveSensors`: bodies kinematic-sensor que siguen los huesos
   * para que las balas detecten hits por body part sin alterar la física.
   */
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

  /**
   * Transiciona a modo `passiveRagdoll`: desactiva los sensores vivos,
   * construye el ragdoll físico (si no existía), le aplica el impulso
   * direccional y clampa la velocidad inicial heredada del motor.
   */
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
