import { describe, expect, it, vi } from "vitest";
import { InspectorView } from "@game/editor/ui/InspectorView";
import type { EditorDocument, EditorEntity } from "@game/editor/EditorDocument";
import { testEditorDocument } from "@tests/support/fixtures";

describe("InspectorView entity I/O", () => {
  it("ofrece inputs según la clase del target y cambia el parámetro al tipo del catálogo", () => {
    const trigger = triggerEntity({
      output: "OnStartTouch",
      target: "kills",
      input: "Add",
      param: 2,
    });
    const doc = ioDocument([
      trigger,
      logicEntity({ kind: "counter", id: "kills", name: "kills", max: 3, connections: [] }),
      logicEntity({ kind: "message", id: "message", name: "message", text: "Hola", duration: 2, connections: [] }),
    ]);
    const inspector = showInspector(doc, trigger);

    expect(selectOptions(fieldControl(inspector, "Input"))).toEqual([
      "Add",
      "Subtract",
      "SetValue",
      "Reset",
    ]);
    expect(fieldControl(inspector, "Parametro")).toMatchObject({ type: "number" });

    const target = fieldControl(inspector, "Target") as HTMLSelectElement;
    target.value = "message";
    target.dispatchEvent(new Event("change"));

    expect(trigger.def.connections?.[0]).toMatchObject({ target: "message", input: "Show" });
    expect(trigger.def.connections?.[0]?.param).toBeUndefined();
    expect(selectOptions(fieldControl(inspector, "Input"))).toEqual(["Show"]);
    expect(optionalFieldControl(inspector, "Parametro")).toBeNull();
  });

  it("usa un selector de targetnames para parámetros targetName e incluye NPCs de spawners", () => {
    const trigger = triggerEntity({
      output: "OnStartTouch",
      target: "alyx",
      input: "EscortTo",
      param: "exit-point",
    });
    const doc = ioDocument([
      trigger,
      npcEntity("alyx-id", "alyx"),
      logicEntity({ kind: "marker", id: "exit", name: "exit-point", position: [0, 1, -10] }),
      logicEntity({
        kind: "npcSpawner",
        id: "spawner",
        name: "spawner",
        npcs: [{ id: "spawned-id", name: "spawned", characterId: "combine", position: [0, 1, 0] }],
        connections: [],
      }),
    ]);
    const inspector = showInspector(doc, trigger);

    const param = fieldControl(inspector, "Parametro (targetname)");
    expect(param).toBeInstanceOf(HTMLSelectElement);
    expect(selectOptions(param)).toEqual(["exit-point"]);
    expect(selectOptions(fieldControl(inspector, "Target"))).toContain("spawned");
  });

  it("advierte targetnames duplicados sin impedir el fan-out", () => {
    const first = npcEntity("alyx-a", "alyx");
    const second = npcEntity("alyx-b", "alyx");
    const doc = ioDocument([first, second]);
    const inspector = showInspector(doc, first);

    const warning = inspector.element.querySelector(".editor-note--warning");
    expect(warning?.textContent).toContain("Targetname compartido por 2 entidades");
    expect(warning?.textContent).toContain("fan-out");
  });

  it("expone las opciones de retrigger del logic_relay", () => {
    const relay = logicEntity({ kind: "relay", id: "relay", name: "relay", connections: [] });
    const inspector = showInspector(ioDocument([relay]), relay);

    const fast = fieldControl(inspector, "Permitir retrigger rápido") as HTMLInputElement;
    const once = fieldControl(inspector, "Disparar una sola vez") as HTMLInputElement;
    fast.checked = true;
    fast.dispatchEvent(new Event("change"));
    once.checked = true;
    once.dispatchEvent(new Event("change"));

    expect(relay.def).toMatchObject({ allowFastRetrigger: true, triggerOnce: true });
  });
});

function showInspector(documentValue: EditorDocument, entity: EditorEntity): InspectorView {
  const inspector = new InspectorView({
    getDocument: () => documentValue,
    onEntityChanged: vi.fn(),
    onPlayerStartChanged: vi.fn(),
  });
  document.body.append(inspector.element);
  inspector.showEntity(entity);
  return inspector;
}

function fieldControl(inspector: InspectorView, label: string): HTMLInputElement | HTMLSelectElement {
  const control = optionalFieldControl(inspector, label);
  if (!control) throw new Error(`No se encontró el campo "${label}"`);
  return control;
}

function optionalFieldControl(
  inspector: InspectorView,
  label: string,
): HTMLInputElement | HTMLSelectElement | null {
  const rows = [...inspector.element.querySelectorAll<HTMLElement>(".editor-field")];
  const row = rows.find((candidate) =>
    candidate.querySelector(".editor-field__label")?.textContent === label,
  );
  return row?.querySelector("input, select") ?? null;
}

function selectOptions(control: HTMLInputElement | HTMLSelectElement): string[] {
  if (!(control instanceof HTMLSelectElement)) throw new Error("El control no es un select");
  return [...control.options].map((option) => option.value);
}

function ioDocument(entities: EditorEntity[]): EditorDocument {
  return testEditorDocument({ entities });
}

function triggerEntity(connection: {
  output: string;
  target: string;
  input: string;
  param?: string | number | boolean;
}): Extract<EditorEntity, { kind: "trigger" }> {
  return {
    eid: "trigger-eid",
    kind: "trigger",
    def: {
      id: "trigger",
      name: "trigger",
      position: [0, 1, 0],
      size: [2, 2, 2],
      once: true,
      connections: [connection],
    },
  };
}

function npcEntity(id: string, name: string): Extract<EditorEntity, { kind: "npc" }> {
  return {
    eid: `${id}-eid`,
    kind: "npc",
    def: { id, name, characterId: "alyx", position: [0, 1, 0], connections: [] },
  };
}

function logicEntity(
  def: Extract<EditorEntity, { kind: "logic" }>["def"],
): Extract<EditorEntity, { kind: "logic" }> {
  return { eid: `${def.id}-eid`, kind: "logic", def, position: [0, 1, 0] };
}
