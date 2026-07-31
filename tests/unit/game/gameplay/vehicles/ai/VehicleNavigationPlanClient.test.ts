import { afterEach, describe, expect, it, vi } from 'vitest';
import { VehiclePresets } from '@game/config/vehicles.config';
import {
  createVehicleNavigationPlanClient,
  type VehicleNavigationPlanWorkerRequest,
  type VehicleNavigationPlanWorkerResponse,
} from '@game/gameplay/vehicles/ai/VehicleNavigationPlanClient';
import type { VehicleNavigationBake } from '@game/gameplay/vehicles/ai/VehicleAiTypes';
import { navigationProfileFromPreset } from '@game/gameplay/vehicles/ai/VehicleAiTypes';
import { VehicleNavigationPlanner } from '@game/gameplay/vehicles/ai/VehicleNavigationPlanner';

let lastWorker: FakeWorker | null = null;

describe('VehicleNavigationPlanClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    lastWorker = null;
  });

  it('planifica en un Worker persistente sin invocar el fallback inline', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const profile = navigationProfileFromPreset(VehiclePresets.buggy);
    const navigation = emptyNavigation(profile.id);
    const inlinePlanner = new VehicleNavigationPlanner(navigation, [profile]);
    const inlinePlan = vi.spyOn(inlinePlanner, 'plan');
    const client = await createVehicleNavigationPlanClient(
      navigation,
      [profile],
      inlinePlanner,
    );

    const route = await client.plan(
      profile.id,
      { position: [0, 0, 0], heading: 0 },
      { position: [4, 0, 4], heading: Math.PI / 4 },
    );

    expect(route).toBeNull();
    expect(inlinePlan).not.toHaveBeenCalled();
    expect(lastWorker?.messages.map((message) => message.type)).toEqual([
      'initialize',
      'plan',
    ]);
    client.dispose();
    expect(lastWorker?.terminated).toBe(true);
  });
});

class FakeWorker {
  readonly messages: VehicleNavigationPlanWorkerRequest[] = [];
  terminated = false;
  onmessage:
    | ((event: MessageEvent<VehicleNavigationPlanWorkerResponse>) => void)
    | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;

  constructor(_url: URL | string, _options?: WorkerOptions) {
    lastWorker = this;
  }

  postMessage(message: VehicleNavigationPlanWorkerRequest): void {
    this.messages.push(message);
    if (message.type === 'initialize') {
      this.emit({ type: 'initialized' });
      return;
    }
    this.emit({ type: 'planResult', id: message.id, route: null });
  }

  terminate(): void {
    this.terminated = true;
  }

  private emit(response: VehicleNavigationPlanWorkerResponse): void {
    globalThis.queueMicrotask(() => {
      this.onmessage?.({
        data: response,
      } as MessageEvent<VehicleNavigationPlanWorkerResponse>);
    });
  }
}

function emptyNavigation(profileId: string): VehicleNavigationBake {
  return {
    schemaVersion: 1,
    hash: 'worker-client-test',
    grids: [{ profileId, cellSize: 1, origin: [0, 0], cells: [] }],
    laneGraph: { nodes: [], edges: [] },
    markers: [],
  };
}
