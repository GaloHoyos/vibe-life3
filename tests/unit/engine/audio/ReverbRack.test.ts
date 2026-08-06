import { describe, expect, it } from "vitest";
import { ReverbRack, type ReverbSpace } from "@engine/audio/dsp/ReverbRack";
import { signature } from "@engine/audio/dsp/ImpulseResponse";
import {
  FakeAudioContext,
  FakeConvolverNode,
  isConnected,
  nodesOfKind,
  pathExists,
  paramValue,
} from "@tests/support/fakes/webaudio";

const room: ReverbSpace = {
  duration: 1.2,
  decay: 2.4,
  diffusion: 0.8,
  toneHz: 7_000,
  preDelay: 0.02,
  echoDelay: 0.08,
  echoFeedback: 0.3,
  echoWet: 0.1,
  wet: 0.25,
};

function setup() {
  const context = new FakeAudioContext();
  const destination = context.createGain();
  const rack = new ReverbRack(context as unknown as AudioContext, destination);
  const convolvers = nodesOfKind(context, "convolver") as FakeConvolverNode[];
  return { context, destination, rack, convolvers };
}

describe("ReverbRack", () => {
  it("conecta ambos convolvers y el eco hasta la salida", () => {
    const { context, destination, rack, convolvers } = setup();

    expect(convolvers).toHaveLength(2);
    for (const convolver of convolvers) {
      expect(pathExists(convolver, destination)).toBe(true);
    }
    expect(pathExists(rack.getInput(), destination)).toBe(true);
    // El delay realimenta: hay un ciclo eco -> feedback -> eco.
    const delay = nodesOfKind(context, "delay").at(-1);
    expect(delay).toBeDefined();
    expect(pathExists(delay, delay)).toBe(true);
  });

  it("arranca en silencio hasta que le dan un espacio", () => {
    const { destination, context } = setup();
    const output = nodesOfKind(context, "gain").find((node) =>
      isConnected(node, destination),
    );

    expect(paramValue(output, "gain")).toBe(0);
  });

  it("aplica los parametros del espacio", () => {
    const { context, rack } = setup();

    rack.apply(room, 0);

    const tone = nodesOfKind(context, "biquad")[0];
    expect(paramValue(tone, "frequency")).toBeCloseTo(room.toneHz);
    const delays = nodesOfKind(context, "delay");
    expect(paramValue(delays[0], "delayTime")).toBeCloseTo(room.preDelay);
    expect(paramValue(delays[1], "delayTime")).toBeCloseTo(room.echoDelay);
  });

  it("carga la IR en un convolver y cruza al otro al cambiar de espacio", () => {
    const { context, rack, convolvers } = setup();

    rack.apply(room, 0);
    const first = convolvers.findIndex((node) => node.buffer !== null);
    expect(first).toBeGreaterThanOrEqual(0);

    // Cambio grande de sala: la IR nueva entra por el convolver libre y la
    // vieja se apaga cruzando, en vez de cortarse la cola de golpe.
    rack.apply({ ...room, duration: 2.8 }, 0.5);

    const second = first === 0 ? 1 : 0;
    expect(convolvers[second]?.buffer).not.toBeNull();
    expect(wetGainOf(context, convolvers[second])).toBeCloseTo(1);
    expect(wetGainOf(context, convolvers[first])).toBeCloseTo(0);
  });

  it("no reasigna el buffer si la IR no cambio de escalon", () => {
    const { rack, convolvers } = setup();

    rack.apply(room, 0);
    const assignments = convolvers.map((node) => node.bufferAssignments.length);

    // Mismo tamano de sala, solo se movio el wet: no hay motivo para
    // recompilar el kernel FFT del convolver.
    rack.apply({ ...room, wet: 0.4 }, 0);
    rack.apply({ ...room, wet: 0.1 }, 0);

    expect(convolvers.map((node) => node.bufferAssignments.length)).toEqual(
      assignments,
    );
  });

  it("la firma redondea para que un barrido continuo no genere una IR por frame", () => {
    expect(signature({ duration: 1.21, decay: 2.4 })).toBe(
      signature({ duration: 1.23, decay: 2.42 }),
    );
    expect(signature({ duration: 1.2, decay: 2.4 })).not.toBe(
      signature({ duration: 2.8, decay: 2.4 })

    );
  });

  it("dispose desconecta la salida", () => {
    const { destination, rack } = setup();
    rack.apply(room, 0);

    rack.dispose();

    expect(isConnected(rack.getInput(), destination)).toBe(false);
  });
});

/** Gain de mezcla que cuelga de un convolver del par A/B. */
function wetGainOf(
  context: FakeAudioContext,
  convolver: FakeConvolverNode | undefined,
): number {
  const wet = nodesOfKind(context, "gain").find(
    (node) => convolver !== undefined && isConnected(convolver, node),
  );
  return paramValue(wet, "gain");
}
