import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import type { GameEventMap } from "@game/GameEvents";
import { Sector1Arrival } from "@game/levels/maps/campaign/Sector1Arrival";
import { TriggerSystem } from "@game/levels/TriggerSystem";
import { EntityIOSystem } from "@game/script/EntityIOSystem";
import { EntityEventBridge } from "@game/script/EntityEventBridge";
import { bindWorldEntities, type WorldEntityHooks } from "@game/script/WorldEntityBinder";
import { effectiveName } from "@game/script/EntityIOTypes";

/**
 * Wiring de punta a punta (trigger → puente → I/O → hooks de mundo) sobre los
 * datos reales del Sector 1: valida que cruzar el volumen de la esclusa
 * encadena el mensaje, la apertura de la puerta y el objetivo migrados a I/O.
 */
function harness() {
  const bus = new EventBus<GameEventMap>();
  const io = new EntityIOSystem();
  const triggers = new TriggerSystem(bus);
  const level = Sector1Arrival;

  const calls = {
    dialogue: [] as string[],
    doorsOpened: [] as string[],
    objectives: [] as string[],
    endLevel: 0,
  };
  const hooks: WorldEntityHooks = {
    showDialogue: (text) => calls.dialogue.push(text),
    spawnNpcs: () => {},
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

describe("entity I/O wiring (Sector 1)", () => {
  it("cruzar la esclusa dispara mensaje + puerta + objetivo", () => {
    const { calls, io, triggers } = harness();
    // El trigger tr-gate-open está centrado en [0, 1.2, 8] con tamaño [40, 3, 4].
    triggers.update(new Vector3(0, 1.2, 8), 0.016);
    io.update(0.016);

    expect(calls.dialogue).toContain("Esclusa norte desbloqueada.");
    expect(calls.doorsOpened).toContain("gate-1");
    expect(calls.objectives).toContain("Cruzá la esclusa hacia la extracción");
  });

  it("el trigger de salida encadena el objetivo y el changelevel con su delay", () => {
    const { calls, io, triggers } = harness();
    // tr-exit en [0, 1.2, -23], tamaño [40, 3, 3]; changelevel tiene delay 1.2s.
    triggers.update(new Vector3(0, 1.2, -23), 0.016);
    io.update(0.016);

    expect(calls.objectives).toContain("Sector 1 asegurado");
    expect(calls.endLevel).toBe(0); // Todavía no venció el delay.

    io.update(1.3);
    expect(calls.endLevel).toBe(1);
  });
});
