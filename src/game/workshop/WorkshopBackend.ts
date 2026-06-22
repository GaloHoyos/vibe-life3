import type {
  PublishMeta,
  WorkshopListing,
  WorkshopQuery,
  WorkshopUser,
} from "./WorkshopTypes";

export interface WorkshopCapabilities {
  /** El backend acepta subidas (hay API de escritura disponible). */
  publish: boolean;
  /** El backend soporta inicio de sesion. */
  auth: boolean;
}

/**
 * Puerta de salida del Workshop hacia un backend remoto. Todo el cliente
 * depende solo de esta interfaz: cambiar de proveedor es cambiar la
 * implementacion registrada, sin tocar UI ni gameplay.
 *
 * `fetchDocument` devuelve `unknown` a proposito: el documento viene de una
 * fuente no confiable y debe pasar por `sanitizeDocument` antes de usarse.
 */
export interface WorkshopBackend {
  readonly id: string;
  readonly capabilities: WorkshopCapabilities;
  list(query?: WorkshopQuery): Promise<WorkshopListing[]>;
  fetchDocument(id: string, revision?: string): Promise<unknown>;
  publish(document: unknown, meta: PublishMeta): Promise<WorkshopListing>;
  signIn(): Promise<WorkshopUser>;
  signOut(): void;
  currentUser(): WorkshopUser | null;
}
