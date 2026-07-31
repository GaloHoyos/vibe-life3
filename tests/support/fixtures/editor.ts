import {
  CURRENT_EDITOR_SCHEMA_VERSION,
  type EditorDocument,
} from "@game/editor/EditorDocument";
import { testMapMeta } from "./levels";

export function testEditorDocument(overrides: Partial<EditorDocument> = {}): EditorDocument {
  return {
    schemaVersion: CURRENT_EDITOR_SCHEMA_VERSION,
    meta: testMapMeta(),
    entities: [],
    ...overrides,
  };
}
