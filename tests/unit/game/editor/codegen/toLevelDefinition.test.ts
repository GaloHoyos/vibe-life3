import { describe, expect, it } from "vitest";
import type { EditorEntity } from "@game/editor/EditorDocument";
import type { StaticBoxDefinition } from "@game/levels/LevelDefinition";
import { testEditorDocument } from "@tests/support/fixtures";
import { toLevelDefinition } from "@game/editor/codegen/toLevelDefinition";
import { fromLevelDefinition } from "@game/editor/codegen/fromLevelDefinition";
import { toTypeScript } from "@game/editor/codegen/toTypeScript";

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

  it("round-trip de autoría vehicular y emisión TypeScript", () => {
    const entities: EditorEntity[] = [
      {
        eid: "wp-a-eid",
        kind: "vehicleWaypoint",
        def: { id: "wp-a", position: [0, 4, 0], next: "wp-b", speed: 16, connections: [] },
      },
      {
        eid: "wp-b-eid",
        kind: "vehicleWaypoint",
        def: { id: "wp-b", position: [0, 5, -12], wait: 0.5, connections: [] },
      },
      {
        eid: "heli-eid",
        kind: "vehicle",
        def: {
          id: "heli",
          presetId: "helicopter",
          position: [0, 4, 0],
          pathStart: "wp-a",
          crashPolicy: "survivable",
          accessPolicy: "resistance",
          allowPlayerExit: true,
          crew: [{ actor: "!player", role: "gunner", seatId: "door-gunner" }],
          weaponEnabled: true,
          portalTraversal: "blocked",
          connections: [{ output: "OnCrashed", target: "landing", input: "Enable" }],
        },
      },
      {
        eid: "water-eid",
        kind: "waterVolume",
        def: { id: "canal", position: [10, -1, 0], size: [12, 2, 30], surface: "canal" },
      },
      {
        eid: "area-eid",
        kind: "vehicleNavArea",
        def: {
          id: "drive-area",
          polygon: [[-8, 0, -8], [8, 0, -8], [8, 0, 8], [-8, 0, 8]],
          surface: "ground",
        },
      },
      {
        eid: "lane-eid",
        kind: "vehicleNavLane",
        def: {
          id: "main-lane",
          points: [[0, 0, -8], [0, 0, 8]],
          width: 3,
          direction: "both",
        },
      },
      {
        eid: "marker-eid",
        kind: "vehicleNavMarker",
        def: { id: "landing", position: [0, 0, -15], kind: "landingZone", connections: [] },
      },
      {
        eid: "checkpoint-eid",
        kind: "checkpoint",
        def: { id: "save-vehicle", position: [0, 1, 3], size: [3, 2, 3], respawn: [0, 0, 2] },
      },
    ];
    const doc = testEditorDocument({ entities });

    const level = toLevelDefinition(doc);
    expect(level.vehicles?.[0]).toMatchObject({
      id: "heli",
      presetId: "helicopter",
      pathStart: "wp-a",
      crashPolicy: "survivable",
      accessPolicy: "resistance",
      allowPlayerExit: true,
    });
    expect(level.vehicleWaypoints).toHaveLength(2);
    expect(level.waterVolumes?.[0].size).toEqual([12, 2, 30]);
    expect(level.vehicleNavAreas).toHaveLength(1);
    expect(level.vehicleNavLanes).toHaveLength(1);
    expect(level.vehicleNavMarkers?.[0].kind).toBe("landingZone");
    expect(level.checkpoints?.[0].id).toBe("save-vehicle");

    const roundTripped = fromLevelDefinition(level);
    expect(roundTripped.schemaVersion).toBe(1);
    expect(roundTripped.entities.find((entity) => entity.kind === "vehicle")).toMatchObject({
      def: { accessPolicy: "resistance", allowPlayerExit: true },
    });
    expect(roundTripped.entities.map((entity) => entity.kind)).toEqual(
      expect.arrayContaining([
        "vehicle",
        "vehicleWaypoint",
        "waterVolume",
        "vehicleNavArea",
        "vehicleNavLane",
        "vehicleNavMarker",
        "checkpoint",
      ]),
    );

    const source = toTypeScript(roundTripped);
    expect(source).toContain(".vehicle(");
    expect(source).toContain(".vehicleWaypoint(");
    expect(source).toContain(".waterVolume(");
    expect(source).toContain(".vehicleNavArea(");
    expect(source).toContain(".vehicleNavLane(");
    expect(source).toContain(".vehicleNavMarker(");
    expect(source).toContain(".checkpoint(");
  });

  it("rechaza rutas vehiculares cíclicas sin pathLoop", () => {
    const entities: EditorEntity[] = [
      {
        eid: "a",
        kind: "vehicleWaypoint",
        def: { id: "a", position: [0, 3, 0], next: "b" },
      },
      {
        eid: "b",
        kind: "vehicleWaypoint",
        def: { id: "b", position: [0, 3, -4], next: "a" },
      },
      {
        eid: "heli",
        kind: "vehicle",
        def: { id: "heli", presetId: "helicopter", position: [0, 3, 0], pathStart: "a" },
      },
    ];

    expect(() => toLevelDefinition(testEditorDocument({ entities }))).toThrow("ciclo sin pathLoop");
  });

  it("rechaza políticas de acceso vehicular desconocidas", () => {
    expect(() => toLevelDefinition(testEditorDocument({
      entities: [
        {
          eid: "vehicle",
          kind: "vehicle",
          def: {
            id: "vehicle",
            presetId: "buggy",
            position: [0, 1, 0],
            accessPolicy: "zombies",
          },
        },
      ] as never,
    }))).toThrow("accessPolicy desconocida");
  });

  it("rechaza allowPlayerExit vehicular si no es booleano", () => {
    expect(() => toLevelDefinition(testEditorDocument({
      entities: [
        {
          eid: "vehicle",
          kind: "vehicle",
          def: {
            id: "vehicle",
            presetId: "buggy",
            position: [0, 1, 0],
            allowPlayerExit: "sí",
          },
        },
      ] as never,
    }))).toThrow("allowPlayerExit booleano");
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
