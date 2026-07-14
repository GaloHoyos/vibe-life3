/**
 * Tuning data-driven del NPC blob. El core es el cuerpo principal dañable y
 * cada esfera de `armor` es un rigid body independiente unido por un resorte.
 */
export const BlobConfig = {
  core: {
    maxHealth: 60,
    radius: 0.38,
    mass: 24,
    /** Peso del cuerpo gel; la futura navegación mueve este root contra él. */
    gravityScale: 0.8,
  },
  armor: {
    /** Volumen multicapa: 6 nodos internos, 12 medios y 18 externos. */
    count: 36,
    layerCounts: [6, 12, 18] as const,
    layerRadii: [0.56, 0.78, 0.99] as const,
    layerPhases: [0, 2.3562, 4.6142] as const,
    coreAnchorCount: 6,
    coreAnchorRadius: 0.56,
    outerRadius: 0.99,
    /** Radio agregado conservador para spawn, separación y bounds de IA. */
    aggregateRadius: 1.48,
    minRadius: 0.18,
    maxRadius: 0.21,
    mass: 0.24,
    springRestLength: 0,
    springStiffness: 240,
    springDamping: 20,
    /** El resorte al core sobrevive brevemente al impacto para que pueda ceder. */
    detachResistanceSeconds: 0.1,
    detachImpulse: 1.2,
    /** Grafo local que mantiene juntas a las esferas vecinas. */
    cohesionNeighborCount: 4,
    /** Refuerzo tangencial mínimo para que las capas no sean sólo rayos. */
    cohesionLayerNeighborCount: 2,
    cohesionSpringStiffness: 50,
    cohesionSpringDamping: 5,
    /** No crea resortes nuevos hacia fragmentos que ya quedaron lejos. */
    cohesionAttachMaxDistance: 0.84,
    /** Carga relativa mínima para que un impacto pueda arrancar un vecino. */
    cohesionTearRelativeSpeed: 6,
    /** Una carga extrema corta la adhesión en vez de propagar el racimo. */
    cohesionSnapRelativeSpeed: 12,
    /** Tiempo durante el que el resorte transmite la carga antes de ceder. */
    cohesionTearDelaySeconds: 0.14,
    /** La adhesión al perímetro se fatiga si no consigue arrancar al vecino. */
    cohesionShellFatigueSeconds: 0.32,
    /** Los enlaces internos de un racimo toleran más deformación. */
    cohesionFragmentBreakStretch: 0.28,
    /** Fatiga pasiva: peso sostenido y maniobras bruscas cargan los bonds. */
    cohesionLoadStretchStart: 0.065,
    cohesionHeldStretchStart: 0.075,
    cohesionLoadSeparationSpeed: 0.9,
    cohesionLoadRelativeAcceleration: 18,
    cohesionHeldBodyAcceleration: 42,
    cohesionManeuverFatigueSeconds: 0.45,
    cohesionManeuverRecoveryPerSecond: 1.25,
    cohesionLoadFatigueSeconds: 0.52,
    cohesionLoadRecoveryPerSecond: 1.35,
    cohesionLoadBreakCooldown: 0.26,
    cohesionLoadMaxChunkSize: 10,
    cohesionLoadMinimumAttachedCount: 24,
    cohesionLoadPatchProtectionSeconds: 0.55,
    cohesionLoadInitialGraceSeconds: 0.65,
    cohesionReflowLoadGraceSeconds: 0.75,
    /** Carga sostenida sobre sectores sin suelo debajo (bordes/precipicios). */
    hangingLoadSupportProbe: 0.12,
    hangingLoadGroundProbeDepth: 3.1,
    hangingLoadFatigueSeconds: 0.68,
    hangingLoadRate: 1.15,
    hangingLoadRecoveryPerSecond: 1.5,
    hangingLoadMaxPatchSize: 3,
    /** Espera antes de que un fragmento vuelva a buscar otros blobs o el core. */
    reassemblyDelaySeconds: 0.75,
    /** Magnetismo local entre componentes desprendidos; no es navegación. */
    reassemblyAttractionRadius: 1.25,
    reassemblyAttractionAcceleration: 12,
    reassemblyMaxSpeed: 2.2,
    /** Margen sobre la suma de radios para convertir la atracción en un bond. */
    reassemblyJoinPadding: 0.08,
    reassemblyJoinMaxRelativeSpeed: 3,
    /** Retorno local hacia un punto de la cubierta del core. */
    reassemblyCoreAttractionRadius: 1.6,
    reassemblyCoreCaptureDistance: 0.3,
    reassemblyCoreAcceleration: 16,
    reassemblyCoreMaxSpeed: 2.4,
    /** Relajación interna: dobla cadenas desprendidas hasta formar un racimo. */
    fragmentShapePositionGain: 5,
    fragmentShapeAcceleration: 9,
    fragmentShapeMaxSpeed: 1.45,
    fragmentShapePadding: 0.025,
    /** Cobertura del cerebro: contiene cada capa y reparte sus nodos en 3D. */
    mainShapeRadialGain: 7,
    mainShapeRadialAcceleration: 14,
    mainShapeMaxSpeed: 2,
    mainShapeAngularGain: 7,
    mainShapeAngularAcceleration: 6,
    mainShapeSpacingScale: 0.92,
    mainShapeAssignmentGain: 5,
    mainShapeAssignmentAcceleration: 10,
    mainShapeAssignmentMaxSpeed: 1.3,
    mainShapeAssignmentHealingBoost: 2,
    mainShapeAssignmentMaintenanceScale: 0.35,
    mainShapeLoadedScale: 0.65,
    /** Tras cualquier cambio de masa, acelera el cierre uniforme de huecos. */
    mainShapeHealingBoost: 4,
    /** Crosslinks locales que fijan la nueva forma sin rigidizarla de golpe. */
    shapeHealInterval: 0.18,
    shapeHealPadding: 0.06,
    shapeHealMaxDegree: 7,
    shapeHealMaxBondsPerTick: 5,
    shapeHealMaxPrunedPerTick: 2,
    shapeHealStaleDistanceFactor: 1.15,
    reflowDelay: 0.5,
    reflowDuration: 1.5,
    /** El cuerpo principal hereda la caída del core; evita que la red se pliegue. */
    attachedGravityScale: 0.8,
    linearDamping: 0.45,
    angularDamping: 0.8,
  },
} as const;
