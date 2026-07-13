import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import type { Faction } from '@engine/ai/Faction';
import type { BlobOrganismRuntime } from '@engine/blob/BlobOrganismRuntime';
import type { CharacterId } from '@engine/characters/CharacterDefinition';
import type { PhysicsWorld } from '@engine/physics/PhysicsWorld';
import type { Damageable, DamageType } from '@shared/types/lifecycle';
import { BlobConfig } from '@game/config/blob.config';

interface HitboxEntry {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  enabled: boolean;
  radius: number;
}

interface LocalOpening {
  anchorParticleIndex: number;
  direction: Vector3;
  strength: number;
  expiresAt: number;
  opensCorePath: boolean;
}

export interface BlobMassImpact {
  point: Vector3;
  direction: Vector3;
  impulse: Vector3;
  damage: number;
  damageType: DamageType;
  clusterIndex: number;
  particleIndex: number | null;
  affectedParticles: number;
}

export interface BlobHitboxesOptions {
  physics: PhysicsWorld;
  ownerId: string;
  characterId: CharacterId;
  faction: Faction;
  runtime: BlobOrganismRuntime;
  pool: Damageable;
  /** Feedback visual/sonoro: la masa no drena la vida cerebral. */
  onMassImpact?: (impact: BlobMassImpact) => void;
}

const ZERO = new Vector3();
const TMP_DELTA = new Vector3();
const SCORE_EPSILON = 1e-9;
const HULL_RADIAL_BIAS = 0.08;

/**
 * Hitboxes agregadas del organismo. Las partículas siguen siendo el detalle
 * visual, pero balas/física solo consultan diez volúmenes de masa y el cerebro.
 */
export class BlobHitboxes {
  private readonly entries: HitboxEntry[] = [];
  private readonly clusterCenters: Vector3[] = [];
  private readonly candidateIndices: number[] = [];
  private readonly candidateMinimumDistances: number[] = [];
  private readonly selectedParticleIndices: number[];
  private readonly localOpenings: LocalOpening[] = [];
  private core: HitboxEntry | null = null;
  private removed = false;
  private readonly explosionDamageable: Damageable;

  constructor(private readonly opts: BlobHitboxesOptions) {
    this.selectedParticleIndices = new Array(
      BlobConfig.physics.clusterHitboxCount,
    ).fill(-1) as number[];
    this.explosionDamageable = this.createExplosionDamageable();
    for (let index = 0; index < BlobConfig.physics.clusterHitboxCount; index++) {
      this.clusterCenters.push(new Vector3());
      this.entries.push(
        this.createHitbox(
          `${opts.ownerId}-mass-${index}`,
          BlobConfig.physics.elementHitboxRadius,
          { name: 'blob-mass', damageMultiplier: 1 },
          this.createMassDamageable(index),
        ),
      );
    }
    this.core = this.createHitbox(
      `${opts.ownerId}-core`,
      BlobConfig.physics.coreHitboxRadius,
      { name: 'blob-core', damageMultiplier: BlobConfig.physics.coreDamageMult },
      this.createCoreDamageable(),
    );
  }

  sync(): void {
    if (this.removed) return;
    this.selectHullRepresentatives();
    this.discardExpiredOpenings();
    const exposed = this.opts.runtime.exposure >= BlobConfig.core.minimumExposure;
    for (let index = 0; index < this.entries.length; index++) {
      const entry = this.entries[index];
      const hasRepresentative = this.selectedParticleIndices[index] >= 0;
      const opening = exposed && hasRepresentative
        ? this.openingInfluenceAt(this.clusterCenters[index])
        : 0;
      const enabled =
        hasRepresentative &&
        opening < BlobConfig.physics.localOpeningDisableThreshold;
      this.setEntryEnabled(entry, enabled);
      const radius = BlobConfig.physics.elementHitboxRadius * Math.max(
        BlobConfig.physics.localOpeningMinimumRadiusScale,
        1 - opening,
      );
      if (Math.abs(radius - entry.radius) > 1e-4) {
        entry.radius = radius;
        entry.collider.setRadius(radius);
      }
      if (hasRepresentative) {
        entry.body.setTranslation(this.clusterCenters[index], false);
      }
    }
    const brain = this.opts.runtime.particles[0];
    if (this.core && brain.active) {
      if (!this.core.enabled) {
        this.core.enabled = true;
        this.core.collider.setEnabled(true);
      }
      this.core.body.setTranslation(brain.renderPosition, false);
    }
  }

  remove(): void {
    if (this.removed) return;
    this.removed = true;
    for (const entry of this.entries) this.opts.physics.removeBody(entry.body);
    this.entries.length = 0;
    if (this.core) {
      this.opts.physics.removeBody(this.core.body);
      this.core = null;
    }
  }

  dispose(): void { this.remove(); }

  private createHitbox(
    id: string,
    radius: number,
    bodyPart: { name: string; damageMultiplier: number },
    damageable: Damageable,
  ): HitboxEntry {
    const body = this.opts.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased(),
    );
    const collider = this.opts.physics.world.createCollider(
      RAPIER.ColliderDesc.ball(radius).setSensor(true),
      body,
    );
    this.opts.physics.registerCollider(collider, {
      id,
      ownerId: this.opts.ownerId,
      kind: 'npc',
      characterId: this.opts.characterId,
      faction: this.opts.faction,
      damageable,
      explosionGroupId: this.opts.ownerId,
      explosionDamageable: this.explosionDamageable,
      bodyPart,
    });
    collider.setEnabled(false);
    return { body, collider, enabled: false, radius };
  }

  private createMassDamageable(clusterIndex: number): Damageable {
    return {
      applyDamage: (amount, direction, _part, _attacker, point, damageType) => {
        if (this.removed || !this.opts.pool.isAlive()) return;
        const hitPoint = (point ?? this.clusterCenters[clusterIndex] ?? this.opts.runtime.center).clone();
        const impactDirection = (direction ?? ZERO).clone();
        if (impactDirection.lengthSq() <= 1e-6) {
          impactDirection.subVectors(this.opts.runtime.center, hitPoint);
        }
        if (impactDirection.lengthSq() <= 1e-6) impactDirection.set(0, 0.15, 1);
        impactDirection.normalize();
        const impulse = impactDirection
          .clone()
          .multiplyScalar(Math.min(
            BlobConfig.physics.knockMaxSpeed,
            1.5 + amount * BlobConfig.physics.knockSpeedPerDamage,
          ));
        impulse.y += BlobConfig.physics.knockUpSpeed * 0.35;
        // The hull collider is intentionally a little wider than one field
        // particle. Project the physical response onto the nearest real
        // particle; otherwise a hit on the outside of the sensor can fall just
        // beyond the spatial kernel and look like it struck empty air.
        const nearest = this.opts.runtime.nearestParticle(hitPoint, false);
        const impulsePoint = nearest?.position ?? hitPoint;
        const affectedParticles = this.opts.runtime.applyImpulseAt(
          impulsePoint,
          impulse,
          BlobConfig.swarm.elementRadius * 1.65,
        );
        // Un golpe pesado no solo abolla: arranca el kernel como chunk libre
        // que cae, repta de vuelta y se re-absorbe. Mientras falta esa masa el
        // cerebro queda más expuesto (la ventana para matarlo).
        if (
          amount >= BlobConfig.physics.detachDamageThreshold ||
          damageType === 'explosive'
        ) {
          const detachRadius =
            BlobConfig.physics.detachRadiusBase +
            amount * BlobConfig.physics.detachRadiusPerDamage;
          const detachSpeed = Math.min(
            BlobConfig.physics.detachMaxSpeed,
            BlobConfig.physics.detachSpeedBase +
              amount * BlobConfig.physics.detachSpeedPerDamage,
          );
          const detachVelocity = impactDirection.clone().multiplyScalar(detachSpeed);
          detachVelocity.y += 1.4;
          this.opts.runtime.detachAt(impulsePoint, detachRadius, detachVelocity);
        }
        const particleIndex = this.recordLocalOpening(
          hitPoint,
          impactDirection,
          amount,
        );
        this.opts.onMassImpact?.({
          point: hitPoint,
          direction: impactDirection.clone(),
          impulse: impulse.clone(),
          damage: amount,
          damageType: damageType ?? 'bullet',
          clusterIndex,
          particleIndex,
          affectedParticles,
        });
      },
      isAlive: () => !this.removed && this.opts.pool.isAlive(),
    };
  }

  private createCoreDamageable(): Damageable {
    return {
      applyDamage: (amount, direction, _part, attackerId, point, damageType) => {
        if (this.removed || !this.opts.pool.isAlive()) return;
        const brain = this.opts.runtime.particles[0].position;
        const wasExposed = this.opts.runtime.exposure >= BlobConfig.core.minimumExposure;
        this.opts.runtime.applyRadialImpulse(
          point ?? brain,
          1.2,
          Math.min(4, amount * 0.08),
          0.8,
        );
        if (!wasExposed) return;
        this.opts.pool.applyDamage(
          amount,
          direction,
          'blob-core',
          attackerId,
          point,
          damageType,
        );
      },
      isAlive: () => !this.removed && this.opts.pool.isAlive(),
    };
  }

  private createExplosionDamageable(): Damageable {
    return {
      applyDamage: (amount, direction, _part, attackerId, point, damageType) => {
        if (this.removed || !this.opts.pool.isAlive()) return;
        const origin = point ?? this.opts.runtime.center;
        const wasExposed = this.opts.runtime.exposure >= BlobConfig.core.minimumExposure;
        this.opts.runtime.applyRadialImpulse(
          origin,
          BlobConfig.swarm.baseRadius * 2.2,
          BlobConfig.physics.shockwaveSpeed * Math.min(1.5, amount / 40),
          BlobConfig.physics.shockwaveUpSpeed,
        );
        // La detonación arranca el lado expuesto: un chunk grande sale volando
        // en la dirección del estallido y deja el flanco del cerebro abierto.
        if (amount >= 12) {
          const anchor = this.opts.runtime.nearestParticle(origin, false);
          if (anchor) {
            const blastVelocity = anchor.position.clone().sub(origin);
            blastVelocity.y = 0;
            if (blastVelocity.lengthSq() <= 1e-4) blastVelocity.set(0, 0, 1);
            blastVelocity
              .normalize()
              .multiplyScalar(
                Math.min(BlobConfig.physics.detachMaxSpeed, 4 + amount * 0.05),
              );
            blastVelocity.y = 2.2;
            this.opts.runtime.detachAt(
              anchor.position,
              BlobConfig.swarm.baseRadius * 0.75,
              blastVelocity,
            );
          }
        }
        if (!wasExposed) return;
        this.opts.pool.applyDamage(
          amount,
          direction,
          'blob-core',
          attackerId,
          point,
          damageType ?? 'explosive',
        );
      },
      isAlive: () => !this.removed && this.opts.pool.isAlive(),
    };
  }

  /**
   * Picks real particles on the outside of the organism. Farthest-point
   * sampling naturally distributes the small collider budget over every lobe
   * and split component; the radial term keeps late samples on the hull instead
   * of filling the interior.
   */
  private selectHullRepresentatives(): void {
    this.candidateIndices.length = 0;
    for (let index = 1; index < this.opts.runtime.particleCount; index++) {
      const particle = this.opts.runtime.particles[index];
      if (particle.active && particle.scale > 0.15) {
        this.candidateIndices.push(index);
      }
    }
    this.selectedParticleIndices.fill(-1);
    if (this.candidateIndices.length === 0) return;

    const brain = this.opts.runtime.particles[0].renderPosition;
    let seedCandidate = 0;
    let seedScore = -Infinity;
    for (let candidate = 0; candidate < this.candidateIndices.length; candidate++) {
      const particle = this.opts.runtime.particles[this.candidateIndices[candidate]];
      const component = this.opts.runtime.components[particle.componentId];
      const score =
        particle.renderPosition.distanceToSquared(brain) +
        particle.renderPosition.distanceToSquared(component.center) * HULL_RADIAL_BIAS;
      if (
        score > seedScore + SCORE_EPSILON ||
        (Math.abs(score - seedScore) <= SCORE_EPSILON &&
          particle.index < this.candidateIndices[seedCandidate])
      ) {
        seedScore = score;
        seedCandidate = candidate;
      }
    }

    const seedIndex = this.candidateIndices[seedCandidate];
    this.selectedParticleIndices[0] = seedIndex;
    const seedPosition = this.opts.runtime.particles[seedIndex].renderPosition;
    this.candidateMinimumDistances.length = this.candidateIndices.length;
    for (let candidate = 0; candidate < this.candidateIndices.length; candidate++) {
      const particleIndex = this.candidateIndices[candidate];
      this.candidateMinimumDistances[candidate] = candidate === seedCandidate
        ? -1
        : this.opts.runtime.particles[particleIndex].renderPosition.distanceToSquared(seedPosition);
    }

    const wanted = Math.min(this.entries.length, this.candidateIndices.length);
    for (let slot = 1; slot < wanted; slot++) {
      let bestCandidate = -1;
      let bestScore = -Infinity;
      for (let candidate = 0; candidate < this.candidateIndices.length; candidate++) {
        const minimumDistance = this.candidateMinimumDistances[candidate];
        if (minimumDistance < 0) continue;
        const particle = this.opts.runtime.particles[this.candidateIndices[candidate]];
        const component = this.opts.runtime.components[particle.componentId];
        const score =
          minimumDistance +
          particle.renderPosition.distanceToSquared(component.center) * HULL_RADIAL_BIAS;
        if (
          score > bestScore + SCORE_EPSILON ||
          (Math.abs(score - bestScore) <= SCORE_EPSILON &&
            (bestCandidate < 0 || particle.index < this.candidateIndices[bestCandidate]))
        ) {
          bestScore = score;
          bestCandidate = candidate;
        }
      }
      if (bestCandidate < 0) break;
      const selectedIndex = this.candidateIndices[bestCandidate];
      this.selectedParticleIndices[slot] = selectedIndex;
      this.candidateMinimumDistances[bestCandidate] = -1;
      const selectedPosition = this.opts.runtime.particles[selectedIndex].renderPosition;
      for (let candidate = 0; candidate < this.candidateIndices.length; candidate++) {
        if (this.candidateMinimumDistances[candidate] < 0) continue;
        const candidatePosition = this.opts.runtime.particles[
          this.candidateIndices[candidate]
        ].renderPosition;
        this.candidateMinimumDistances[candidate] = Math.min(
          this.candidateMinimumDistances[candidate],
          candidatePosition.distanceToSquared(selectedPosition),
        );
      }
    }

    for (let slot = 0; slot < wanted; slot++) {
      const particleIndex = this.selectedParticleIndices[slot];
      if (particleIndex >= 0) {
        this.clusterCenters[slot].copy(
          this.opts.runtime.particles[particleIndex].renderPosition,
        );
      }
    }
  }

  private recordLocalOpening(
    point: Vector3,
    direction: Vector3,
    amount: number,
  ): number | null {
    this.discardExpiredOpenings();
    const nearest = this.opts.runtime.nearestParticle(point, false);
    if (!nearest) return null;
    const openingRadiusSq = BlobConfig.physics.localOpeningRadius ** 2;
    let opening = this.localOpenings.find((candidate) => {
      const anchor = this.opts.runtime.particles[candidate.anchorParticleIndex];
      return anchor.active && anchor.renderPosition.distanceToSquared(point) <= openingRadiusSq;
    });
    if (!opening) {
      if (this.localOpenings.length >= this.entries.length) {
        this.localOpenings.sort((a, b) => a.expiresAt - b.expiresAt);
        this.localOpenings.shift();
      }
      opening = {
        anchorParticleIndex: nearest.index,
        direction: direction.clone(),
        strength: 0,
        expiresAt: 0,
        opensCorePath: false,
      };
      this.localOpenings.push(opening);
    }
    opening.anchorParticleIndex = nearest.index;
    opening.direction.copy(direction).normalize();
    opening.strength = Math.min(
      1,
      opening.strength +
        BlobConfig.physics.localOpeningBaseStrength +
        Math.max(0, amount) * BlobConfig.physics.localOpeningStrengthPerDamage,
    );
    opening.expiresAt =
      this.opts.runtime.simulationTimeSeconds + BlobConfig.physics.localOpeningSeconds;

    const brain = this.opts.runtime.particles[0].renderPosition;
    TMP_DELTA.subVectors(brain, point);
    const forwardDistance = TMP_DELTA.dot(opening.direction);
    const perpendicularSq = Math.max(
      0,
      TMP_DELTA.lengthSq() - forwardDistance * forwardDistance,
    );
    opening.opensCorePath ||=
      forwardDistance > 0 &&
      perpendicularSq <= BlobConfig.physics.coreHitboxRadius ** 2;
    return nearest.index;
  }

  private openingInfluenceAt(center: Vector3): number {
    const now = this.opts.runtime.simulationTimeSeconds;
    const brain = this.opts.runtime.particles[0].renderPosition;
    let influence = 0;
    for (const opening of this.localOpenings) {
      const remaining = Math.max(
        0,
        Math.min(
          1,
          (opening.expiresAt - now) / BlobConfig.physics.localOpeningSeconds,
        ),
      );
      if (remaining <= 0) continue;
      const strength = opening.strength * remaining;
      const anchor = this.opts.runtime.particles[opening.anchorParticleIndex];
      if (!anchor.active) continue;
      const distance = center.distanceTo(anchor.renderPosition);
      if (distance < BlobConfig.physics.localOpeningRadius) {
        influence = Math.max(
          influence,
          strength * (1 - distance / BlobConfig.physics.localOpeningRadius),
        );
      }

      // If this was a shot aimed through the core, clear every hull sphere in
      // front of the brain that would intersect the same ray. Spheres behind
      // the brain remain enabled, so shots from other directions still meet gel.
      if (opening.opensCorePath) {
        TMP_DELTA.subVectors(center, brain);
        const along = TMP_DELTA.dot(opening.direction);
        const perpendicularSq = Math.max(
          0,
          TMP_DELTA.lengthSq() - along * along,
        );
        const massRadius = BlobConfig.physics.elementHitboxRadius;
        const intersectsRay = perpendicularSq <= massRadius * massRadius;
        const halfChord = intersectsRay
          ? Math.sqrt(Math.max(0, massRadius * massRadius - perpendicularSq))
          : 0;
        // A center can sit slightly behind the brain while its large sphere
        // still begins in front of the core collider. Compare the actual first
        // intersections instead of only comparing both centers.
        const massFront = along - halfChord;
        const coreFront = -BlobConfig.physics.coreHitboxRadius;
        if (intersectsRay && massFront < coreFront) {
          influence = Math.max(influence, strength);
        }
      }
    }
    return Math.min(1, influence);
  }

  private discardExpiredOpenings(): void {
    const now = this.opts.runtime.simulationTimeSeconds;
    for (let index = this.localOpenings.length - 1; index >= 0; index--) {
      const opening = this.localOpenings[index];
      const anchor = this.opts.runtime.particles[opening.anchorParticleIndex];
      if (opening.expiresAt <= now || !anchor?.active) {
        this.localOpenings.splice(index, 1);
      }
    }
  }

  private setEntryEnabled(entry: HitboxEntry, enabled: boolean): void {
    if (entry.enabled === enabled) return;
    entry.enabled = enabled;
    entry.collider.setEnabled(enabled);
  }
}
