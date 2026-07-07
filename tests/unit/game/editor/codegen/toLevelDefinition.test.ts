import { describe, expect, it } from "vitest";
import type { EditorEntity } from "@game/editor/EditorDocument";
import type { StaticBoxDefinition } from "@game/levels/LevelDefinition";
import { testEditorDocument } from "@tests/support/fixtures";
import { toLevelDefinition } from "@game/editor/codegen/toLevelDefinition";
import { fromLevelDefinition } from "@game/editor/codegen/fromLevelDefinition";

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
      {
        eid: "ammo-eid",
        kind: "ammoPickup",
        def: {
          id: "ammo-1",
          ammoId: "smg",
          position: [3, 0.5, 2],
          rotation: [0, 0.5, 0],
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
    expect(level.ammoPickups?.[0]).toMatchObject({
      id: "ammo-1",
      ammoId: "smg",
      rotation: [0, 0.5, 0],
    });
  });

  it("round-trip del playerModel: meta → nivel → meta", () => {
    const doc = testEditorDocument({});
    doc.meta.playerModel = "postHumanGordon";

    const level = toLevelDefinition(doc);
    expect(level.playerModel).toBe("postHumanGordon");

    const roundTripped = fromLevelDefinition(level);
    expect(roundTripped.meta.playerModel).toBe("postHumanGordon");

    // Omitido queda omitido (el default gordon lo resuelve el runtime).
    const plain = toLevelDefinition(testEditorDocument({}));
    expect(plain.playerModel).toBeUndefined();
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
