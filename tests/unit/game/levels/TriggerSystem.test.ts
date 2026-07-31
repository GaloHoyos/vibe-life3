import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import type { GameEventMap } from "@game/GameEvents";
import { recordEvents } from "@tests/support/events";
import type { TriggerDefinition } from "@game/levels/LevelDefinition";
import { TriggerSystem } from "@game/levels/TriggerSystem";

function setup() {
  const bus = new EventBus<GameEventMap>();
  return {
    system: new TriggerSystem(bus),
    entered: recordEvents(bus, "trigger.entered"),
    exited: recordEvents(bus, "trigger.exited"),
  };
}

function trigger(overrides: Partial<TriggerDefinition> = {}): TriggerDefinition {
  return {
    id: "t1",
    position: [0, 0, 0],
    size: [2, 2, 2],
    once: false,
    ...overrides,
  };
}

describe("TriggerSystem", () => {
  it("emite entered/exited solo en los flancos", () => {
    const { system, entered, exited } = setup();
    system.addTrigger(trigger());

    system.update(new Vector3(0, 0, 0), 0.016);
    system.update(new Vector3(0, 0, 0), 0.016);
    system.update(new Vector3(10, 0, 0), 0.016);
    system.update(new Vector3(0, 0, 0), 0.016);

    expect(entered).toHaveLength(2);
    expect(exited).toHaveLength(1);
  });

  it("desactiva triggers once despues del primer entered", () => {
    const { system, entered, exited } = setup();
    system.addTrigger(trigger({ once: true }));

    system.update(new Vector3(0, 0, 0), 0.016);
    system.update(new Vector3(10, 0, 0), 0.016);
    system.update(new Vector3(0, 0, 0), 0.016);

    expect(entered).toHaveLength(1);
    // Un trigger once no vuelve a emitir entered ni exited espurio.
    expect(exited).toHaveLength(0);
  });

  it("no emite si arranca deshabilitado hasta habilitarlo", () => {
    const { system, entered } = setup();
    system.addTrigger(trigger({ startDisabled: true }));

    system.update(new Vector3(0, 0, 0), 0.016);
    expect(entered).toHaveLength(0);

    system.setEnabled("t1", true);
    system.update(new Vector3(0, 0, 0), 0.016);
    expect(entered).toHaveLength(1);
  });

  it("Toggle alterna el estado y reevalúa al jugador que ya está adentro", () => {
    const { system, entered } = setup();
    system.addTrigger(trigger());
    system.toggleEnabled("t1");
    expect(system.isEnabled("t1")).toBe(false);

    system.update(new Vector3(0, 0, 0), 0.016);
    expect(entered).toHaveLength(0);

    system.toggleEnabled("t1");
    expect(system.isEnabled("t1")).toBe(true);
    system.update(new Vector3(0, 0, 0), 0.016);
    expect(entered).toHaveLength(1);
  });

  it("Disable mientras toca emite exited una sola vez antes de quedar inactivo", () => {
    const { system, entered, exited } = setup();
    system.addTrigger(trigger());

    system.update(new Vector3(0, 0, 0), 0.016);
    expect(entered).toHaveLength(1);

    system.setEnabled("t1", false);
    expect(exited).toHaveLength(1);

    system.setEnabled("t1", false);
    system.update(new Vector3(10, 0, 0), 0.016);
    system.update(new Vector3(0, 0, 0), 0.016);
    expect(exited).toHaveLength(1);
    expect(entered).toHaveLength(1);
  });

  it("Disable fuera del volumen no inventa un exited", () => {
    const { system, exited } = setup();
    system.addTrigger(trigger());

    system.setEnabled("t1", false);
    system.update(new Vector3(10, 0, 0), 0.016);

    expect(exited).toHaveLength(0);
  });

  it("un Disable reentrante desde entered cierra exactamente el mismo touch", () => {
    const bus = new EventBus<GameEventMap>();
    const system = new TriggerSystem(bus);
    const entered = recordEvents(bus, "trigger.entered");
    const exited = recordEvents(bus, "trigger.exited");
    bus.on("trigger.entered", ({ id }) => system.setEnabled(id, false));
    system.addTrigger(trigger());

    system.update(new Vector3(0, 0, 0), 0.016);
    system.update(new Vector3(10, 0, 0), 0.016);

    expect(entered).toHaveLength(1);
    expect(exited).toHaveLength(1);
    expect(system.isEnabled("t1")).toBe(false);
  });

  it("un trigger_once consumido no revive por Enable", () => {
    const { system, entered } = setup();
    system.addTrigger(trigger({ once: true }));
    system.update(new Vector3(0, 0, 0), 0.016);

    system.setEnabled("t1", true);
    system.update(new Vector3(10, 0, 0), 0.016);
    system.update(new Vector3(0, 0, 0), 0.016);

    expect(entered).toHaveLength(1);
  });

  it("trigger_multiple respeta wait antes de aceptar otra entrada", () => {
    const { system, entered, exited } = setup();
    system.addTrigger(trigger({ wait: 1 }));

    system.update(new Vector3(0, 0, 0), 0.1);
    system.update(new Vector3(10, 0, 0), 0.1);
    system.update(new Vector3(0, 0, 0), 0.1);
    system.update(new Vector3(10, 0, 0), 0.1);
    expect(entered).toHaveLength(1);
    expect(exited).toHaveLength(1);

    system.update(new Vector3(10, 0, 0), 0.7);
    system.update(new Vector3(0, 0, 0), 0.1);
    expect(entered).toHaveLength(2);
  });

  it("acepta al vencer wait una reentrada pendiente que permanece adentro", () => {
    const { system, entered, exited } = setup();
    system.addTrigger(trigger({ wait: 1 }));

    system.update(new Vector3(0, 0, 0), 0);
    system.update(new Vector3(10, 0, 0), 0.1);
    system.update(new Vector3(0, 0, 0), 0.1);
    expect(entered).toHaveLength(1);
    expect(exited).toHaveLength(1);

    system.update(new Vector3(0, 0, 0), 0.7);
    expect(entered).toHaveLength(1);

    system.update(new Vector3(0, 0, 0), 0.2);
    expect(entered).toHaveLength(2);
    expect(exited).toHaveLength(1);
  });

  it("una entrada rechazada por wait no produce EndTouch huérfano", () => {
    const { system, entered, exited } = setup();
    system.addTrigger(trigger({ wait: 1 }));

    system.update(new Vector3(0, 0, 0), 0);
    system.update(new Vector3(10, 0, 0), 0.1);
    system.update(new Vector3(0, 0, 0), 0.1);
    system.update(new Vector3(10, 0, 0), 0.1);

    expect(entered).toHaveLength(1);
    expect(exited).toHaveLength(1);
  });

  it("clear elimina los triggers", () => {
    const { system, entered } = setup();
    system.addTrigger(trigger());

    system.clear();
    system.update(new Vector3(0, 0, 0), 0.016);
    expect(entered).toHaveLength(0);
  });

  it("evalua triggers rotados en espacio local", () => {
    const { system, entered } = setup();
    system.addTrigger(trigger({
      size: [4, 2, 1],
      rotation: [0, Math.PI / 2, 0],
    }));

    system.update(new Vector3(1.5, 0, 0), 0.016);
    expect(entered).toHaveLength(0);

    system.update(new Vector3(0, 0, 1.5), 0.016);
    expect(entered).toHaveLength(1);
  });

  it("restaura consumo, touch y cooldown sin repetir outputs", () => {
    const source = setup();
    source.system.addTrigger(trigger({ wait: 2 }));
    source.system.update(new Vector3(0, 0, 0), 0.25);
    const snapshot = source.system.captureSaveState();

    const restored = setup();
    restored.system.addTrigger(trigger({ wait: 2 }));
    restored.system.restoreSaveState(snapshot);
    restored.system.update(new Vector3(0, 0, 0), 0.5);

    expect(restored.entered).toHaveLength(0);
    expect(restored.exited).toHaveLength(0);
    expect(restored.system.captureTriggerSaveState("t1")).toMatchObject({
      enabled: true,
      inside: true,
      touching: true,
      cooldownRemaining: 1.5,
    });
  });
});
