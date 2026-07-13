import { beforeAll, describe, expect, it, vi } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import { BlobOrganismRuntime } from '@engine/blob/BlobOrganismRuntime';
import { BLOB_SUPPORT_FACTOR } from '@engine/blob/Blobulator';
import type { PhysicsMetadata } from '@engine/physics/PhysicsWorld';
import { PhysicsWorld } from '@engine/physics/PhysicsWorld';
import { Raycast } from '@engine/physics/Raycast';
import { BlobConfig } from '@game/config/blob.config';
import {
  BlobHitboxes,
  type BlobMassImpact,
} from '@game/npc/blob/BlobHitboxes';

beforeAll(async () => {
  await RAPIER.init();
});

async function setup(onMassImpact?: (impact: BlobMassImpact) => void) {
  const physics = new PhysicsWorld();
  await physics.init();
  const runtime = new BlobOrganismRuntime({
    center: new Vector3(1, 1, 1),
    initialParticleCount: BlobConfig.swarm.baseElements,
    maxParticleCount: BlobConfig.swarm.maxElements,
    particleRadius: BlobConfig.swarm.elementRadius,
    bodyRadius: BlobConfig.swarm.baseRadius,
    separationDistance: BlobConfig.swarm.elementRadius * 1.65,
  });
  const pool = { applyDamage: vi.fn(), isAlive: () => true };
  const hitboxes = new BlobHitboxes({
    physics,
    ownerId: 'blob-1',
    characterId: 'blob',
    faction: 'zombies',
    runtime,
    pool,
    onMassImpact,
  });
  hitboxes.sync();
  physics.updateQueryPipeline();
  const metadata: PhysicsMetadata[] = [];
  physics.world.intersectionsWithShape(
    runtime.center,
    { x: 0, y: 0, z: 0, w: 1 },
    new RAPIER.Ball(5),
    (collider) => {
      const value = physics.getColliderMetadata(collider);
      if (value?.ownerId === 'blob-1') metadata.push(value);
      return true;
    },
  );
  return { physics, runtime, pool, hitboxes, metadata };
}

describe('BlobHitboxes', () => {
  it('crea masa agregada y un único collider cerebral', async () => {
    const { metadata } = await setup();
    expect(metadata.filter((item) => item.bodyPart?.name === 'blob-mass')).toHaveLength(
      BlobConfig.physics.clusterHitboxCount,
    );
    const core = metadata.filter((item) => item.bodyPart?.name === 'blob-core');
    expect(core).toHaveLength(1);
    expect(core[0].bodyPart?.damageMultiplier).toBe(BlobConfig.physics.coreDamageMult);
  });

  it('la masa exterior abre cobertura sin drenar el cerebro', async () => {
    const { metadata, runtime, pool } = await setup();
    const mass = metadata.find((item) => item.bodyPart?.name === 'blob-mass')!;
    mass.damageable!.applyDamage(20, new Vector3(1, 0.2, 0), undefined, 'player', runtime.center, 'bullet');
    expect(runtime.exposure).toBeGreaterThan(0);
    expect(pool.applyDamage).not.toHaveBeenCalled();
  });

  it('distribuye los doce sensores sobre el hull y cubre la piel visible', async () => {
    const { physics, runtime } = await setup();
    const raycast = new Raycast(physics);
    const directions = [
      new Vector3(0, 0, 1),
      new Vector3(1, 0, 0),
      new Vector3(1, 0, 1).normalize(),
    ];
    for (const direction of directions) {
      const right = new Vector3().crossVectors(direction, new Vector3(0, 1, 0)).normalize();
      let expectedHits = 0;
      let detectedHits = 0;
      for (let yIndex = 0; yIndex <= 10; yIndex++) {
        const vertical = -0.9 + yIndex * 0.22;
        for (let xIndex = 0; xIndex <= 14; xIndex++) {
          const horizontal = -1.7 + xIndex * 0.24;
          const projectedPoint = runtime.center
            .clone()
            .addScaledVector(right, horizontal)
            .add(new Vector3(0, vertical, 0));
          const visuallyOccupied = runtime.activeParticles.some((particle) => {
            const radius = particle.index === 0
              ? BlobConfig.core.fieldRadius
              : particle.radius * BlobConfig.swarm.surfaceFieldRadiusScale;
            const relative = particle.renderPosition.clone().sub(projectedPoint);
            const alongRay = relative.dot(direction);
            const perpendicularSq = relative.lengthSq() - alongRay * alongRay;
            return perpendicularSq <= (radius * BLOB_SUPPORT_FACTOR) ** 2;
          });
          if (!visuallyOccupied) continue;
          expectedHits++;
          const hit = raycast.cast(
            projectedPoint.clone().addScaledVector(direction, -5),
            direction,
            10,
          );
          if (hit?.metadata?.ownerId === 'blob-1') detectedHits++;
        }
      }

      expect(expectedHits).toBeGreaterThan(100);
      expect(detectedHits / expectedHits).toBeGreaterThanOrEqual(0.85);
    }
  });

  it('notifica el impacto de masa sin convertirlo en daño cerebral', async () => {
    const onMassImpact = vi.fn<(impact: BlobMassImpact) => void>();
    const { metadata, runtime, pool } = await setup(onMassImpact);
    const mass = metadata.find((item) => item.bodyPart?.name === 'blob-mass')!;
    const point = runtime.center.clone().add(new Vector3(0, 0, -0.6));
    mass.damageable!.applyDamage(
      8,
      new Vector3(0, 0, 1),
      undefined,
      'player',
      point,
      'bullet',
    );

    expect(pool.applyDamage).not.toHaveBeenCalled();
    expect(onMassImpact).toHaveBeenCalledTimes(1);
    expect(onMassImpact).toHaveBeenCalledWith(expect.objectContaining({
      damage: 8,
      damageType: 'bullet',
      clusterIndex: expect.any(Number),
      particleIndex: expect.any(Number),
      affectedParticles: expect.any(Number),
    }));
    const impact = onMassImpact.mock.calls[0][0];
    expect(impact.point).not.toBe(point);
    expect(impact.point.distanceTo(point)).toBe(0);
    expect(impact.direction.distanceTo(new Vector3(0, 0, 1))).toBe(0);
    expect(impact.affectedParticles).toBeGreaterThan(0);
  });

  it('todos los sensores comparten un target explosivo canónico', async () => {
    const { metadata } = await setup();
    const explosiveTargets = new Set(metadata.map((item) => item.explosionDamageable));
    const groups = new Set(metadata.map((item) => item.explosionGroupId));
    expect(explosiveTargets.size).toBe(1);
    expect(groups).toEqual(new Set(['blob-1']));
  });

  it('el cerebro protegido no recibe daño directo', async () => {
    const { metadata, runtime, pool } = await setup();
    const core = metadata.find((item) => item.bodyPart?.name === 'blob-core')!;
    expect(runtime.exposure).toBeLessThan(BlobConfig.core.minimumExposure);
    core.damageable!.applyDamage(25, new Vector3(0, 0, 1), undefined, 'player', runtime.center, 'bullet');
    expect(pool.applyDamage).not.toHaveBeenCalled();
  });

  it('el cerebro expuesto sí recibe el multiplicador ya resuelto por el hitbox', async () => {
    const { metadata, runtime, pool } = await setup();
    runtime.applyRadialImpulse(runtime.center.clone().add(new Vector3(0, 0, -0.2)), 4, 20, 4);
    expect(runtime.exposure).toBeGreaterThanOrEqual(BlobConfig.core.minimumExposure);
    const core = metadata.find((item) => item.bodyPart?.name === 'blob-core')!;
    core.damageable!.applyDamage(25, new Vector3(0, 0, 1), undefined, 'player', runtime.center, 'bullet');
    expect(pool.applyDamage).toHaveBeenCalledTimes(1);
    expect(pool.applyDamage).toHaveBeenCalledWith(
      25,
      expect.any(Vector3),
      'blob-core',
      'player',
      runtime.center,
      'bullet',
    );
  });

  it('abre el corredor impactado para que el siguiente rayo alcance el cerebro', async () => {
    const { physics, runtime, pool, hitboxes } = await setup();
    const raycast = new Raycast(physics);
    const origin = runtime.center.clone().add(new Vector3(0, 0, -5));
    const direction = new Vector3(0, 0, 1);

    const protectedHit = raycast.cast(origin, direction, 10);
    expect(protectedHit?.metadata?.bodyPart?.name).toBe('blob-mass');
    for (
      let shot = 0;
      shot < 20 && runtime.exposure < BlobConfig.core.minimumExposure;
      shot++
    ) {
      protectedHit!.metadata!.damageable!.applyDamage(
        5,
        direction,
        'blob-mass',
        'player',
        protectedHit!.point,
        'bullet',
      );
    }
    expect(pool.applyDamage).not.toHaveBeenCalled();
    expect(runtime.exposure).toBeGreaterThanOrEqual(BlobConfig.core.minimumExposure);

    hitboxes.sync();
    physics.updateQueryPipeline();
    const exposedHit = raycast.cast(origin, direction, 10);
    expect(exposedHit?.metadata?.bodyPart?.name).toBe('blob-core');
    const coreDamage = 5 * BlobConfig.physics.coreDamageMult;
    exposedHit!.metadata!.damageable!.applyDamage(
      coreDamage,
      direction,
      'blob-core',
      'player',
      exposedHit!.point,
      'bullet',
    );
    expect(pool.applyDamage).toHaveBeenCalledTimes(1);
    expect(pool.applyDamage).toHaveBeenCalledWith(
      coreDamage,
      direction,
      'blob-core',
      'player',
      exposedHit!.point,
      'bullet',
    );
  });

  it('remove es idempotente y retira los sensores', async () => {
    const { hitboxes, physics } = await setup();
    hitboxes.remove();
    hitboxes.remove();
    physics.updateQueryPipeline();
    let found = 0;
    physics.world.intersectionsWithShape(
      new Vector3(1, 1, 1),
      { x: 0, y: 0, z: 0, w: 1 },
      new RAPIER.Ball(5),
      (collider) => {
        if (physics.getColliderMetadata(collider)?.ownerId === 'blob-1') found++;
        return true;
      },
    );
    expect(found).toBe(0);
  });
});
