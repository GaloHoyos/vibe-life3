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
});
