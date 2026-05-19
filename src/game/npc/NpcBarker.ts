import type { GameEventBus } from "../GameEvents";

/**
 * Categorías de bark. Cada una tiene su propio cooldown para evitar spam.
 * Diseñado para que más adelante un audio system pueda mapear cada categoría
 * a un clip distinto (variantes por personaje también — el `speaker`
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
 * Diccionario de líneas por categoría. Múltiples variantes para que no diga
 * siempre lo mismo. El hablante (`speaker`) lo pone el NPC.
 */
const BARK_LINES: Record<BarkCategory, BarkVariant[]> = {
  spotted: [
    { text: "¡Hostil avistado!", duration: 1.6 },
    { text: "¡Contacto al frente!", duration: 1.6 },
    { text: "¡Lo veo!", duration: 1.3 },
    { text: "¡Objetivo identificado!", duration: 1.7 },
  ],
  flanking: [
    { text: "¡Flanqueando por la derecha!", duration: 1.8 },
    { text: "¡Voy por la izquierda!", duration: 1.7 },
    { text: "¡Cubriendo el costado!", duration: 1.6 },
  ],
  covering: [
    { text: "¡A cubierto!", duration: 1.4 },
    { text: "¡Pierdo posición!", duration: 1.5 },
  ],
  reloading: [
    { text: "¡Recargando!", duration: 1.3 },
    { text: "¡Necesito munición!", duration: 1.6 },
  ],
  lostSight: [
    { text: "¡Lo perdí!", duration: 1.3 },
    { text: "¡Se escondió!", duration: 1.4 },
  ],
  investigating: [
    { text: "¡Última posición conocida!", duration: 1.8 },
    { text: "¡Revisando el área!", duration: 1.6 },
  ],
  advancing: [
    { text: "¡Avanzo!", duration: 1.2 },
    { text: "¡Presión!", duration: 1.2 },
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
 * Rate-limited emisor de subtitles tácticos para NPCs en combate.
 *
 * Cada categoría tiene su propio cooldown global (per-NPC, no global por
 * categoría). Random pick entre variantes. El sistema de audio futuro
 * puede suscribirse a `subtitle.show` y mapear `text` → clip de voz, o
 * agregar un evento dedicado si querés desacoplar.
 */
export class NpcBarker {
  private readonly lastSpokenAt: Partial<Record<BarkCategory, number>> = {};

  constructor(
    private readonly speaker: string,
    private readonly eventBus: GameEventBus,
  ) {}

  /** Emite si la categoría no está en cooldown. Devuelve true si emitió. */
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
