import { describe, expect, it } from "vitest";
import { testEditorDocument } from "@tests/support/fixtures";
import { sanitizeDocument } from "@game/workshop/sanitizeDocument";
import { fromLevelDefinition } from "@game/editor/codegen/fromLevelDefinition";
import { SetpieceTestLevel } from "@game/levels/maps/custom/SetpieceTestLevel";

describe("sanitizeDocument", () => {
  it("rechaza estructuras invalidas", () => {
    expect(sanitizeDocument({}).ok).toBe(false);
  });

  it("rechaza entidades malformadas sin lanzar excepciones", () => {
    const doc = testEditorDocument({ entities: [null] as never });

    expect(sanitizeDocument(doc)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("entidad 0"),
    });
  });

  it("rechaza demasiadas entidades", () => {
    const doc = testEditorDocument({
      entities: Array.from({ length: 2001 }, (_, index) => ({
        eid: `bad-${index}`,
      })) as never,
    });

    const result = sanitizeDocument(doc);

    expect(result).toMatchObject({
      ok: false,
      reason: expect.stringContaining("Demasiadas entidades"),
    });
  });

  it("rechaza strings demasiado largos", () => {
    const doc = testEditorDocument({
      meta: {
        ...testEditorDocument().meta,
        title: "x".repeat(4001),
      },
    });

    expect(sanitizeDocument(doc)).toMatchObject({
      ok: false,
      reason: "El documento contiene texto demasiado largo.",
    });
  });

  it("rechaza numeros no finitos", () => {
    const doc = testEditorDocument({
      meta: {
        ...testEditorDocument().meta,
        playerStart: [0, Number.NaN, 0],
      },
    });

    expect(sanitizeDocument(doc)).toMatchObject({
      ok: false,
      reason: "El documento contiene numeros invalidos.",
    });
  });

  it("rechaza documentos no serializables", () => {
    const doc = testEditorDocument() as unknown as Record<string, unknown>;
    doc.self = doc;

    expect(sanitizeDocument(doc)).toMatchObject({
      ok: false,
      reason: "El documento no es serializable.",
    });
  });

  it("rechaza soundscapes desconocidos en metadata", () => {
    const doc = testEditorDocument({
      meta: {
        ...testEditorDocument().meta,
        audio: {
          ...testEditorDocument().meta.audio,
          soundscape: "missing-soundscape" as never,
        },
      },
    });

    expect(sanitizeDocument(doc)).toMatchObject({
      ok: false,
      reason: "El documento referencia un soundscape desconocido.",
    });
  });

  it("rechaza soundscapes desconocidos en entidades lógicas", () => {
    const doc = testEditorDocument({
      entities: [
        {
          eid: "ss-1",
          kind: "logic",
          def: {
            kind: "soundscape",
            id: "ss-1",
            name: "ss-1",
            soundscape: "missing-soundscape",
          },
        },
      ] as never,
    });

    expect(sanitizeDocument(doc)).toMatchObject({
      ok: false,
      reason: "El documento referencia un soundscape desconocido.",
    });
  });

  it("acepta un grafo I/O válido con fan-out del mismo tipo", () => {
    const doc = ioDocument({
      output: "OnStartTouch",
      target: "kills",
      input: "Add",
      param: 1,
      delay: 0.5,
      maxFires: 3,
    }, [counter("counter-a", "kills"), counter("counter-b", "kills")]);

    expect(sanitizeDocument(doc)).toMatchObject({ ok: true });
  });

  it("resuelve comodines de targetname contra todas las clases coincidentes", () => {
    const doc = ioDocument({
      output: "OnStartTouch",
      target: "counter-*",
      input: "Add",
    }, [counter("counter-a", "counter-a"), counter("counter-b", "counter-b")]);

    expect(sanitizeDocument(doc)).toMatchObject({ ok: true });
  });

  it("valida el grafo completo del mapa demo de setpiece", () => {
    expect(sanitizeDocument(fromLevelDefinition(SetpieceTestLevel))).toMatchObject({ ok: true });
  });

  it("valida targets contextuales contra su clase efectiva", () => {
    const doc = ioDocument({
      output: "OnStartTouch",
      target: "!player",
      input: "Teleport",
      param: "destination",
    }, [{ kind: "marker", id: "destination", name: "destination", position: [0, 1, 0] }]);

    expect(sanitizeDocument(doc)).toMatchObject({ ok: true });
  });

  it.each([
    [
      "output inexistente",
      { output: "OnMissing", target: "kills", input: "Add" },
      [counter("counter", "kills")],
      "output",
    ],
    [
      "target inexistente",
      { output: "OnStartTouch", target: "missing", input: "Add" },
      [counter("counter", "kills")],
      "no existe",
    ],
    [
      "input incompatible",
      { output: "OnStartTouch", target: "kills", input: "Open" },
      [counter("counter", "kills")],
      "input",
    ],
    [
      "delay negativo",
      { output: "OnStartTouch", target: "kills", input: "Add", delay: -1 },
      [counter("counter", "kills")],
      "delay",
    ],
    [
      "maxFires no positivo",
      { output: "OnStartTouch", target: "kills", input: "Add", maxFires: 0 },
      [counter("counter", "kills")],
      "maxFires",
    ],
    [
      "parámetro de tipo incorrecto",
      { output: "OnStartTouch", target: "kills", input: "Add", param: "uno" },
      [counter("counter", "kills")],
      "numérico",
    ],
  ])("rechaza wiring inválido: %s", (_case, connection, targets, reason) => {
    expect(sanitizeDocument(ioDocument(connection, targets))).toMatchObject({
      ok: false,
      reason: expect.stringContaining(reason),
    });
  });

  it("valida referencias y pasos de scripted sequences", () => {
    const doc = testEditorDocument({
      entities: [
        {
          eid: "sequence",
          kind: "sequence",
          def: {
            id: "sequence",
            name: "sequence",
            targetNpc: "missing-npc",
            position: [0, 1, 0],
            moveMode: "walk",
            steps: [{ kind: "face", target: "missing-marker" }],
            connections: [],
          },
        },
      ] as never,
    });

    expect(sanitizeDocument(doc)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("targetNpc"),
    });
  });

  it("rechaza entidades lógicas con configuración inválida", () => {
    const doc = testEditorDocument({
      entities: [
        {
          eid: "timer",
          kind: "logic",
          def: { kind: "timer", id: "timer", name: "timer", interval: 0, connections: [] },
          position: [0, 1, 0],
        },
      ] as never,
    });

    expect(sanitizeDocument(doc)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("interval"),
    });
  });

  it("conserva compatibilidad con triggers de acciones legacy", () => {
    const doc = testEditorDocument({
      entities: [
        {
          eid: "legacy-trigger",
          kind: "trigger",
          def: {
            id: "legacy-trigger",
            position: [0, 1, 0],
            size: [2, 2, 2],
            once: true,
            actions: [{ kind: "dialogue", text: "Hola", duration: 2 }],
          },
        },
      ] as never,
    });

    expect(sanitizeDocument(doc)).toMatchObject({ ok: true });
  });
});

function ioDocument(connection: Record<string, unknown>, targets: unknown[]) {
  return testEditorDocument({
    entities: [
      {
        eid: "trigger",
        kind: "trigger",
        def: {
          id: "trigger",
          name: "trigger",
          position: [0, 1, 0],
          size: [2, 2, 2],
          once: true,
          connections: [connection],
        },
      },
      ...targets.map((def, index) => ({
        eid: `logic-${index}`,
        kind: "logic",
        def,
        position: [0, 1, 0],
      })),
    ] as never,
  });
}

function counter(id: string, name: string): Record<string, unknown> {
  return { kind: "counter", id, name, max: 3, connections: [] };
}
