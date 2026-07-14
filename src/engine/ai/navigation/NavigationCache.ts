const DB_NAME = "vibe-life-navigation";
const STORE_NAME = "domains";

export async function readNavigationCache(key: string): Promise<Map<string, Uint8Array> | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await openDatabase();
    const value = await requestValue<Record<string, ArrayBuffer> | undefined>(
      db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key),
    );
    db.close();
    if (!value) return null;
    return new Map(Object.entries(value).map(([id, data]) => [id, new Uint8Array(data)]));
  } catch {
    return null;
  }
}

export async function writeNavigationCache(key: string, domains: Map<string, Uint8Array>): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDatabase();
    const value: Record<string, ArrayBuffer> = {};
    for (const [id, bytes] of domains) {
      value[id] = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    }
    await requestValue(db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(value, key));
    db.close();
  } catch {
    // IndexedDB es una optimizacion; la navegación ya quedó generada.
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestValue<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
