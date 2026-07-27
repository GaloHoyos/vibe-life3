import type { Disposable } from "@shared/types/lifecycle";
import {
  assertJsonValue,
  cloneJsonValue,
  isJsonObject,
  type JsonObject,
  type JsonValue,
} from "./JsonValue";
import type {
  SaveEnvelopeV1,
  SavedEntityState,
} from "./SaveTypes";

export const SAVE_RESTORE_PHASES = [
  "physics",
  "actors",
  "relationships",
  "logic",
  "presentation",
] as const;

export type SaveRestorePhase = (typeof SAVE_RESTORE_PHASES)[number];

type MaybePromise<T> = Promise<T> | T;

export interface SaveEntityRestoreContext {
  envelope: SaveEnvelopeV1;
  sourceDocument: JsonValue | null;
  phase: SaveRestorePhase;
  entityId: string;
}

export interface SaveEntityRegistration {
  id: string;
  entityType: string;
  version: number;
  required?: boolean;
  requireStateOnRestore?: boolean;
  phases?: readonly SaveRestorePhase[];
  capture(): MaybePromise<JsonObject | null>;
  restore(
    data: JsonObject,
    context: SaveEntityRestoreContext,
  ): MaybePromise<void>;
  migrate?(
    data: JsonObject,
    fromVersion: number,
    toVersion: number,
  ): JsonObject;
}

interface PreparedEntry {
  registration: SaveEntityRegistration;
  data: JsonObject;
}

export class PreparedEntityRestore {
  readonly entries: readonly PreparedEntry[];

  constructor(entries: readonly PreparedEntry[]) {
    this.entries = entries;
  }
}

export type SaveEntityRegistryErrorCode =
  | "duplicate-id"
  | "invalid-registration"
  | "invalid-state"
  | "missing-entity"
  | "missing-state"
  | "type-mismatch"
  | "unsupported-entity-version";

export class SaveEntityRegistryError extends Error {
  constructor(
    readonly code: SaveEntityRegistryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SaveEntityRegistryError";
  }
}

/**
 * Registro runtime de serializers pequeños. No retiene referencias entre
 * cargas: el loader debe limpiar y volver a registrar las entidades del mundo
 * recién construido antes de `prepareRestore`.
 */
export class SaveEntityRegistry {
  private readonly registrations = new Map<string, SaveEntityRegistration>();

  get size(): number {
    return this.registrations.size;
  }

  register(registration: SaveEntityRegistration): Disposable {
    validateRegistration(registration);
    if (this.registrations.has(registration.id)) {
      throw new SaveEntityRegistryError(
        "duplicate-id",
        `Ya existe un serializer para ${registration.id}`,
      );
    }
    this.registrations.set(registration.id, registration);
    return {
      dispose: () => {
        if (this.registrations.get(registration.id) === registration) {
          this.registrations.delete(registration.id);
        }
      },
    };
  }

  clear(): void {
    this.registrations.clear();
  }

  async captureAll(): Promise<Record<string, SavedEntityState>> {
    const captured: Record<string, SavedEntityState> = Object.create(null) as Record<
      string,
      SavedEntityState
    >;
    const registrations = [...this.registrations.values()].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    for (const registration of registrations) {
      const value = await registration.capture();
      if (value === null) continue;
      try {
        assertJsonValue(value);
      } catch (error) {
        throw new SaveEntityRegistryError(
          "invalid-state",
          `El serializer ${registration.id} produjo estado no serializable`,
          { cause: error },
        );
      }
      if (!isJsonObject(value)) {
        throw new SaveEntityRegistryError(
          "invalid-state",
          `El serializer ${registration.id} debe producir un objeto JSON`,
        );
      }
      captured[registration.id] = {
        entityType: registration.entityType,
        version: registration.version,
        required: registration.required ?? true,
        data: cloneJsonValue(value),
      };
    }
    return captured;
  }

  prepareRestore(
    states: Readonly<Record<string, SavedEntityState>>,
  ): PreparedEntityRestore {
    const prepared: PreparedEntry[] = [];
    const restoredIds = new Set<string>();
    const sortedStates = Object.entries(states).sort(([a], [b]) =>
      a.localeCompare(b),
    );

    for (const [id, state] of sortedStates) {
      const registration = this.registrations.get(id);
      if (!registration) {
        if (state.required) {
          throw new SaveEntityRegistryError(
            "missing-entity",
            `El mundo cargado no registró la entidad requerida ${id}`,
          );
        }
        continue;
      }
      if (registration.entityType !== state.entityType) {
        throw new SaveEntityRegistryError(
          "type-mismatch",
          `La entidad ${id} cambió de ${state.entityType} a ${registration.entityType}`,
        );
      }
      if (state.version > registration.version) {
        throw new SaveEntityRegistryError(
          "unsupported-entity-version",
          `La entidad ${id} requiere versión ${state.version}`,
        );
      }

      let data = cloneJsonValue(state.data);
      if (state.version < registration.version) {
        if (!registration.migrate) {
          throw new SaveEntityRegistryError(
            "unsupported-entity-version",
            `No existe migración de ${id} v${state.version} a v${registration.version}`,
          );
        }
        try {
          data = registration.migrate(
            data,
            state.version,
            registration.version,
          );
          assertJsonValue(data);
        } catch (error) {
          throw new SaveEntityRegistryError(
            "invalid-state",
            `Falló la migración de estado para ${id}`,
            { cause: error },
          );
        }
        if (!isJsonObject(data)) {
          throw new SaveEntityRegistryError(
            "invalid-state",
            `La migración de ${id} debe producir un objeto JSON`,
          );
        }
        data = cloneJsonValue(data);
      }

      prepared.push({ registration, data });
      restoredIds.add(id);
    }

    for (const registration of this.registrations.values()) {
      if (registration.requireStateOnRestore && !restoredIds.has(registration.id)) {
        throw new SaveEntityRegistryError(
          "missing-state",
          `El guardado no contiene la entidad requerida ${registration.id}`,
        );
      }
    }

    return new PreparedEntityRestore(prepared);
  }

  async restorePhase(
    prepared: PreparedEntityRestore,
    phase: SaveRestorePhase,
    envelope: SaveEnvelopeV1,
    sourceDocument: JsonValue | null,
  ): Promise<void> {
    for (const entry of prepared.entries) {
      if (entry.registration.phases && !entry.registration.phases.includes(phase)) {
        continue;
      }
      await entry.registration.restore(cloneJsonValue(entry.data), {
        envelope,
        sourceDocument: sourceDocument
          ? cloneJsonValue(sourceDocument)
          : null,
        phase,
        entityId: entry.registration.id,
      });
    }
  }
}

function validateRegistration(registration: SaveEntityRegistration): void {
  if (
    registration.id.trim().length === 0 ||
    registration.entityType.trim().length === 0 ||
    !Number.isInteger(registration.version) ||
    registration.version < 0
  ) {
    throw new SaveEntityRegistryError(
      "invalid-registration",
      "El serializer debe tener id, tipo y versión no negativa",
    );
  }
  if (
    registration.phases &&
    registration.phases.some((phase) => !SAVE_RESTORE_PHASES.includes(phase))
  ) {
    throw new SaveEntityRegistryError(
      "invalid-registration",
      `El serializer ${registration.id} declara una fase inválida`,
    );
  }
}
