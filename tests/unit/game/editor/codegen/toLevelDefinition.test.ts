import { describe, expect, it } from "vitest";
import type { EditorEntity } from "@game/editor/EditorDocument";
import type { StaticBoxDefinition } from "@game/levels/LevelDefinition";
import { testEditorDocument } from "@tests/support/fixtures";
import { toLevelDefinition } from "@game/editor/codegen/toLevelDefinition";

describe("toLevelDefinition", () => {
  it("preserva entidades y rotaciones del documento", () => {
    const entities: EditorEntity[] = [
      {
        eid: "box-eid",
        kind: "staticBox",
        def: {
          id: "box",
          position: [1, 2, 3],
          size: [4, 5, 6],
          rotation: [0, 0.25, 0],
          material: "wall",
        },
      },
      {
        eid: "npc-eid",
        kind: "npc",
        def: {
          id: "npc-1",
          characterId: "zombie",
          position: [2, 0.5, 1],
          rotation: [0, Math.PI, 0],
        },
      },
      {
        eid: "trigger-eid",
        kind: "trigger",
        def: {
          id: "trigger-1",
          position: [0, 0, 0],
          size: [4, 2, 1],
          rotation: [0, Math.PI / 2, 0],
          once: false,
          actions: [{ kind: "dialogue", text: "hola", duration: 1 }],
        },
      },
    ];

    const level = toLevelDefinition(testEditorDocument({ entities }));

    expect(level.staticBoxes[0]).toMatchObject({
      id: "box",
      rotation: [0, 0.25, 0],
    });
    expect(level.npcs[0]).toMatchObject({
      id: "npc-1",
      rotation: [0, Math.PI, 0],
    });
    expect(level.triggers[0]).toMatchObject({
      id: "trigger-1",
      rotation: [0, Math.PI / 2, 0],
    });
  });

  it("falla con ids duplicados", () => {
    const duplicate: StaticBoxDefinition = {
      id: "dupe",
      position: [0, 0, 0],
      size: [1, 1, 1],
      material: "wall",
    };

    expect(() => toLevelDefinition(testEditorDocument({
      entities: [
        { eid: "a", kind: "staticBox", def: duplicate },
        { eid: "b", kind: "staticBox", def: duplicate },
      ],
    }))).toThrow("ids duplicados: dupe");
  });
});
