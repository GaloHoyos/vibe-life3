import type { JsonValue } from "./JsonValue";
import type { SaveEnvelopeV1 } from "./SaveTypes";

/**
 * Frontera mínima de persistencia. `SaveRepository` conserva aquí toda la
 * política de slots, migración y hashes; el adapter sólo brinda transacciones.
 */
export interface SaveStorageAdapter {
  getSave(id: string): Promise<unknown | null>;
  listSaves(): Promise<readonly unknown[]>;
  commitSaves(save: SaveEnvelopeV1, deleteIds: readonly string[]): Promise<void>;
  deleteSave(id: string): Promise<void>;

  getDocument(hash: string): Promise<unknown | null>;
  putDocument(hash: string, document: JsonValue): Promise<void>;
  deleteDocument(hash: string): Promise<void>;
}
