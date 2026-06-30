import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import type { GameEventMap } from "@game/GameEvents";
import { recordEvents } from "@tests/support/events";
import type { TriggerAction, TriggerDefinition } from "@game/levels/LevelDefinition";
import { TriggerSystem } from "@game/levels/TriggerSystem";

const action: TriggerAction = {
  kind: "dialogue",
  text: "test",
  duration: 1,
};

function setup() {
  const bus = new EventBus<GameEventMap>();
  return {
    system: new TriggerSystem(bus),
    entered: recordEvents(bus, "trigger.entered"),
    actions: recordEvents(bus, "trigger.action"),
  };
}

function trigger(overrides: Partial<TriggerDefinition> = {}): TriggerDefinition {
  return {
    id: "t1",
    position: [0, 0, 0],
    size: [2, 2, 2],
    once: false,
    actions: [action],
    ...overrides,
  };
}

describe("TriggerSystem", () => {
  it("dispara solo en el flanco de entrada", () => {
    const { system, entered, actions } = setup();
    system.addTrigger(trigger());

    system.update(new Vector3(0, 0, 0), 0.016);
    system.update(new Vector3(0, 0, 0), 0.016);
    system.update(new Vector3(10, 0, 0), 0.016);
    system.update(new Vector3(0, 0, 0), 0.016);

    expect(entered).toHaveLength(2);
    expect(actions).toHaveLength(2);
  });

  it("desactiva triggers once despues del primer disparo", () => {
    const { system, entered, actions } = setup();
    system.addTrigger(trigger({ once: true }));

    system.update(new Vector3(0, 0, 0), 0.016);
    system.update(new Vector3(10, 0, 0), 0.016);
    system.update(new Vector3(0, 0, 0), 0.016);

    expect(entered).toHaveLength(1);
    expect(actions).toHaveLength(1);
  });

  it("respeta acciones demoradas", () => {
    const { system, actions } = setup();
    system.addTrigger(trigger({
      actions: [
        action,
        { ...action, text: "delayed", delay: 0.5 },
      ],
    }));

    system.update(new Vector3(0, 0, 0), 0.1);
    expect(actions.map((event) => event.action)).toEqual([action]);

    system.update(new Vector3(10, 0, 0), 0.3);
    expect(actions).toHaveLength(1);

    system.update(new Vector3(10, 0, 0), 0.2);
    expect(actions).toHaveLength(2);
    expect(actions[1].action).toMatchObject({ text: "delayed" });
  });

  it("clear elimina triggers y acciones pendientes", () => {
    const { system, actions } = setup();
    system.addTrigger(trigger({ actions: [{ ...action, delay: 0.25 }] }));

    system.update(new Vector3(0, 0, 0), 0.016);
    system.clear();
    system.update(new Vector3(0, 0, 0), 1);

    expect(actions).toHaveLength(0);
  });

  it("evalua triggers rotados en espacio local", () => {
    const { system, actions } = setup();
    system.addTrigger(trigger({
      size: [4, 2, 1],
      rotation: [0, Math.PI / 2, 0],
    }));

    system.update(new Vector3(1.5, 0, 0), 0.016);
    expect(actions).toHaveLength(0);

    system.update(new Vector3(0, 0, 1.5), 0.016);
    expect(actions).toHaveLength(1);
  });
});
