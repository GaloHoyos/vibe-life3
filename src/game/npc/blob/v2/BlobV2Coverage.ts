import type { BlobParticleSnapshot, BlobVector3 } from "@engine/blob/v2";

export interface BlobV2CoverageResult {
  readonly contact: boolean;
  readonly enveloped: boolean;
  readonly nearbyParticles: number;
  readonly occupiedSectors: number;
  readonly requiredParticles: number;
  readonly requiredSectors: number;
}

export interface BlobV2CoverageOptions {
  readonly targetRadius: number;
  readonly padding?: number;
  readonly biomassScale?: number;
  readonly previouslyEnveloped?: boolean;
}

const PARTICLE_REACH_SCALE = 1.8;
const HORIZONTAL_SECTORS = 8;

/**
 * Measures actual attached-mass coverage around a target. A single touching
 * particle is only contact: envelopment requires several particles spread
 * across independent angular sectors. Lower exit thresholds provide stable
 * hysteresis while the liquid surface is moving.
 */
export function measureBlobV2Coverage(
  position: BlobVector3,
  particles: readonly Pick<BlobParticleSnapshot, "position" | "radius">[],
  options: BlobV2CoverageOptions,
): BlobV2CoverageResult {
  const targetRadius = finiteNonNegative(options.targetRadius, 0.2);
  const padding = finiteNonNegative(options.padding, 0);
  const biomassScale = finitePositive(options.biomassScale, 1);
  const previouslyEnveloped = options.previouslyEnveloped === true;
  const occupied = new Uint8Array(HORIZONTAL_SECTORS);
  let nearbyParticles = 0;

  for (const particle of particles) {
    const reach =
      (targetRadius + padding + particle.radius * PARTICLE_REACH_SCALE) *
      biomassScale;
    const dx = particle.position.x - position.x;
    const dy = particle.position.y - position.y;
    const dz = particle.position.z - position.z;
    if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
    nearbyParticles += 1;
    const angle = Math.atan2(dz, dx) + Math.PI;
    const sector = Math.min(
      HORIZONTAL_SECTORS - 1,
      Math.floor((angle / (Math.PI * 2)) * HORIZONTAL_SECTORS),
    );
    occupied[sector] = 1;
  }

  let occupiedSectors = 0;
  for (const value of occupied) occupiedSectors += value;
  const enterParticles = clampInteger(
    Math.round(6 + targetRadius * 5),
    6,
    12,
  );
  const requiredParticles = previouslyEnveloped
    ? Math.max(4, enterParticles - 3)
    : enterParticles;
  const requiredSectors = previouslyEnveloped ? 2 : 3;

  return Object.freeze({
    contact: nearbyParticles > 0,
    enveloped:
      nearbyParticles >= requiredParticles &&
      occupiedSectors >= requiredSectors,
    nearbyParticles,
    occupiedSectors,
    requiredParticles,
    requiredSectors,
  });
}

function finiteNonNegative(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! >= 0 ? value! : fallback;
}

function finitePositive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! > 0 ? value! : fallback;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}
