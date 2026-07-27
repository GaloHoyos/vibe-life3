import { beforeEach, describe, expect, it, vi } from "vitest";
import { SaveGameMenu } from "@game/ui/menu/SaveGameMenu";
import type { SaveEnvelopeV1, SaveSlot } from "@game/save";

describe("SaveGameMenu", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("lista miniatura, nivel, fecha, tiempo y tipo de guardado", async () => {
    const save = makeSave("quick:0", { kind: "quick", index: 0 });
    const menu = createMenu([save]);
    document.body.append(menu.element);

    await menu.refresh();

    expect(menu.element.textContent).toContain("GUARDADO RÁPIDO");
    expect(menu.element.textContent).toContain("Demo 3 — Cielo blanco");
    expect(menu.element.textContent).toContain("1 h 01 min");
    const image = menu.element.querySelector("img");
    expect(image?.src).toBe(save.metadata.thumbnail?.dataUrl);
    expect(image?.width).toBe(320);
    expect(image?.height).toBe(180);
    menu.dispose();
  });

  it("carga el guardado elegido", async () => {
    const onLoadSave = vi.fn();
    const save = makeSave("auto:1", { kind: "auto", index: 1 });
    const menu = createMenu([save], { onLoadSave });
    document.body.append(menu.element);
    await menu.refresh();

    findButton(menu.element, "CARGAR").click();
    await settle();

    expect(onLoadSave).toHaveBeenCalledWith("auto:1");
    menu.dispose();
  });

  it("crea y sobrescribe guardados manuales desde pausa", async () => {
    const onCreateManualSave = vi.fn();
    const onOverwriteSave = vi.fn();
    const manual = makeSave("manual:alpha", { kind: "manual" });
    const menu = createMenu([manual], {
      onCreateManualSave,
      onOverwriteSave,
    });
    document.body.append(menu.element);
    menu.show("save");
    await settle();

    findButton(menu.element, "CREAR GUARDADO MANUAL").click();
    await settle();
    expect(onCreateManualSave).toHaveBeenCalledOnce();

    findButton(menu.element, "SOBRESCRIBIR").click();
    expect(onOverwriteSave).not.toHaveBeenCalled();
    findButton(menu.element, "CONFIRMAR").click();
    await settle();
    expect(onOverwriteSave).toHaveBeenCalledWith("manual:alpha");
    menu.dispose();
  });

  it("exige confirmación y actualiza la lista después de borrar", async () => {
    let saves = [makeSave("manual:alpha", { kind: "manual" })];
    const onDeleteSave = vi.fn((id: string) => {
      saves = saves.filter((save) => save.id !== id);
    });
    const menu = createMenu(saves, {
      listSaves: async () => saves,
      onDeleteSave,
    });
    document.body.append(menu.element);
    await menu.refresh();

    findButton(menu.element, "BORRAR").click();
    expect(onDeleteSave).not.toHaveBeenCalled();
    findButton(menu.element, "CONFIRMAR BORRADO").click();
    await settle();

    expect(onDeleteSave).toHaveBeenCalledWith("manual:alpha");
    expect(menu.element.textContent).toContain("SIN GUARDADOS");
    menu.dispose();
  });

  it("muestra un error recuperable si falla IndexedDB", async () => {
    let shouldFail = true;
    const menu = createMenu([], {
      listSaves: () => {
        if (shouldFail) {
          shouldFail = false;
          return Promise.reject(new Error("IndexedDB no está disponible."));
        }
        return Promise.resolve([]);
      },
    });
    document.body.append(menu.element);

    await menu.refresh();
    expect(menu.element.textContent).toContain("IndexedDB no está disponible.");

    findButton(menu.element, "VOLVER A INTENTAR").click();
    await settle();
    expect(menu.element.textContent).toContain("SIN GUARDADOS");
    menu.dispose();
  });
});

function createMenu(
  initialSaves: readonly SaveEnvelopeV1[],
  overrides: Partial<ConstructorParameters<typeof SaveGameMenu>[0]> = {},
): SaveGameMenu {
  return new SaveGameMenu({
    listSaves: async () => initialSaves,
    onLoadSave: () => undefined,
    onCreateManualSave: () => undefined,
    onOverwriteSave: () => undefined,
    onDeleteSave: () => undefined,
    onBack: () => undefined,
    ...overrides,
  });
}

function makeSave(id: string, slot: SaveSlot): SaveEnvelopeV1 {
  return {
    format: "vibe-life-save",
    schemaVersion: 1,
    id,
    slot,
    createdAt: Date.UTC(2026, 6, 26, 15, 0),
    updatedAt: Date.UTC(2026, 6, 26, 16, 30),
    gameBuild: "test",
    source: { kind: "built-in", levelId: "demo-03-whiteout-flight" },
    metadata: {
      title: "Choque en Whiteout",
      levelTitle: "Demo 3 — Cielo blanco",
      playTimeSeconds: 3_690,
      difficulty: "Difícil",
      thumbnail: {
        mimeType: "image/webp",
        dataUrl: "data:image/webp;base64,UklGRg==",
        width: 320,
        height: 180,
      },
    },
    world: {
      levelId: "demo-03-whiteout-flight",
      simulationTimeSeconds: 10,
      globals: {},
      systems: {},
      entities: {},
      extensions: {},
    },
  };
}

function findButton(root: Element, label: string): HTMLButtonElement {
  const button = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error(`No se encontró el botón ${label}`);
  return button;
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
