import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioSystem } from "@engine/audio/core/AudioSystem";
import { SoundManager } from "@engine/audio/core/SoundManager";
import {
  installWebAudioHarness,
  isConnected,
  nodesOfKind,
  pathExists,
  paramValue,
} from "@tests/support/fakes/webaudio";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AudioSystem autoplay unlock", () => {
  it("no crea AudioContext durante bootstrap ni desde llamadas programaticas", () => {
    const { contexts } = installWebAudioHarness();
    const audio = new AudioSystem();

    expect(audio.getContext()).toBeNull();
    expect(audio.getBus("master")).toBeNull();
    audio.unlock();
    audio.resume();

    expect(contexts).toHaveLength(0);
  });

  it("crea y reanuda el contexto dentro de un gesto confiable", async () => {
    const { contexts, listeners } = installWebAudioHarness();
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
    const { activation, contexts, listeners } = installWebAudioHarness();
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
    const { contexts, gesture } = installWebAudioHarness();
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

    gesture("click");

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(contexts[0]?.sources).toHaveLength(1);
      expect(contexts[0]?.sources[0]?.start).toHaveBeenCalledTimes(1);
    });
    expect(contexts[0]?.sources[0]?.loop).toBe(true);
  });

  it("dispose limpia listeners, waiters y el contexto", async () => {
    const { activation, contexts, listeners } = installWebAudioHarness();
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

describe("AudioSystem mixer", () => {
  function unlockedSystem() {
    const harness = installWebAudioHarness();
    const audio = new AudioSystem();
    harness.gesture();
    const context = harness.contexts[0];
    if (!context) {
      throw new Error("El gesto no creó el contexto");
    }
    return { audio, context, harness };
  }

  it("agrupa las hojas del mundo bajo sfx y sfx bajo master", () => {
    const { audio, context } = unlockedSystem();

    const master = audio.getBus("master");
    const sfx = audio.getBus("sfx");
    const weapons = audio.getBus("weapons");

    const limiter = nodesOfKind(context, "compressor")[0];
    expect(limiter).toBeDefined();
    expect(isConnected(weapons?.gain, sfx?.gain)).toBe(true);
    expect(isConnected(sfx?.gain, master?.gain)).toBe(true);
    expect(isConnected(master?.gain, limiter)).toBe(true);
    expect(isConnected(limiter, context.destination)).toBe(true);
    // La musica cuelga del master, no de sfx: bajar "efectos" no la toca.
    expect(isConnected(audio.getBus("music")?.gain, master?.gain)).toBe(true);
    expect(pathExists(weapons?.gain, context.destination)).toBe(true);
  });

  it("el camino aux replica el arbol de faders", () => {
    const { audio } = unlockedSystem();

    expect(
      isConnected(audio.getBus("weapons")?.auxGain, audio.getBus("sfx")?.auxGain),
    ).toBe(true);
    expect(
      isConnected(audio.getBus("sfx")?.auxGain, audio.getBus("master")?.auxGain),
    ).toBe(true);
  });

  it("aplica la curva perceptual y persiste la posicion del fader", () => {
    const { audio, harness } = unlockedSystem();

    audio.setVolume("music", 0.5);

    // Se guarda la posicion (0.5), suena a la ganancia de la curva (0.25).
    expect(paramValue(audio.getBus("music")?.gain, "gain")).toBeCloseTo(0.25);
    expect(audio.getVolume("music")).toBeCloseTo(0.5);
    const saved = harness.storage.get("hl3.audio.mix.v2");
    expect(JSON.parse(saved ?? "{}")).toMatchObject({ music: 0.5 });
  });

  it("el aux sigue al fader (si no, bajar el bus no bajaria su reverb)", () => {
    const { audio } = unlockedSystem();

    audio.setVolume("weapons", 0.5);

    const weapons = audio.getBus("weapons");
    expect(paramValue(weapons?.auxGain, "gain")).toBeCloseTo(
      paramValue(weapons?.gain, "gain"),
    );
  });

  it("el ducking atenua sin pisar el volumen del usuario", () => {
    const { audio } = unlockedSystem();
    audio.setVolume("ambience", 1);

    audio.duck(["ambience"], 0.5, 0);
    expect(paramValue(audio.getBus("ambience")?.gain, "gain")).toBeCloseTo(0.5);
    expect(paramValue(audio.getBus("ambience")?.auxGain, "gain")).toBeCloseTo(0.5);

    audio.unduck(["ambience"], 0);
    expect(paramValue(audio.getBus("ambience")?.gain, "gain")).toBeCloseTo(1);
    expect(audio.getVolume("ambience")).toBeCloseTo(1);
  });

  it("carga los volumenes guardados al construir", () => {
    installWebAudioHarness({
      "hl3.audio.mix.v2": JSON.stringify({ weapons: 0.3 }),
    });
    const audio = new AudioSystem();

    expect(audio.getVolume("weapons")).toBeCloseTo(0.3);
  });

  it("migra el esquema viejo de ganancia lineal a posicion de fader", () => {
    const harness = installWebAudioHarness({
      "hl3.audio.volumes": JSON.stringify({ master: 0.64, dialogue: 0.81 }),
    });
    const audio = new AudioSystem();

    // El jugador conserva su volumen: sqrt revierte la curva nueva.
    expect(audio.getVolume("master")).toBeCloseTo(0.8);
    // `dialogue` se fusiono con la voz del traje HEV.
    expect(audio.getVolume("voice")).toBeCloseTo(0.9);
    expect(harness.storage.has("hl3.audio.volumes")).toBe(false);
    expect(harness.storage.has("hl3.audio.mix.v2")).toBe(true);
  });
});
