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
 * datos reales del Nivel demo 1: valida que cruzar los volúmenes encadena
 * mensajes, spawners y el changelevel migrados a entity I/O.
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

  return { calls, io, triggers };
}

describe("entity I/O wiring (Demo 1 — Plaza)", () => {
  it("cruzar el patio dispara el mensaje de emboscada y la primera oleada", () => {
    const { calls, io, triggers } = harness();
    // El trigger `ambush-trigger` está centrado en [0, 1.2, 14] con tamaño [46, 3, 3].
    triggers.update(new Vector3(0, 1.2, 14), 0.016);
    io.update(0.016);

    expect(calls.dialogue).toContain("¡Emboscada! Combine entrando al patio.");
    expect(calls.spawners).toContain("spawn-wave1");
    // Las oleadas 2 y 3 tienen delay: todavía no dispararon.
    expect(calls.spawners).not.toContain("spawn-wave2");

    io.update(4.1);
    expect(calls.spawners).toContain("spawn-wave2");
  });

  it("el trigger de salida encadena el changelevel con su delay", () => {
    const { calls, io, triggers } = harness();
    // `exit-trigger` arranca deshabilitado (se habilita al despejar el patio).
    triggers.setEnabled("exit-trigger", true);
    // Centrado en [0, 1.2, -100], tamaño [88, 3, 3]; el changelevel tiene delay 1s.
    triggers.update(new Vector3(0, 1.2, -100), 0.016);
    io.update(0.016);
    expect(calls.endLevel).toBe(0); // Todavía no venció el delay.

    io.update(1.1);
    expect(calls.endLevel).toBe(1);
  });
});
