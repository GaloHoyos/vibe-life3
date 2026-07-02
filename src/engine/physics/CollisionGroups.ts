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
} as const;

const ALL_GROUPS = 0xffff;

export function interactionGroups(membership: number, filter: number): number {
  return ((membership & ALL_GROUPS) << 16) | (filter & ALL_GROUPS);
}

/** Live player/NPC capsules: collide with everything (world sees them as always). */
export const ACTOR_COLLISION_GROUPS = interactionGroups(CollisionGroup.Actor, ALL_GROUPS);

/** Ragdoll parts: collide with world and other ragdolls, never with live actor capsules. */
export const RAGDOLL_COLLISION_GROUPS = interactionGroups(
  CollisionGroup.Ragdoll,
  ALL_GROUPS & ~CollisionGroup.Actor,
);
