import { describe, expect, it } from "vitest";
import type { SoundManager } from "@engine/audio/core/SoundManager";
import { AmbientSoundSystem } from "@game/audio/AmbientSoundSystem";
import {
  fakePositionalSounds,
  fakeSoundManager,
} from "@tests/support/fakes/audio";

const generator = {
  id: "gen",
  sound: "background.hl2.canals.generator",
  position: [4, 1, -8] as const,
};

function setup(available = [generator.sound]) {
  const sounds = fakeSoundManager(available) as unknown as SoundManager;
  const positional = fakePositionalSounds();
  return {
    positional,
    system: new AmbientSoundSystem(sounds, positional),
  };
}

describe("AmbientSoundSystem", () => {
  it("arranca las fuentes del nivel en su posicion", () => {
    const { positional, system } = setup();

    system.load([{ ...generator, position: [...generator.position] }]);

    expect(positional.attachedCalls).toHaveLength(1);
    expect(positional.attachedCalls[0]?.id).toBe(generator.sound);
    expect(positional.attachedCalls[0]?.options.loop).toBe(true);
    expect(system.positionOf("gen")?.toArray()).toEqual([4, 1, -8]);
  });

  it("respeta startDisabled hasta que la prendan por I/O", () => {
    const { positional, system } = setup();

    system.load([
      { ...generator, position: [...generator.position], startDisabled: true },
    ]);
    expect(positional.attachedCalls).toHaveLength(0);

    system.play("gen");
    expect(positional.attachedCalls).toHaveLength(1);
  });

  it("no vuelve a arrancar una fuente ya sonando", () => {
    const { positional, system } = setup();
    system.load([{ ...generator, position: [...generator.position] }]);

    system.play("gen");
    system.play("gen");

    expect(positional.attachedCalls).toHaveLength(1);
  });

  it("alterna entre encendida y apagada", () => {
    const { positional, system } = setup();
    system.load([{ ...generator, position: [...generator.position] }]);

    system.toggle("gen");
    expect(positional.stopped).toHaveLength(1);

    system.toggle("gen");
    expect(positional.attachedCalls).toHaveLength(2);
  });

  it("el radio define hasta donde se oye", () => {
    const { positional, system } = setup();

    system.load([
      { ...generator, position: [...generator.position], radius: 50 },
    ]);

    expect(positional.attachedCalls[0]?.options.maxDistance).toBe(50);
    expect(positional.attachedCalls[0]?.options.refDistance).toBeCloseTo(6);
  });

  it("ignora clips que no existen en el catalogo", () => {
    const { positional, system } = setup([]);

    system.load([{ ...generator, position: [...generator.position] }]);

    expect(positional.attachedCalls).toHaveLength(0);
    expect(system.positionOf("gen")).toBeNull();
  });

  it("clear frena todo y una carga nueva no arrastra lo anterior", () => {
    const { positional, system } = setup();
    system.load([{ ...generator, position: [...generator.position] }]);

    system.clear();
    expect(positional.stopped).toHaveLength(1);

    system.load([{ ...generator, position: [...generator.position] }]);
    expect(positional.attachedCalls).toHaveLength(2);
  });
});
