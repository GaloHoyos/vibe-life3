import { describe, expect, it } from "vitest";
import {
  SAVE_RESTORE_PHASES,
  SaveEntityRegistry,
  SaveEntityRegistryError,
} from "@game/save/SaveEntityRegistry";
import { rawSaveEnvelope } from "./SaveTestSupport";

describe("SaveEntityRegistry", () => {
  it("captura en orden estable, versiona y no comparte referencias", async () => {
    const registry = new SaveEntityRegistry();
    const source = { health: 100 };
    registry.register({
      id: "zombie-b",
      entityType: "npc",
      version: 2,
      required: false,
      capture: () => source,
      restore: () => undefined,
    });
    registry.register({
      id: "player",
      entityType: "player",
      version: 1,
      capture: () => ({ health: 80 }),
      restore: () => undefined,
    });

    const captured = await registry.captureAll();
    expect(Object.keys(captured)).toEqual(["player", "zombie-b"]);
    expect(captured["zombie-b"]).toMatchObject({
      entityType: "npc",
      version: 2,
      required: false,
    });

    captured["zombie-b"].data.health = 1;
    expect(source.health).toBe(100);
  });

  it("migra estado por entidad y ejecuta sólo sus fases declaradas", async () => {
    const registry = new SaveEntityRegistry();
    const calls: string[] = [];
    registry.register({
      id: "door-a",
      entityType: "door",
      version: 2,
      phases: ["physics", "logic"],
      capture: () => ({ open: false }),
      migrate: (data, fromVersion, toVersion) => ({
        ...data,
        migrated: `${fromVersion}->${toVersion}`,
      }),
      restore: (data, context) => {
        calls.push(`${context.phase}:${String(data.migrated)}`);
      },
    });
    const prepared = registry.prepareRestore({
      "door-a": {
        entityType: "door",
        version: 1,
        required: true,
        data: { open: true },
      },
    });
    const envelope = rawSaveEnvelope();

    for (const phase of SAVE_RESTORE_PHASES) {
      await registry.restorePhase(prepared, phase, envelope, null);
    }

    expect(calls).toEqual(["physics:1->2", "logic:1->2"]);
  });

  it("falla antes de restaurar ante entidades, tipos o versiones incompatibles", () => {
    const registry = new SaveEntityRegistry();
    registry.register({
      id: "player",
      entityType: "player",
      version: 1,
      capture: () => ({}),
      restore: () => undefined,
    });

    expectErrorCode(() =>
      registry.prepareRestore({
        missing: {
          entityType: "npc",
          version: 1,
          required: true,
          data: {},
        },
      }), "missing-entity");
    expectErrorCode(() =>
      registry.prepareRestore({
        player: {
          entityType: "npc",
          version: 1,
          required: true,
          data: {},
        },
      }), "type-mismatch");
    expectErrorCode(() =>
      registry.prepareRestore({
        player: {
          entityType: "player",
          version: 2,
          required: true,
          data: {},
        },
      }), "unsupported-entity-version");
  });

  it("permite estados best-effort, exige estados marcados y dispone registros", () => {
    const registry = new SaveEntityRegistry();
    expect(() =>
      registry.prepareRestore({
        removed: {
          entityType: "prop",
          version: 1,
          required: false,
          data: {},
        },
      }),
    ).not.toThrow();

    const disposer = registry.register({
      id: "required-now",
      entityType: "system",
      version: 1,
      requireStateOnRestore: true,
      capture: () => ({}),
      restore: () => undefined,
    });
    expect(() => registry.prepareRestore({})).toThrow(
      SaveEntityRegistryError,
    );

    disposer.dispose();
    expect(registry.size).toBe(0);
    expect(() => registry.prepareRestore({})).not.toThrow();
  });

  it("rechaza ids duplicados y estados no serializables", async () => {
    const registry = new SaveEntityRegistry();
    const registration = {
      id: "same",
      entityType: "test",
      version: 1,
      capture: () => ({ broken: Number.NaN }),
      restore: () => undefined,
    };
    registry.register(registration);

    expectErrorCode(() => registry.register(registration), "duplicate-id");
    await expect(registry.captureAll()).rejects.toMatchObject({
      code: "invalid-state",
    });
  });
});

function expectErrorCode(operation: () => unknown, code: string): void {
  try {
    operation();
    expect.unreachable("La operación debía fallar");
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}
