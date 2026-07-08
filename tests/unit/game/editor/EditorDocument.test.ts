import { describe, expect, it } from "vitest";
import {
  blankDocument,
  cloneDocument,
  entityKindLabel,
  entityLevelId,
  newEid,
  type EditorEntity,
} from "@game/editor/EditorDocument";
import { testEditorDocument } from "@tests/support/fixtures";

describe("EditorDocument", () => {
  it("creates unique session entity ids with kind prefixes", () => {
    const first = newEid("staticBox");
    const second = newEid("staticBox");

    expect(first).toMatch(/^staticBox-/);
    expect(second).toMatch(/^staticBox-/);
    expect(first).not.toBe(second);
  });

  it("creates a blank document with editable defaults", () => {
    const doc = blankDocument();

    expect(doc.meta.id).toBe("nuevo-nivel");
    expect(doc.meta.playerStart).toEqual([0, 1.6, 6]);
    expect(doc.entities).toHaveLength(1);
    expect(doc.entities[0].kind).toBe("staticBox");
    expect(entityLevelId(doc.entities[0])).toBe("ground");
  });

  it("clones documents deeply", () => {
    const doc = testEditorDocument({
      entities: [staticBox("box-1")],
    });
    const clone = cloneDocument(doc);

    clone.meta.id = "changed";
    if (clone.entities[0].kind === "staticBox") {
      clone.entities[0].def.position[0] = 99;
    }

    expect(doc.meta.id).toBe("test-map");
    expect(doc.entities[0]).not.toBe(clone.entities[0]);
    expect(doc.entities[0].kind === "staticBox" && doc.entities[0].def.position[0]).toBe(1);
  });

  it("resolves level ids and labels across entity families", () => {
    expect(entityLevelId(staticBox("box-1"))).toBe("box-1");
    expect(
      entityLevelId({
        eid: "prop-eid",
        kind: "prop",
        prop: { prop: "crate", spec: { id: "crate-1", at: [1, 2, 3] } },
      } as EditorEntity),
    ).toBe("crate-1");
    expect(
      entityLevelId({
        eid: "building-eid",
        kind: "prebuiltBuilding",
        artifact: {
          id: "artifact-1",
          boxes: [],
          rooms: [],
          doorways: [],
          envelope: { min: [0, 0, 0], max: [1, 1, 1] },
        },
      } as EditorEntity),
    ).toBe("artifact-1");

    expect(entityKindLabel("npc")).toBe("NPC");
    expect(entityKindLabel("hazardVolume")).toBe("Kill-volume");
  });
});

function staticBox(id: string): EditorEntity {
  return {
    eid: `${id}-eid`,
    kind: "staticBox",
    def: {
      id,
      position: [1, 2, 3],
      size: [4, 5, 6],
      material: "concrete",
    },
  };
}
