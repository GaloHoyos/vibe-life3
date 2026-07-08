import { describe, expect, it } from "vitest";
import { testEditorDocument } from "@tests/support/fixtures";
import { sanitizeDocument } from "@game/workshop/sanitizeDocument";

describe("sanitizeDocument", () => {
  it("rechaza estructuras invalidas", () => {
    expect(sanitizeDocument({}).ok).toBe(false);
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

  it("rechaza soundscapes desconocidos en triggers", () => {
    const doc = testEditorDocument({
      entities: [
        {
          eid: "trigger-1",
          kind: "trigger",
          def: {
            id: "trigger-1",
            position: [0, 1, 0],
            size: [1, 1, 1],
            once: true,
            actions: [{ kind: "soundscape", soundscape: "missing-soundscape" as never }],
          },
        },
      ],
    });

    expect(sanitizeDocument(doc)).toMatchObject({
      ok: false,
      reason: "El documento referencia un soundscape desconocido.",
    });
  });
});
