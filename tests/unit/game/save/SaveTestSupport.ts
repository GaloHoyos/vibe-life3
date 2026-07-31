import type { JsonValue } from "@game/save/JsonValue";
import type { SaveStorageAdapter } from "@game/save/SaveStorageAdapter";
import {
  SAVE_FORMAT,
  SAVE_SCHEMA_VERSION,
  type SaveDraftV1,
  type SaveEnvelopeV1,
} from "@game/save/SaveTypes";

export class MemorySaveStorage implements SaveStorageAdapter {
  private saves = new Map<string, unknown>();
  private documents = new Map<string, unknown>();

  async getSave(id: string): Promise<unknown | null> {
    const value = this.saves.get(id);
    return value === undefined ? null : structuredClone(value);
  }

  async listSaves(): Promise<readonly unknown[]> {
    return [...this.saves.values()].map((value) => structuredClone(value));
  }

  async commitSaves(
    save: SaveEnvelopeV1,
    deleteIds: readonly string[],
  ): Promise<void> {
    const next = new Map(this.saves);
    for (const id of deleteIds) next.delete(id);
    next.set(save.id, structuredClone(save));
    this.saves = next;
  }

  async deleteSave(id: string): Promise<void> {
    this.saves.delete(id);
  }

  async getDocument(hash: string): Promise<unknown | null> {
    const value = this.documents.get(hash);
    return value === undefined ? null : structuredClone(value);
  }

  async putDocument(hash: string, document: JsonValue): Promise<void> {
    this.documents.set(hash, structuredClone(document));
  }

  async deleteDocument(hash: string): Promise<void> {
    this.documents.delete(hash);
  }

  setRawSave(id: string, value: unknown): void {
    this.saves.set(id, structuredClone(value));
  }

  setRawDocument(hash: string, value: unknown): void {
    this.documents.set(hash, structuredClone(value));
  }

  saveCount(): number {
    return this.saves.size;
  }
}

export function saveDraft(label: string, levelId = "demo-01"): SaveDraftV1 {
  return {
    gameBuild: "test-build",
    source: { kind: "built-in", levelId },
    metadata: {
      title: label,
      levelTitle: "Nivel de prueba",
      playTimeSeconds: 12,
      difficulty: "normal",
    },
    world: {
      levelId,
      simulationTimeSeconds: 10,
      globals: { label },
      systems: {},
      entities: {},
      extensions: {},
    },
  };
}

export function rawSaveEnvelope(
  id = "manual:test",
  label = "Prueba",
): SaveEnvelopeV1 {
  const draft = saveDraft(label);
  return {
    format: SAVE_FORMAT,
    schemaVersion: SAVE_SCHEMA_VERSION,
    id,
    slot: { kind: "manual" },
    createdAt: 100,
    updatedAt: 100,
    ...draft,
  };
}
