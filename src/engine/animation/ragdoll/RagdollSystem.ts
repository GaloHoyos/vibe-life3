import { Object3D, Vector3 } from 'three';

const ZERO_VECTOR = new Vector3();
import type { Damageable } from '@shared/types/lifecycle';
import type { CharacterId } from '@engine/characters/CharacterDefinition';
import type { PhysicsWorld } from '@engine/physics/PhysicsWorld';
import { BoneMapper } from '@engine/animation/pose/BoneMapper';
import { PhysicalSkeleton } from './PhysicalSkeleton';
import { RagdollBuilder } from './RagdollBuilder';
import { DefaultRagdollConfig, type RagdollConfig } from './RagdollDefinition';
import type { RagdollController } from './RagdollController';
import { captureRestPose, type RagdollRestPose } from './RagdollRestPose';

export interface RagdollSystemOptions {
  id: string;
  root: Object3D;
  physics: PhysicsWorld;
  mapper: BoneMapper;
  config?: Partial<RagdollConfig>;
  characterId?: CharacterId;
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
  private readonly restPose: RagdollRestPose | null;
  private sensorSkeleton: PhysicalSkeleton | null = null;
  private controller: RagdollController | null = null;
  private disposed = false;

  constructor(private readonly options: RagdollSystemOptions) {
    // Captured at construction: the load pose is the rest pose (same contract
    // as PoseSnapshot). Canonical joint frames depend on this reference.
    this.restPose = captureRestPose(options.root, options.mapper);
  }

  /** Construye el ragdoll fÃ­sico real (lazy). Usado al pasar a passiveRagdoll. */
  ensureBuilt(): RagdollController {
    if (this.disposed) {
      throw new Error(`[RagdollSystem] '${this.options.id}' ya fue disposed.`);
    }
    if (this.controller) {
      return this.controller;
    }

    this.controller = this.builder.build({
      id: this.options.id,
      root: this.options.root,
      mapper: this.options.mapper,
      physics: this.options.physics,
      config: this.options.config,
      characterId: this.options.characterId,
      owner: this.options.owner,
      restPose: this.restPose,
    });

    return this.controller;
  }

  /**
   * Modo `liveSensors`: bodies kinematic-sensor que siguen los huesos
   * para que las balas detecten hits por body part sin alterar la fÃ­sica.
   */
  ensureLiveSensors(): PhysicalSkeleton | null {
    if (this.disposed) return null;
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
      characterId: this.options.characterId,
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
    controller.inheritVelocity(currentVelocity);
    controller.applyImpulse(hitDirection ?? ZERO_VECTOR, this.options.config?.impulseScale ?? DefaultRagdollConfig.impulseScale, hitPartName);
    return controller;
  }

  updateLiveSensors(): void {
    if (this.disposed) return;
    this.sensorSkeleton?.updateFromVisualPose();
  }

  update(delta = 0): void {
    if (this.disposed) return;
    this.controller?.update(delta);
  }

  isActive(): boolean {
    return this.controller?.isActive() ?? false;
  }

  getBodyCount(): number {
    return (this.controller?.getBodyCount() ?? 0) + (this.sensorSkeleton?.getBodyCount() ?? 0);
  }

  /** Centro de masa world-space del passive ragdoll; null antes de morir o tras cleanup. */
  getCenter(): Vector3 | null {
    return this.controller?.getCenter() ?? null;
  }

  pullToward(
    target: Vector3,
    delta: number,
    positionGain: number,
    maxSpeed: number,
    acceleration: number,
  ): void {
    this.controller?.pullToward(
      target,
      delta,
      positionGain,
      maxSpeed,
      acceleration,
    );
  }

  /** Libera tanto el cadaver pasivo como los sensores vivos. Idempotente. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sensorSkeleton?.dispose();
    this.controller?.dispose();
    this.sensorSkeleton = null;
    this.controller = null;
  }
}
