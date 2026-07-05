import { describe, expect, it, vi } from "vitest";
import { Object3D, PositionalAudio } from "three";
import { PositionalSoundManager } from "@engine/audio/core/PositionalSoundManager";
import type { AudioSystem } from "@engine/audio/core/AudioSystem";
import type { SoundManager } from "@engine/audio/core/SoundManager";

function fakeParam() {
  return { value: 1, setTargetAtTime: vi.fn() };
}

function fakeNode() {
  return { connect: vi.fn(), disconnect: vi.fn(), gain: fakeParam() };
}

function fakeAudioContext() {
  return {
    currentTime: 0,
    destination: fakeNode(),
    listener: {},
    createGain: () => fakeNode(),
    createPanner: () => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      panningModel: "",
      refDistance: 0,
      maxDistance: 0,
      rolloffFactor: 0,
      coneInnerAngle: 0,
      coneOuterAngle: 0,
      coneOuterGain: 0,
    }),
    createBufferSource: vi.fn(() => ({
      buffer: null,
      loop: false,
      loopStart: 0,
      loopEnd: 0,
      onended: null,
      detune: fakeParam(),
      playbackRate: fakeParam(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    })),
  };
}

function setup() {
  const context = fakeAudioContext();
  const audioSystem = {
    getContext: () => context as unknown as AudioContext,
    unlock: vi.fn(),
    getBus: () => null,
  } as unknown as AudioSystem;

  const pendingBuffers: Array<(buffer: AudioBuffer | null) => void> = [];
  const sounds = {
    getBuffer: vi.fn(
      () =>
        new Promise<AudioBuffer | null>((resolve) => {
          pendingBuffers.push(resolve);
        }),
    ),
  } as unknown as SoundManager;

  const scene = new Object3D();
  const camera = new Object3D();
  const manager = new PositionalSoundManager(audioSystem, sounds, scene, camera);

  const flush = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  return { context, manager, pendingBuffers, flush };
}

function attachedAudios(object: Object3D): PositionalAudio[] {
  return object.children.filter(
    (child): child is PositionalAudio => child instanceof PositionalAudio,
  );
}

describe("PositionalSoundManager", () => {
  it("reproduce y frena un loop atachado cuando el buffer ya cargo", async () => {
    const { context, manager, pendingBuffers, flush } = setup();
    const object = new Object3D();

    manager.attachToObject("loop", object, { loop: true });
    pendingBuffers[0]({} as AudioBuffer);
    await flush();

    expect(context.createBufferSource).toHaveBeenCalledTimes(1);
    expect(attachedAudios(object)).toHaveLength(1);

    manager.stopAttached(object);
    expect(attachedAudios(object)).toHaveLength(0);
  });

  it("descarta un attach en vuelo si stopAttached llega antes que el buffer", async () => {
    const { context, manager, pendingBuffers, flush } = setup();
    const object = new Object3D();

    manager.attachToObject("loop", object, { loop: true });
    // El objeto se destruye (explosion) mientras el buffer sigue cargando: el
    // loop no debe arrancar nunca o quedaria sonando sin forma de frenarlo.
    manager.stopAttached(object);
    pendingBuffers[0]({} as AudioBuffer);
    await flush();

    expect(context.createBufferSource).not.toHaveBeenCalled();
    expect(attachedAudios(object)).toHaveLength(0);
  });

  it("descarta attaches en vuelo al hacer clear (recarga de nivel)", async () => {
    const { context, manager, pendingBuffers, flush } = setup();
    const object = new Object3D();

    manager.attachToObject("loop", object, { loop: true });
    manager.clear();
    pendingBuffers[0]({} as AudioBuffer);
    await flush();

    expect(context.createBufferSource).not.toHaveBeenCalled();
    expect(attachedAudios(object)).toHaveLength(0);
  });

  it("un attach posterior al stop sigue funcionando sobre el mismo objeto", async () => {
    const { context, manager, pendingBuffers, flush } = setup();
    const object = new Object3D();

    manager.attachToObject("loop", object, { loop: true });
    manager.stopAttached(object);
    manager.attachToObject("loop", object, { loop: true });
    pendingBuffers.forEach((resolve) => resolve({} as AudioBuffer));
    await flush();

    expect(context.createBufferSource).toHaveBeenCalledTimes(1);
    expect(attachedAudios(object)).toHaveLength(1);
  });
});
