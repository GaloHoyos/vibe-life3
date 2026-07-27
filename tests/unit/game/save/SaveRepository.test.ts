import { beforeEach, describe, expect, it } from "vitest";
import {
  hashSaveDocument,
  MAX_AUTOSAVES,
  MAX_MANUAL_SAVES,
  SaveRepository,
  SaveRepositoryError,
} from "@game/save/SaveRepository";
import {
  MemorySaveStorage,
  rawSaveEnvelope,
  saveDraft,
} from "./SaveTestSupport";

describe("SaveRepository", () => {
  let storage: MemorySaveStorage;
  let now: number;
  let nextId: number;
  let repository: SaveRepository;

  beforeEach(() => {
    storage = new MemorySaveStorage();
    now = 100;
    nextId = 1;
    repository = new SaveRepository(storage, {
      clock: () => now++,
      idFactory: () => `id-${nextId++}`,
    });
  });

  it("mantiene un único quicksave y devuelve copias aisladas", async () => {
    const first = await repository.save("quick", saveDraft("Primero"));
    const second = await repository.save("quick", saveDraft("Segundo"));
    const listed = await repository.list("quick");

    expect(first.id).toBe("quick:0");
    expect(second.id).toBe("quick:0");
    expect(listed).toHaveLength(1);
    expect(listed[0].metadata.title).toBe("Segundo");

    listed[0].metadata.title = "Mutado";
    expect((await repository.require("quick:0")).metadata.title).toBe("Segundo");
  });

  it("rota exactamente tres autosaves reemplazando el más viejo", async () => {
    for (let index = 1; index <= MAX_AUTOSAVES + 1; index += 1) {
      await repository.save("auto", saveDraft(`Auto ${index}`));
    }

    const autos = await repository.list("auto");
    expect(autos).toHaveLength(3);
    expect(autos.map((save) => save.metadata.title)).toEqual([
      "Auto 4",
      "Auto 3",
      "Auto 2",
    ]);
    expect(autos.find((save) => save.id === "auto:0")?.metadata.title).toBe(
      "Auto 4",
    );
  });

  it("limita manuales a veinte y sobrescribe sólo slots manuales", async () => {
    const writes = Array.from(
      { length: MAX_MANUAL_SAVES + 2 },
      (_, index) => repository.save("manual", saveDraft(`Manual ${index + 1}`)),
    );
    await Promise.all(writes);

    const manuals = await repository.list("manual");
    expect(manuals).toHaveLength(MAX_MANUAL_SAVES);
    expect(manuals.some((save) => save.metadata.title === "Manual 1")).toBe(false);
    expect(manuals.some((save) => save.metadata.title === "Manual 2")).toBe(false);

    const target = manuals[5];
    const overwritten = await repository.save(
      "manual",
      saveDraft("Sobrescrito"),
      { overwriteId: target.id },
    );
    expect(overwritten.id).toBe(target.id);
    expect(overwritten.createdAt).toBe(target.createdAt);
    expect(await repository.list("manual")).toHaveLength(MAX_MANUAL_SAVES);

    await expect(
      repository.save("manual", saveDraft("Inválido"), {
        overwriteId: "quick:0",
      }),
    ).rejects.toMatchObject({ code: "invalid-overwrite" });
  });

  it("serializa mutaciones concurrentes para no duplicar ids ni exceder límites", async () => {
    await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        repository.save("manual", saveDraft(`Concurrente ${index}`)),
      ),
    );

    const manuals = await repository.list("manual");
    expect(manuals).toHaveLength(MAX_MANUAL_SAVES);
    expect(new Set(manuals.map((save) => save.id)).size).toBe(
      MAX_MANUAL_SAVES,
    );
    expect(storage.saveCount()).toBe(MAX_MANUAL_SAVES);
  });

  it("ignora entradas corruptas al listar y las denuncia al pedirlas por id", async () => {
    storage.setRawSave("corrupt", { broken: true });
    storage.setRawSave("manual:valid", rawSaveEnvelope("manual:valid"));

    expect(await repository.list()).toHaveLength(1);
    await expect(repository.get("corrupt")).rejects.toBeInstanceOf(
      SaveRepositoryError,
    );
    await expect(repository.require("missing")).rejects.toMatchObject({
      code: "save-not-found",
    });
  });

  it("guarda documentos por SHA-256 canónico, deduplica y verifica integridad", async () => {
    const firstHash = await repository.storeDocument({
      entities: [{ id: "a" }],
      meta: { title: "Mapa" },
    });
    const secondHash = await repository.storeDocument({
      meta: { title: "Mapa" },
      entities: [{ id: "a" }],
    });

    expect(firstHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(secondHash).toBe(firstHash);
    expect(await repository.requireDocument(firstHash)).toEqual({
      entities: [{ id: "a" }],
      meta: { title: "Mapa" },
    });

    storage.setRawDocument(firstHash, { tampered: true });
    await expect(repository.getDocument(firstHash)).rejects.toMatchObject({
      code: "document-hash-mismatch",
    });
    await expect(
      repository.requireDocument(`sha256:${"0".repeat(64)}`),
    ).rejects.toMatchObject({ code: "document-not-found" });
  });

  it("expone un hasher estable para contenido JSON", async () => {
    await expect(hashSaveDocument({ b: 2, a: 1 })).resolves.toBe(
      await hashSaveDocument({ a: 1, b: 2 }),
    );
  });
});
