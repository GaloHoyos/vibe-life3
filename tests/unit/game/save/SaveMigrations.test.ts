import { describe, expect, it } from "vitest";
import {
  migrateLegacyCheckpointWorld,
  migrateSaveEnvelope,
  parseSaveEnvelope,
  SaveMigrationError,
  tryMigrateSaveEnvelope,
} from "@game/save/SaveMigrations";
import { rawSaveEnvelope } from "./SaveTestSupport";

describe("SaveMigrations", () => {
  it("valida y clona un envelope v1 sin mutar la entrada", () => {
    const input = rawSaveEnvelope();
    const migrated = migrateSaveEnvelope(input);

    migrated.world.globals.changed = true;

    expect(input.world.globals.changed).toBeUndefined();
    expect(migrated.schemaVersion).toBe(1);
  });

  it("rechaza versiones futuras, timestamps inválidos y niveles cruzados", () => {
    const future = { ...rawSaveEnvelope(), schemaVersion: 2 };
    expectErrorCode(() => migrateSaveEnvelope(future), "future-version");

    const badTime = { ...rawSaveEnvelope(), updatedAt: Number.NaN };
    expect(() => migrateSaveEnvelope(badTime)).toThrow(SaveMigrationError);

    const crossed = rawSaveEnvelope();
    crossed.world.levelId = "otro";
    expect(() => migrateSaveEnvelope(crossed)).toThrow(/no coincide/);
  });

  it("parsea texto y ofrece una variante tolerante para índices corruptos", () => {
    const envelope = rawSaveEnvelope();
    expect(parseSaveEnvelope(JSON.stringify(envelope))).toEqual(envelope);
    expect(tryMigrateSaveEnvelope({ nope: true })).toBeNull();
    expectErrorCode(() => parseSaveEnvelope("{"), "invalid-json");
  });

  it("migra el checkpoint legacy a una entidad player v1", () => {
    const world = migrateLegacyCheckpointWorld("demo-01", {
      position: [1, 2, 3],
      health: 80,
      armor: 15,
      weapons: [{ id: "crowbar" }],
      activeWeaponId: "crowbar",
      yaw: 0.5,
    });

    expect(world.levelId).toBe("demo-01");
    expect(world.entities.player).toMatchObject({
      entityType: "player",
      version: 1,
      required: true,
      data: { health: 80, position: [1, 2, 3] },
    });
    expect(() =>
      migrateLegacyCheckpointWorld("demo-01", {
        position: [1, 2],
        health: 80,
        armor: 0,
        weapons: [],
        activeWeaponId: null,
      }),
    ).toThrow(/Posición/);
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
