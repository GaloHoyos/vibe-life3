/**
 * Rapier interaction groups. Colliders without explicit groups default to
 * membership/filter 0xffff (collide with everything), so only the pairs that
 * must NOT interact need tagging: ragdoll parts vs live actor capsules.
 * The filter is bidirectional: contact happens iff (m1 & f2) && (m2 & f1).
 */
export const CollisionGroup = {
  Default: 0x0001,
  Actor: 0x0002,
  Ragdoll: 0x0004,
  CharacterMedium: 0x0008,
} as const;

const ALL_GROUPS = 0xffff;

export function interactionGroups(membership: number, filter: number): number {
  return ((membership & ALL_GROUPS) << 16) | (filter & ALL_GROUPS);
}

/** Live player/NPC capsules: collide with everything (world sees them as always). */
export const ACTOR_COLLISION_GROUPS = interactionGroups(CollisionGroup.Actor, ALL_GROUPS);

/** Medio semipermeable: interactúa con mundo/props, pero no bloquea actores vivos. */
export const CHARACTER_MEDIUM_COLLISION_GROUPS = interactionGroups(
  CollisionGroup.CharacterMedium,
  ALL_GROUPS & ~CollisionGroup.Actor,
);

/** Ragdoll parts: collide with world and other ragdolls, never with live actor capsules. */
export const RAGDOLL_COLLISION_GROUPS = interactionGroups(
  CollisionGroup.Ragdoll,
  ALL_GROUPS & ~CollisionGroup.Actor,
);

/**
 * Portal aperture patch (the physical hole objects tumble through): collides
 * with dynamic props only, never with player/NPC capsules or ragdolls, so it
 * cannot interfere with character traversal — only props rest on / pivot over
 * its real edge.
 */
export const APERTURE_COLLISION_GROUPS = interactionGroups(
  CollisionGroup.Default,
  ALL_GROUPS & ~CollisionGroup.Actor & ~CollisionGroup.Ragdoll,
);
