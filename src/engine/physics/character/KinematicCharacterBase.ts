import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { createCapsuleCollider } from "@engine/physics/Colliders";
import { ACTOR_COLLISION_GROUPS } from "@engine/physics/CollisionGroups";
import {
  PHYSICS_FIXED_TIMESTEP,
  type PhysicsMetadata,
  type PhysicsWorld,
} from "@engine/physics/PhysicsWorld";
import {
  isPassThroughCharacterContact,
  sampleCharacterMedium,
  type ResolvedCharacterContact,
} from "./CharacterContactMedium";
import { PendingKinematicTarget } from "./PendingKinematicTarget";

/** Margen del clamp anti-desync del objetivo pendiente. */
const PENDING_SAFETY_MARGIN = 0.5;

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
  private simulationEnabled = true;
  private readonly pending: PendingKinematicTarget;
  private readonly stepOffset: number;
  private readonly snapToGround: number;
  private readonly tmpNext = new Vector3();

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
    this.stepOffset = options.stepOffset ?? 0.45;
    this.snapToGround = options.snapToGround ?? 0.45;
    this.controller.enableAutostep(
      this.stepOffset,
      options.stepMaxClimb ?? options.radius * 0.65,
      true,
    );
    this.controller.enableSnapToGround(this.snapToGround);
    this.pending = new PendingKinematicTarget(options.position);
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
    if (!this.simulationEnabled) {
      return {
        corrected: new Vector3(),
        grounded: false,
        medium: null,
      };
    }
    const current = this.body.translation();
    const desired = this.pending.computeDesired(
      current,
      this.velocity,
      delta,
      this.maxPendingDistance(),
    );
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
    const frameDisplacement = this.pending.commit(current, out);
    const next = this.pending.read(this.tmpNext);
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
      // `out` cubre todo lo pendiente, no sólo este frame: derivar velocidad
      // real de él daría picos de 2-3x en los frames que corren un substep.
      corrected: frameDisplacement.clone(),
      grounded: this.grounded,
      medium,
    };
  }

  /**
   * Cota del offset pendiente legítimo. La ventana sin comprometer es siempre
   * menor a un paso fijo, pero el barrido también resuelve autostep y
   * snap-to-ground, que no salen de `velocity * delta`.
   */
  private maxPendingDistance(): number {
    return (
      this.velocity.length() * PHYSICS_FIXED_TIMESTEP +
      this.stepOffset +
      this.snapToGround +
      PENDING_SAFETY_MARGIN
    );
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
    this.pending.reset(position);
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
    this.pending.reset(position);
  }

  /**
   * Re-ancla el objetivo pendiente a la pose real del cuerpo. Lo necesita todo
   * hard-set que no pase por `teleport`/`setPosition` (restore de un save,
   * montaje en un asiento): si no, el barrido del próximo frame arrastraría al
   * actor de vuelta a la pose anterior.
   */
  resyncPendingFromBody(): void {
    this.pending.reset(this.body.translation());
  }

  /** Acompaña un `setTranslation` relativo hecho por una subclase (crouch). */
  protected shiftPendingTarget(dx: number, dy: number, dz: number): void {
    this.pending.shift(dx, dy, dz);
  }

  /** Pose pendiente sin alocar. El vector devuelto es `out`. */
  protected readPendingPosition(out: Vector3): Vector3 {
    return this.pending.read(out);
  }

  /**
   * Suspende reversiblemente el actor cinemático. Un asiento deshabilita la
   * cápsula para que el ocupante no empuje el chasis que lo transporta.
   */
  setSimulationEnabled(enabled: boolean): void {
    if (this.simulationEnabled === enabled) {
      return;
    }
    this.simulationEnabled = enabled;
    this.velocity.set(0, 0, 0);
    this.grounded = false;
    this.collider.setEnabled(enabled);
    this.body.setEnabled(enabled);
    // Con el cuerpo deshabilitado Rapier nunca compromete el objetivo, así que
    // lo pendiente quedaría colgado hasta la próxima suspensión.
    this.pending.reset(this.body.translation());
  }

  isSimulationEnabled(): boolean {
    return this.simulationEnabled;
  }

  /**
   * Pose "ahora", incluyendo lo pendiente de comprometer. Devuelve una copia
   * nueva: hay consumidores (tránsito por portales) que mutan el resultado.
   */
  getPosition(): Vector3 {
    return this.pending.read(new Vector3());
  }

  getVelocity(out = new Vector3()): Vector3 {
    return out.copy(this.velocity);
  }

  isGrounded(): boolean {
    return this.grounded;
  }
}
