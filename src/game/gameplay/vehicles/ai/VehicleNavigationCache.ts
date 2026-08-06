import type {
  VehicleNavigationBake,
  VehicleNavigationBakeInput,
} from './VehicleAiTypes';
import { vehicleNavigationHash } from './VehicleNavigationHash';

export interface VehicleNavigationCache {
  read(hash: string): Promise<VehicleNavigationBake | null>;
  write(bake: VehicleNavigationBake): Promise<void>;
  delete?(hash: string): Promise<void>;
}

export class MemoryVehicleNavigationCache implements VehicleNavigationCache {
  private readonly entries = new Map<string, VehicleNavigationBake>();

  async read(hash: string): Promise<VehicleNavigationBake | null> {
    return this.entries.get(hash) ?? null;
  }

  async write(bake: VehicleNavigationBake): Promise<void> {
    this.entries.set(bake.hash, bake);
  }

  async delete(hash: string): Promise<void> {
    this.entries.delete(hash);
  }

  clear(): void {
    this.entries.clear();
  }
}

export class IndexedDbVehicleNavigationCache implements VehicleNavigationCache {
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly databaseName = 'vibe-life3-vehicle-navigation',
    private readonly storeName = 'bakes',
  ) {}

  async read(hash: string): Promise<VehicleNavigationBake | null> {
    const database = await this.database();
    const value = await requestResult<unknown>(
      database.transaction(this.storeName, 'readonly').objectStore(this.storeName).get(hash),
    );
    return isVehicleNavigationBake(value, hash) ? value : null;
  }

  async write(bake: VehicleNavigationBake): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(this.storeName, 'readwrite');
    transaction.objectStore(this.storeName).put(bake, bake.hash);
    await transactionComplete(transaction);
  }

  async delete(hash: string): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(this.storeName, 'readwrite');
    transaction.objectStore(this.storeName).delete(hash);
    await transactionComplete(transaction);
  }

  dispose(): void {
    void this.databasePromise?.then((database) => database.close());
    this.databasePromise = null;
  }

  private database(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new Error('IndexedDB no está disponible para el cache vehicular.'));
    }
    this.databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = (): void => {
        const database = request.result;
        if (!database.objectStoreNames.contains(this.storeName)) {
          database.createObjectStore(this.storeName);
        }
      };
      request.onsuccess = (): void => resolve(request.result);
      request.onerror = (): void =>
        reject(request.error ?? new Error('No se pudo abrir el cache vehicular.'));
    });
    return this.databasePromise;
  }
}

export function createDefaultVehicleNavigationCache(): VehicleNavigationCache {
  return typeof indexedDB === 'undefined'
    ? new MemoryVehicleNavigationCache()
    : new IndexedDbVehicleNavigationCache();
}

export async function loadOrBakeVehicleNavigation(
  input: VehicleNavigationBakeInput,
  cache: VehicleNavigationCache,
  bake: (
    source: VehicleNavigationBakeInput,
    expectedHash?: string,
  ) => VehicleNavigationBake | Promise<VehicleNavigationBake>,
): Promise<{ navigation: VehicleNavigationBake; cacheHit: boolean }> {
  const hash = vehicleNavigationHash(input);
  let cached: VehicleNavigationBake | null = null;
  try {
    cached = await cache.read(hash);
  } catch {
    cached = null;
  }
  if (cached?.schemaVersion === 2 && cached.hash === hash) {
    return { navigation: cached, cacheHit: true };
  }
  const navigation = await bake(input, hash);
  if (navigation.schemaVersion !== 2 || navigation.hash !== hash) {
    throw new Error('El bake vehicular devolvió una versión o hash inesperado.');
  }
  try {
    await cache.write(navigation);
  } catch {
    // El cache es una optimización: una cuota agotada no debe impedir cargar el nivel.
  }
  return { navigation, cacheHit: false };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = (): void => resolve(request.result);
    request.onerror = (): void =>
      reject(request.error ?? new Error('Falló una lectura del cache vehicular.'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = (): void => resolve();
    transaction.onerror = (): void =>
      reject(transaction.error ?? new Error('Falló una escritura del cache vehicular.'));
    transaction.onabort = (): void =>
      reject(transaction.error ?? new Error('Se abortó una escritura del cache vehicular.'));
  });
}

function isVehicleNavigationBake(
  value: unknown,
  expectedHash: string,
): value is VehicleNavigationBake {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as {
    schemaVersion?: unknown;
    hash?: unknown;
    grids?: unknown;
    laneGraph?: unknown;
    markers?: unknown;
  };
  return (
    candidate.schemaVersion === 2 &&
    candidate.hash === expectedHash &&
    Array.isArray(candidate.grids) &&
    typeof candidate.laneGraph === 'object' &&
    candidate.laneGraph !== null &&
    Array.isArray(candidate.markers)
  );
}
