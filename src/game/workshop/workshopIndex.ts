import type { WorkshopListing } from "./WorkshopTypes";

/**
 * Indice sincronico de suscripciones del Workshop en `localStorage`. Espeja a
 * `mapLibrary`: el menu arma su lista de forma sincrona, asi que los metadatos
 * livianos (id/titulo/revision/enabled) viven aca, mientras los `EditorDocument`
 * completos van a IndexedDB (`WorkshopStore`) por cupo.
 */
const INDEX_KEY = "vibe.workshop.index";

export interface WorkshopSubscription {
  /** Id del listing del Workshop (clave del documento en IndexedDB). */
  id: string;
  title: string;
  revision: string;
  enabled: boolean;
}

function isSubscription(value: unknown): value is WorkshopSubscription {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<WorkshopSubscription>;
  return (
    typeof s.id === "string" &&
    typeof s.title === "string" &&
    typeof s.revision === "string" &&
    typeof s.enabled === "boolean"
  );
}

function readAll(): WorkshopSubscription[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSubscription);
  } catch {
    return [];
  }
}

function writeAll(list: WorkshopSubscription[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(list));
  } catch {
    // Cuota llena o storage deshabilitado: best-effort, igual que el editor.
  }
}

export function listWorkshopIndex(): WorkshopSubscription[] {
  return readAll();
}

export function getWorkshopSubscription(id: string): WorkshopSubscription | null {
  return readAll().find((s) => s.id === id) ?? null;
}

/** Upsert por `listing.id`. Preserva el flag `enabled` de una suscripcion previa. */
export function upsertWorkshopSubscription(listing: WorkshopListing): void {
  const list = readAll();
  const existing = list.find((s) => s.id === listing.id);
  const next = list.filter((s) => s.id !== listing.id);
  next.push({
    id: listing.id,
    title: listing.title,
    revision: listing.revision,
    enabled: existing ? existing.enabled : true,
  });
  writeAll(next);
}

export function removeWorkshopSubscription(id: string): void {
  writeAll(readAll().filter((s) => s.id !== id));
}

export function setWorkshopEnabled(id: string, enabled: boolean): void {
  const list = readAll();
  const target = list.find((s) => s.id === id);
  if (!target) return;
  target.enabled = enabled;
  writeAll(list);
}
