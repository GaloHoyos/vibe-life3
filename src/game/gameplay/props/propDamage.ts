import type { DamageType } from "@shared/types/lifecycle";
import { PropTuning, type PropArchetype } from "@game/config/props.config";

/** Un prop con `health: false` no se rompe por ningún medio. */
export function isPropDestructible(archetype: PropArchetype): boolean {
  return archetype.damage.health !== false;
}

export function propMaxHealth(archetype: PropArchetype): number {
  return archetype.damage.health === false ? Infinity : archetype.damage.health;
}

/**
 * Fuerza efectiva del golpe tras aplicar el multiplicador del tipo. Es lo que
 * hace que la barreta parta un cajón y apenas raye un archivero.
 *
 * NO mira si el prop es destructible: un balde indestructible igual tiene que
 * poder abollarse y sonar al recibir el tiro. Quién pierde vida lo decide
 * `PropInstance`, que es el único que sabe si le queda.
 */
export function resolvePropDamage(
  archetype: PropArchetype,
  amount: number,
  damageType?: DamageType,
): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const multiplier =
    (damageType ? archetype.damage.multipliers?.[damageType] : undefined) ?? 1;
  return amount * multiplier;
}

/**
 * Daño que se hace a sí mismo un prop al chocar a cierta velocidad. Debajo de
 * su umbral no se lastima: un cajón empujado por el piso nunca se rompe solo.
 */
export function impactDamageToProp(archetype: PropArchetype, speed: number): number {
  const profile = archetype.damage;
  if (!isPropDestructible(archetype)) return 0;
  if (!Number.isFinite(speed) || !Number.isFinite(profile.impactDamageSpeed)) return 0;
  const excess = speed - profile.impactDamageSpeed;
  return excess <= 0 ? 0 : excess * profile.impactDamageScale;
}

/** La masa escala al cubo: duplicar el tamaño lo hace ocho veces más pesado. */
export function propMassForScale(archetype: PropArchetype, scale: number): number {
  return archetype.physics.mass * clampPropScale(scale) ** 3;
}

export function clampPropScale(scale: number | undefined): number {
  if (scale === undefined || !Number.isFinite(scale)) return 1;
  return Math.min(PropTuning.maxScale, Math.max(PropTuning.minScale, scale));
}

/** Extensiones del prop ya escaladas, para bounds de nav y placeholder. */
export function propBoundsForScale(
  archetype: PropArchetype,
  scale: number | undefined,
): [number, number, number] {
  const factor = clampPropScale(scale);
  const [x, y, z] = archetype.bounds;
  return [x * factor, y * factor, z * factor];
}
