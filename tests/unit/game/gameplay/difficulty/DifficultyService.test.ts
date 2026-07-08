import { beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "@engine/core/EventBus";
import type { GameEventMap } from "@game/GameEvents";
import { DifficultyService } from "@game/gameplay/difficulty/DifficultyService";
import { DifficultyTable } from "@game/config/difficulty.config";
import { recordEvents } from "@tests/support/events";
import { installMemoryStorage } from "@tests/support/fakes/storage";

const STORAGE_KEY = "vibe-life3:difficulty";

let storage: Storage;
beforeEach(() => {
  storage = installMemoryStorage("localStorage");
});

describe("DifficultyTable", () => {
  it("normal es la línea base (todos los mults = 1)", () => {
    expect(DifficultyTable.normal).toEqual({
      incomingPlayerDamageMult: 1,
      enemyHealthMult: 1,
      playerWeaponDamageMult: 1,
    });
  });

  it("fácil es más permisivo y difícil más severo que normal", () => {
    expect(DifficultyTable.facil.incomingPlayerDamageMult).toBeLessThan(1);
    expect(DifficultyTable.facil.enemyHealthMult).toBeLessThan(1);
    expect(DifficultyTable.dificil.incomingPlayerDamageMult).toBeGreaterThan(1);
    expect(DifficultyTable.dificil.enemyHealthMult).toBeGreaterThan(1);
  });

  it("los mults de vida enemiga dan 3 / 5 / 7 cohetes para un jefe base 500", () => {
    const rockets = (mult: number) => Math.round((500 * mult) / 100);
    expect(rockets(DifficultyTable.facil.enemyHealthMult)).toBe(3);
    expect(rockets(DifficultyTable.normal.enemyHealthMult)).toBe(5);
    expect(rockets(DifficultyTable.dificil.enemyHealthMult)).toBe(7);
  });
});

describe("DifficultyService", () => {
  it("arranca en normal sin nada persistido", () => {
    const service = new DifficultyService(new EventBus<GameEventMap>());
    expect(service.getLevel()).toBe("normal");
    expect(service.getModifiers()).toEqual(DifficultyTable.normal);
  });

  it("setLevel persiste y emite difficulty.changed", () => {
    const bus = new EventBus<GameEventMap>();
    const changed = recordEvents(bus, "difficulty.changed");
    const service = new DifficultyService(bus);

    service.setLevel("dificil");

    expect(service.getLevel()).toBe("dificil");
    expect(service.getModifiers()).toEqual(DifficultyTable.dificil);
    expect(storage.getItem(STORAGE_KEY)).toBe("dificil");
    expect(changed).toEqual([{ level: "dificil" }]);
  });

  it("no re-emite si el nivel no cambia", () => {
    const bus = new EventBus<GameEventMap>();
    const changed = recordEvents(bus, "difficulty.changed");
    const service = new DifficultyService(bus);
    service.setLevel("normal");
    expect(changed).toHaveLength(0);
  });

  it("hidrata el nivel persistido al construirse", () => {
    storage.setItem(STORAGE_KEY, "facil");
    const service = new DifficultyService(new EventBus<GameEventMap>());
    expect(service.getLevel()).toBe("facil");
  });

  it("cae a normal si el valor persistido es inválido", () => {
    storage.setItem(STORAGE_KEY, "imposible");
    const service = new DifficultyService(new EventBus<GameEventMap>());
    expect(service.getLevel()).toBe("normal");
  });
});
