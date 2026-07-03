/**
 * Tuning data-driven de la portal gun y sus portales.
 * Slot "a" = portal azul (LMB), slot "b" = portal naranja (RMB).
 */
export const PortalConfig = {
  ellipse: {
    halfWidth: 0.55,
    halfHeight: 0.95,
  },
  placement: {
    range: 60,
    /** Lift over the surface for fit probes; toi must land near it. */
    probeLift: 0.1,
    probeMaxDistance: 0.2,
    probeToiMin: 0.08,
    probeToiMax: 0.12,
    /** Min alignment (dot) between probe hit normal and portal normal. */
    normalAlignMin: 0.99,
    /** Below this |normal.y| the surface counts as wall (up = world up). */
    wallNormalYMax: 0.75,
  },
  traversal: {
    /** Per-entity seconds before the same body can teleport again. */
    cooldownSeconds: 0.15,
    /**
     * The player teleports when crossing a plane this far IN FRONT of the
     * portal surface, so the camera never gets within near-plane distance of
     * the disc (visible "blink" otherwise). The landing is the exact
     * through-portal image of the crossing point — buried in the exit wall —
     * so a larger offset does NOT make the transition jumpier.
     */
    playerTriggerOffset: 0.15,
    /**
     * Same idea for dynamic bodies, but larger: they have no collision
     * filter against the backing wall, so they must teleport BEFORE the
     * solver resolves the contact (or they bounce off and never cross).
     */
    dynamicTriggerOffset: 0.25,
    /**
     * Min exit speed along the exit normal. For the player it only applies to
     * VERTICAL exits (floor/ceiling, where falling back behind the plane
     * drops you out of the world); wall exits keep the incoming speed intact
     * so slow walk-throughs stay fluid. Dynamics/NPCs use it on every exit.
     */
    minExitSpeed: 1.5,
    /** Distance to a linked portal that enables wall pass-through filtering. */
    passThroughProximity: 1.5,
    /** Ellipse margin factor for the crossing test. */
    crossingMargin: 1.15,
    /** Radius of the ball query that collects dynamic-body candidates. */
    dynamicQueryRadius: 2,
    /** Push-out along the exit normal for teleported dynamic bodies. */
    dynamicExitClearance: 0.35,
  },
  view: {
    renderScale: 1,
    maxViewDistance: 45,
  },
  colors: {
    a: 0x3fa7ff,
    b: 0xff9a3f,
  },
  npcTraversal: {
    enabled: false,
  },
} as const;
