/**
 * Perfil de mezcla: qué tan fuerte debe sonar cada *rol* de clip una vez
 * normalizado.
 *
 * La unidad de normalización es el rol, no el bus ni la categoría. Medido
 * sobre los assets reales: dentro del bus `weapons` un disparo (-11.7 LUFS) y
 * su recarga (-30.3 LUFS) difieren 18 dB **a propósito**, mientras que dentro
 * del mismo pool de pasos hay 24 dB de diferencia que es puro ruido de origen.
 * Normalizar por bus aplastaría lo primero; normalizar por rol arregla lo
 * segundo y respeta lo primero.
 */

export type AudioRole =
  | "weaponFire"
  | "weaponHandling"
  | "impact"
  | "explosion"
  | "vocalization"
  | "footstep"
  | "ambienceBed"
  | "ambienceOneShot"
  | "uiClick"
  | "voice"
  | "music"
  | "engineLoop"
  | "hevBeep";

/** Medición generada por `npm run audio:levels`. */
export interface ClipLoudness {
  /** Sonoridad K-weighted (BS.1770) de la ventana de 400 ms más fuerte. */
  readonly lufs: number;
  /** Pico de muestra, 0..1. */
  readonly peak: number;
}

/** Objetivo de sonoridad por rol, en LUFS. */
export const RoleLoudnessTargets: Readonly<Record<AudioRole, number>> = {
  explosion: -10,
  weaponFire: -12,
  vocalization: -16,
  voice: -16,
  music: -18,
  impact: -18,
  weaponHandling: -20,
  engineLoop: -20,
  uiClick: -20,
  hevBeep: -22,
  footstep: -24,
  ambienceOneShot: -24,
  ambienceBed: -30,
};

/**
 * Cuánto manda cada rol al retorno de reverb, 0..1.
 *
 * Es lo que decide qué "vive en el espacio" y qué no: un disparo retumba en el
 * pasillo, la voz del traje suena dentro del casco y la interfaz no está en el
 * mundo. Antes esto era un peso por bus, que no podía distinguir el chillido de
 * un enemigo del zumbido de su motor.
 */
export const RoleReverbSend: Readonly<Record<AudioRole, number>> = {
  explosion: 1,
  weaponFire: 1,
  impact: 0.9,
  vocalization: 0.9,
  engineLoop: 0.8,
  footstep: 0.7,
  weaponHandling: 0.5,
  ambienceOneShot: 0.3,
  hevBeep: 0.15,
  // El lecho de ambiente ya está grabado con el espacio adentro.
  ambienceBed: 0.1,
  // Suenan dentro del casco del jugador, no en la sala.
  voice: 0,
  uiClick: 0,
  music: 0,
};

export const MixTuning = {
  /**
   * Techo de amplificación. Un clip grabado muy bajo tiene el piso de ruido
   * proporcionalmente alto; subirlo sin límite trae el ruido con él.
   */
  maxBoostDb: 12,
  /**
   * Techo de pico al amplificar. Va por encima de 0 dBFS a propósito: Web Audio
   * es float de punta a punta y el único lugar donde se clipea es el destino,
   * con el limiter del master delante. Recortar los transitorios acá dejaría a
   * los clips de pico alto y RMS bajo (pasos, clicks) atados 5-10 dB por debajo
   * de su rol.
   */
  peakCeilingDb: 3,
  /**
   * Por debajo de esto la medición es silencio digital y el clip se deja como
   * está: normalizarlo sería amplificar solo ruido.
   */
  silenceFloorLufs: -70,
} as const;
