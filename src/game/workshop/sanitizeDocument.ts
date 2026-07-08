import type { EditorDocument } from "@game/editor/EditorDocument";
import { isEditorDocument } from "@game/editor/persistence";
import { Soundscapes } from "@game/config/audio.config";

export type SanitizeResult =
  | { ok: true; document: EditorDocument }
  | { ok: false; reason: string };

/** Tope de entidades antes de rechazar (evita colgar el browser al construir). */
const MAX_ENTITIES = 2000;
/** Tamano maximo del documento serializado, en caracteres (~bytes para ASCII). */
const MAX_SERIALIZED_LENGTH = 512 * 1024;
const MAX_STRING_LENGTH = 4000;
/** Presupuesto de nodos al recorrer el arbol; corta estructuras patologicas. */
const MAX_NODES = 200_000;

/**
 * Chequeo best-effort del lado del cliente: estructura minima + limites de
 * tamano/complejidad + numeros finitos. NO sustituye la validacion del
 * servidor (que es la autoridad); corre antes de publicar y tras descargar
 * como defensa en profundidad y para fallar rapido con un mensaje claro.
 */
export function sanitizeDocument(value: unknown): SanitizeResult {
  if (!isEditorDocument(value)) {
    return { ok: false, reason: "El documento no tiene la estructura esperada." };
  }
  if (value.entities.length > MAX_ENTITIES) {
    return {
      ok: false,
      reason: `Demasiadas entidades (${value.entities.length} > ${MAX_ENTITIES}).`,
    };
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return { ok: false, reason: "El documento no es serializable." };
  }
  if (serialized.length > MAX_SERIALIZED_LENGTH) {
    return { ok: false, reason: "El documento supera el tamano maximo permitido." };
  }

  const scan = scanValue(value);
  if (!scan.ok) return scan;

  const soundscapeScan = scanSoundscapeReferences(value);
  if (!soundscapeScan.ok) return soundscapeScan;

  return { ok: true, document: value };
}

function scanSoundscapeReferences(
  document: EditorDocument,
): { ok: true } | { ok: false; reason: string } {
  const audio = document.meta.audio as { soundscape?: unknown } | undefined;
  const levelSoundscape = audio?.soundscape;
  if (levelSoundscape !== undefined && !isKnownSoundscape(levelSoundscape)) {
    return { ok: false, reason: "El documento referencia un soundscape desconocido." };
  }

  for (const entity of document.entities) {
    const candidate = entity as { kind?: unknown; def?: { actions?: unknown } };
    if (candidate.kind !== "trigger") {
      continue;
    }
    if (!Array.isArray(candidate.def?.actions)) {
      continue;
    }
    for (const rawAction of candidate.def.actions) {
      const action =
        rawAction !== null && typeof rawAction === "object"
          ? (rawAction as { kind?: unknown; soundscape?: unknown })
          : null;
      if (action?.kind === "soundscape" && !isKnownSoundscape(action.soundscape)) {
        return { ok: false, reason: "El documento referencia un soundscape desconocido." };
      }
    }
  }

  return { ok: true };
}

function isKnownSoundscape(value: unknown): boolean {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(Soundscapes, value);
}

function scanValue(root: unknown): { ok: true } | { ok: false; reason: string } {
  let nodes = 0;
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > MAX_NODES) {
      return { ok: false, reason: "El documento es demasiado complejo." };
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        return { ok: false, reason: "El documento contiene numeros invalidos." };
      }
    } else if (typeof current === "string") {
      if (current.length > MAX_STRING_LENGTH) {
        return { ok: false, reason: "El documento contiene texto demasiado largo." };
      }
    } else if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
    } else if (current !== null && typeof current === "object") {
      for (const item of Object.values(current)) stack.push(item);
    }
  }
  return { ok: true };
}
