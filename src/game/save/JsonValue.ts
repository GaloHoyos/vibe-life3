export type JsonPrimitive = boolean | number | string | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export class JsonValueError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${message} en ${path}`);
    this.name = "JsonValueError";
  }
}

export function isJsonObject(value: unknown): value is JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function assertJsonValue(value: unknown, path = "$"): asserts value is JsonValue {
  validateJsonValue(value, path, new Set<object>());
}

export function cloneJsonValue<T extends JsonValue>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneJsonValue(entry)) as T;
  }
  if (isJsonObject(value)) {
    const clone: JsonObject = {};
    for (const [key, entry] of Object.entries(value)) {
      Object.defineProperty(clone, key, {
        configurable: true,
        enumerable: true,
        value: cloneJsonValue(entry),
        writable: true,
      });
    }
    return clone as T;
  }
  return value;
}

export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
  return `{${entries.join(",")}}`;
}

function validateJsonValue(value: unknown, path: string, ancestors: Set<object>): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new JsonValueError("El número debe ser finito", path);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    throw new JsonValueError("El valor no es serializable como JSON", path);
  }
  if (ancestors.has(value)) {
    throw new JsonValueError("El valor contiene una referencia circular", path);
  }

  ancestors.add(value);
  if (Array.isArray(value)) {
    const keys = Object.keys(value);
    const dense =
      keys.length === value.length &&
      keys.every((key, index) => key === String(index));
    if (!dense || Object.getOwnPropertySymbols(value).length > 0) {
      throw new JsonValueError("El array debe ser denso y no tener propiedades extra", path);
    }
    for (let index = 0; index < value.length; index += 1) {
      validateJsonValue(value[index], `${path}[${index}]`, ancestors);
    }
  } else {
    if (!isJsonObject(value)) {
      throw new JsonValueError("Sólo se permiten objetos JSON planos", path);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new JsonValueError("No se permiten claves Symbol", path);
    }
    for (const [key, entry] of Object.entries(value)) {
      validateJsonValue(entry, `${path}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
}
