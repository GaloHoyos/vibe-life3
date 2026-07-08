import { beforeEach, describe, expect, it } from "vitest";
import {
  getEditorMode,
  isEditorDocument,
  loadDraft,
  saveDraft,
  setEditorMode,
} from "@game/editor/persistence";
import { testEditorDocument } from "@tests/support/fixtures";
import { installMemoryStorage } from "@tests/support/fakes";

describe("editor persistence", () => {
  beforeEach(() => {
    installMemoryStorage("localStorage");
    installMemoryStorage("sessionStorage");
  });

  it("validates editor document shape conservatively", () => {
    expect(isEditorDocument(testEditorDocument())).toBe(true);
    expect(isEditorDocument(null)).toBe(false);
    expect(isEditorDocument({ meta: {}, entities: [] })).toBe(false);
    expect(isEditorDocument({ meta: { playerStart: [0, 1, 2] }, entities: "nope" })).toBe(false);
  });

  it("saves and loads valid drafts, ignoring invalid stored data", () => {
    const doc = testEditorDocument();

    saveDraft(doc);

    expect(loadDraft()).toEqual(doc);

    localStorage.setItem("vibe.editor.draft", "{bad json");
    expect(loadDraft()).toBeNull();

    localStorage.setItem("vibe.editor.draft", JSON.stringify({ meta: {}, entities: [] }));
    expect(loadDraft()).toBeNull();
  });

  it("round-trips editor boot mode in session storage", () => {
    expect(getEditorMode()).toBeNull();

    setEditorMode("playtest");
    expect(getEditorMode()).toBe("playtest");

    setEditorMode("edit");
    expect(getEditorMode()).toBe("edit");

    sessionStorage.setItem("vibe.editor.mode", "other");
    expect(getEditorMode()).toBeNull();

    setEditorMode(null);
    expect(sessionStorage.getItem("vibe.editor.mode")).toBeNull();
  });
});
