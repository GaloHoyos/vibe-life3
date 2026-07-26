import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";

export interface ResolvedCharacterContact {
  speedScale: number;
  damping: number;
  landingImpactScale: number;
  verticalDamping: number;
}

interface SampleCharacterMediumOptions {
  physics: PhysicsWorld;
  collider: RAPIER.Collider;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  velocity: Vector3;
  delta: number;
  characterMass: number;
}

const TMP_RADIAL = new Vector3();
const TMP_DIRECTION = new Vector3();
const TMP_VELOCITY_DIRECTION = new Vector3();

export function isPassThroughCharacterContact(
  physics: PhysicsWorld,
  collider: RAPIER.Collider,
): boolean {
  return physics.getColliderMetadata(collider)?.characterContact?.passThrough === true;
}

export function sampleCharacterMedium(
  options: SampleCharacterMediumOptions,
): ResolvedCharacterContact | null {
  let overlapWeight = 0;
  let minimumSpeedScale = 1;
  let maximumDamping = 0;
  let minimumLandingImpactScale = 1;
  let maximumVerticalDamping = 0;
  let maximumPushAcceleration = 0;
  const overlappingBodies = new Map<number, RAPIER.RigidBody>();

  options.physics.world.intersectionsWithShape(
    options.position,
    options.rotation,
    options.collider.shape,
    (collider) => {
      const response = options.physics.getColliderMetadata(collider)?.characterContact;
      if (!response?.passThrough) return true;

      const fullImmersionCount = Math.max(1, response.fullImmersionCount ?? 1);
      overlapWeight += 1 / fullImmersionCount;
      minimumSpeedScale = Math.min(minimumSpeedScale, clamp01(response.speedScale));
      maximumDamping = Math.max(maximumDamping, positive(response.damping));
      minimumLandingImpactScale = Math.min(
        minimumLandingImpactScale,
        clamp01(response.landingImpactScale),
      );
      maximumVerticalDamping = Math.max(
        maximumVerticalDamping,
        positive(response.verticalDamping ?? 0),
      );
      maximumPushAcceleration = Math.max(
        maximumPushAcceleration,
        positive(response.pushAcceleration ?? 0),
      );

      const body = collider.parent();
      if (body?.isDynamic() && body.handle !== options.collider.parent()?.handle) {
        overlappingBodies.set(body.handle, body);
      }
      return true;
    },
    RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
    undefined,
    options.collider,
    options.collider.parent() ?? undefined,
    (collider) => isPassThroughCharacterContact(options.physics, collider),
  );

  if (overlapWeight <= 0) return null;

  const immersion = Math.min(1, overlapWeight);
  const responseStrength = Math.sqrt(immersion);
  if (maximumPushAcceleration > 0 && overlappingBodies.size > 0) {
    pushMediumBodies(
      overlappingBodies.values(),
      options,
      maximumPushAcceleration,
      responseStrength,
    );
  }

  return {
    speedScale: lerp(1, minimumSpeedScale, responseStrength),
    damping: maximumDamping * immersion,
    landingImpactScale: lerp(1, minimumLandingImpactScale, responseStrength),
    verticalDamping: maximumVerticalDamping * immersion,
  };
}

export function combineCharacterContacts(
  first: ResolvedCharacterContact | null,
  second: ResolvedCharacterContact | null,
): ResolvedCharacterContact | null {
  if (!first) return second;
  if (!second) return first;
  return {
    speedScale: Math.min(first.speedScale, second.speedScale),
    damping: Math.max(first.damping, second.damping),
    landingImpactScale: Math.min(
      first.landingImpactScale,
      second.landingImpactScale,
    ),
    verticalDamping: Math.max(first.verticalDamping, second.verticalDamping),
  };
}

export function applyCharacterContactDamping(
  velocity: Vector3,
  response: ResolvedCharacterContact | null,
  delta: number,
): void {
  if (!response) return;
  const elapsed = Math.max(0, delta);
  const horizontalDamping = Math.exp(-response.damping * elapsed);
  velocity.x *= horizontalDamping;
  velocity.z *= horizontalDamping;
  if (velocity.y < 0 && response.verticalDamping > 0) {
    velocity.y *= Math.exp(-response.verticalDamping * elapsed);
  }
}

function pushMediumBodies(
  bodies: Iterable<RAPIER.RigidBody>,
  options: SampleCharacterMediumOptions,
  acceleration: number,
  responseStrength: number,
): void {
  const speed = options.velocity.length();
  if (speed > 1e-4) {
    TMP_VELOCITY_DIRECTION.copy(options.velocity).multiplyScalar(1 / speed);
  } else {
    TMP_VELOCITY_DIRECTION.set(0, 0, 0);
  }
  const elapsed = Math.max(0, Math.min(options.delta, 1 / 20));
  const characterMass = Math.max(0, options.characterMass);

  for (const body of bodies) {
    const position = body.translation();
    TMP_RADIAL.set(
      position.x - options.position.x,
      position.y - options.position.y,
      position.z - options.position.z,
    );
    if (TMP_RADIAL.lengthSq() > 1e-6) TMP_RADIAL.normalize();
    else TMP_RADIAL.set(0, 1, 0);

    TMP_DIRECTION
      .copy(TMP_RADIAL)
      .multiplyScalar(0.7)
      .addScaledVector(TMP_VELOCITY_DIRECTION, 0.65);
    if (TMP_DIRECTION.lengthSq() <= 1e-6) continue;
    TMP_DIRECTION.normalize();

    const effectiveMass = Math.min(
      Math.max(0.001, body.mass()),
      Math.max(0.001, characterMass * 0.08),
    );
    const impulse = effectiveMass * acceleration * elapsed * responseStrength;
    body.applyImpulse(
      {
        x: TMP_DIRECTION.x * impulse,
        y: TMP_DIRECTION.y * impulse,
        z: TMP_DIRECTION.z * impulse,
      },
      true,
    );
  }
}

function positive(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
