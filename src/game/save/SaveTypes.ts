import type { JsonObject } from "./JsonValue";

export const SAVE_FORMAT = "vibe-life-save" as const;
export const SAVE_SCHEMA_VERSION = 1 as const;
export const SAVE_THUMBNAIL_WIDTH = 320 as const;
export const SAVE_THUMBNAIL_HEIGHT = 180 as const;

export type SaveSlotKind = "quick" | "auto" | "manual";

export type SaveSlot =
  | { kind: "quick"; index: 0 }
  | { kind: "auto"; index: 0 | 1 | 2 }
  | { kind: "manual" };

export type LevelSourceRef =
  | {
      kind: "built-in";
      levelId: string;
    }
  | {
      kind: "library";
      levelId: string;
      mapId: string;
      documentHash: string;
    }
  | {
      kind: "workshop";
      levelId: string;
      workshopId: string;
      revision: number;
      documentHash: string;
    };

export interface SaveThumbnail {
  mimeType: "image/jpeg" | "image/webp";
  dataUrl: string;
  width: typeof SAVE_THUMBNAIL_WIDTH;
  height: typeof SAVE_THUMBNAIL_HEIGHT;
}

export interface SaveMetadata {
  title: string;
  levelTitle: string;
  playTimeSeconds: number;
  difficulty: string;
  thumbnail?: SaveThumbnail;
}

export interface SavedEntityState {
  entityType: string;
  version: number;
  required: boolean;
  data: JsonObject;
}

/**
 * Snapshot neutral del mundo. Las claves de `globals`, `systems` y
 * `extensions` permiten sumar dominios sin cambiar el envelope. Los objetos
 * con identidad propia se versionan individualmente en `entities`.
 */
export interface WorldSaveState {
  levelId: string;
  simulationTimeSeconds: number;
  globals: JsonObject;
  systems: JsonObject;
  entities: Record<string, SavedEntityState>;
  extensions: JsonObject;
}

export interface SaveEnvelopeV1 {
  format: typeof SAVE_FORMAT;
  schemaVersion: typeof SAVE_SCHEMA_VERSION;
  id: string;
  slot: SaveSlot;
  createdAt: number;
  updatedAt: number;
  gameBuild: string;
  source: LevelSourceRef;
  metadata: SaveMetadata;
  world: WorldSaveState;
}

export interface SaveDraftV1 {
  gameBuild: string;
  source: LevelSourceRef;
  metadata: SaveMetadata;
  world: WorldSaveState;
}
