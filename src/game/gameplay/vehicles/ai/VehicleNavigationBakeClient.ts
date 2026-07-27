import type {
  VehicleNavigationBake,
  VehicleNavigationBakeInput,
} from './VehicleAiTypes';
import { bakeVehicleNavigation } from './VehicleNavigationBake';
import { vehicleNavigationHash } from './VehicleNavigationHash';

interface VehicleNavigationBakeWorkerResponse {
  id: number;
  navigation?: VehicleNavigationBake;
  error?: string;
}

export interface VehicleNavigationBakeClientOptions {
  timeoutMs?: number;
  forceInline?: boolean;
}

export async function bakeVehicleNavigationAsync(
  input: VehicleNavigationBakeInput,
  options: VehicleNavigationBakeClientOptions = {},
): Promise<VehicleNavigationBake> {
  const hash = vehicleNavigationHash(input);
  if (options.forceInline || typeof Worker === 'undefined') {
    return bakeVehicleNavigation(input, hash);
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./VehicleNavigationBakeWorker.ts', import.meta.url),
      { type: 'module' },
    );
    const id = 1;
    const timeout = globalThis.setTimeout(() => {
      worker.terminate();
      reject(new Error('El bake de navegación vehicular agotó el tiempo de espera.'));
    }, Math.max(1_000, options.timeoutMs ?? 60_000));
    worker.onmessage = (event: MessageEvent<VehicleNavigationBakeWorkerResponse>): void => {
      if (event.data.id !== id) return;
      globalThis.clearTimeout(timeout);
      worker.terminate();
      if (!event.data.navigation) {
        reject(new Error(event.data.error ?? 'El Worker vehicular no devolvió navegación.'));
        return;
      }
      resolve(event.data.navigation);
    };
    worker.onerror = (event): void => {
      globalThis.clearTimeout(timeout);
      worker.terminate();
      reject(new Error(event.message || 'Falló el Worker de navegación vehicular.'));
    };
    worker.postMessage({ id, input, expectedHash: hash });
  });
}
