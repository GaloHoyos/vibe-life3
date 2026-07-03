/**
 * Tuning data-driven de la ice gun (blobulator estilo Episode 3).
 * LMB = spray unificado (pinta hielo en superficies estáticas / congela NPCs);
 * RMB sostenido = rampa asistida que crece hacia adelante para surfear.
 */
export const IceConfig = {
  /** Grilla del blobulator (marching cubes por chunks alineados al mundo). */
  blob: {
    chunkSize: 2.8,
    cellSize: 0.14,
    padCells: 3,
    maxPolyCount: 30000,
    maxChunkRebuildsPerFrame: 3,
  },
  paint: {
    /** Radio base de cada depósito del spray. */
    blobRadius: 0.44,
    radiusJitter: 0.1,
    /** Intervalo mínimo entre depósitos (el beam sigue al fireRate del arma). */
    interval: 0.12,
    /**
     * No depositar si el centro del blob queda a menos de esto de la cápsula
     * del tirador: evita que la masa crezca hasta clipear dentro del player.
     */
    shooterClearance: 1.0,
    /** El centro se entierra `radius * embedFactor` en la superficie. */
    embedFactor: 0.35,
    /** Paso del puente entre ticks consecutivos del stroke. */
    strokeStep: 0.4,
    /** Más allá de esto el stroke se corta (no se puentea). */
    strokeBridgeMax: 2.4,
    /** Segundos sin pintar tras los cuales el stroke se resetea. */
    strokeResetDelay: 0.35,
    /** Presupuesto global de blobs; al excederlo, el más viejo se derrite. */
    budget: 240,
  },
  melt: {
    /** Duración del derretido (el blob encoge y desaparece). */
    seconds: 1.1,
    /** Escala del radio a la que el blob desaparece del campo. */
    minScale: 0.4,
    /** Throttle de updates de radio durante el derretido (rebuilds de chunk). */
    updateInterval: 0.1,
    /** Máximo de blobs derritiéndose a la vez (limita rebuilds). */
    maxConcurrent: 10,
  },
  /** Daño de armas sobre hielo: cavado de blobs alrededor del impacto. */
  carve: {
    baseRadius: 0.45,
    radiusPerDamage: 0.012,
    maxRadius: 1.5,
  },
  /** Rampa asistida (RMB sostenido). rise/step ≈ 17.5° de pendiente. */
  ramp: {
    cooldown: 0.09,
    step: 0.6,
    rise: 0.19,
    blobRadius: 0.5,
    lateralOffsets: [-0.5, 0, 0.5],
    /** Largo máximo de una rampa desde su arranque (evita puentes infinitos). */
    maxLength: 14,
    groundProbeForward: 1.1,
    groundProbeHeight: 0.65,
    groundProbeDistance: 3.6,
  },
  freeze: {
    perTick: 14,
    threshold: 100,
    decayDelay: 1.2,
    decayPerSecond: 28,
    /** Daño por tick a jefes resistentes al congelamiento. */
    bossColdDamage: 4,
    patchTtl: 2.2,
    maxPatches: 48,
    /**
     * Estatua congelada: el NPC muere rígido y cae como un cuerpo dinámico
     * único (sin ragdoll), recubierto por un cascarón de metaballs horneado.
     */
    statue: {
      mass: 75,
      /** Empujón horizontal (m/s) a la altura del torso para que se tumbe. */
      tipSpeed: 1.6,
      /** Ancho del collider de caja relativo al radio de la cápsula. */
      widthFactor: 1.5,
    },
  },
} as const;
