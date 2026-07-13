import { describe, expect, it } from "vitest";
import type { EditorEntity } from "@game/editor/EditorDocument";
import type { StaticBoxDefinition } from "@game/levels/LevelDefinition";
import { testEditorDocument } from "@tests/support/fixtures";
import { toLevelDefinition } from "@game/editor/codegen/toLevelDefinition";
import { fromLevelDefinition } from "@game/editor/codegen/fromLevelDefinition";

describe("toLevelDefinition", () => {
  it("preserva configuración Blob en el round-trip editor ↔ nivel", () => {
    const entities: EditorEntity[] = [
      {
        eid: "grate-eid",
        kind: "staticBox",
        def: { id: "grate", position: [0, 1, 0], size: [2, 2, 0.1], material: "wall", blobPermeable: true },
      },
      {
        eid: "food-eid",
        kind: "dynamicBox",
        def: {
          id: "food",
          position: [2, 1, 0],
          size: [1, 1, 1],
          mass: 2,
          material: "dynamic",
          blobConsumable: { consumeSeconds: 1.5, biomass: 6 },
        },
      },
      {
        eid: "blob-eid",
        kind: "npc",
        def: {
          id: "blob",
          characterId: "blob",
          position: [0, 1, 2],
          blobPoses: [{ id: "column-a", kind: "column", marker: "marker-a", height: 5 }],
        },
      },
      {
        eid: "marker-eid",
        kind: "logic",
        def: { kind: "marker", id: "marker-a", name: "marker-a", position: [0, 1, 4] },
        position: [0, 1, 4],
      },
    ];

    const roundTrip = fromLevelDefinition(toLevelDefinition(testEditorDocument({ entities })));

    expect(roundTrip.entities.find((entity) => entity.kind === "staticBox" && entity.def.id === "grate"))
      .toMatchObject({ def: { blobPermeable: true } });
    expect(roundTrip.entities.find((entity) => entity.kind === "dynamicBox" && entity.def.id === "food"))
      .toMatchObject({ def: { blobConsumable: { consumeSeconds: 1.5, biomass: 6 } } });
    expect(roundTrip.entities.find((entity) => entity.kind === "npc" && entity.def.id === "blob"))
      .toMatchObject({ def: { blobPoses: [{ id: "column-a", kind: "column", marker: "marker-a", height: 5 }] } });
  });

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
          connections: [{ output: "OnStartTouch", target: "msg-1", input: "Show" }],
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

  it("round-trip de logic + sequence: documento → nivel → documento", () => {
    const entities: EditorEntity[] = [
      {
        eid: "logic-eid",
        kind: "logic",
        position: [0, 1, 0],
        def: { kind: "counter", id: "kills", name: "kills", max: 3, connections: [{ output: "OnHitMax", target: "gate", input: "Open" }] },
      },
      {
        eid: "marker-eid",
        kind: "logic",
        position: [4, 1, -2],
        def: { kind: "marker", id: "exit", name: "exit", position: [4, 1, -2] },
      },
      {
        eid: "seq-eid",
        kind: "sequence",
        def: { id: "intro", name: "intro", targetNpc: "alyx", position: [0, 1, -1], moveMode: "walk", steps: [{ kind: "gesture", gesture: "point" }] },
      },
    ];

    const level = toLevelDefinition(testEditorDocument({ entities }));
    expect(level.logicEntities).toHaveLength(2);
    expect(level.sequences).toHaveLength(1);
    expect(level.sequences?.[0]).toMatchObject({ id: "intro", targetNpc: "alyx" });

    const roundTripped = fromLevelDefinition(level);
    expect(roundTripped.entities.filter((e) => e.kind === "logic")).toHaveLength(2);
    expect(roundTripped.entities.filter((e) => e.kind === "sequence")).toHaveLength(1);
    // El marker recupera su posición de escena desde la def.
    const marker = roundTripped.entities.find((e) => e.kind === "logic" && e.def.kind === "marker");
    expect(marker?.kind === "logic" ? marker.position : null).toEqual([4, 1, -2]);
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
