import {
  assertJsonValue,
  cloneJsonValue,
  isJsonObject,
  type JsonObject,
  type JsonValue,
} from "./JsonValue";
import {
  SAVE_FORMAT,
  SAVE_SCHEMA_VERSION,
  SAVE_THUMBNAIL_HEIGHT,
  SAVE_THUMBNAIL_WIDTH,
  type LevelSourceRef,
  type SaveEnvelopeV1,
  type SaveMetadata,
  type SaveSlot,
  type SavedEntityState,
  type SaveThumbnail,
  type WorldSaveState,
} from "./SaveTypes";

export type SaveMigrationErrorCode =
  | "invalid-json"
  | "invalid-format"
  | "invalid-version"
  | "future-version"
  | "invalid-save";

export class SaveMigrationError extends Error {
  constructor(
    readonly code: SaveMigrationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SaveMigrationError";
  }
}

/**
 * Punto único de entrada para saves persistidos. Es intencionalmente puro:
 * valida, migra y clona sin mutar el valor recibido.
 */
export function migrateSaveEnvelope(input: unknown): SaveEnvelopeV1 {
  let json: JsonValue;
  try {
    assertJsonValue(input);
    json = input;
  } catch (error) {
    throw new SaveMigrationError(
      "invalid-json",
      error instanceof Error ? error.message : "El guardado no es JSON válido",
    );
  }
  if (!isJsonObject(json)) {
    throw new SaveMigrationError("invalid-save", "El guardado debe ser un objeto");
  }
  if (json.format !== SAVE_FORMAT) {
    throw new SaveMigrationError("invalid-format", "Formato de guardado desconocido");
  }
  if (!Number.isInteger(json.schemaVersion)) {
    throw new SaveMigrationError("invalid-version", "Versión de guardado inválida");
  }
  if (typeof json.schemaVersion === "number" && json.schemaVersion > SAVE_SCHEMA_VERSION) {
    throw new SaveMigrationError(
      "future-version",
      `El guardado requiere la versión ${json.schemaVersion}`,
    );
  }

  switch (json.schemaVersion) {
    case SAVE_SCHEMA_VERSION:
      return readV1(json);
    default:
      throw new SaveMigrationError(
        "invalid-version",
        `No existe una migración desde la versión ${String(json.schemaVersion)}`,
      );
  }
}

export function tryMigrateSaveEnvelope(input: unknown): SaveEnvelopeV1 | null {
  try {
    return migrateSaveEnvelope(input);
  } catch {
    return null;
  }
}

export function parseSaveEnvelope(raw: string): SaveEnvelopeV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new SaveMigrationError("invalid-json", "El guardado contiene JSON inválido");
  }
  return migrateSaveEnvelope(parsed);
}

/**
 * Puente puro para el checkpoint player-only anterior al sistema durable.
 * La integración puede registrar `player` con entityType `player` y restaurar
 * estos mismos campos sin acoplar el módulo de persistencia a gameplay.
 */
export function migrateLegacyCheckpointWorld(
  levelId: string,
  snapshot: unknown,
): WorldSaveState {
  requireNonEmptyString(levelId, "levelId");
  try {
    assertJsonValue(snapshot);
  } catch (error) {
    throw new SaveMigrationError(
      "invalid-json",
      error instanceof Error ? error.message : "Checkpoint inválido",
    );
  }
  if (!isJsonObject(snapshot)) {
    throw new SaveMigrationError("invalid-save", "El checkpoint debe ser un objeto");
  }
  const position = snapshot.position;
  if (
    !Array.isArray(position) ||
    position.length !== 3 ||
    !position.every(isFiniteNumber)
  ) {
    throw new SaveMigrationError("invalid-save", "Posición de checkpoint inválida");
  }
  requireFiniteNumber(snapshot.health, "health");
  requireFiniteNumber(snapshot.armor, "armor");
  if (!Array.isArray(snapshot.weapons)) {
    throw new SaveMigrationError("invalid-save", "Armas de checkpoint inválidas");
  }
  if (
    snapshot.activeWeaponId !== null &&
    typeof snapshot.activeWeaponId !== "string"
  ) {
    throw new SaveMigrationError("invalid-save", "Arma activa de checkpoint inválida");
  }
  if (snapshot.yaw !== undefined && !isFiniteNumber(snapshot.yaw)) {
    throw new SaveMigrationError("invalid-save", "Orientación de checkpoint inválida");
  }

  return {
    levelId,
    simulationTimeSeconds: 0,
    globals: {},
    systems: {
      legacyCheckpoint: {
        sourceVersion: 0,
      },
    },
    entities: {
      player: {
        entityType: "player",
        version: 1,
        required: true,
        data: cloneJsonValue(snapshot),
      },
    },
    extensions: {},
  };
}

function readV1(value: JsonObject): SaveEnvelopeV1 {
  const id = requireNonEmptyString(value.id, "id");
  const slot = readSlot(value.slot);
  const createdAt = requireTimestamp(value.createdAt, "createdAt");
  const updatedAt = requireTimestamp(value.updatedAt, "updatedAt");
  if (updatedAt < createdAt) {
    throw invalid("updatedAt no puede ser anterior a createdAt");
  }
  const source = readLevelSource(value.source);
  const metadata = readMetadata(value.metadata);
  const world = readWorld(value.world);
  if (world.levelId !== source.levelId) {
    throw invalid("El nivel del snapshot no coincide con su fuente");
  }

  return {
    format: SAVE_FORMAT,
    schemaVersion: SAVE_SCHEMA_VERSION,
    id,
    slot,
    createdAt,
    updatedAt,
    gameBuild: requireNonEmptyString(value.gameBuild, "gameBuild"),
    source,
    metadata,
    world,
  };
}

function readSlot(value: JsonValue | undefined): SaveSlot {
  const object = requireObject(value, "slot");
  switch (object.kind) {
    case "quick":
      if (object.index !== 0) throw invalid("Índice de quicksave inválido");
      return { kind: "quick", index: 0 };
    case "auto":
      if (object.index !== 0 && object.index !== 1 && object.index !== 2) {
        throw invalid("Índice de autosave inválido");
      }
      return { kind: "auto", index: object.index };
    case "manual":
      return { kind: "manual" };
    default:
      throw invalid("Tipo de slot inválido");
  }
}

function readLevelSource(value: JsonValue | undefined): LevelSourceRef {
  const object = requireObject(value, "source");
  const levelId = requireNonEmptyString(object.levelId, "source.levelId");
  switch (object.kind) {
    case "built-in":
      return { kind: "built-in", levelId };
    case "library":
      return {
        kind: "library",
        levelId,
        mapId: requireNonEmptyString(object.mapId, "source.mapId"),
        documentHash: requireDocumentHash(object.documentHash),
      };
    case "workshop":
      return {
        kind: "workshop",
        levelId,
        workshopId: requireNonEmptyString(object.workshopId, "source.workshopId"),
        revision: requireNonNegativeInteger(object.revision, "source.revision"),
        documentHash: requireDocumentHash(object.documentHash),
      };
    default:
      throw invalid("Fuente de nivel inválida");
  }
}

function readMetadata(value: JsonValue | undefined): SaveMetadata {
  const object = requireObject(value, "metadata");
  const metadata: SaveMetadata = {
    title: requireNonEmptyString(object.title, "metadata.title"),
    levelTitle: requireNonEmptyString(object.levelTitle, "metadata.levelTitle"),
    playTimeSeconds: requireNonNegativeNumber(
      object.playTimeSeconds,
      "metadata.playTimeSeconds",
    ),
    difficulty: requireNonEmptyString(object.difficulty, "metadata.difficulty"),
  };
  if (object.thumbnail !== undefined) {
    metadata.thumbnail = readThumbnail(object.thumbnail);
  }
  return metadata;
}

function readThumbnail(value: JsonValue): SaveThumbnail {
  const object = requireObject(value, "metadata.thumbnail");
  if (object.mimeType !== "image/jpeg" && object.mimeType !== "image/webp") {
    throw invalid("Formato de miniatura inválido");
  }
  if (object.width !== SAVE_THUMBNAIL_WIDTH || object.height !== SAVE_THUMBNAIL_HEIGHT) {
    throw invalid(
      `La miniatura debe medir ${SAVE_THUMBNAIL_WIDTH}x${SAVE_THUMBNAIL_HEIGHT}`,
    );
  }
  const dataUrl = requireNonEmptyString(object.dataUrl, "metadata.thumbnail.dataUrl");
  if (!dataUrl.startsWith(`data:${object.mimeType};base64,`)) {
    throw invalid("Data URL de miniatura inválida");
  }
  return {
    mimeType: object.mimeType,
    dataUrl,
    width: SAVE_THUMBNAIL_WIDTH,
    height: SAVE_THUMBNAIL_HEIGHT,
  };
}

function readWorld(value: JsonValue | undefined): WorldSaveState {
  const object = requireObject(value, "world");
  const entitiesObject = requireObject(object.entities, "world.entities");
  const entities: Record<string, SavedEntityState> = Object.create(null) as Record<
    string,
    SavedEntityState
  >;
  for (const [id, entityValue] of Object.entries(entitiesObject)) {
    requireNonEmptyString(id, "world.entities key");
    entities[id] = readEntityState(entityValue, id);
  }
  return {
    levelId: requireNonEmptyString(object.levelId, "world.levelId"),
    simulationTimeSeconds: requireNonNegativeNumber(
      object.simulationTimeSeconds,
      "world.simulationTimeSeconds",
    ),
    globals: cloneJsonValue(requireObject(object.globals, "world.globals")),
    systems: cloneJsonValue(requireObject(object.systems, "world.systems")),
    entities,
    extensions: cloneJsonValue(requireObject(object.extensions, "world.extensions")),
  };
}

function readEntityState(value: JsonValue, id: string): SavedEntityState {
  const object = requireObject(value, `world.entities.${id}`);
  if (typeof object.required !== "boolean") {
    throw invalid(`world.entities.${id}.required debe ser boolean`);
  }
  return {
    entityType: requireNonEmptyString(
      object.entityType,
      `world.entities.${id}.entityType`,
    ),
    version: requireNonNegativeInteger(
      object.version,
      `world.entities.${id}.version`,
    ),
    required: object.required,
    data: cloneJsonValue(requireObject(object.data, `world.entities.${id}.data`)),
  };
}

function requireObject(
  value: JsonValue | undefined,
  field: string,
): JsonObject {
  if (!isJsonObject(value)) {
    throw invalid(`${field} debe ser un objeto`);
  }
  return value;
}

function requireNonEmptyString(
  value: JsonValue | undefined,
  field: string,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalid(`${field} debe ser un texto no vacío`);
  }
  return value;
}

function requireTimestamp(value: JsonValue | undefined, field: string): number {
  return requireNonNegativeInteger(value, field);
}

function requireNonNegativeInteger(
  value: JsonValue | undefined,
  field: string,
): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 0) {
    throw invalid(`${field} debe ser un entero no negativo`);
  }
  return value;
}

function requireFiniteNumber(value: JsonValue | undefined, field: string): number {
  if (!isFiniteNumber(value)) {
    throw invalid(`${field} debe ser un número finito`);
  }
  return value;
}

function requireNonNegativeNumber(
  value: JsonValue | undefined,
  field: string,
): number {
  const result = requireFiniteNumber(value, field);
  if (result < 0) {
    throw invalid(`${field} debe ser no negativo`);
  }
  return result;
}

function requireDocumentHash(value: JsonValue | undefined): string {
  const hash = requireNonEmptyString(value, "documentHash");
  if (!/^sha256:[a-f0-9]{64}$/.test(hash)) {
    throw invalid("Hash de documento inválido");
  }
  return hash;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function invalid(message: string): SaveMigrationError {
  return new SaveMigrationError("invalid-save", message);
}
