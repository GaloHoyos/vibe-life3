import { vi } from "vitest";

/**
 * Fake de Web Audio orientado a **topología**: registra cómo quedan conectados
 * los nodos y qué automatizaciones recibió cada `AudioParam`. Permite afirmar
 * "el send de esta voz llega al aux del bus correcto" sin un motor de audio
 * real, que ni happy-dom ni node proveen.
 *
 * Los factories devuelven los tipos de Web Audio por conveniencia del código
 * bajo test; en runtime el objeto sigue siendo el fake, así que los helpers de
 * abajo lo recuperan con `instanceof`.
 */

export type FakeNodeKind =
  | "gain"
  | "compressor"
  | "delay"
  | "convolver"
  | "biquad"
  | "bufferSource"
  | "panner"
  | "destination";

export type ParamMethod =
  | "value"
  | "setValueAtTime"
  | "linearRampToValueAtTime"
  | "exponentialRampToValueAtTime"
  | "setTargetAtTime"
  | "cancelScheduledValues";

export interface ParamCall {
  readonly param: string;
  readonly method: ParamMethod;
  readonly value: number;
  readonly time: number;
  readonly timeConstant?: number;
}

/**
 * `value` refleja siempre el destino de la última automatización (no el valor
 * interpolado en `currentTime`). Es una simplificación deliberada: los tests
 * quieren afirmar "a dónde va" el parámetro, no simular la rampa.
 */
export class FakeAudioParam {
  readonly calls: ParamCall[] = [];
  private current: number;

  constructor(
    readonly name: string,
    private readonly clock: () => number,
    initial = 0,
  ) {
    this.current = initial;
  }

  get value(): number {
    return this.current;
  }

  set value(next: number) {
    this.current = next;
    this.record("value", next);
  }

  setValueAtTime(value: number, time: number): FakeAudioParam {
    this.current = value;
    this.record("setValueAtTime", value, time);
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): FakeAudioParam {
    this.current = value;
    this.record("linearRampToValueAtTime", value, time);
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): FakeAudioParam {
    this.current = value;
    this.record("exponentialRampToValueAtTime", value, time);
    return this;
  }

  setTargetAtTime(
    value: number,
    time: number,
    timeConstant: number,
  ): FakeAudioParam {
    this.current = value;
    this.calls.push({
      param: this.name,
      method: "setTargetAtTime",
      value,
      time,
      timeConstant,
    });
    return this;
  }

  cancelScheduledValues(time: number): FakeAudioParam {
    this.record("cancelScheduledValues", this.current, time);
    return this;
  }

  private record(method: ParamMethod, value: number, time?: number): void {
    this.calls.push({
      param: this.name,
      method,
      value,
      time: time ?? this.clock(),
    });
  }
}

let nextNodeId = 0;

export class FakeAudioNode {
  readonly id = (nextNodeId += 1);
  readonly outputs: FakeAudioNode[] = [];
  readonly inputs: FakeAudioNode[] = [];
  readonly params = new Map<string, FakeAudioParam>();

  constructor(
    readonly kind: FakeNodeKind,
    readonly context: FakeAudioContext,
  ) {}

  get label(): string {
    return `${this.kind}#${this.id}`;
  }

  connect<T>(target: T): T {
    const node = asFakeNode(target);
    if (node) {
      this.outputs.push(node);
      node.inputs.push(this);
    }
    return target;
  }

  disconnect(target?: unknown): void {
    if (target === undefined) {
      this.outputs.forEach((node) => removeOnce(node.inputs, this));
      this.outputs.length = 0;
      return;
    }
    const node = asFakeNode(target);
    if (!node) {
      return;
    }
    removeOnce(this.outputs, node);
    removeOnce(node.inputs, this);
  }

  protected param(name: string, initial = 0): FakeAudioParam {
    const created = new FakeAudioParam(
      name,
      () => this.context.currentTime,
      initial,
    );
    this.params.set(name, created);
    return created;
  }
}

export class FakeGainNode extends FakeAudioNode {
  readonly gain = this.param("gain", 1);

  constructor(context: FakeAudioContext) {
    super("gain", context);
  }
}

export class FakeCompressorNode extends FakeAudioNode {
  readonly threshold = this.param("threshold", -24);
  readonly knee = this.param("knee", 30);
  readonly ratio = this.param("ratio", 12);
  readonly attack = this.param("attack", 0.003);
  readonly release = this.param("release", 0.25);
  readonly reduction = 0;

  constructor(context: FakeAudioContext) {
    super("compressor", context);
  }
}

export class FakeDelayNode extends FakeAudioNode {
  readonly delayTime = this.param("delayTime", 0);

  constructor(
    context: FakeAudioContext,
    readonly maxDelayTime = 1,
  ) {
    super("delay", context);
  }
}

export class FakeConvolverNode extends FakeAudioNode {
  normalize = true;
  /** Historial de asignaciones: asignar `buffer` recompila el kernel FFT. */
  readonly bufferAssignments: Array<AudioBuffer | null> = [];
  private current: AudioBuffer | null = null;

  constructor(context: FakeAudioContext) {
    super("convolver", context);
  }

  get buffer(): AudioBuffer | null {
    return this.current;
  }

  set buffer(next: AudioBuffer | null) {
    this.current = next;
    this.bufferAssignments.push(next);
  }
}

export class FakeBiquadFilterNode extends FakeAudioNode {
  type: BiquadFilterType = "lowpass";
  readonly frequency = this.param("frequency", 350);
  readonly Q = this.param("Q", 1);
  readonly detune = this.param("detune", 0);
  readonly gain = this.param("gain", 0);

  constructor(context: FakeAudioContext) {
    super("biquad", context);
  }
}

export class FakePannerNode extends FakeAudioNode {
  panningModel: PanningModelType = "equalpower";
  distanceModel: DistanceModelType = "inverse";
  refDistance = 1;
  maxDistance = 10000;
  rolloffFactor = 1;
  coneInnerAngle = 360;
  coneOuterAngle = 360;
  coneOuterGain = 0;
  readonly positionX = this.param("positionX", 0);
  readonly positionY = this.param("positionY", 0);
  readonly positionZ = this.param("positionZ", 0);
  readonly orientationX = this.param("orientationX", 1);
  readonly orientationY = this.param("orientationY", 0);
  readonly orientationZ = this.param("orientationZ", 0);

  constructor(context: FakeAudioContext) {
    super("panner", context);
  }

  setPosition(x: number, y: number, z: number): void {
    this.positionX.value = x;
    this.positionY.value = y;
    this.positionZ.value = z;
  }

  setOrientation(x: number, y: number, z: number): void {
    this.orientationX.value = x;
    this.orientationY.value = y;
    this.orientationZ.value = z;
  }
}

export class FakeBufferSourceNode extends FakeAudioNode {
  buffer: AudioBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  onended: (() => void) | null = null;
  readonly playbackRate = this.param("playbackRate", 1);
  readonly detune = this.param("detune", 0);
  readonly start =
    vi.fn<(when?: number, offset?: number, duration?: number) => void>();
  readonly stop = vi.fn<(when?: number) => void>();
  private readonly endedListeners: EventListener[] = [];

  constructor(context: FakeAudioContext) {
    super("bufferSource", context);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === "ended" && typeof listener === "function") {
      this.endedListeners.push(listener);
    }
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    if (type !== "ended" || typeof listener !== "function") {
      return;
    }
    removeOnce(this.endedListeners, listener);
  }

  /** Simula el fin natural del clip: dispara `onended` y los listeners. */
  fireEnded(): void {
    this.onended?.();
    this.endedListeners
      .slice()
      .forEach((listener) => listener(new Event("ended")));
  }
}

export class FakeAudioListener {
  readonly positionX: FakeAudioParam;
  readonly positionY: FakeAudioParam;
  readonly positionZ: FakeAudioParam;
  readonly forwardX: FakeAudioParam;
  readonly forwardY: FakeAudioParam;
  readonly forwardZ: FakeAudioParam;
  readonly upX: FakeAudioParam;
  readonly upY: FakeAudioParam;
  readonly upZ: FakeAudioParam;

  constructor(clock: () => number) {
    this.positionX = new FakeAudioParam("positionX", clock, 0);
    this.positionY = new FakeAudioParam("positionY", clock, 0);
    this.positionZ = new FakeAudioParam("positionZ", clock, 0);
    this.forwardX = new FakeAudioParam("forwardX", clock, 0);
    this.forwardY = new FakeAudioParam("forwardY", clock, 0);
    this.forwardZ = new FakeAudioParam("forwardZ", clock, -1);
    this.upX = new FakeAudioParam("upX", clock, 0);
    this.upY = new FakeAudioParam("upY", clock, 1);
    this.upZ = new FakeAudioParam("upZ", clock, 0);
  }
}

export class FakeAudioContext {
  state: AudioContextState = "suspended";
  currentTime = 0;
  readonly sampleRate = 48_000;
  readonly destination: FakeAudioNode;
  readonly listener: FakeAudioListener;
  readonly nodes: FakeAudioNode[] = [];
  readonly sources: FakeBufferSourceNode[] = [];

  readonly resume = vi.fn(async () => {
    this.state = "running";
  });
  readonly suspend = vi.fn(async () => {
    this.state = "suspended";
  });
  readonly close = vi.fn(async () => {
    this.state = "closed";
  });
  readonly decodeAudioData = vi.fn(async () => this.createBuffer(2, 4800, 48_000));

  constructor() {
    this.destination = this.track(new FakeAudioNode("destination", this));
    this.listener = new FakeAudioListener(() => this.currentTime);
  }

  createGain(): GainNode {
    return this.track(new FakeGainNode(this)) as unknown as GainNode;
  }

  createDynamicsCompressor(): DynamicsCompressorNode {
    return this.track(
      new FakeCompressorNode(this),
    ) as unknown as DynamicsCompressorNode;
  }

  createDelay(maxDelayTime = 1): DelayNode {
    return this.track(
      new FakeDelayNode(this, maxDelayTime),
    ) as unknown as DelayNode;
  }

  createConvolver(): ConvolverNode {
    return this.track(new FakeConvolverNode(this)) as unknown as ConvolverNode;
  }

  createBiquadFilter(): BiquadFilterNode {
    return this.track(
      new FakeBiquadFilterNode(this),
    ) as unknown as BiquadFilterNode;
  }

  createPanner(): PannerNode {
    return this.track(new FakePannerNode(this)) as unknown as PannerNode;
  }

  createBufferSource(): AudioBufferSourceNode {
    const source = this.track(new FakeBufferSourceNode(this));
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }

  createBuffer(
    numberOfChannels: number,
    length: number,
    sampleRate: number,
  ): AudioBuffer {
    const channels = Array.from(
      { length: numberOfChannels },
      () => new Float32Array(length),
    );
    return {
      numberOfChannels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: (channel: number) => {
        const data = channels[channel];
        if (!data) {
          throw new RangeError(`Canal ${channel} fuera de rango`);
        }
        return data;
      },
      copyFromChannel: () => undefined,
      copyToChannel: () => undefined,
    } as unknown as AudioBuffer;
  }

  /** Avanza el reloj para poder afirmar sobre tiempos de automatización. */
  advance(seconds: number): void {
    this.currentTime += seconds;
  }

  private track<T extends FakeAudioNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }
}

export interface WebAudioHarness {
  readonly activation: { isActive: boolean; hasBeenActive: boolean };
  readonly contexts: FakeAudioContext[];
  readonly listeners: Map<string, EventListener[]>;
  readonly storage: Map<string, string>;
  /** Dispara un gesto confiable del usuario (crea y reanuda el contexto). */
  gesture(eventName?: string): void;
}

/**
 * Stubea `window` con lo mínimo que `AudioSystem` toca: constructor de
 * `AudioContext`, `navigator.userActivation`, `localStorage` y los listeners
 * de gesto. Devuelve handles para inspeccionar y disparar cada uno.
 */
export function installWebAudioHarness(
  initialStorage: Record<string, string> = {},
): WebAudioHarness {
  const contexts: FakeAudioContext[] = [];
  const listeners = new Map<string, EventListener[]>();
  const activation = { isActive: false, hasBeenActive: false };
  const storage = new Map(Object.entries(initialStorage));

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
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
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

  return {
    activation,
    contexts,
    listeners,
    storage,
    gesture: (eventName = "pointerdown") => {
      listeners.get(eventName)?.[0]?.({ isTrusted: true } as Event);
    },
  };
}

export function asFakeNode(value: unknown): FakeAudioNode | null {
  return value instanceof FakeAudioNode ? value : null;
}

function requireNode(value: unknown, role: string): FakeAudioNode {
  const node = asFakeNode(value);
  if (!node) {
    throw new TypeError(`${role} no es un nodo del fake de Web Audio`);
  }
  return node;
}

/** Nodos a los que `node` conecta directamente. */
export function connectionsFrom(node: unknown): FakeAudioNode[] {
  return [...requireNode(node, "origen").outputs];
}

export function isConnected(from: unknown, to: unknown): boolean {
  const target = requireNode(to, "destino");
  return requireNode(from, "origen").outputs.includes(target);
}

/** Existe algún camino de señal (no solo conexión directa) entre dos nodos. */
export function pathExists(from: unknown, to: unknown): boolean {
  const target = requireNode(to, "destino");
  const seen = new Set<FakeAudioNode>();
  const pending = [requireNode(from, "origen")];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || seen.has(current)) {
      continue;
    }
    seen.add(current);
    if (current === target) {
      return true;
    }
    pending.push(...current.outputs);
  }

  return false;
}

export function paramHistory(node: unknown, param: string): ParamCall[] {
  const found = requireNode(node, "nodo").params.get(param);
  if (!found) {
    throw new TypeError(`El nodo no tiene el parámetro '${param}'`);
  }
  return [...found.calls];
}

export function paramValue(node: unknown, param: string): number {
  const found = requireNode(node, "nodo").params.get(param);
  if (!found) {
    throw new TypeError(`El nodo no tiene el parámetro '${param}'`);
  }
  return found.value;
}

export function nodesOfKind(
  context: FakeAudioContext,
  kind: FakeNodeKind,
): FakeAudioNode[] {
  return context.nodes.filter((node) => node.kind === kind);
}

/** Aristas del grafo en forma legible, para diffs en fallos de test. */
export function graphEdges(
  context: FakeAudioContext,
): Array<{ from: string; to: string }> {
  return context.nodes.flatMap((node) =>
    node.outputs.map((output) => ({ from: node.label, to: output.label })),
  );
}

function removeOnce<T>(list: T[], value: T): void {
  const index = list.indexOf(value);
  if (index >= 0) {
    list.splice(index, 1);
  }
}
