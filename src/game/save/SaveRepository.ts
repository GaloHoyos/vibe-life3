import {
  assertJsonValue,
  canonicalJson,
  cloneJsonValue,
  type JsonValue,
} from "./JsonValue";
import {
  migrateSaveEnvelope,
  tryMigrateSaveEnvelope,
} from "./SaveMigrations";
import type { SaveStorageAdapter } from "./SaveStorageAdapter";
import {
  SAVE_FORMAT,
  SAVE_SCHEMA_VERSION,
  type SaveDraftV1,
  type SaveEnvelopeV1,
  type SaveSlot,
  type SaveSlotKind,
} from "./SaveTypes";

export const MAX_AUTOSAVES = 3 as const;
export const MAX_MANUAL_SAVES = 20 as const;

export type SaveRepositoryErrorCode =
  | "corrupt-save"
  | "document-hash-mismatch"
  | "document-not-found"
  | "invalid-overwrite"
  | "save-not-found";

export class SaveRepositoryError extends Error {
  constructor(
    readonly code: SaveRepositoryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SaveRepositoryError";
  }
}

export interface SaveRepositoryOptions {
  clock?: () => number;
  idFactory?: () => string;
  documentHasher?: (document: JsonValue) => Promise<string>;
}

export interface SaveWriteOptions {
  overwriteId?: string;
}

export class SaveRepository {
  private readonly clock: () => number;
  private readonly idFactory: () => string;
  private readonly documentHasher: (document: JsonValue) => Promise<string>;
  private mutationTail: Promise<void> = Promise.resolve();
  private fallbackId = 0;

  constructor(
    private readonly storage: SaveStorageAdapter,
    options: SaveRepositoryOptions = {},
  ) {
    this.clock = options.clock ?? Date.now;
    this.idFactory = options.idFactory ?? (() => this.createFallbackId());
    this.documentHasher = options.documentHasher ?? hashSaveDocument;
  }

  async get(id: string): Promise<SaveEnvelopeV1 | null> {
    const stored = await this.storage.getSave(id);
    if (stored === null) return null;
    try {
      return migrateSaveEnvelope(stored);
    } catch (error) {
      throw new SaveRepositoryError(
        "corrupt-save",
        `El guardado ${id} está dañado o es incompatible`,
        { cause: error },
      );
    }
  }

  async require(id: string): Promise<SaveEnvelopeV1> {
    const save = await this.get(id);
    if (!save) {
      throw new SaveRepositoryError("save-not-found", `No existe el guardado ${id}`);
    }
    return save;
  }

  async list(kind?: SaveSlotKind): Promise<SaveEnvelopeV1[]> {
    const stored = await this.storage.listSaves();
    return stored
      .map((entry) => tryMigrateSaveEnvelope(entry))
      .filter((entry): entry is SaveEnvelopeV1 => {
        return entry !== null && (kind === undefined || entry.slot.kind === kind);
      })
      .sort(compareMostRecent);
  }

  async mostRecent(): Promise<SaveEnvelopeV1 | null> {
    return (await this.list())[0] ?? null;
  }

  save(
    kind: SaveSlotKind,
    draft: SaveDraftV1,
    options: SaveWriteOptions = {},
  ): Promise<SaveEnvelopeV1> {
    return this.exclusive(async () => {
      const saves = await this.list();
      const now = this.clock();
      const { id, slot, createdAt } = this.resolveTarget(
        kind,
        saves,
        now,
        options.overwriteId,
      );
      const envelope = migrateSaveEnvelope({
        format: SAVE_FORMAT,
        schemaVersion: SAVE_SCHEMA_VERSION,
        id,
        slot,
        createdAt,
        updatedAt: now,
        gameBuild: draft.gameBuild,
        source: draft.source,
        metadata: draft.metadata,
        world: draft.world,
      });

      const deleteIds =
        kind === "manual" ? manualOverflowIds(saves, envelope) : [];
      await this.storage.commitSaves(envelope, deleteIds);
      return migrateSaveEnvelope(envelope);
    });
  }

  delete(id: string): Promise<void> {
    return this.exclusive(() => this.storage.deleteSave(id));
  }

  async storeDocument(
    document: unknown,
    expectedHash?: string,
  ): Promise<string> {
    assertJsonValue(document);
    const clone = cloneJsonValue(document);
    const hash = await this.documentHasher(clone);
    requireSha256Hash(hash);
    if (expectedHash !== undefined) {
      requireSha256Hash(expectedHash);
      if (hash !== expectedHash) {
        throw new SaveRepositoryError(
          "document-hash-mismatch",
          `El documento provisto no coincide con ${expectedHash}`,
        );
      }
    }
    await this.storage.putDocument(hash, clone);
    return hash;
  }

  async getDocument(hash: string): Promise<JsonValue | null> {
    requireSha256Hash(hash);
    const stored = await this.storage.getDocument(hash);
    if (stored === null) return null;
    try {
      assertJsonValue(stored);
    } catch (error) {
      throw new SaveRepositoryError(
        "document-hash-mismatch",
        `El documento ${hash} está dañado`,
        { cause: error },
      );
    }
    const clone = cloneJsonValue(stored);
    const actualHash = await this.documentHasher(clone);
    if (actualHash !== hash) {
      throw new SaveRepositoryError(
        "document-hash-mismatch",
        `El contenido del documento ${hash} no coincide con su hash`,
      );
    }
    return clone;
  }

  async requireDocument(hash: string): Promise<JsonValue> {
    const document = await this.getDocument(hash);
    if (!document) {
      throw new SaveRepositoryError(
        "document-not-found",
        `No existe el documento local ${hash}`,
      );
    }
    return document;
  }

  deleteDocument(hash: string): Promise<void> {
    requireSha256Hash(hash);
    return this.storage.deleteDocument(hash);
  }

  private resolveTarget(
    kind: SaveSlotKind,
    saves: readonly SaveEnvelopeV1[],
    now: number,
    overwriteId: string | undefined,
  ): { id: string; slot: SaveSlot; createdAt: number } {
    switch (kind) {
      case "quick":
        if (overwriteId !== undefined) {
          throw invalidOverwrite("Un quicksave no acepta overwriteId");
        }
        return {
          id: "quick:0",
          slot: { kind: "quick", index: 0 },
          createdAt: now,
        };
      case "auto": {
        if (overwriteId !== undefined) {
          throw invalidOverwrite("Un autosave no acepta overwriteId");
        }
        const autosaves = saves.filter((save) => save.slot.kind === "auto");
        const used = new Set(
          autosaves.map((save) => {
            return save.slot.kind === "auto" ? save.slot.index : 0;
          }),
        );
        let index: 0 | 1 | 2;
        if (!used.has(0)) index = 0;
        else if (!used.has(1)) index = 1;
        else if (!used.has(2)) index = 2;
        else {
          const oldest = [...autosaves].sort(compareOldest)[0];
          if (!oldest || oldest.slot.kind !== "auto") {
            throw new Error("No se pudo seleccionar el slot de autosave");
          }
          index = oldest.slot.index;
        }
        return {
          id: `auto:${index}`,
          slot: { kind: "auto", index },
          createdAt: now,
        };
      }
      case "manual": {
        if (overwriteId !== undefined) {
          const existing = saves.find((save) => save.id === overwriteId);
          if (!existing || existing.slot.kind !== "manual") {
            throw invalidOverwrite(
              `No existe un guardado manual para sobrescribir: ${overwriteId}`,
            );
          }
          return {
            id: existing.id,
            slot: { kind: "manual" },
            createdAt: existing.createdAt,
          };
        }
        return {
          id: this.uniqueManualId(saves),
          slot: { kind: "manual" },
          createdAt: now,
        };
      }
    }
  }

  private uniqueManualId(saves: readonly SaveEnvelopeV1[]): string {
    const occupied = new Set(saves.map((save) => save.id));
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const suffix = this.idFactory().trim();
      if (suffix.length === 0) continue;
      const id = `manual:${suffix}`;
      if (!occupied.has(id)) return id;
    }
    throw new Error("No se pudo generar un identificador único de guardado");
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private createFallbackId(): string {
    const randomId = globalThis.crypto?.randomUUID?.();
    if (randomId) return randomId;
    this.fallbackId += 1;
    return `${this.clock().toString(36)}-${this.fallbackId.toString(36)}`;
  }
}

export async function hashSaveDocument(document: JsonValue): Promise<string> {
  const canonical = canonicalJson(document);
  const subtle = globalThis.crypto?.subtle;
  // `crypto.subtle` sólo existe en contextos seguros: sin este fallback, jugar
  // por http en la LAN rompería el guardado de cualquier mapa custom. El
  // prefijo distinto evita confundir los dos espacios de hash.
  if (!subtle) {
    return `fnv1a64:${fnv1a64(canonical)}`;
  }
  const bytes = new TextEncoder().encode(canonical);
  const digest = await subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

function manualOverflowIds(
  saves: readonly SaveEnvelopeV1[],
  incoming: SaveEnvelopeV1,
): string[] {
  const manuals = saves
    .filter((save) => save.slot.kind === "manual" && save.id !== incoming.id)
    .concat(incoming)
    .sort(compareMostRecent);
  return manuals.slice(MAX_MANUAL_SAVES).map((save) => save.id);
}

function compareMostRecent(a: SaveEnvelopeV1, b: SaveEnvelopeV1): number {
  return (
    b.updatedAt - a.updatedAt ||
    b.createdAt - a.createdAt ||
    a.id.localeCompare(b.id)
  );
}

function compareOldest(a: SaveEnvelopeV1, b: SaveEnvelopeV1): number {
  return (
    a.updatedAt - b.updatedAt ||
    a.createdAt - b.createdAt ||
    a.id.localeCompare(b.id)
  );
}

function requireSha256Hash(hash: string): void {
  if (!/^sha256:[a-f0-9]{64}$/.test(hash)) {
    throw new SaveRepositoryError(
      "document-hash-mismatch",
      `Hash de documento inválido: ${hash}`,
    );
  }
}

function invalidOverwrite(message: string): SaveRepositoryError {
  return new SaveRepositoryError("invalid-overwrite", message);
}
