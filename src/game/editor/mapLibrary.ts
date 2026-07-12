import type { EditorDocument } from './EditorDocument';
import { isEditorDocument } from './persistence';
import { migrateDocument } from './migrateDocument';

/**
 * Biblioteca de mapas custom persistida en `localStorage`. A diferencia del
 * draft unico del editor, guarda multiples documentos nombrados que alimentan la
 * seccion "Mapas Personalizados" del menu. Sincrono a proposito: el menu arma su
 * lista de forma sincrona y el volumen esperado (un punado de mapas) entra de
 * sobra en el cupo de localStorage. Si llegara a escalar, migrar a IndexedDB.
 */
const INDEX_KEY = 'vibe.maps.index';
const MAP_PREFIX = 'vibe.maps.';

export interface LibraryMapInfo {
  id: string;
  title: string;
}

function readIndex(): LibraryMapInfo[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is LibraryMapInfo =>
        !!entry &&
        typeof entry === 'object' &&
        typeof (entry as LibraryMapInfo).id === 'string' &&
        typeof (entry as LibraryMapInfo).title === 'string',
    );
  } catch {
    return [];
  }
}

function writeIndex(index: LibraryMapInfo[]): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

export function listLibraryMaps(): LibraryMapInfo[] {
  return readIndex();
}

export function getLibraryMap(id: string): EditorDocument | null {
  try {
    const raw = localStorage.getItem(MAP_PREFIX + id);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isEditorDocument(parsed) ? migrateDocument(parsed) : null;
  } catch {
    return null;
  }
}

/** Upsert por `doc.meta.id`. Sobrescribe el mapa homonimo y refresca el indice. */
export function saveLibraryMap(doc: EditorDocument): void {
  const id = doc.meta.id;
  localStorage.setItem(MAP_PREFIX + id, JSON.stringify(doc));
  const index = readIndex().filter((entry) => entry.id !== id);
  index.push({ id, title: doc.meta.title || id });
  writeIndex(index);
}

export function deleteLibraryMap(id: string): void {
  localStorage.removeItem(MAP_PREFIX + id);
  writeIndex(readIndex().filter((entry) => entry.id !== id));
}
