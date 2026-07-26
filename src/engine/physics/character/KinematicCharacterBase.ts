import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { createCapsuleCollider } from "@engine/physics/Colliders";
import { ACTOR_COLLISION_GROUPS } from "@engine/physics/CollisionGroups";
import type { PhysicsMetadata, PhysicsWorld } from "@engine/physics/PhysicsWorld";
import {
  isPassThroughCharacterContact,
  sampleCharacterMedium,
  type ResolvedCharacterContact,
} from "./CharacterContactMedium";

export interface KinematicCharacterBaseOptions {
  physics: PhysicsWorld;
  position: Vector3;
  radius: number;
  /** Mitad de la secciÃ³n cilÃ­ndrica de la cÃ¡psula (sin contar los hemisferios). */
  halfHeight: number;
  metadata: PhysicsMetadata;
  /** Offset interno del Rapier `KinematicCharacterController`. Default 0.03. */
  offset?: number;
  /** Auto-step mÃ¡ximo en altura. */
  stepOffset?: number;
  /** Auto-step distancia horizontal mÃ­nima. */
  stepMaxClimb?: number;
  /** Snap-to-ground threshold. */
  snapToGround?: number;
  /** Masa virtual usada al transferir impulso a rigid bodies dinámicos. */
  dynamicPushMass?: number;
}

/**
 * Base compartida entre Player (`CharacterController`) y NPC (`CharacterMotor`).
 *
 * Encapsula:
 *  - cuerpo `kinematic-positionBased` + cÃ¡psula
 *  - `KinematicCharacterController` de Rapier con autostep/snap-to-ground
 *  - acumulador de velocidad (incluido manejo de gravedad al tocar suelo)
 *  - bucle estÃ¡ndar `computeColliderMovement â†’ setNextKinematicTranslation`
 *
 * Las subclases definen *quÃ©* velocidad asignan (input vs IA) y, opcionalmente,
 * la rotaciÃ³n del body (`setNextKinematicRotation`).
 */
export abstract class KinematicCharacterBase {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  protected readonly controller: RAPIER.KinematicCharacterController;
  protected readonly velocity = new Vector3();
  protected grounded = false;
  protected contactSpeedMultiplier = 1;
  private readonly characterMass: number;

  constructor(
    protected readonly physics: PhysicsWorld,
    options: KinematicCharacterBaseOptions,
  ) {
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        options.position.x,
        options.position.y,
        options.position.z,
      ),
    );
    this.collider = physics.world.createCollider(
      createCapsuleCollider(options.radius, options.halfHeight).setCollisionGroups(ACTOR_COLLISION_GROUPS),
      this.body,
    );
    physics.registerCollider(this.collider, options.metadata);

    this.controller = physics.createCharacterController(options.offset ?? 0.03);
    const dynamicPushMass = Math.max(0, options.dynamicPushMass ?? 0);
    this.characterMass = dynamicPushMass;
    if (dynamicPushMass > 0) {
      this.controller.setApplyImpulsesToDynamicBodies(true);
      this.controller.setCharacterMass(dynamicPushMass);
    }
    this.controller.enableAutostep(
      options.stepOffset ?? 0.45,
      options.stepMaxClimb ?? options.radius * 0.65,
      true,
    );
    this.controller.enableSnapToGround(options.snapToGround ?? 0.45);
  }

  /**
   * Aplica `this.velocity` durante `delta` resolviendo colisiones contra el
   * mundo. Devuelve el desplazamiento corregido para que las subclases
   * puedan derivar velocidad real / yaw / etc.
   */
  protected stepMovement(
    delta: number,
    filter?: (collider: RAPIER.Collider) => boolean,
  ): {
    corrected: Vector3;
    grounded: boolean;
    medium: ResolvedCharacterContact | null;
  } {
    const desired = this.velocity.clone().multiplyScalar(delta);
    // filterGroups explícito: computeColliderMovement NO respeta los collision
    // groups del collider movido por sí solo. Sin esto la cápsula choca con
    // colliders que la excluyen por grupo (parche de apertura de portales,
    // ragdolls) y se frena contra "paredes invisibles".
    this.controller.computeColliderMovement(
      this.collider,
      desired,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      this.collider.collisionGroups(),
      (collider) =>
        !isPassThroughCharacterContact(this.physics, collider) &&
        (filter?.(collider) ?? true),
    );
    const out = this.controller.computedMovement();
    const current = this.body.translation();
    const next = {
      x: current.x + out.x,
      y: current.y + out.y,
      z: current.z + out.z,
    };
    this.body.setNextKinematicTranslation(next);
    const medium = sampleCharacterMedium({
      physics: this.physics,
      collider: this.collider,
      position: next,
      rotation: this.body.rotation(),
      velocity: this.velocity,
      delta,
      characterMass: this.characterMass,
    });
    this.contactSpeedMultiplier = medium?.speedScale ?? 1;
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.velocity.y < 0) {
      this.velocity.y = 0;
    }
    return {
      corrected: new Vector3(out.x, out.y, out.z),
      grounded: this.grounded,
      medium,
    };
  }

  /**
   * Hard-set de posición + velocidad (portales/teleports). Usa `setTranslation`
   * y no `setNextKinematicTranslation`: el salto debe ser instantáneo, sin que
   * el solver interpole un frame de movimiento gigante.
   */
  teleport(position: Vector3, velocity: Vector3): void {
    this.body.setTranslation(
      { x: position.x, y: position.y, z: position.z },
      true,
    );
    this.body.setNextKinematicTranslation({
      x: position.x,
      y: position.y,
      z: position.z,
    });
    this.velocity.copy(velocity);
    this.grounded = false;
  }

  /**
   * Corrección posicional dura sin tocar velocidad ni grounded (clamp del
   * hueco de un portal). A diferencia de `teleport`, preserva el momentum.
   */
  setPosition(position: Vector3): void {
    this.body.setTranslation(
      { x: position.x, y: position.y, z: position.z },
      true,
    );
    this.body.setNextKinematicTranslation({
      x: position.x,
      y: position.y,
      z: position.z,
    });
  }

  getPosition(): Vector3 {
    const p = this.body.translation();
    return new Vector3(p.x, p.y, p.z);
  }

  getVelocity(out = new Vector3()): Vector3 {
    return out.copy(this.velocity);
  }

  isGrounded(): boolean {
    return this.grounded;
  }
}
