import { beforeEach, describe, expect, it } from "vitest";
import {
  SaveCoordinator,
  type SaveRestoreContext,
  type SaveWorldAdapter,
  type WorldSaveBaseState,
} from "@game/save/SaveCoordinator";
import {
  SaveEntityRegistry,
  type SaveRestorePhase,
} from "@game/save/SaveEntityRegistry";
import {
  SaveOperationBarrier,
} from "@game/save/SaveOperationBarrier";
import {
  SaveRepository,
} from "@game/save/SaveRepository";
import type {
  LevelSourceRef,
  SaveMetadata,
} from "@game/save/SaveTypes";
import { MemorySaveStorage } from "./SaveTestSupport";

class TestWorldAdapter implements SaveWorldAdapter {
  readonly events: string[] = [];
  levelId = "demo-01";
  failPhase: SaveRestorePhase | null = null;
  restoredDocument: unknown = undefined;

  captureWorldBase(): WorldSaveBaseState {
    this.events.push("capture-world");
    return {
      levelId: this.levelId,
      simulationTimeSeconds: 42,
      globals: { flag: true },
      systems: {},
      extensions: {},
    };
  }

  validateRestore(context: SaveRestoreContext): void {
    this.events.push("validate");
    this.restoredDocument = context.sourceDocument;
  }

  prepareRestore(): void {
    this.events.push("prepare");
  }

  restorePhase(phase: SaveRestorePhase): void {
    this.events.push(`world:${phase}`);
    if (phase === this.failPhase) throw new Error(`fallo-${phase}`);
  }

  completeRestore(): void {
    this.events.push("complete");
  }

  abortRestore(): void {
    this.events.push("abort");
  }
}

const metadata: SaveMetadata = {
  title: "Prueba",
  levelTitle: "Nivel",
  playTimeSeconds: 10,
  difficulty: "normal",
};

describe("SaveCoordinator", () => {
  let storage: MemorySaveStorage;
  let repository: SaveRepository;
  let registry: SaveEntityRegistry;
  let world: TestWorldAdapter;
  let barrierEvents: string[];
  let coordinator: SaveCoordinator;

  beforeEach(() => {
    storage = new MemorySaveStorage();
    repository = new SaveRepository(storage, {
      clock: () => 100,
      idFactory: () => "one",
    });
    registry = new SaveEntityRegistry();
    world = new TestWorldAdapter();
    barrierEvents = [];
    const barrier = new SaveOperationBarrier({
      enter: (operation) => {
        barrierEvents.push(`enter:${operation}`);
      },
      leave: (operation, error) => {
        barrierEvents.push(`leave:${operation}:${error ? "error" : "ok"}`);
      },
    });
    coordinator = new SaveCoordinator(repository, registry, world, barrier);
  });

  it("captura mundo y serializers dentro de la barrera", async () => {
    registry.register({
      id: "player",
      entityType: "player",
      version: 1,
      capture: () => {
        world.events.push("capture-player");
        return { health: 75 };
      },
      restore: () => undefined,
    });

    const save = await coordinator.capture({
      kind: "quick",
      gameBuild: "test",
      source: { kind: "built-in", levelId: "demo-01" },
      metadata,
    });

    expect(barrierEvents).toEqual(["enter:capture", "leave:capture:ok"]);
    expect(world.events).toEqual(["capture-world", "capture-player"]);
    expect(save.world.entities.player.data).toEqual({ health: 75 });
  });

  it("restaura en orden estricto y completa antes de abrir la barrera", async () => {
    registry.register({
      id: "player",
      entityType: "player",
      version: 1,
      capture: () => ({ health: 75 }),
      restore: (_data, context) => {
        world.events.push(`entity:${context.phase}`);
      },
    });
    const save = await coordinator.capture({
      kind: "quick",
      gameBuild: "test",
      source: { kind: "built-in", levelId: "demo-01" },
      metadata,
    });
    world.events.length = 0;
    barrierEvents.length = 0;

    await coordinator.restore(save.id);

    expect(world.events).toEqual([
      "validate",
      "prepare",
      "world:physics",
      "entity:physics",
      "world:actors",
      "entity:actors",
      "world:relationships",
      "entity:relationships",
      "world:logic",
      "entity:logic",
      "world:presentation",
      "entity:presentation",
      "complete",
    ]);
    expect(barrierEvents).toEqual(["enter:restore", "leave:restore:ok"]);
  });

  it("aborta el restore fallido y siempre libera la barrera", async () => {
    registry.register({
      id: "player",
      entityType: "player",
      version: 1,
      capture: () => ({ health: 75 }),
      restore: () => undefined,
    });
    const save = await coordinator.capture({
      kind: "quick",
      gameBuild: "test",
      source: { kind: "built-in", levelId: "demo-01" },
      metadata,
    });
    world.events.length = 0;
    barrierEvents.length = 0;
    world.failPhase = "relationships";

    await expect(coordinator.restore(save.id)).rejects.toThrow(
      "fallo-relationships",
    );

    expect(world.events.at(-1)).toBe("abort");
    expect(barrierEvents).toEqual(["enter:restore", "leave:restore:error"]);
  });

  it("vincula mapas custom a un documento íntegro por hash", async () => {
    const document = { meta: { title: "Custom" }, entities: [] };
    const hash = await repository.storeDocument(document);
    const source: LevelSourceRef = {
      kind: "library",
      levelId: "custom-map",
      mapId: "local-1",
      documentHash: hash,
    };
    world.levelId = "custom-map";

    const save = await coordinator.capture({
      kind: "manual",
      gameBuild: "test",
      source,
      metadata,
      sourceDocument: document,
    });
    await coordinator.restore(save.id);

    expect(world.restoredDocument).toEqual(document);

    const different = { different: true };
    const differentHash = await repository.storeDocument(different);
    await expect(
      coordinator.capture({
        kind: "manual",
        gameBuild: "test",
        source,
        metadata,
        sourceDocument: different,
      }),
    ).rejects.toMatchObject({ code: "document-hash-mismatch" });
    await expect(repository.requireDocument(differentHash)).resolves.toEqual(
      different,
    );
  });

  it("rechaza documentos para niveles built-in y falta de saves recientes", async () => {
    await expect(
      coordinator.capture({
        kind: "quick",
        gameBuild: "test",
        source: { kind: "built-in", levelId: "demo-01" },
        metadata,
        sourceDocument: {},
      }),
    ).rejects.toMatchObject({ code: "document-hash-mismatch" });

    await expect(coordinator.restoreMostRecent()).rejects.toMatchObject({
      code: "save-not-found",
    });
  });
});
