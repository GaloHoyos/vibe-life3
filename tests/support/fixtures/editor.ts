import type { EditorDocument } from "@game/editor/EditorDocument";
import { testMapMeta } from "./levels";

export function testEditorDocument(overrides: Partial<EditorDocument> = {}): EditorDocument {
  return {
    meta: testMapMeta(),
    entities: [],
    ...overrides,
  };
}
