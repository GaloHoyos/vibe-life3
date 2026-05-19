import type { Time } from "./Time";

/**
 * Sistema actualizable por el game loop.
 *
 * Permite al Engine iterar una colección homogénea de subsistemas
 * sin conocer sus implementaciones concretas. El orden de actualización
 * lo decide el orquestador (Engine), no el sistema.
 */
export interface ISystem {
  update(time: Time): void;
}

/**
 * Sistema que necesita inicialización asíncrona antes del primer frame
 * (carga de assets, init de WASM, fetch de manifests, etc.).
 */
export interface IAsyncBootSystem {
  boot(): Promise<void>;
}

/**
 * Sistema que mantiene recursos nativos (event listeners, GPU buffers,
 * audio nodes) y debe liberarlos al detener el motor.
 */
export interface IDisposableSystem {
  dispose(): void;
}
