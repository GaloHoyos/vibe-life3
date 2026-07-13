import RAPIER from '@dimforge/rapier3d-compat';
import { MathUtils, Mesh, Quaternion, Vector3 } from 'three';
import type {
  BlobParticle,
  BlobParticleMotionResolver,
  BlobResolvedMotion,
} from '@engine/blob/BlobTypes';
import { BlobParticleRole } from '@engine/blob/BlobTypes';
import type { BlobOrganismRuntime } from '@engine/blob/BlobOrganismRuntime';
import type { PhysicsMetadata, PhysicsWorld } from '@engine/physics/PhysicsWorld';
import type { CharacterMotorSnapshot, NpcMotor, SliceHit } from './NpcMotor';

export interface BlobMotorConfig {
  id: string;
  maxSpeed: number;
  acceleration: number;
  turnSpeed: number;
  metadata: PhysicsMetadata;
  onConsumeProp?: (biomass: number, position: Vector3) => void;
}

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 } as const;
const Y_AXIS = new Vector3(0, 1, 0);
const SKIN = 0.015;
const MAX_SWEEPS = 2;
const MAX_DEPENETRATION_PASSES = 3;
const DEPENETRATION_SLOP = 0.002;
const MOTION_EPSILON_SQ = 1e-8;
const TOI_EPSILON = 1e-5;
const SUPPORT_GRAVITY = 18;
const MAX_SUPPORT_DROP_PER_STEP = 0.025;

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
  };
  private enabled = true;
  private speedMultiplier = 1;
  private yaw = 0;
  private targetYaw = 0;
  private distanceToTarget = Infinity;
  private portalExclusions: ReadonlySet<number> | null = null;
  private flowMergeIn = 0;
  private readonly propConsumeTimers = new Map<number, number>();

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
    this.maybeSplitForPermeable(delta);

    this.runtime.step(delta, {
      anchor: this.runtime.center,
      target: wantsMove ? targetPosition : null,
      desiredVelocity: this.desiredVelocity,
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

  leapTo(): void {}
  isLeaping(): boolean { return false; }
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
    // Las partículas de apoyo funcionan como pies: buscan suelo y arrastran el
    // esqueleto mediante constraints. La masa ya no queda flotando con el
    // centro invisible de una cápsula.
    if (particle.role === BlobParticleRole.Support) {
      const step = this.runtime.fixedStepSeconds;
      this.remaining.y -= Math.min(
        MAX_SUPPORT_DROP_PER_STEP,
        0.5 * SUPPORT_GRAVITY * step * step,
      );
    }
    if (this.remaining.lengthSq() < MOTION_EPSILON_SQ) return this.resolvedPosition;

    const shape = new RAPIER.Ball(Math.max(0.05, particle.radius * particle.scale));
    let impacts = 0;
    let depenetrationPasses = 0;
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

      impacts++;
      this.resolvedPosition.addScaledVector(this.remaining, Math.max(0, toi - 0.002));
      this.normal.set(hit.normal1.x, hit.normal1.y, hit.normal1.z).normalize();
      this.remaining.multiplyScalar(1 - toi);
      const intoSurface = this.remaining.dot(this.normal);
      if (intoSurface < 0) this.remaining.addScaledVector(this.normal, -intoSurface);
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
    this.resolvedPosition.addScaledVector(this.normal, clearance - contact.distance);
    const intoSurface = this.remaining.dot(this.normal);
    if (intoSurface < 0) this.remaining.addScaledVector(this.normal, -intoSurface);
    return true;
  }

  private shouldCollide(collider: RAPIER.Collider): boolean {
    if (collider.isSensor() || this.portalExclusions?.has(collider.handle)) return false;
    const metadata = this.physics.getColliderMetadata(collider);
    if ((metadata?.ownerId ?? metadata?.id) === this.config.id) return false;
    if (metadata?.blobPermeable) return false;
    // La masa puede envolver actores; sus hitboxes no son paredes de flujo.
    if (metadata?.kind === 'npc' || metadata?.kind === 'player') return false;
    const body = collider.parent();
    // Props livianos son desplazados/envueltos una vez por organismo en
    // tickDynamicProps. Si cada una de las 192 partículas los trata además
    // como pared, el prop inmoviliza la red antes de recibir ese empuje.
    if (metadata?.kind === 'dynamic' && body?.isDynamic() && body.mass() <= 25) return false;
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
          TMP_PROP_DIR.copy(component.center).sub(body.translation());
          TMP_PROP_DIR.y = Math.max(0.1, TMP_PROP_DIR.y);
          if (TMP_PROP_DIR.lengthSq() > 1e-5 && body.mass() <= 25) {
            TMP_PROP_DIR.normalize().multiplyScalar(delta * 7);
            body.applyImpulse(TMP_PROP_DIR, true);
          }
          if (!metadata.blobConsumable) return true;
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
