import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { createCapsuleCollider } from "@engine/physics/Colliders";
import type { PhysicsMetadata, PhysicsWorld } from "@engine/physics/PhysicsWorld";

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
      createCapsuleCollider(options.radius, options.halfHeight),
      this.body,
    );
    physics.registerCollider(this.collider, options.metadata);

    this.controller = physics.createCharacterController(options.offset ?? 0.03);
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
  ): { corrected: Vector3; grounded: boolean } {
    const desired = this.velocity.clone().multiplyScalar(delta);
    this.controller.computeColliderMovement(
      this.collider,
      desired,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      filter,
    );
    const out = this.controller.computedMovement();
    const current = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: current.x + out.x,
      y: current.y + out.y,
      z: current.z + out.z,
    });
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.velocity.y < 0) {
      this.velocity.y = 0;
    }
    return {
      corrected: new Vector3(out.x, out.y, out.z),
      grounded: this.grounded,
    };
  }

  getPosition(): Vector3 {
    const p = this.body.translation();
    return new Vector3(p.x, p.y, p.z);
  }

  isGrounded(): boolean {
    return this.grounded;
  }
}
