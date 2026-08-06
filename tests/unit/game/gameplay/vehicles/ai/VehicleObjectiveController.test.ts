import { describe, expect, it } from 'vitest';
import { VehicleObjectiveController } from '@game/gameplay/vehicles/ai/VehicleObjectiveController';
import type {
  VehicleObjectiveRequest,
  VehicleObjectiveSource,
} from '@game/gameplay/vehicles/ai/VehicleTacticalTypes';

describe('VehicleObjectiveController', () => {
  it('prioriza Overwatch, extracción, misión autorada y autonomía', () => {
    const controller = new VehicleObjectiveController();
    controller.assign(request('wander', 'autonomous', 1));
    const queuedAssignment = controller.assign(request('mission', 'authored', 2));
    expect(queuedAssignment.changed).toBe(true);
    controller.assign(request('rescue', 'extraction', 3));
    controller.assign(request('overwatch', 'overwatch', 4));

    expect(controller.active()?.id).toBe('overwatch');
    expect(controller.objective('extraction')?.status).toBe('queued');

    controller.cancel('overwatch', 1, 5);
    expect(controller.active()?.id).toBe('rescue');
    expect(controller.active()?.status).toBe('active');

    controller.complete('rescue', 1, 6);
    expect(controller.active()?.id).toBe('mission');

    controller.fail('mission', 1, {
      reason: 'unreachable',
      atSeconds: 7,
      recoverable: false,
    });
    expect(controller.active()?.id).toBe('wander');
  });

  it('ignora revisiones viejas y acepta una revisión más nueva', () => {
    const controller = new VehicleObjectiveController();
    controller.assign(request('order', 'overwatch', 1, 4));

    expect(controller.assign(request('order', 'overwatch', 2, 3)).changed).toBe(false);
    expect(controller.active()?.target).toEqual({
      type: 'position',
      position: [4, 0, 0],
    });

    const updated = controller.assign(request('order', 'overwatch', 3, 5));
    expect(updated.changed).toBe(true);
    expect(controller.active()?.revision).toBe(5);
    expect(controller.active()?.target).toEqual({
      type: 'position',
      position: [5, 0, 0],
    });
  });

  it('no deja que un ID distinto reemplace una revisión más nueva', () => {
    const controller = new VehicleObjectiveController();
    controller.assign(request('new-order', 'overwatch', 4, 7));

    const stale = controller.assign(request('stale-order', 'overwatch', 5, 6));

    expect(stale.changed).toBe(false);
    expect(controller.active()).toMatchObject({
      id: 'new-order',
      revision: 7,
    });
  });

  it('conserva el resultado tipado y rechaza acknowledgements obsoletos', () => {
    const controller = new VehicleObjectiveController();
    controller.assign(request('land', 'overwatch', 1, 2));

    expect(controller.complete('land', 1, 2).changed).toBe(false);
    const transition = controller.fail('land', 2, {
      reason: 'noSafeLanding',
      atSeconds: 4,
      recoverable: true,
      detail: 'Techo demasiado chico',
    });

    expect(transition.outcome).toMatchObject({
      id: 'land',
      revision: 2,
      status: 'failed',
      failure: { reason: 'noSafeLanding', recoverable: true },
    });
    expect(controller.outcomes()).toEqual([transition.outcome]);
  });

  it('cancela la orden anterior cuando la misma fuente la reemplaza', () => {
    const controller = new VehicleObjectiveController();
    controller.assign(request('first', 'overwatch', 1));
    const transition = controller.assign(request('second', 'overwatch', 2, 2));

    expect(transition.active?.id).toBe('second');
    expect(transition.outcome).toMatchObject({ id: 'first', status: 'cancelled' });
  });
});

function request(
  id: string,
  source: VehicleObjectiveSource,
  issuedAtSeconds: number,
  revision = 1,
): VehicleObjectiveRequest {
  return {
    id,
    revision,
    source,
    kind: 'move',
    target: { type: 'position', position: [revision, 0, 0] },
    issuedAtSeconds,
  };
}
