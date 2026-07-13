/**
 * Tuning del NPC blob (npc_blob de HL2:Ep3): enjambre de metaballs que
 * persigue, envuelve y consume. Referencia original: ~20 elementos, velocidad
 * clampeada 50%..150% y daño de contacto continuo (200 DPS en HL2 — acá ~17
 * DPS para que sea jugable).
 */
export const BlobConfig = {
  swarm: {
    // Muchos elementos muy solapados y hundidos: el campo se funde en un manto
    // ancho y bajo (la referencia de Ep3 es una masa continua, no bolitas).
    baseElements: 192,
    maxElements: 250,
    elementRadius: 0.28,
    speedBase: 3.4,
    speedWaveAmplitude: 0.35,
    waveFrequency: 5.5,
    separationScale: 0.58,
    groundRaycastsPerFrame: 20,
    groundSink: 0.2,
    baseRadius: 1.6,
    /** Escala visual del campo: solapa la carne para formar una piel continua. */
    surfaceFieldRadiusScale: 2.05,
    /** Ignora unos pocos splats extremos al dimensionar la superficie principal. */
    surfaceDomainPercentile: 0.96,
    surfaceMaxDomain: 7,
    surfaceResolution: 40,
    maxPolyCount: 40000,
    gravity: 18,
    /** Ooze de trepado contra paredes (presión de líquido). */
    climbSpeed: 2.4,
    maxClimb: 1.3,
    stackRide: 0.8,
    /** Escalón que el flujo vierte de una (trace elevado estilo npc_blob). */
    stepUpHeight: 0.26,
    /** Chunks volados por disparos: gracia balística y crawl de regreso. */
    detachReturnDelay: 0.55,
    crawlReturnSpeed: 2.3,
    /** Peso del líquido al saltar: la carne baja despega hasta este retraso. */
    leapStagger: 0.22,
    /** Gel rezagado más allá de este radio (× baseRadius) se corta como chunk. */
    strandDistanceScale: 2.1,
    /** Segundos colgando fuera de alcance antes de separarse por gravedad. */
    strandSeconds: 0.45,
    /** Altura del domo al envolver una víctima (pies a cabeza). */
    envelopHeight: 1.7,
    /** Flujo del manto sobre la víctima al envolverla. */
    envelopFlowSpeed: 2.9,
    /** Fracción de la carne que abandona el montículo para envolver. */
    envelopFraction: 0.62,
    /** Deriva angular del manto (rad/s): la piel sigue fluyendo al matar. */
    envelopSwirlSpeed: 0.55,
  },
  /** Hitboxes y reacción física por elemento. */
  physics: {
    /** Vida individual: con suficiente daño el elemento revienta (pop). */
    elementHealth: 20,
    // Doce esferas sobre el hull dan una cobertura jugable de la piel sin
    // volver a crear un sensor por partícula. Los centros se eligen mediante
    // farthest-point sampling determinista; no son promedios del volumen.
    elementHitboxRadius: 0.8,
    clusterHitboxCount: 12,
    coreHitboxRadius: 0.42,
    /** El núcleo es el punto débil: multiplica el daño al pool total. */
    coreDamageMult: 2.5,
    knockSpeedPerDamage: 0.25,
    knockMaxSpeed: 7.5,
    knockUpSpeed: 2.8,
    /** Apertura local que permite que un rayo repetido alcance el cerebro. */
    localOpeningRadius: 1.05,
    localOpeningSeconds: 1.15,
    localOpeningBaseStrength: 0.45,
    localOpeningStrengthPerDamage: 0.02,
    localOpeningDisableThreshold: 0.52,
    localOpeningMinimumRadiusScale: 0.2,
    /** Sacudida radial de toda la masa ante golpes fuertes (explosiones). */
    shockwaveSpeed: 5.5,
    shockwaveUpSpeed: 2.2,
    /**
     * Daño acumulado en la misma zona (ventana `localOpeningSeconds`) que
     * desprende un chunk de masa; todo explosivo desprende siempre.
     */
    detachDamageThreshold: 12,
    detachRadiusBase: 0.6,
    detachRadiusPerDamage: 0.008,
    detachSpeedBase: 4.6,
    detachSpeedPerDamage: 0.09,
    detachMaxSpeed: 8,
    /** Tope de Δv/s al empujar props; debe ganarle a la fricción (µ·g ≈ 10). */
    propPushMaxDeltaV: 14,
  },
  /** Núcleo/"cerebro" emisivo visible a través de la masa translúcida. */
  core: {
    /** Metaball extra en el centro: levanta una joroba sobre el núcleo. */
    fieldRadius: 0.62,
    visualRadius: 0.3,
    glowRadius: 0.48,
    /** Altura del núcleo sobre el centroide de los elementos. */
    heightOffset: 0.3,
    maxHealth: 150,
    minimumExposure: 0.35,
  },
  contact: {
    damage: 6,
    interval: 0.35,
    baseRange: 1.7,
    rangePerGrowth: 0.15,
    attackSoundInterval: 1.0,
  },
  growth: {
    maxKills: 5,
    elementsPerKill: 12,
    radiusPerKill: 0.08,
    damageMultPerKill: 0,
    healPerKill: 30,
    propElements: 4,
    propHeal: 10,
    propConsumeSeconds: 2,
  },
  shrink: {
    /** Con vida 0 el enjambre conserva esta fracción de elementos visibles. */
    minVisibleFraction: 0.3,
    minElements: 10,
  },
  death: {
    dispersalSeconds: 1.4,
  },
  organism: {
    fixedStep: 1 / 30,
    maxSubsteps: 2,
    structureParticles: 24,
    footParticles: 40,
    armParticles: 16,
    maxComponents: 6,
    automaticSplitComponents: 3,
    splitLifetime: 3.5,
    spatialCellSize: 0.62,
    constraintIterations: 3,
  },
  surfaceLod: {
    nearDistance: 18,
    midDistance: 45,
    farDistance: 90,
    hysteresisDistance: 3,
    hysteresisSeconds: 0.5,
    hiddenDelay: 0.75,
    frameBudgetMs: 3.5,
    nearResolution: 40,
    midResolution: 32,
    farResolution: 24,
    nearUpdateHz: 30,
    midUpdateHz: 15,
    farUpdateHz: 5,
    splitMainResolution: 32,
    splitResolution: 24,
  },
} as const;
