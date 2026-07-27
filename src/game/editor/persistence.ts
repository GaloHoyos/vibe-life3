import {
  CURRENT_EDITOR_SCHEMA_VERSION,
  type EditorDocument,
} from './EditorDocument';
import { migrateDocument } from './migrateDocument';

const DRAFT_KEY = 'vibe.editor.draft';
const MODE_KEY = 'vibe.editor.mode';

export type EditorMode = 'edit' | 'playtest';

/** Validacion estructural minima de un documento parseado de JSON externo. */
export function isEditorDocument(value: unknown): value is EditorDocument {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Partial<EditorDocument>;
  const schemaVersion = (value as { schemaVersion?: unknown }).schemaVersion;
  return (
    (schemaVersion === undefined || schemaVersion === CURRENT_EDITOR_SCHEMA_VERSION) &&
    typeof doc.meta === 'object' &&
    doc.meta !== null &&
    Array.isArray(doc.entities) &&
    Array.isArray((doc.meta as { playerStart?: unknown }).playerStart)
  );
}

export function saveDraft(doc: EditorDocument): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(doc));
  } catch {
    // Cuota llena o storage deshabilitado: el autosave es best-effort.
  }
}

export function loadDraft(): EditorDocument | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isEditorDocument(parsed) ? migrateDocument(parsed) : null;
  } catch {
    return null;
  }
}

/** Modo de boot del editor (round-trip de "Probar" via reload). En sessionStorage. */
export function setEditorMode(mode: EditorMode | null): void {
  if (mode) sessionStorage.setItem(MODE_KEY, mode);
  else sessionStorage.removeItem(MODE_KEY);
}

export function getEditorMode(): EditorMode | null {
  const value = sessionStorage.getItem(MODE_KEY);
  return value === 'edit' || value === 'playtest' ? value : null;
}

export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadJson(doc: EditorDocument): void {
  downloadText(`${doc.meta.id || 'nivel'}.json`, JSON.stringify(doc, null, 2), 'application/json');
}

/** Abre un selector de archivo y resuelve con el `EditorDocument` parseado. */
export function pickJsonFile(): Promise<EditorDocument> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error('Sin archivo'));
        return;
      }
      file
        .text()
        .then((text) => {
          const parsed: unknown = JSON.parse(text);
          if (isEditorDocument(parsed)) resolve(migrateDocument(parsed));
          else reject(new Error('JSON no es un documento de editor valido'));
        })
        .catch((error: unknown) => reject(error instanceof Error ? error : new Error('Error leyendo archivo')));
    });
    input.click();
  });
}
