import type { Disposable } from "@shared/types/lifecycle";
import type { JsonValue } from "./JsonValue";
import type { SaveStorageAdapter } from "./SaveStorageAdapter";
import type { SaveEnvelopeV1 } from "./SaveTypes";

const DEFAULT_DATABASE_NAME = "vibe-life-saves";
const DATABASE_VERSION = 1;
const SAVES_STORE = "saves";
const DOCUMENTS_STORE = "documents";

interface StoredDocument {
  hash: string;
  document: JsonValue;
}

export interface IndexedDbSaveStorageOptions {
  indexedDb?: IDBFactory;
  databaseName?: string;
}

export class IndexedDbSaveStorage implements SaveStorageAdapter, Disposable {
  private readonly factory: IDBFactory;
  private readonly databaseName: string;
  private databasePromise: Promise<IDBDatabase> | null = null;
  private disposed = false;

  constructor(options: IndexedDbSaveStorageOptions = {}) {
    const factory = options.indexedDb ?? globalThis.indexedDB;
    if (!factory) {
      throw new Error("IndexedDB no está disponible");
    }
    this.factory = factory;
    this.databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME;
  }

  async getSave(id: string): Promise<unknown | null> {
    const database = await this.open();
    return requestResult(database, SAVES_STORE, "readonly", (store) => store.get(id));
  }

  async listSaves(): Promise<readonly unknown[]> {
    const database = await this.open();
    const result = await requestResult<unknown[]>(
      database,
      SAVES_STORE,
      "readonly",
      (store) => store.getAll(),
    );
    return Array.isArray(result) ? result : [];
  }

  async commitSaves(
    save: SaveEnvelopeV1,
    deleteIds: readonly string[],
  ): Promise<void> {
    const database = await this.open();
    await runTransaction(database, SAVES_STORE, "readwrite", (store) => {
      for (const id of deleteIds) {
        if (id !== save.id) store.delete(id);
      }
      store.put(save);
    });
  }

  async deleteSave(id: string): Promise<void> {
    const database = await this.open();
    await runTransaction(database, SAVES_STORE, "readwrite", (store) => {
      store.delete(id);
    });
  }

  async getDocument(hash: string): Promise<unknown | null> {
    const database = await this.open();
    const value = await requestResult<unknown>(
      database,
      DOCUMENTS_STORE,
      "readonly",
      (store) => store.get(hash),
    );
    if (!value || typeof value !== "object" || !("document" in value)) {
      return null;
    }
    return (value as StoredDocument).document;
  }

  async putDocument(hash: string, document: JsonValue): Promise<void> {
    const database = await this.open();
    await runTransaction(database, DOCUMENTS_STORE, "readwrite", (store) => {
      const record: StoredDocument = { hash, document };
      store.put(record);
    });
  }

  async deleteDocument(hash: string): Promise<void> {
    const database = await this.open();
    await runTransaction(database, DOCUMENTS_STORE, "readwrite", (store) => {
      store.delete(hash);
    });
  }

  dispose(): void {
    this.disposed = true;
    const pending = this.databasePromise;
    this.databasePromise = null;
    if (pending) {
      void pending.then((database) => database.close()).catch(() => undefined);
    }
  }

  private open(): Promise<IDBDatabase> {
    if (this.disposed) {
      return Promise.reject(new Error("El repositorio de guardados fue cerrado"));
    }
    if (!this.databasePromise) {
      this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = this.factory.open(this.databaseName, DATABASE_VERSION);
        let rejected = false;
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(SAVES_STORE)) {
            database.createObjectStore(SAVES_STORE, { keyPath: "id" });
          }
          if (!database.objectStoreNames.contains(DOCUMENTS_STORE)) {
            database.createObjectStore(DOCUMENTS_STORE, { keyPath: "hash" });
          }
        };
        request.onsuccess = () => {
          const database = request.result;
          if (rejected || this.disposed) {
            database.close();
            if (!rejected) reject(new Error("El repositorio de guardados fue cerrado"));
            return;
          }
          database.onversionchange = () => {
            database.close();
            if (this.databasePromise) this.databasePromise = null;
          };
          resolve(database);
        };
        request.onerror = () => {
          rejected = true;
          reject(request.error ?? new Error("No se pudo abrir IndexedDB"));
        };
        request.onblocked = () => {
          rejected = true;
          reject(new Error("La base de guardados está bloqueada por otra pestaña"));
        };
      });
      this.databasePromise.catch(() => {
        this.databasePromise = null;
      });
    }
    return this.databasePromise;
  }
}

function requestResult<T>(
  database: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  createRequest: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return new Promise<T | null>((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = createRequest(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => {
      reject(request.error ?? new Error("Falló una operación de IndexedDB"));
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error("La transacción fue cancelada"));
    };
  });
}

function runTransaction(
  database: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  mutate: (store: IDBObjectStore) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    mutate(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("Falló una transacción de IndexedDB"));
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error("La transacción fue cancelada"));
    };
  });
}
