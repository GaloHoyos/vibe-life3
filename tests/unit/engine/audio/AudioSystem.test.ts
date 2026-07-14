import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioSystem } from "@engine/audio/core/AudioSystem";
import { SoundManager } from "@engine/audio/core/SoundManager";

interface AudioHarness {
  readonly activation: { isActive: boolean; hasBeenActive: boolean };
  readonly contexts: FakeAudioContext[];
  readonly listeners: Map<string, EventListener[]>;
}

class FakeAudioContext {
  state: AudioContextState = "suspended";
  readonly currentTime = 0;
  readonly destination = fakeNode();
  readonly sampleRate = 48_000;
  readonly sources: Array<ReturnType<typeof fakeBufferSource>> = [];
  readonly resume = vi.fn(async () => {
    this.state = "running";
  });
  readonly suspend = vi.fn(async () => {
    this.state = "suspended";
  });
  readonly close = vi.fn(async () => {
    this.state = "closed";
  });
  readonly decodeAudioData = vi.fn(async () => ({} as AudioBuffer));

  createGain(): GainNode {
    return fakeGainNode() as unknown as GainNode;
  }

  createDynamicsCompressor(): DynamicsCompressorNode {
    return {
      ...fakeNode(),
      threshold: fakeParam(),
      knee: fakeParam(),
      ratio: fakeParam(),
      attack: fakeParam(),
      release: fakeParam(),
    } as unknown as DynamicsCompressorNode;
  }

  createDelay(): DelayNode {
    return {
      ...fakeNode(),
      delayTime: fakeParam(),
    } as unknown as DelayNode;
  }

  createConvolver(): ConvolverNode {
    return {
      ...fakeNode(),
      buffer: null,
    } as unknown as ConvolverNode;
  }

  createBiquadFilter(): BiquadFilterNode {
    return {
      ...fakeNode(),
      type: "lowpass",
      frequency: fakeParam(),
    } as unknown as BiquadFilterNode;
  }

  createBufferSource(): AudioBufferSourceNode {
    const source = fakeBufferSource();
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }
}

function fakeParam(): AudioParam {
  return {
    value: 0,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  } as unknown as AudioParam;
}

function fakeNode(): AudioNode {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as AudioNode;
}

function fakeGainNode(): GainNode {
  return {
    ...fakeNode(),
    gain: fakeParam(),
  } as unknown as GainNode;
}

function fakeBufferSource() {
  return {
    buffer: null as AudioBuffer | null,
    loop: false,
    detune: fakeParam(),
    playbackRate: fakeParam(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    addEventListener: vi.fn(),
  };
}

function installAudioHarness(): AudioHarness {
  const contexts: FakeAudioContext[] = [];
  const listeners = new Map<string, EventListener[]>();
  const activation = { isActive: false, hasBeenActive: false };

  class HarnessAudioContext extends FakeAudioContext {
    constructor() {
      super();
      contexts.push(this);
    }
  }

  const windowStub = {
    AudioContext: HarnessAudioContext,
    navigator: { userActivation: activation },
    localStorage: {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    },
    addEventListener: vi.fn(
      (eventName: string, listener: EventListenerOrEventListenerObject) => {
        if (typeof listener !== "function") {
          return;
        }
        const entries = listeners.get(eventName) ?? [];
        entries.push(listener);
        listeners.set(eventName, entries);
      },
    ),
    removeEventListener: vi.fn(
      (eventName: string, listener: EventListenerOrEventListenerObject) => {
        const entries = listeners.get(eventName) ?? [];
        listeners.set(
          eventName,
          entries.filter((entry) => entry !== listener),
        );
      },
    ),
  };

  vi.stubGlobal("window", windowStub);
  return { activation, contexts, listeners };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AudioSystem autoplay unlock", () => {
  it("no crea AudioContext durante bootstrap ni desde llamadas programaticas", () => {
    const { contexts } = installAudioHarness();
    const audio = new AudioSystem();

    expect(audio.getContext()).toBeNull();
    expect(audio.getBus("master")).toBeNull();
    audio.unlock();
    audio.resume();

    expect(contexts).toHaveLength(0);
  });

  it("crea y reanuda el contexto dentro de un gesto confiable", async () => {
    const { contexts, listeners } = installAudioHarness();
    const audio = new AudioSystem();
    const ready = audio.getContextWhenReady();

    const pointerListener = listeners.get("pointerdown")?.[0];
    expect(pointerListener).toBeDefined();
    pointerListener?.({ isTrusted: true } as Event);

    const context = await ready;
    expect(contexts).toHaveLength(1);
    expect(context).toBe(contexts[0]);
    expect(contexts[0]?.resume).toHaveBeenCalledTimes(1);
    expect(contexts[0]?.state).toBe("running");
    expect(listeners.get("pointerdown")).toHaveLength(0);
  });

  it("ignora eventos sinteticos pero permite unlock con activacion vigente", async () => {
    const { activation, contexts, listeners } = installAudioHarness();
    const audio = new AudioSystem();

    listeners.get("click")?.[0]?.({ isTrusted: false } as Event);
    expect(contexts).toHaveLength(0);

    activation.isActive = true;
    activation.hasBeenActive = true;
    audio.unlock();
    await Promise.resolve();

    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.resume).toHaveBeenCalledTimes(1);
  });

  it("conserva un loop pedido antes del gesto y lo inicia despues del unlock", async () => {
    const { contexts, listeners } = installAudioHarness();
    const fetchMock = vi.fn(async () => ({
      arrayBuffer: async () => new ArrayBuffer(1),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const audio = new AudioSystem();
    const sounds = new SoundManager(audio);

    sounds.playLoop("background.wind");
    await Promise.resolve();
    expect(contexts).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();

    listeners.get("click")?.[0]?.({ isTrusted: true } as Event);

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(contexts[0]?.sources).toHaveLength(1);
      expect(contexts[0]?.sources[0]?.start).toHaveBeenCalledTimes(1);
    });
    expect(contexts[0]?.sources[0]?.loop).toBe(true);
  });

  it("dispose limpia listeners, waiters y el contexto", async () => {
    const { activation, contexts, listeners } = installAudioHarness();
    const audio = new AudioSystem();
    const pendingContext = audio.getContextWhenReady();

    audio.dispose();

    await expect(pendingContext).resolves.toBeNull();
    expect(
      [...listeners.values()].every((entries) => entries.length === 0),
    ).toBe(true);

    activation.isActive = true;
    audio.unlock();
    expect(contexts).toHaveLength(0);

    const secondAudio = new AudioSystem();
    secondAudio.unlock();
    await Promise.resolve();
    expect(contexts).toHaveLength(1);

    secondAudio.dispose();
    await Promise.resolve();
    expect(contexts[0]?.close).toHaveBeenCalledTimes(1);
    expect(contexts[0]?.state).toBe("closed");
  });
});
