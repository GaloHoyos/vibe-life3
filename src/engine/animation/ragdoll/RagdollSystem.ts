import { Object3D, Vector3 } from 'three';

const ZERO_VECTOR = new Vector3();
import type { Damageable } from '@shared/types/lifecycle';
import type { PhysicsWorld } from '@engine/physics/PhysicsWorld';
import { BoneMapper } from '@engine/animation/pose/BoneMapper';
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
 * Fachada Ãºnica para el ragdoll de un personaje. Expone dos modos:
 *
 * 1. **`liveSensors`** â€” el personaje estÃ¡ vivo. `ensureLiveSensors()`
 *    crea un `PhysicalSkeleton` con bodies *kinematic-sensor* siguiendo
 *    cada hueso. Estos cuerpos se usan SOLO para recibir hits con body
 *    parts; no afectan a la fÃ­sica ni desplazan al `CharacterMotor`.
 *    El esqueleto visual lo conduce el animador procedural.
 *
 * 2. **`passiveRagdoll`** â€” el personaje muriÃ³. `activate(direction, vel,
 *    partName)` desactiva los sensores vivos y construye (lazy) un
 *    `RagdollController` con joints fÃ­sicos reales. A partir de ahÃ­,
 *    el cuerpo cae y reacciona a impulsos como cualquier rigidbody.
 *
 * La transiciÃ³n es unidireccional: una vez activado el passive ragdoll
 * no se vuelve a sensores. Reutilizar la misma instancia para revivir
 * NPCs no estÃ¡ soportado en el flujo actual.
 */
export class RagdollSystem {
  private readonly builder = new RagdollBuilder();
  private sensorSkeleton: PhysicalSkeleton | null = null;
  private controller: RagdollController | null = null;

  constructor(private readonly options: RagdollSystemOptions) {}

  /** Construye el ragdoll fÃ­sico real (lazy). Usado al pasar a passiveRagdoll. */
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
   * para que las balas detecten hits por body part sin alterar la fÃ­sica.
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
   * construye el ragdoll fÃ­sico (si no existÃ­a), le aplica el impulso
   * direccional y clampa la velocidad inicial heredada del motor.
   */
  activate(hitDirection?: Vector3, currentVelocity?: Vector3, hitPartName?: string): RagdollController {
    this.sensorSkeleton?.setEnabled(false);
    const controller = this.ensureBuilt();
    controller.setPassive();
    controller.clampDeathVelocity(currentVelocity);
    controller.applyImpulse(hitDirection ?? ZERO_VECTOR, this.options.config?.impulseScale ?? 0.35, hitPartName);
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
