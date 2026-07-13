import RAPIER from '@dimforge/rapier3d-compat';
import { MathUtils, Mesh, Quaternion, Vector3 } from 'three';
import type {
  BlobParticle,
  BlobParticleMotionResolver,
  BlobResolvedMotion,
} from '@engine/blob/BlobTypes';
import type { BlobOrganismRuntime } from '@engine/blob/BlobOrganismRuntime';
import type { PhysicsMetadata, PhysicsWorld } from '@engine/physics/PhysicsWorld';
import type { CharacterMotorSnapshot, NpcMotor, SliceHit } from './NpcMotor';

export interface BlobMotorConfig {
  id: string;
  maxSpeed: number;
  acceleration: number;
  turnSpeed: number;
  metadata: PhysicsMetadata;
  /** Downward acceleration (m/s²) fed into the organism simulation. */
  gravity?: number;
  /** Ledge height the ooze pours over instantly (Valve's elevated trace). */
  stepUpHeight?: number;
  /** Upward flow speed while pressure holds the mass against a wall. */
  climbSpeed?: number;
  /** Maximum height above the component's support the ooze can climb. */
  maxClimb?: number;
  /** Cap on the velocity change shoved props may receive, in Δv per second. */
  propPushMaxDeltaV?: number;
  onConsumeProp?: (biomass: number, position: Vector3) => void;
}

interface PropPush {
  body: RAPIER.RigidBody;
  impulse: Vector3;
  point: Vector3;
}

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 } as const;
const Y_AXIS = new Vector3(0, 1, 0);
const SKIN = 0.015;
const MAX_SWEEPS = 3;
const MAX_DEPENETRATION_PASSES = 3;
const DEPENETRATION_SLOP = 0.002;
const MOTION_EPSILON_SQ = 1e-8;
const TOI_EPSILON = 1e-5;
const DEFAULT_GRAVITY = 18;
const DEFAULT_STEP_UP = 0.24;
const DEFAULT_CLIMB_SPEED = 2.4;
const DEFAULT_MAX_CLIMB = 1.3;
// Debe superar la desaceleración por fricción de piso (µ·g ≈ 10 m/s²) o el
// empuje nunca arranca un prop apoyado.
const DEFAULT_PROP_PUSH_MAX_DELTAV = 14;
/**
 * Blocked-flow speed → impulse factor (kg·s equivalent per particle contact).
 * Sustained pressing must beat floor friction on light props (Valve applied a
 * flat -150 force per element for the same reason).
 */
const PROP_PUSH_SPEED_TRANSFER = 0.8;
const GROUND_NORMAL_MIN_Y = 0.55;
const WALL_NORMAL_MAX_Y = 0.35;
const MIN_LEAP_UP_SPEED = 2.8;

/**
 * Motor sin cápsula sólida: el organismo se mueve mediante sweeps de sus
 * partículas. El body es únicamente un sensor diminuto que conserva el
 * contrato común de NPC/portales y nunca bloquea el mundo.
 */
export class BlobMotor implements NpcMotor {
  readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly desiredVelocity = new Vector3();
  private readonly actualVelocity = new Vector3();
  private readonly forward = new Vector3(0, 0, 1);
  private readonly rotation = new Quaternion();
  private readonly displacement = new Vector3();
  private readonly remaining = new Vector3();
  private readonly resolvedPosition = new Vector3();
  private readonly normal = new Vector3();
  private readonly resolvedVelocity = new Vector3();
  private readonly motionResult: BlobResolvedMotion = {
    position: this.resolvedPosition,
    velocity: this.resolvedVelocity,
    grounded: false,
  };
  private enabled = true;
  private speedMultiplier = 1;
  private yaw = 0;
  private targetYaw = 0;
  private distanceToTarget = Infinity;
  private portalExclusions: ReadonlySet<number> | null = null;
  private flowMergeIn = 0;
  private readonly propConsumeTimers = new Map<number, number>();
  private readonly propPushes = new Map<number, PropPush>();
  private readonly stepUpProbe = new Vector3();
  private readonly gravity: number;
  private readonly stepUpHeight: number;
  private readonly climbSpeed: number;
  private readonly maxClimb: number;
  private readonly propPushMaxDeltaV: number;

  readonly resolveParticleMotion: BlobParticleMotionResolver = (
    particle,
    from,
    desired,
  ) => this.sweepParticle(particle, from, desired);

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly runtime: BlobOrganismRuntime,
    private readonly config: BlobMotorConfig,
  ) {
    this.gravity = Math.max(0, config.gravity ?? DEFAULT_GRAVITY);
    this.stepUpHeight = Math.max(0, config.stepUpHeight ?? DEFAULT_STEP_UP);
    this.climbSpeed = Math.max(0, config.climbSpeed ?? DEFAULT_CLIMB_SPEED);
    this.maxClimb = Math.max(0, config.maxClimb ?? DEFAULT_MAX_CLIMB);
    this.propPushMaxDeltaV = Math.max(
      0,
      config.propPushMaxDeltaV ?? DEFAULT_PROP_PUSH_MAX_DELTAV,
    );
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        runtime.center.x,
        runtime.center.y,
        runtime.center.z,
      ),
    );
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.ball(0.12).setSensor(true),
      this.body,
    );
    physics.registerCollider(this.collider, {
      id: config.id,
      ownerId: config.id,
      kind: 'npc',
      characterId: config.metadata.characterId,
      faction: config.metadata.faction,
      selfPortalTraversal: false,
    });
  }

  update(
    delta: number,
    targetPosition: Vector3 | null,
    wantsMove: boolean,
    facingTarget: Vector3 | null = null,
  ): void {
    if (!this.enabled) return;
    if (this.flowMergeIn > 0) {
      this.flowMergeIn -= delta;
      if (this.flowMergeIn <= 0 && this.runtime.componentCount > 1) this.runtime.merge();
    }
    const direction = this.displacement;
    if (targetPosition) direction.copy(targetPosition).sub(this.runtime.center).setY(0);
    else direction.set(0, 0, 0);
    this.distanceToTarget = direction.length();

    const facing = facingTarget
      ? this.remaining.copy(facingTarget).sub(this.runtime.center).setY(0)
      : direction;
    if (facing.lengthSq() > 0.0025) {
      this.targetYaw = Math.atan2(facing.x, facing.z);
      const angle = Math.atan2(
        Math.sin(this.targetYaw - this.yaw),
        Math.cos(this.targetYaw - this.yaw),
      );
      this.yaw += angle * (1 - Math.exp(-this.config.turnSpeed * delta));
    }
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));

    const targetVelocity = this.remaining;
    if (wantsMove && !this.runtime.isLocomotionPaused && direction.lengthSq() > 1e-5) {
      targetVelocity
        .copy(direction)
        .normalize()
        .multiplyScalar(this.config.maxSpeed * this.speedMultiplier);
    } else {
      targetVelocity.set(0, 0, 0);
    }
    const maxChange = this.config.acceleration * Math.max(0, delta);
    const change = targetVelocity.sub(this.desiredVelocity);
    if (change.lengthSq() > maxChange * maxChange) change.setLength(maxChange);
    this.desiredVelocity.add(change);
    const airborne = this.runtime.airborne;
    if (!airborne) this.maybeSplitForPermeable(delta);

    this.runtime.step(delta, {
      anchor: this.runtime.center,
      target: wantsMove && !airborne ? targetPosition : null,
      desiredVelocity: this.desiredVelocity,
      gravity: this.gravity,
      motionResolver: this.resolveParticleMotion,
    });
    this.tickDynamicProps(delta);
    // A render frame may execute two fixed steps. Dividing both displacements
    // by the shorter render delta reported false 6-8 m/s spikes to AI/audio;
    // the solver's interpolated brain velocity is the authoritative value.
    this.actualVelocity.copy(this.runtime.velocity);
    this.syncBody();
  }

  teleportPose(position: Vector3, velocity: Vector3, yaw: number): void {
    const deltaYaw = yaw - this.yaw;
    this.runtime.teleportPose({
      position,
      rotation: new Quaternion().setFromAxisAngle(Y_AXIS, deltaYaw),
      velocity,
    });
    this.yaw = yaw;
    this.targetYaw = yaw;
    this.desiredVelocity.copy(velocity).setY(0);
    this.actualVelocity.copy(velocity);
    this.syncBody();
  }

  teleport(position: Vector3, velocity: Vector3): void {
    this.teleportPose(position, velocity, this.yaw);
  }

  snapYaw(yaw: number): void {
    this.teleportPose(this.runtime.center, this.runtime.velocity, yaw);
  }

  setPortalExclusions(handles: ReadonlySet<number> | null): void {
    this.portalExclusions = handles;
  }

  getPosition(): Vector3 { return this.runtime.center; }
  getYaw(): number { return this.yaw; }
  getRotation(): Quaternion { return this.rotation.setFromAxisAngle(Y_AXIS, this.yaw); }
  getVelocity(): Vector3 { return this.actualVelocity.clone(); }

  syncFromPhysics(): CharacterMotorSnapshot {
    return {
      position: this.runtime.center,
      velocity: this.actualVelocity.clone(),
      desiredVelocity: this.desiredVelocity.clone(),
      forward: this.forward.clone(),
      grounded: true,
      yaw: this.yaw,
      targetYaw: this.targetYaw,
      distanceToTarget: this.distanceToTarget,
    };
  }

  setSpeedMultiplier(multiplier: number): void {
    this.speedMultiplier = Math.max(0, multiplier);
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.desiredVelocity.set(0, 0, 0);
    this.actualVelocity.set(0, 0, 0);
    this.collider.setEnabled(false);
    this.body.setEnabled(false);
  }

  /**
   * Salto balístico de todo el organismo (jump links del navmesh y el "hoppy
   * blob" del documental): misma parábola que CharacterMotor, aplicada como
   * lanzamiento coherente de partículas; el aterrizaje lo detecta el runtime
   * cuando recupera soporte.
   */
  leapTo(target: Vector3, upSpeed: number, maxForwardSpeed: number): void {
    if (!this.enabled || this.runtime.airborne) return;
    const up = Math.max(MIN_LEAP_UP_SPEED, upSpeed);
    const gravity = Math.max(1, this.gravity);
    const position = this.runtime.center;
    const dx = target.x - position.x;
    const dz = target.z - position.z;
    const planar = Math.hypot(dx, dz);
    const flightTime = (2 * up) / gravity;
    const needed = flightTime > 0 ? planar / flightTime : maxForwardSpeed;
    const forward = Math.min(needed, Math.max(1, maxForwardSpeed));
    const dirX = planar > 1e-4 ? dx / planar : this.forward.x;
    const dirZ = planar > 1e-4 ? dz / planar : this.forward.z;
    this.desiredVelocity.set(dirX * forward, 0, dirZ * forward);
    this.runtime.launch(this.remaining.set(dirX * forward, up, dirZ * forward));
  }

  isLeaping(): boolean { return this.runtime.airborne; }
  isIncapacitated(): boolean { return false; }
  consumeImpactDamage(): number { return 0; }
  reactToHit(): void {}
  consumeSliceHits(): SliceHit[] { return []; }

  private sweepParticle(
    particle: BlobParticle,
    from: Vector3,
    desired: Vector3,
  ): BlobResolvedMotion | Vector3 {
    this.resolvedPosition.copy(from);
    this.remaining.copy(desired).sub(from);
    this.motionResult.grounded = false;
    if (this.remaining.lengthSq() < MOTION_EPSILON_SQ) return this.resolvedPosition;

    const intentX = this.remaining.x;
    const intentZ = this.remaining.z;
    const intentPlanar = Math.hypot(intentX, intentZ);
    const shape = new RAPIER.Ball(Math.max(0.05, particle.radius * particle.scale));
    let impacts = 0;
    let depenetrationPasses = 0;
    let stepUpUsed = false;
    let climbed = false;
    while (impacts < MAX_SWEEPS && this.remaining.lengthSq() >= MOTION_EPSILON_SQ) {
      const hit = this.physics.world.castShape(
        this.resolvedPosition,
        IDENTITY,
        this.remaining,
        shape,
        SKIN,
        1,
        true,
        undefined,
        undefined,
        undefined,
        this.body,
        (collider) => this.shouldCollide(collider),
      );
      if (!hit) {
        this.resolvedPosition.add(this.remaining);
        this.remaining.set(0, 0, 0);
        break;
      }
      const toi = MathUtils.clamp(hit.time_of_impact, 0, 1);
      // A shape cast starting even slightly inside the floor returns TOI=0.
      // Merely projecting the velocity is not enough: another cast observes the
      // same overlap and, after MAX_SWEEPS, used to discard all tangential
      // motion. Push the particle to a small positive clearance first, then
      // retry without consuming one of the two actual impact responses.
      if (
        toi <= TOI_EPSILON &&
        depenetrationPasses < MAX_DEPENETRATION_PASSES &&
        this.depenetrateFrom(hit.collider, shape)
      ) {
        depenetrationPasses++;
        continue;
      }

      this.normal.set(hit.normal1.x, hit.normal1.y, hit.normal1.z).normalize();
      // La orientación de normal1 depende de qué shape la reporta; para el
      // slide, el soporte y el empuje sirve únicamente la normal que se opone
      // al movimiento.
      if (this.normal.dot(this.remaining) > 0) this.normal.negate();
      if (this.normal.y > GROUND_NORMAL_MIN_Y) this.motionResult.grounded = true;
      this.notePropContact(hit);
      const pressingIntoWall =
        this.normal.y < WALL_NORMAL_MAX_Y &&
        intentPlanar > 1e-4 &&
        intentX * this.normal.x + intentZ * this.normal.z < -0.3 * intentPlanar;

      // Valve's elements traced 8 units above their origin: motion that a
      // ledge stops at foot level often clears one step higher, which is what
      // lets the goo pour over crates and stair steps without a jump.
      if (pressingIntoWall && !stepUpUsed && this.stepUpHeight > 0 && this.tryStepUp(shape)) {
        stepUpUsed = true;
        continue;
      }

      impacts++;
      this.resolvedPosition.addScaledVector(this.remaining, Math.max(0, toi - 0.002));
      this.remaining.multiplyScalar(1 - toi);
      const prePlanar = Math.hypot(this.remaining.x, this.remaining.z);
      const intoSurface = this.remaining.dot(this.normal);
      if (intoSurface < 0) this.remaining.addScaledVector(this.normal, -intoSurface);

      // Liquid pressure: sliding keeps whatever tangential flow the wall
      // allows. Only when the surface kills most of the advance does the
      // blocked displacement become an upward ooze along the wall, bounded by
      // how high the mass can pile above its own support.
      if (
        pressingIntoWall &&
        !climbed &&
        this.climbSpeed > 0 &&
        Math.hypot(this.remaining.x, this.remaining.z) < prePlanar * 0.3 &&
        this.resolvedPosition.y - this.componentGroundY(particle) < this.maxClimb
      ) {
        climbed = true;
        const upDot = this.normal.y;
        this.stepUpProbe.set(
          -this.normal.x * upDot,
          1 - upDot * upDot,
          -this.normal.z * upDot,
        );
        if (this.stepUpProbe.lengthSq() > 1e-6) {
          this.stepUpProbe.normalize();
          const climbDistance = Math.min(
            Math.max(prePlanar, intentPlanar * 0.5),
            this.climbSpeed * this.runtime.fixedStepSeconds,
          );
          this.remaining.copy(this.stepUpProbe).multiplyScalar(climbDistance);
          continue;
        }
      }
    }

    // Two contacts are enough to compute a corner/sliding direction, but the
    // old loop threw that final tangent away. Advance it conservatively: a
    // third obstacle may stop the particle, but empty space must not.
    if (this.remaining.lengthSq() >= MOTION_EPSILON_SQ) {
      const finalHit = this.physics.world.castShape(
        this.resolvedPosition,
        IDENTITY,
        this.remaining,
        shape,
        SKIN,
        1,
        true,
        undefined,
        undefined,
        undefined,
        this.body,
        (collider) => this.shouldCollide(collider),
      );
      const safeFraction = finalHit
        ? Math.max(0, MathUtils.clamp(finalHit.time_of_impact, 0, 1) - 0.002)
        : 1;
      this.resolvedPosition.addScaledVector(this.remaining, safeFraction);
      this.remaining.set(0, 0, 0);
    }
    this.resolvedVelocity
      .copy(this.resolvedPosition)
      .sub(from)
      .multiplyScalar(1 / this.runtime.fixedStepSeconds);
    return this.motionResult;
  }

  private depenetrateFrom(collider: RAPIER.Collider, shape: RAPIER.Ball): boolean {
    const clearance = SKIN + DEPENETRATION_SLOP;
    const contact = collider.contactShape(shape, this.resolvedPosition, IDENTITY, clearance);
    if (!contact || contact.distance >= clearance) return false;
    this.normal.set(contact.normal1.x, contact.normal1.y, contact.normal1.z);
    if (this.normal.lengthSq() < 1e-10) return false;
    this.normal.normalize();
    if (this.normal.y > GROUND_NORMAL_MIN_Y) this.motionResult.grounded = true;
    this.resolvedPosition.addScaledVector(this.normal, clearance - contact.distance);
    const intoSurface = this.remaining.dot(this.normal);
    if (intoSurface < 0) this.remaining.addScaledVector(this.normal, -intoSurface);
    return true;
  }

  /**
   * Empuje de flujo sobre props dinámicos, fiel al npc_blob original: Valve
   * aplicaba `ApplyForceOffset(-150·normal)` en el punto del trace, con lo que
   * la masa volcaba y apartaba objetos físicos al fluir contra ellos. Acá cada
   * partícula bloqueada acumula impulso; `tickDynamicProps` lo aplica una vez
   * por cuerpo con un tope de Δv para que nada salga disparado.
   */
  private notePropContact(
    hit: NonNullable<ReturnType<RAPIER.World['castShape']>>,
  ): void {
    const body = hit.collider.parent();
    if (!body || !body.isDynamic()) return;
    const metadata = this.physics.getColliderMetadata(hit.collider);
    if (metadata?.kind !== 'dynamic') return;
    const blockedSpeed =
      -Math.min(0, this.remaining.dot(this.normal)) / this.runtime.fixedStepSeconds;
    if (blockedSpeed <= 0.05) return;
    let push = this.propPushes.get(body.handle);
    if (!push) {
      push = { body, impulse: new Vector3(), point: new Vector3() };
      this.propPushes.set(body.handle, push);
    }
    push.impulse.addScaledVector(this.normal, -blockedSpeed * PROP_PUSH_SPEED_TRANSFER);
    push.point.set(hit.witness1.x, hit.witness1.y, hit.witness1.z);
  }

  /** Reintenta el movimiento bloqueado un escalón más arriba (con headroom). */
  private tryStepUp(shape: RAPIER.Ball): boolean {
    this.stepUpProbe.set(0, this.stepUpHeight, 0);
    const liftHit = this.physics.world.castShape(
      this.resolvedPosition,
      IDENTITY,
      this.stepUpProbe,
      shape,
      SKIN,
      1,
      true,
      undefined,
      undefined,
      undefined,
      this.body,
      (collider) => this.shouldCollide(collider),
    );
    if (liftHit && liftHit.time_of_impact < 0.95) return false;
    this.stepUpProbe.copy(this.resolvedPosition);
    this.stepUpProbe.y += this.stepUpHeight;
    const forwardHit = this.physics.world.castShape(
      this.stepUpProbe,
      IDENTITY,
      this.remaining,
      shape,
      SKIN,
      1,
      true,
      undefined,
      undefined,
      undefined,
      this.body,
      (collider) => this.shouldCollide(collider),
    );
    if (forwardHit && MathUtils.clamp(forwardHit.time_of_impact, 0, 1) < 0.4) return false;
    this.resolvedPosition.y += this.stepUpHeight;
    return true;
  }

  private componentGroundY(particle: BlobParticle): number {
    const component = this.runtime.components[particle.componentId];
    return component ? component.groundY : this.runtime.center.y - 1;
  }

  private shouldCollide(collider: RAPIER.Collider): boolean {
    if (collider.isSensor() || this.portalExclusions?.has(collider.handle)) return false;
    const metadata = this.physics.getColliderMetadata(collider);
    if ((metadata?.ownerId ?? metadata?.id) === this.config.id) return false;
    if (metadata?.blobPermeable) return false;
    // Presa en digestión: la masa fluye por encima mientras corre su timer.
    if (metadata?.blobConsumable) return false;
    // La masa puede envolver actores; sus hitboxes no son paredes de flujo.
    if (metadata?.kind === 'npc' || metadata?.kind === 'player') return false;
    return true;
  }

  private maybeSplitForPermeable(delta: number): void {
    if (this.runtime.componentCount !== 1 || this.desiredVelocity.lengthSq() < 0.01) return;
    this.remaining.copy(this.desiredVelocity).multiplyScalar(Math.max(delta, 0.2));
    const hit = this.physics.world.castShape(
      this.runtime.center,
      IDENTITY,
      this.remaining,
      new RAPIER.Ball(0.16),
      0,
      1,
      true,
      undefined,
      undefined,
      undefined,
      this.body,
      (collider) => this.physics.getColliderMetadata(collider)?.blobPermeable === true,
    );
    if (hit) {
      this.runtime.split(3, 1.25);
      this.flowMergeIn = 3.5;
    }
  }

  private tickDynamicProps(delta: number): void {
    // Empujes de flujo acumulados por los sweeps de este update. El tope de Δv
    // por cuerpo evita que doscientas partículas conviertan una caja en bala.
    for (const push of this.propPushes.values()) {
      if (!push.body.isValid()) continue;
      const mass = Math.max(0.2, push.body.mass());
      const maxImpulse = mass * this.propPushMaxDeltaV * Math.max(delta, 1 / 240);
      if (push.impulse.lengthSq() > maxImpulse * maxImpulse) {
        push.impulse.setLength(maxImpulse);
      }
      push.body.applyImpulseAtPoint(push.impulse, push.point, true);
    }
    this.propPushes.clear();

    const seen = new Set<number>();
    const consumed: Array<{ body: RAPIER.RigidBody; biomass: number; position: Vector3 }> = [];
    const shape = new RAPIER.Ball(1.15);
    for (const component of this.runtime.components) {
      if (!component.active) continue;
      this.physics.world.intersectionsWithShape(
        component.center,
        IDENTITY,
        shape,
        (collider) => {
          const metadata = this.physics.getColliderMetadata(collider);
          const body = collider.parent();
          if (!body?.isDynamic() || metadata?.kind !== 'dynamic') return true;
          // A split organism may overlap the same prop with several component
          // queries (and a body may own several colliders). Residence time,
          // impulses and biomass are properties of the organism/prop pair, so
          // advance them at most once per motor update.
          if (seen.has(body.handle)) return true;
          seen.add(body.handle);
          if (!metadata.blobConsumable) return true;
          // Succión de digestión: solo la presa marcada consumible se hunde
          // hacia el centro de la masa; el resto de los props ahora son
          // obstáculos reales que el flujo empuja por contacto.
          TMP_PROP_DIR.copy(component.center).sub(body.translation());
          TMP_PROP_DIR.y = Math.max(0.1, TMP_PROP_DIR.y);
          if (TMP_PROP_DIR.lengthSq() > 1e-5) {
            TMP_PROP_DIR.normalize().multiplyScalar(delta * 7);
            body.applyImpulse(TMP_PROP_DIR, true);
          }
          const elapsed = (this.propConsumeTimers.get(body.handle) ?? 0) + delta;
          this.propConsumeTimers.set(body.handle, elapsed);
          if (elapsed >= metadata.blobConsumable.consumeSeconds) {
            const position = body.translation();
            consumed.push({
              body,
              biomass: metadata.blobConsumable.biomass,
              position: new Vector3(position.x, position.y, position.z),
            });
          }
          return true;
        },
      );
    }
    for (const handle of this.propConsumeTimers.keys()) {
      if (!seen.has(handle)) this.propConsumeTimers.delete(handle);
    }
    for (const item of consumed) {
      if (!this.propConsumeTimers.delete(item.body.handle)) continue;
      const visual = this.physics.getBoundMesh(item.body);
      visual?.removeFromParent();
      visual?.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        object.geometry.dispose();
        if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
        else object.material.dispose();
      });
      this.physics.removeBody(item.body);
      this.runtime.grow(item.biomass);
      this.config.onConsumeProp?.(item.biomass, item.position);
    }
  }

  private syncBody(): void {
    this.body.setTranslation(this.runtime.center, true);
    this.body.setNextKinematicTranslation(this.runtime.center);
    const rotation = this.rotation.setFromAxisAngle(Y_AXIS, this.yaw);
    this.body.setRotation(rotation, true);
    this.body.setNextKinematicRotation(rotation);
  }
}

const TMP_PROP_DIR = new Vector3();
