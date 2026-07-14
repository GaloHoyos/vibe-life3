/**
 * The browser-facing helper deliberately depends on this small port instead of
 * a Blob controller, NPC, renderer, camera, or CharacterFactory. A dev harness
 * can expose as much or as little of the runtime as it wants by supplying the
 * corresponding adapters.
 */
export interface BlobV2DebugSource {
  readonly id: string;
  readonly snapshot: () => unknown;
  readonly telemetry?: () => unknown;
  readonly diagnostics?: () => unknown;
  readonly events: () => readonly unknown[];
  readonly freeze?: (frozen: boolean) => unknown;
  readonly fixedStep?: (steps: number) => unknown;
  readonly impact?: (impact: unknown) => unknown;
  readonly split?: (components: number) => unknown;
  readonly merge?: () => unknown;
  readonly scenario?: (name: string) => unknown;
  readonly camera?: (name: string) => unknown;
  readonly prepareEvidence?: () => unknown;
  readonly resetEvidence?: () => unknown;
}

export interface BlobV2DebugApi {
  /** Live source ids, in the deterministic order returned by getSources. */
  list: () => string[];
  /** Omit id to target the first source. */
  snapshot: (id?: string) => unknown;
  /** Timing and resource counters for deterministic acceptance runs. */
  telemetry: (id?: string) => unknown;
  /** Runtime-only traversal, pose and command state; never used by gameplay. */
  diagnostics: (id?: string) => unknown;
  /** Omit id to target the first source. The adapter decides whether this drains. */
  events: (id?: string) => readonly unknown[];
  /** `freeze(true)` targets the first source; `freeze(id, false)` targets one explicitly. */
  freeze: (idOrFrozen?: string | boolean, frozen?: boolean) => unknown;
  /** `fixedStep(3)` targets the first source; `fixedStep(id, 3)` targets one explicitly. */
  fixedStep: (idOrSteps?: string | number, steps?: number) => unknown;
  /** `impact(payload)` targets the first source; `impact(id, payload)` targets one explicitly. */
  impact: (idOrImpact: string | unknown, impact?: unknown) => unknown;
  /** `split(3)` targets the first source; `split(id, 3)` targets one explicitly. */
  split: (idOrComponents?: string | number, components?: number) => unknown;
  merge: (id?: string) => unknown;
  /** `scenario(name)` targets the first source; `scenario(id, name)` targets one explicitly. */
  scenario: (idOrName: string, name?: string) => unknown;
  /** `camera(name)` targets the first source; `camera(id, name)` targets one explicitly. */
  camera: (idOrName: string, name?: string) => unknown;
  /** Resets presentation-only hysteresis and clock for a frozen golden frame. */
  prepareEvidence: (id?: string) => unknown;
  /** Restores a pristine fresh-page simulation before deterministic settling. */
  resetEvidence: (id?: string) => unknown;
}

declare global {
  interface Window {
    /** Explicit dev/test Blob V2 adapter console. It is never installed automatically. */
    __blobDebug?: BlobV2DebugApi;
  }
}

type DebugHost = typeof globalThis & { __blobDebug?: BlobV2DebugApi };
type Capability = Exclude<keyof BlobV2DebugSource, 'id'>;

/**
 * Installs the plan-level `globalThis.__blobDebug` console for dev harnesses and tests.
 *
 * `getSources` is evaluated for every command so level reloads cannot leave
 * stale controller references behind. Disposing restores the exact prior
 * property descriptor, but only while this installer still owns the global.
 */
export function installBlobV2Debug(
  getSources: () => readonly BlobV2DebugSource[],
): () => void {
  const host = globalThis as DebugHost;
  const previous = Object.getOwnPropertyDescriptor(host, '__blobDebug');

  const api: BlobV2DebugApi = {
    list: () => sources().map((source) => source.id),
    snapshot: (id) => source(id).snapshot(),
    telemetry: (id) => adapter(source(id), 'telemetry')(),
    diagnostics: (id) => adapter(source(id), 'diagnostics')(),
    events: (id) => source(id).events(),
    freeze: (idOrFrozen, frozen = true) => {
      const id = typeof idOrFrozen === 'string' ? idOrFrozen : undefined;
      const value = typeof idOrFrozen === 'boolean' ? idOrFrozen : frozen;
      return adapter(source(id), 'freeze')(value);
    },
    fixedStep: (idOrSteps, steps = 1) => {
      const id = typeof idOrSteps === 'string' ? idOrSteps : undefined;
      const count = typeof idOrSteps === 'number' ? idOrSteps : steps;
      positiveInteger(count, 'fixedStep steps');
      return adapter(source(id), 'fixedStep')(count);
    },
    impact: (idOrImpact, impact) => {
      const hasExplicitId = typeof idOrImpact === 'string' && impact !== undefined;
      const id = hasExplicitId ? idOrImpact : undefined;
      const payload = hasExplicitId ? impact : idOrImpact;
      if (payload === undefined) throw new TypeError('Blob V2 debug impact payload is required');
      return adapter(source(id), 'impact')(payload);
    },
    split: (idOrComponents, components = 2) => {
      const id = typeof idOrComponents === 'string' ? idOrComponents : undefined;
      const count = typeof idOrComponents === 'number' ? idOrComponents : components;
      positiveInteger(count, 'split components');
      if (count < 2) throw new RangeError('Blob V2 debug split components must be at least 2');
      return adapter(source(id), 'split')(count);
    },
    merge: (id) => adapter(source(id), 'merge')(),
    scenario: (idOrName, name) => {
      const [id, value] = namedTarget(idOrName, name, 'scenario');
      return adapter(source(id), 'scenario')(value);
    },
    camera: (idOrName, name) => {
      const [id, value] = namedTarget(idOrName, name, 'camera');
      return adapter(source(id), 'camera')(value);
    },
    prepareEvidence: (id) => adapter(source(id), 'prepareEvidence')(),
    resetEvidence: (id) => adapter(source(id), 'resetEvidence')(),
  };

  Object.defineProperty(host, '__blobDebug', {
    configurable: true,
    enumerable: false,
    writable: true,
    value: api,
  });

  return () => {
    if (host.__blobDebug !== api) return;
    if (previous) {
      Object.defineProperty(host, '__blobDebug', previous);
    } else {
      delete host.__blobDebug;
    }
  };

  function sources(): readonly BlobV2DebugSource[] {
    const current = getSources();
    const ids = new Set<string>();
    for (const item of current) {
      if (item.id.trim().length === 0) throw new Error('Blob V2 debug source id cannot be empty');
      if (ids.has(item.id)) throw new Error(`Duplicate Blob V2 debug source id: ${item.id}`);
      ids.add(item.id);
    }
    return current;
  }

  function source(id?: string): BlobV2DebugSource {
    const current = sources();
    if (id !== undefined) {
      const match = current.find((candidate) => candidate.id === id);
      if (!match) throw new Error(`Blob V2 debug source not found: ${id}`);
      return match;
    }
    const first = current[0];
    if (!first) throw new Error('No Blob V2 debug sources are available');
    return first;
  }
}

function adapter<K extends Capability>(
  source: BlobV2DebugSource,
  capability: K,
): NonNullable<BlobV2DebugSource[K]> {
  const value = source[capability];
  if (typeof value !== 'function') {
    throw new Error(`Blob V2 debug source ${source.id} does not support ${capability}`);
  }
  return value as NonNullable<BlobV2DebugSource[K]>;
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`Blob V2 debug ${label} must be a positive integer`);
  }
}

function namedTarget(
  idOrName: string,
  name: string | undefined,
  label: 'scenario' | 'camera',
): readonly [id: string | undefined, name: string] {
  const id = name === undefined ? undefined : idOrName;
  const value = name === undefined ? idOrName : name;
  if (value.trim().length === 0) throw new TypeError(`Blob V2 debug ${label} name cannot be empty`);
  return [id, value];
}
