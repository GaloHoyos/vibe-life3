/**
 * Tuning data-driven del NPC blob. El core es el cuerpo principal dañable y
 * cada esfera de `armor` es un rigid body independiente unido por un resorte.
 */
export const BlobConfig = {
  core: {
    maxHealth: 60,
    radius: 0.38,
    mass: 24,
  },
  armor: {
    count: 16,
    minRadius: 0.21,
    maxRadius: 0.25,
    mass: 0.45,
    orbitRadius: 0.68,
    springRestLength: 0,
    springStiffness: 90,
    springDamping: 12,
    detachImpulse: 1.2,
    reflowDelay: 0.5,
    reflowDuration: 1.5,
    linearDamping: 0.8,
    angularDamping: 1.2,
  },
} as const;
