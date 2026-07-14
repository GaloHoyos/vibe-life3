import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installBlobV2Debug,
  type BlobV2DebugApi,
  type BlobV2DebugSource,
} from '@game/debug/BlobV2Debug';

type DebugGlobal = typeof globalThis & { __blobDebug?: BlobV2DebugApi };

const host = globalThis as DebugGlobal;
let originalDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  originalDescriptor = Object.getOwnPropertyDescriptor(host, '__blobDebug');
  delete host.__blobDebug;
});

afterEach(() => {
  if (originalDescriptor) Object.defineProperty(host, '__blobDebug', originalDescriptor);
  else delete host.__blobDebug;
});

describe('installBlobV2Debug', () => {
  it('routes every command through first-source and explicit-id adapters', () => {
    const alpha = fakeSource('alpha');
    const beta = fakeSource('beta');
    const dispose = installBlobV2Debug(() => [alpha, beta]);
    const api = requiredApi();
    const impactA = { damage: 5 };
    const impactB = { damage: 12 };

    expect(api.list()).toEqual(['alpha', 'beta']);
    expect(api.snapshot()).toEqual({ id: 'alpha' });
    expect(api.snapshot('beta')).toEqual({ id: 'beta' });
    expect(api.telemetry()).toEqual({ id: 'alpha', telemetry: true });
    expect(api.telemetry('beta')).toEqual({ id: 'beta', telemetry: true });
    expect(api.diagnostics()).toEqual({ id: 'alpha', diagnostics: true });
    expect(api.diagnostics('beta')).toEqual({ id: 'beta', diagnostics: true });
    expect(api.events()).toEqual([{ source: 'alpha' }]);
    expect(api.events('beta')).toEqual([{ source: 'beta' }]);

    api.freeze(false);
    api.freeze('beta', true);
    api.fixedStep(3);
    api.fixedStep('beta', 4);
    api.impact(impactA);
    api.impact('beta', impactB);
    api.split(3);
    api.split('beta', 4);
    api.merge('beta');
    api.scenario('squeeze');
    api.scenario('beta', 'wither');
    api.camera('overview');
    api.camera('beta', 'grate');

    expect(alpha.freeze).toHaveBeenCalledWith(false);
    expect(beta.freeze).toHaveBeenCalledWith(true);
    expect(alpha.fixedStep).toHaveBeenCalledWith(3);
    expect(beta.fixedStep).toHaveBeenCalledWith(4);
    expect(alpha.impact).toHaveBeenCalledWith(impactA);
    expect(beta.impact).toHaveBeenCalledWith(impactB);
    expect(alpha.split).toHaveBeenCalledWith(3);
    expect(beta.split).toHaveBeenCalledWith(4);
    expect(beta.merge).toHaveBeenCalledOnce();
    expect(alpha.scenario).toHaveBeenCalledWith('squeeze');
    expect(beta.scenario).toHaveBeenCalledWith('wither');
    expect(alpha.camera).toHaveBeenCalledWith('overview');
    expect(beta.camera).toHaveBeenCalledWith('grate');

    dispose();
    expect(host.__blobDebug).toBeUndefined();
  });

  it('reads the live source collection instead of retaining stale controllers', () => {
    const alpha = fakeSource('alpha');
    const beta = fakeSource('beta');
    let sources: readonly BlobV2DebugSource[] = [alpha];
    installBlobV2Debug(() => sources);

    expect(requiredApi().list()).toEqual(['alpha']);
    sources = [beta];
    expect(requiredApi().list()).toEqual(['beta']);
    expect(requiredApi().snapshot()).toEqual({ id: 'beta' });
  });

  it('restores the exact previous global property descriptor on dispose', () => {
    const previous = { list: () => ['previous'] } as BlobV2DebugApi;
    Object.defineProperty(host, '__blobDebug', {
      configurable: true,
      enumerable: true,
      writable: false,
      value: previous,
    });
    const before = Object.getOwnPropertyDescriptor(host, '__blobDebug');

    const dispose = installBlobV2Debug(() => [fakeSource('alpha')]);
    expect(host.__blobDebug).not.toBe(previous);
    dispose();

    expect(host.__blobDebug).toBe(previous);
    expect(Object.getOwnPropertyDescriptor(host, '__blobDebug')).toEqual(before);
  });

  it('does not overwrite a newer owner during disposal', () => {
    const dispose = installBlobV2Debug(() => [fakeSource('alpha')]);
    const replacement = { list: () => ['replacement'] } as BlobV2DebugApi;
    host.__blobDebug = replacement;

    dispose();

    expect(host.__blobDebug).toBe(replacement);
  });

  it('reports missing, duplicate, and unsupported sources clearly', () => {
    installBlobV2Debug(() => []);
    expect(() => requiredApi().snapshot()).toThrow('No Blob V2 debug sources');

    const duplicate = fakeSource('same');
    installBlobV2Debug(() => [duplicate, fakeSource('same')]);
    expect(() => requiredApi().list()).toThrow('Duplicate Blob V2 debug source id: same');

    installBlobV2Debug(() => [{ id: 'read-only', snapshot: () => ({}), events: () => [] }]);
    expect(() => requiredApi().split()).toThrow('does not support split');
    expect(() => requiredApi().fixedStep(0)).toThrow(RangeError);
  });
});

function requiredApi(): BlobV2DebugApi {
  const api = host.__blobDebug;
  if (!api) throw new Error('Blob V2 debug API was not installed');
  return api;
}

function fakeSource(id: string): BlobV2DebugSource {
  return {
    id,
    snapshot: vi.fn(() => ({ id })),
    telemetry: vi.fn(() => ({ id, telemetry: true })),
    diagnostics: vi.fn(() => ({ id, diagnostics: true })),
    events: vi.fn(() => [{ source: id }]),
    freeze: vi.fn((value: boolean) => value),
    fixedStep: vi.fn((steps: number) => steps),
    impact: vi.fn((impact: unknown) => impact),
    split: vi.fn((components: number) => components),
    merge: vi.fn(() => id),
    scenario: vi.fn((name: string) => name),
    camera: vi.fn((name: string) => name),
  };
}
