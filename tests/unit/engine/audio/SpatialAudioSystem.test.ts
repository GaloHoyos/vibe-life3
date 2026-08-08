import { describe, expect, it, vi } from "vitest";
import { Object3D, Vector3 } from "three";
import { AudioBus } from "@engine/audio/core/AudioBus";
import type { AudioSystem } from "@engine/audio/core/AudioSystem";
import type { SoundManager } from "@engine/audio/core/SoundManager";
import { SpatialAudioSystem } from "@engine/audio/spatial/SpatialAudioSystem";
import type { RaycastHit, RaycastSource } from "@engine/physics/Raycast";
import {
  FakeAudioContext,
  isConnected,
  nodesOfKind,
  paramValue,
} from "@tests/support/fakes/webaudio";

function setup() {
  const context = new FakeAudioContext();
  const audioContext = context as unknown as AudioContext;
  const bus = new AudioBus("weapons", audioContext);

  const audioSystem = {
    getContext: vi.fn(() => audioContext),
    getBus: vi.fn(() => bus),
    unlock: vi.fn(),
  } as unknown as AudioSystem;

  const pendingBuffers: Array<(buffer: AudioBuffer | null) => void> = [];
  const sounds = {
    getClip: vi.fn((id: string) => ({
      id,
      path: `${id}.wav`,
      source: `${id}.wav`,
      loop: false,
      bus: "weapons" as const,
      role: "impact" as const,
    })),
    getBuffer: vi.fn(
      () =>
        new Promise<AudioBuffer | null>((resolve) => {
          pendingBuffers.push(resolve);
        }),
    ),
  } as unknown as SoundManager;

  const camera = new Object3D();
  const spatial = new SpatialAudioSystem(audioSystem, sounds, camera);

  const flush = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const resolveBuffers = () => {
    pendingBuffers.splice(0).forEach((resolve) => resolve({} as AudioBuffer));
  };

  return { audioSystem, bus, camera, context, flush, resolveBuffers, spatial };
}

/** Raycast que bloquea (o no) todo lo que se le cruce. */
function fakeRaycast(blocked: boolean): RaycastSource & { calls: number } {
  const raycast = {
    calls: 0,
    cast(): RaycastHit | null {
      raycast.calls += 1;
      return blocked
        ? ({ point: new Vector3(), toi: 1 } as unknown as RaycastHit)
        : null;
    },
  };
  return raycast;
}

describe("SpatialAudioSystem", () => {
  it("no toca Web Audio durante el bootstrap", () => {
    const { audioSystem } = setup();
    expect(audioSystem.getContext).not.toHaveBeenCalled();
  });

  it("arma la cadena seca y el envio humedo del bus", async () => {
    const { bus, context, flush, resolveBuffers, spatial } = setup();

    spatial.playAt("disparo", new Vector3(1, 0, -2));
    resolveBuffers();
    await flush();

    const source = context.sources[0];
    const panner = nodesOfKind(context, "panner")[0];
    const filters = nodesOfKind(context, "biquad");
    expect(source).toBeDefined();
    expect(panner).toBeDefined();
    // Dos lowpass: uno de oclusion (antes del split) y uno de obstruccion.
    expect(filters).toHaveLength(2);
    expect(source?.start).toHaveBeenCalledTimes(1);

    // El seco pasa por el panner; el humedo sale antes y va al aux del bus.
    const dry = nodesOfKind(context, "gain").find((node) =>
      isConnected(node, bus.gain),
    );
    const wet = nodesOfKind(context, "gain").find((node) =>
      isConnected(node, bus.auxGain),
    );
    expect(dry).toBeDefined();
    expect(wet).toBeDefined();
    expect(isConnected(panner, dry)).toBe(true);
    expect(isConnected(filters[0], wet)).toBe(true);
  });

  it("posiciona la voz donde se la pidio", async () => {
    const { context, flush, resolveBuffers, spatial } = setup();

    spatial.playAt("disparo", new Vector3(3, 1, -4));
    resolveBuffers();
    await flush();

    const panner = nodesOfKind(context, "panner")[0];
    expect(paramValue(panner, "positionX")).toBeCloseTo(3);
    expect(paramValue(panner, "positionY")).toBeCloseTo(1);
    expect(paramValue(panner, "positionZ")).toBeCloseTo(-4);
  });

  it("un volumen no finito no llega al AudioParam", async () => {
    const { context, flush, resolveBuffers, spatial } = setup();
    const object = new Object3D();
    const handle = spatial.attachControllable("arrastre", object, { volume: 0.5 });
    resolveBuffers();
    await flush();

    const gains = nodesOfKind(context, "gain");
    const before = gains.map((node) => paramValue(node, "gain"));

    // Un NaN de un sistema de gameplay tira TypeError en Firefox y deja el
    // parámetro envenenado en Chrome: la voz quedaría muda para siempre.
    expect(() => handle.setVolume(Number.NaN)).not.toThrow();
    expect(() => handle.setPlaybackRate(Number.NaN)).not.toThrow();

    expect(gains.map((node) => paramValue(node, "gain"))).toEqual(before);
    for (const value of gains.map((node) => paramValue(node, "gain"))) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("clear frena tambien las voces sin objeto", async () => {
    const { context, flush, resolveBuffers, spatial } = setup();

    spatial.playAt("disparo", new Vector3());
    spatial.attachToObject("motor", new Object3D(), { loop: true });
    resolveBuffers();
    await flush();
    expect(context.sources).toHaveLength(2);

    spatial.clear();

    // Antes, `clear` solo recorria los sonidos atachados y las voces de
    // `playAt` sobrevivian a la recarga de nivel.
    for (const source of context.sources) {
      expect(source.stop).toHaveBeenCalled();
    }
  });

  it("descarta un attach en vuelo si stopAttached llega antes que el buffer", async () => {
    const { context, flush, resolveBuffers, spatial } = setup();
    const object = new Object3D();

    spatial.attachToObject("motor", object, { loop: true });
    // El objeto se destruye (explosion) mientras el buffer sigue cargando.
    spatial.stopAttached(object);
    resolveBuffers();
    await flush();

    expect(context.sources).toHaveLength(0);
  });

  it("descarta attaches en vuelo al hacer clear", async () => {
    const { context, flush, resolveBuffers, spatial } = setup();

    spatial.attachToObject("motor", new Object3D(), { loop: true });
    spatial.clear();
    resolveBuffers();
    await flush();

    expect(context.sources).toHaveLength(0);
  });

  it("un attach posterior al stop sigue funcionando sobre el mismo objeto", async () => {
    const { context, flush, resolveBuffers, spatial } = setup();
    const object = new Object3D();

    spatial.attachToObject("motor", object, { loop: true });
    spatial.stopAttached(object);
    spatial.attachToObject("motor", object, { loop: true });
    resolveBuffers();
    await flush();

    expect(context.sources).toHaveLength(1);
  });

  it("mueve el listener con la camara sin depender del renderer", async () => {
    const { camera, context, spatial } = setup();

    camera.position.set(5, 2, -1);
    spatial.update();

    expect(context.listener.positionX.value).toBeCloseTo(5);
    expect(context.listener.positionY.value).toBeCloseTo(2);
    expect(context.listener.positionZ.value).toBeCloseTo(-1);
    // Mira hacia -Z sin rotacion.
    expect(context.listener.forwardZ.value).toBeCloseTo(-1);
  });

  it("con linea de vista libre no filtra nada", async () => {
    const { context, flush, resolveBuffers, spatial } = setup();
    const raycast = fakeRaycast(false);
    spatial.setRaycast(raycast);

    spatial.playAt("disparo", new Vector3(0, 0, -3), { maxDistance: 40 });
    resolveBuffers();
    await flush();
    spatial.update();

    // Camino libre: un solo rayo, sin los laterales.
    expect(raycast.calls).toBe(1);
    const filters = nodesOfKind(context, "biquad");
    expect(paramValue(filters[0], "frequency")).toBeCloseTo(20_000);
    expect(paramValue(filters[1], "frequency")).toBeCloseTo(20_000);
  });

  it("detras de una pared filtra el directo y apaga el envio", async () => {
    const { bus, context, flush, resolveBuffers, spatial } = setup();
    spatial.setRaycast(fakeRaycast(true));
    spatial.setWetResolver(() => 1);

    spatial.playAt("disparo", new Vector3(0, 0, -3), { maxDistance: 40 });
    resolveBuffers();
    await flush();
    spatial.update();

    const filters = nodesOfKind(context, "biquad");
    // Oclusion total: el filtro comun y el del directo bajan a su tope.
    expect(paramValue(filters[0], "frequency")).toBeLessThan(600);
    expect(paramValue(filters[1], "frequency")).toBeLessThan(2_000);

    const wet = nodesOfKind(context, "gain").find((node) =>
      isConnected(node, bus.auxGain),
    );
    expect(paramValue(wet, "gain")).toBeLessThan(0.4);
  });

  it("no gasta rayos en fuentes fuera de alcance", async () => {
    const { flush, resolveBuffers, spatial } = setup();
    const raycast = fakeRaycast(true);
    spatial.setRaycast(raycast);

    spatial.playAt("disparo", new Vector3(0, 0, -500), { maxDistance: 20 });
    resolveBuffers();
    await flush();
    spatial.update();

    expect(raycast.calls).toBe(0);
  });
});
