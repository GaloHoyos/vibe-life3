import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import type { GameEventMap } from "@game/GameEvents";
import { Demo1Plaza } from "@game/levels/maps/campaign/Demo1Plaza";
import { TriggerSystem } from "@game/levels/TriggerSystem";
import { EntityIOSystem } from "@game/script/EntityIOSystem";
import { EntityEventBridge } from "@game/script/EntityEventBridge";
import { bindWorldEntities, type WorldEntityHooks } from "@game/script/WorldEntityBinder";
import { effectiveName } from "@game/script/EntityIOTypes";

/**
 * Wiring de punta a punta (trigger → puente → I/O → hooks de mundo) sobre los
 * datos reales del nuevo Demo 1: valida el combate del mercado, el arranque
 * guionado de la transmisión y la salida final migrados a entity I/O.
 */
function harness() {
  const bus = new EventBus<GameEventMap>();
  const io = new EntityIOSystem();
  const triggers = new TriggerSystem(bus);
  const level = Demo1Plaza;

  const calls = {
    dialogue: [] as string[],
    spawners: [] as string[],
    doorsOpened: [] as string[],
    objectives: [] as string[],
    endLevel: 0,
  };
  const hooks: WorldEntityHooks = {
    showDialogue: (text) => calls.dialogue.push(text),
    spawnNpcs: (_npcs, spawnerName) => {
      calls.spawners.push(spawnerName);
    },
    setDoorOpen: (doorId, open) => {
      if (open) calls.doorsOpened.push(doorId);
      bus.emit("door.opened", { id: doorId, open });
    },
    toggleDoor: () => {},
    runLevelAction: () => {},
    updateObjective: (text) => calls.objectives.push(text),
    activateSoundscape: () => {},
    playAmbientSound: () => {},
    stopAmbientSound: () => {},
    toggleAmbientSound: () => {},
    endLevel: () => {
      calls.endLevel += 1;
    },
    setTriggerEnabled: (id, enabled) => triggers.setEnabled(id, enabled),
    toggleTrigger: (id) => triggers.toggleEnabled(id),
    killPlayer: () => {},
    teleportPlayer: () => {},
  };

  bindWorldEntities(
    io,
    { logic: level.logicEntities ?? [], doors: level.doors, triggers: level.triggers },
    hooks,
  );
  level.triggers.forEach((t) => triggers.addTrigger(t));

  const triggerSources = new Map(level.triggers.map((t) => [t.id, { key: t.id, name: effectiveName(t) }]));
  const doorSources = new Map(level.doors.map((d) => [d.id, { key: d.id, name: effectiveName(d) }]));
  new EntityEventBridge(bus, io, {
    triggerSource: (id) => triggerSources.get(id) ?? null,
    doorSource: (id) => doorSources.get(id) ?? null,
    npcSource: () => null,
  });

  return { bus, calls, io, triggers };
}

describe("entity I/O wiring (Demo 1 — Frecuencia muerta)", () => {
  it("cruzar el mercado dispara la advertencia y el encuentro", () => {
    const { calls, triggers } = harness();
    // `d1-market-trigger` está centrado en [-35, 1.2, 101].
    triggers.update(new Vector3(-35, 1.2, 101), 0.016);

    expect(calls.dialogue).toContain(
      "Nos marcaron. Usá los puestos: cortales la línea de tiro y rodealos.",
    );
    expect(calls.spawners).toContain("d1-spawn-market");
  });

  it("abrir el transmisor inicia el broadcast y sus oleadas demoradas", () => {
    const { bus, calls, io } = harness();

    bus.emit("door.opened", { id: "d1-door-transmitter-switch", open: true });

    expect(calls.dialogue).toContain(
      "Portadora estable. Estoy enviando el código... noventa segundos. No dejen que corten la antena.",
    );
    expect(calls.spawners).not.toContain("d1-spawn-final-a");
    expect(calls.spawners).not.toContain("d1-spawn-final-b");

    io.update(1.49);
    expect(calls.spawners).not.toContain("d1-spawn-final-a");
    io.update(0.02);
    expect(calls.spawners).toContain("d1-spawn-final-a");
    expect(calls.spawners).not.toContain("d1-spawn-final-b");

    io.update(8.48);
    expect(calls.spawners).not.toContain("d1-spawn-final-b");
    io.update(0.02);
    expect(calls.spawners).toContain("d1-spawn-final-b");
  });

  it("el acceso oeste encadena el changelevel tras su demora", () => {
    const { calls, io, triggers } = harness();
    // Arranca deshabilitado hasta que termina la transmisión.
    triggers.setEnabled("d1-exit-trigger", true);
    triggers.update(new Vector3(-96, 1.2, 40), 0.016);

    expect(calls.endLevel).toBe(0);
    io.update(1.19);
    expect(calls.endLevel).toBe(0);
    io.update(0.02);
    expect(calls.endLevel).toBe(1);
  });
});
