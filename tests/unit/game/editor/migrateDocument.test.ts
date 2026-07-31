import { describe, expect, it } from "vitest";
import { testEditorDocument } from "@tests/support/fixtures";
import { migrateDocument } from "@game/editor/migrateDocument";
import type { EditorDocument, EditorEntity } from "@game/editor/EditorDocument";

/** Trigger con la forma vieja de acciones (pre entity-I/O). */
function legacyTrigger(actions: unknown[]): EditorEntity {
  return {
    eid: "trigger-1",
    kind: "trigger",
    def: { id: "tr", position: [0, 1, 0], size: [2, 2, 2], once: true, actions },
  } as unknown as EditorEntity;
}

function docWith(entities: EditorEntity[]): EditorDocument {
  return testEditorDocument({ entities: entities as never });
}

describe("migrateDocument", () => {
  it("convierte las 7 kinds de acción legacy en entidades lógicas + conexiones", () => {
    const doc = docWith([
      legacyTrigger([
        { kind: "dialogue", speaker: "Sistema", text: "Hola", duration: 3 },
        { kind: "objective", text: "Andá al norte", marker: [0, 1.6, -5] },
        { kind: "soundscape", soundscape: "wasteland" },
        { kind: "levelAction", action: "spawnAllWeapons" },
        { kind: "spawnNpcs", npcs: [{ id: "z1", characterId: "zombie", position: [0, 1, 0] }] },
        { kind: "endLevel", landmark: [0, 1, -6], delay: 1.2 },
        { kind: "door", doorId: "gate-1", open: true },
      ]),
    ]);

    const migrated = migrateDocument(doc);
    const trigger = migrated.entities.find((e) => e.kind === "trigger");
    const logic = migrated.entities.filter((e) => e.kind === "logic");

    // 6 acciones generan entidad lógica; `door` apunta a la puerta por id (sin lógica).
    expect(logic).toHaveLength(6);
    const conns = trigger?.kind === "trigger" ? trigger.def.connections ?? [] : [];
    expect(conns).toHaveLength(7);
    expect(conns.every((c) => c.output === "OnStartTouch")).toBe(true);
    // La puerta se targetea por id con el input correcto.
    expect(conns).toContainEqual(expect.objectContaining({ target: "gate-1", input: "Open" }));
    // El delay del endLevel (acción índice 5) se preserva.
    const endConn = conns.find((c) => c.target === "mig-tr-5");
    expect(endConn?.input).toBe("Trigger");
    expect(endConn?.delay).toBe(1.2);
    const changelevel = logic.find(
      (entity) => entity.def.kind === "changelevel",
    );
    expect(
      changelevel?.kind === "logic" && changelevel.def.kind === "changelevel"
        ? changelevel.def.landmark
        : null,
    ).toEqual({ position: [0, 1, -6], yaw: 0 });
    // La forma vieja se elimina.
    expect((trigger?.kind === "trigger" ? trigger.def : {}) as Record<string, unknown>).not.toHaveProperty("actions");
  });

  it("migra la forma legacy `dialogue` (aún más vieja)", () => {
    const legacy = {
      eid: "t",
      kind: "trigger",
      def: { id: "tr", position: [0, 1, 0], size: [2, 2, 2], once: true, dialogue: { text: "Hey", duration: 2 } },
    } as unknown as EditorEntity;
    const migrated = migrateDocument(docWith([legacy]));

    expect(migrated.entities.filter((e) => e.kind === "logic")).toHaveLength(1);
    const trigger = migrated.entities.find((e) => e.kind === "trigger");
    expect(trigger?.kind === "trigger" ? trigger.def.connections : []).toHaveLength(1);
  });

  it("conserva dialogue legacy cuando actions existe pero está vacío", () => {
    const legacy = {
      eid: "t",
      kind: "trigger",
      def: {
        id: "tr",
        position: [0, 1, 0],
        size: [2, 2, 2],
        once: true,
        actions: [],
        dialogue: { text: "Fallback", duration: 2 },
      },
    } as unknown as EditorEntity;

    const migrated = migrateDocument(docWith([legacy]));
    const trigger = migrated.entities.find((entity) => entity.kind === "trigger");
    expect(trigger?.kind === "trigger" ? trigger.def.connections : []).toHaveLength(1);
    expect(migrated.entities.some(
      (entity) => entity.kind === "logic" && entity.def.kind === "message" && entity.def.text === "Fallback",
    )).toBe(true);
  });

  it("es idempotente y deja intacto un documento ya migrado", () => {
    const doc = docWith([
      {
        eid: "t",
        kind: "trigger",
        def: { id: "tr", position: [0, 1, 0], size: [2, 2, 2], once: true, connections: [{ output: "OnStartTouch", target: "x", input: "Show" }] },
      },
    ]);
    const once = migrateDocument(doc);
    expect(once).toBe(doc); // sin cambios → misma referencia
    const twice = migrateDocument(once);
    expect(twice.entities.filter((e) => e.kind === "logic")).toHaveLength(0);
  });

  it("agrega schemaVersion 1 a documentos legacy sin mutarlos", () => {
    const current = testEditorDocument();
    const legacy = structuredClone(current) as Omit<EditorDocument, "schemaVersion"> & {
      schemaVersion?: number;
    };
    delete legacy.schemaVersion;

    const migrated = migrateDocument(legacy as EditorDocument);

    expect(migrated.schemaVersion).toBe(1);
    expect(legacy.schemaVersion).toBeUndefined();
  });

  it("migra landmarks tuple de metadata y changelevel al formato orientado", () => {
    const doc = testEditorDocument({
      meta: {
        ...testEditorDocument().meta,
        entryLandmark: [4, 1, 8],
      },
      entities: [
        {
          eid: "change",
          kind: "logic",
          position: [0, 1, 0],
          def: {
            kind: "changelevel",
            id: "change",
            name: "change",
            landmark: [10, 2, 12],
          },
        },
      ] as never,
    });

    const migrated = migrateDocument(doc);
    const changelevel = migrated.entities[0];

    expect(migrated.meta.entryLandmark).toEqual({
      position: [4, 1, 8],
      yaw: 0,
    });
    expect(
      changelevel?.kind === "logic" && changelevel.def.kind === "changelevel"
        ? changelevel.def.landmark
        : null,
    ).toEqual({ position: [10, 2, 12], yaw: 0 });
    expect(doc.meta.entryLandmark).toEqual([4, 1, 8]);
  });

  it("evita colisiones con ids o targetnames existentes", () => {
    const existing = {
      eid: "existing",
      kind: "logic",
      def: { kind: "message", id: "existing", name: "mig-tr-0", text: "Old", duration: 1 },
      position: [0, 1, 0],
    } as unknown as EditorEntity;
    const migrated = migrateDocument(docWith([
      existing,
      legacyTrigger([{ kind: "dialogue", text: "New", duration: 1 }]),
    ]));
    const generated = migrated.entities.find(
      (entity) => entity.kind === "logic" && entity.def.kind === "message" && entity.def.text === "New",
    );

    expect(generated?.kind === "logic" ? generated.def.name : null).toBe("mig-tr-0-2");
  });
});
