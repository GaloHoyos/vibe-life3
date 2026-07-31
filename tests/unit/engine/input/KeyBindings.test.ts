import { describe, expect, it } from "vitest";
import type { Input } from "@engine/input/Input";
import { KeyBindings } from "@engine/input/KeyBindings";

type Action = "jump" | "crouch" | "handbrake" | "horn";

const defaults = {
  jump: ["Space"],
  crouch: ["ControlLeft"],
  handbrake: ["Space"],
  horn: ["KeyH"],
} as const;

const contexts = { handbrake: "vehicle", horn: "vehicle" } as const;

describe("KeyBindings", () => {
  it("expulsa la tecla de otra acción del mismo contexto", () => {
    const bindings = build();

    bindings.setBinding("crouch", ["Space"]);

    expect(bindings.getCodes("jump")).toEqual([]);
    expect(bindings.getCodes("crouch")).toEqual(["Space"]);
  });

  it("deja compartir tecla entre contextos distintos", () => {
    // Saltar y el freno de mano comparten Espacio: nunca se está a pie y
    // conduciendo a la vez, así que rebindear uno no puede desarmar al otro.
    const bindings = build();

    expect(bindings.getCodes("jump")).toEqual(["Space"]);
    expect(bindings.getCodes("handbrake")).toEqual(["Space"]);

    bindings.setBinding("jump", ["Space"]);

    expect(bindings.getCodes("handbrake")).toEqual(["Space"]);
  });

  it("sigue expulsando dentro del contexto de vehículo", () => {
    const bindings = build();

    bindings.setBinding("horn", ["Space"]);

    expect(bindings.getCodes("handbrake")).toEqual([]);
    expect(bindings.getCodes("jump")).toEqual(["Space"]);
  });

  it("avisa del cambio a la acción expulsada", () => {
    const bindings = build();
    const changed: Action[] = [];
    bindings.onChange((action) => changed.push(action));

    bindings.setBinding("crouch", ["Space"]);

    expect(changed).toContain("jump");
    expect(changed).toContain("crouch");
  });
});

function build(): KeyBindings<Action> {
  const input = { isKeyDown: () => false, wasKeyPressed: () => false } as unknown as Input;
  return new KeyBindings<Action>(input, { ...defaults }, { ...contexts });
}
