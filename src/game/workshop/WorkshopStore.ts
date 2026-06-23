import type { EditorDocument } from "@game/editor/EditorDocument";
import { isEditorDocument } from "@game/editor/persistence";
import type { WorkshopListing } from "./WorkshopTypes";
import {
  getWorkshopSubscription,
  listWorkshopIndex,
  removeWorkshopSubscription,
  setWorkshopEnabled,
  upsertWorkshopSubscription,
  type WorkshopSubscription,
} from "./workshopIndex";

const DB_NAME = "vibe-workshop";
const DB_VERSION = 1;
const DOC_STORE = "documents";

/**
 * Almacen local de mapas suscritos. Los `EditorDocument` completos van a
 * IndexedDB (pueden superar el cupo ~5 MB de `localStorage` al acumular
 * suscripciones); el indice liviano sincronico vive en `workshopIndex`.
 */
export class WorkshopStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  async subscribe(listing: WorkshopListing, document: unknown): Promise<void> {
    await this.putDocument(listing.id, document);
    upsertWorkshopSubscription(listing);
  }

  async unsubscribe(id: string): Promise<void> {
    await this.deleteDocument(id);
    removeWorkshopSubscription(id);
  }

  setEnabled(id: string, enabled: boolean): void {
    setWorkshopEnabled(id, enabled);
  }

  isSubscribed(id: string): boolean {
    return getWorkshopSubscription(id) !== null;
  }

  listIndex(): WorkshopSubscription[] {
    return listWorkshopIndex();
  }

  /** True si hay una suscripcion local con una revision distinta a la remota. */
  needsUpdate(listing: WorkshopListing): boolean {
    const sub = getWorkshopSubscription(listing.id);
    return sub !== null && sub.revision !== listing.revision;
  }

  async getDocument(id: string): Promise<EditorDocument | null> {
    const db = await this.openDb();
    const value = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(DOC_STORE, "readonly");
      const request = tx.objectStore(DOC_STORE).get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Error leyendo documento"));
    });
    return isEditorDocument(value) ? value : null;
  }

  private openDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(DOC_STORE)) {
            db.createObjectStore(DOC_STORE);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB no disponible"));
      });
      // No cachear una promesa rechazada: si la apertura falla (transitorio),
      // permitir que el proximo intento la vuelva a abrir.
      this.dbPromise.catch(() => {
        this.dbPromise = null;
      });
    }
    return this.dbPromise;
  }

  private async putDocument(id: string, document: unknown): Promise<void> {
    const db = await this.openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DOC_STORE, "readwrite");
      tx.objectStore(DOC_STORE).put(document, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Error guardando documento"));
    });
  }

  private async deleteDocument(id: string): Promise<void> {
    const db = await this.openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DOC_STORE, "readwrite");
      tx.objectStore(DOC_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Error borrando documento"));
    });
  }
}
