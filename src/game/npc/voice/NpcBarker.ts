import type { GameEventBus } from "@game/GameEvents";

/**
 * CategorÃ­as de bark. Cada una tiene su propio cooldown para evitar spam.
 * DiseÃ±ado para que mÃ¡s adelante un audio system pueda mapear cada categorÃ­a
 * a un clip distinto (variantes por personaje tambiÃ©n â€” el `speaker`
 * identifica al hablante).
 */
export type BarkCategory =
  | "spotted"
  | "flanking"
  | "covering"
  | "reloading"
  | "lostSight"
  | "investigating"
  | "advancing";

interface BarkVariant {
  text: string;
  duration: number;
}

/**
 * Diccionario de lÃ­neas por categorÃ­a. MÃºltiples variantes para que no diga
 * siempre lo mismo. El hablante (`speaker`) lo pone el NPC.
 */
const BARK_LINES: Record<BarkCategory, BarkVariant[]> = {
  spotted: [
    { text: "Anticiudadano localizado.", duration: 1.6 },
    { text: "Contacto visual. Sector comprometido.", duration: 1.9 },
    { text: "Objetivo confirmado. Procediendo.", duration: 1.8 },
    { text: "Unidad en contacto. Solicitando convergencia.", duration: 2.1 },
    { text: "Infractor detectado. Línea de fuego autorizada.", duration: 2.1 },
  ],

  flanking: [
    { text: "Unidad moviéndose a flanco derecho.", duration: 2.0 },
    { text: "Reposicionando a flanco izquierdo.", duration: 1.9 },
    { text: "Cerrando ángulo de escape.", duration: 1.8 },
    { text: "Vector lateral establecido.", duration: 1.7 },
    { text: "Maniobra de contención en curso.", duration: 2.0 },
  ],

  covering: [
    { text: "Tomando cobertura táctica.", duration: 1.7 },
    { text: "Posición comprometida. Reubicando.", duration: 2.0 },
    { text: "Unidad bajo presión. Manteniendo línea.", duration: 2.0 },
    { text: "Cobertura parcial establecida.", duration: 1.8 },
  ],

  reloading: [
    { text: "Ciclo de recarga iniciado.", duration: 1.6 },
    { text: "Recargando. Cubrir unidad.", duration: 1.7 },
    { text: "Munición baja. Reposición en curso.", duration: 1.9 },
    { text: "Interrupción de fuego. Recargando.", duration: 1.8 },
  ],

  lostSight: [
    { text: "Contacto visual perdido.", duration: 1.5 },
    { text: "Objetivo fuera de línea de visión.", duration: 1.8 },
    { text: "Anticiudadano desaparecido del sector.", duration: 2.0 },
    { text: "Rastro visual interrumpido. Mantener búsqueda.", duration: 2.1 },
  ],

  investigating: [
    { text: "Avanzando a última posición conocida.", duration: 2.1 },
    { text: "Barriendo sector. Armas listas.", duration: 1.8 },
    { text: "Investigando anomalía de movimiento.", duration: 2.0 },
    { text: "Patrón de búsqueda iniciado.", duration: 1.8 },
    { text: "Zona sospechosa. Proceder con cautela.", duration: 2.0 },
  ],

  advancing: [
    { text: "Avance autorizado.", duration: 1.4 },
    { text: "Presión táctica sobre objetivo.", duration: 1.8 },
    { text: "Cerrando distancia.", duration: 1.4 },
    { text: "Unidad avanzando. Mantener formación.", duration: 2.0 },
    { text: "Empujando línea de combate.", duration: 1.7 },
  ],
};

const COOLDOWNS: Record<BarkCategory, number> = {
  spotted: 8,
  flanking: 6,
  covering: 5,
  reloading: 4,
  lostSight: 6,
  investigating: 8,
  advancing: 5,
};

/**
 * Rate-limited emisor de subtitles tÃ¡cticos para NPCs en combate.
 *
 * Cada categorÃ­a tiene su propio cooldown global (per-NPC, no global por
 * categorÃ­a). Random pick entre variantes. El sistema de audio futuro
 * puede suscribirse a `subtitle.show` y mapear `text` â†’ clip de voz, o
 * agregar un evento dedicado si querÃ©s desacoplar.
 */
export class NpcBarker {
  private readonly lastSpokenAt: Partial<Record<BarkCategory, number>> = {};

  constructor(
    private readonly speaker: string,
    private readonly eventBus: GameEventBus,
  ) {}

  /** Emite si la categorÃ­a no estÃ¡ en cooldown. Devuelve true si emitiÃ³. */
  say(category: BarkCategory, elapsed: number): boolean {
    const last = this.lastSpokenAt[category] ?? -Infinity;
    const cooldown = COOLDOWNS[category];
    if (elapsed - last < cooldown) return false;
    this.lastSpokenAt[category] = elapsed;

    const variants = BARK_LINES[category];
    const variant = variants[Math.floor(Math.random() * variants.length)];
    this.eventBus.emit("subtitle.show", {
      speaker: this.speaker,
      text: variant.text,
      duration: variant.duration,
    });
    return true;
  }
}
