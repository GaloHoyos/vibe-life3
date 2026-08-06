import type { SoundManager } from "@engine/audio/core/SoundManager";
import type { SoundRef } from "@game/config/audio.config";

/**
 * Elige una variante disponible de un `SoundRef`. Las tablas de
 * `audio.config` declaran pools de varios clips para que un impacto o una
 * vocalización no suene idéntica dos veces seguidas; acá se resuelve cuál
 * existe realmente en el catálogo y se sortea entre ésas.
 *
 * Devuelve `null` cuando ninguna variante está registrada — es lo que permite
 * declarar audio para contenido cuyos assets todavía no están.
 */
export function pickSound(
  sounds: SoundManager,
  ref: SoundRef | undefined,
): string | null {
  if (!ref) {
    return null;
  }
  const candidates = typeof ref === "string" ? [ref] : ref;
  const available = candidates.filter((id) => sounds.hasSound(id));
  if (available.length === 0) {
    return null;
  }
  return available[Math.floor(Math.random() * available.length)] ?? null;
}

/** Primera variante disponible, sin sorteo: para cues que deben ser estables. */
export function firstSound(
  sounds: SoundManager,
  ref: SoundRef | undefined,
): string | null {
  if (!ref) {
    return null;
  }
  const candidates = typeof ref === "string" ? [ref] : ref;
  return candidates.find((id) => sounds.hasSound(id)) ?? null;
}
