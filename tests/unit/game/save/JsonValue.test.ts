import { describe, expect, it } from "vitest";
import {
  assertJsonValue,
  canonicalJson,
  cloneJsonValue,
  isJsonObject,
  JsonValueError,
} from "@game/save/JsonValue";

describe("JsonValue", () => {
  it("valida y clona JSON sin compartir referencias", () => {
    const value = { nested: { enabled: true }, values: [1, null, "x"] };
    assertJsonValue(value);

    const clone = cloneJsonValue(value);
    clone.nested.enabled = false;

    expect(value.nested.enabled).toBe(true);
    expect(clone).toEqual({
      nested: { enabled: false },
      values: [1, null, "x"],
    });
  });

  it("rechaza números no finitos, objetos especiales y ciclos", () => {
    expect(() => assertJsonValue({ value: Number.NaN })).toThrow(JsonValueError);
    expect(() => assertJsonValue({ date: new Date() })).toThrow(JsonValueError);

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => assertJsonValue(cyclic)).toThrow(/circular/);

    const sparse = new Array<unknown>(2);
    sparse[1] = "x";
    expect(() => assertJsonValue(sparse)).toThrow(/denso/);

    const symbolKey = { valid: true, [Symbol("hidden")]: 1 };
    expect(() => assertJsonValue(symbolKey)).toThrow(/Symbol/);
  });

  it("produce JSON canónico independientemente del orden de claves", () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  it("conserva una clave __proto__ como dato sin alterar el prototipo", () => {
    const value = JSON.parse('{"__proto__":{"polluted":true}}') as unknown;
    assertJsonValue(value);

    const clone = cloneJsonValue(value);
    if (!isJsonObject(clone)) expect.unreachable("El clon debe ser un objeto");

    expect(Object.getPrototypeOf(clone)).toBe(Object.prototype);
    expect(Object.prototype).not.toHaveProperty("polluted");
    expect(Object.hasOwn(clone, "__proto__")).toBe(true);
  });
});
