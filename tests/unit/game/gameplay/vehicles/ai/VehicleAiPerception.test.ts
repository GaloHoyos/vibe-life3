import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { PerceptionConfig, PerceptionTarget } from '@engine/ai/perception/PerceptionSystem';
import type { RaycastHit, RaycastSource } from '@engine/physics/Raycast';
import { VehicleAiPerception } from '@game/gameplay/vehicles/ai/VehicleAiPerception';

const config: PerceptionConfig = {
  visionRange: 100,
  visionConeRadians: 2.6,
  hearingRadius: 5,
  memoryTime: 4,
  eyeHeight: 0.6,
};

/** Sin obstáculos: todo raycast falla, así que hay línea de visión libre. */
const clearRaycast: RaycastSource = {
  cast: () => null,
};

/** Una pared que corta cualquier LOS. */
const blockedRaycast: RaycastSource = {
  cast: (origin, direction): RaycastHit => ({
    point: origin.clone().addScaledVector(direction.clone().normalize(), 1),
    normal: new Vector3(0, 0, -1),
    toi: 1,
    collider: {} as RaycastHit['collider'],
    metadata: { id: 'wall', kind: 'static' },
  }),
};

const SELF = new Vector3(0, 0, 0);
const FORWARD = new Vector3(0, 0, 1);

function target(id: string, position: Vector3): PerceptionTarget {
  return { id, position, isAlive: true };
}

describe('VehicleAiPerception', () => {
  it('no ve a través de una pared', () => {
    const perception = new VehicleAiPerception('v', config);
    const snapshot = perception.update(
      0.1,
      SELF,
      FORWARD,
      [target('player', new Vector3(0, 0, 30))],
      blockedRaycast,
    );
    expect(snapshot.visible).toBe(false);
    expect(snapshot.targetId).toBeNull();
  });

  it('adquiere con línea de visión y rellena la velocidad del blanco', () => {
    const perception = new VehicleAiPerception('v', config);
    const position = new Vector3(0, 0, 30);
    perception.update(0.1, SELF, FORWARD, [target('player', position)], clearRaycast);
    let snapshot = perception.update(
      0.1,
      SELF,
      FORWARD,
      [target('player', position)],
      clearRaycast,
    );
    for (let frame = 0; frame < 20; frame += 1) {
      position.x += 0.5;
      snapshot = perception.update(
        0.1,
        SELF,
        FORWARD,
        [target('player', position)],
        clearRaycast,
      );
    }
    expect(snapshot.targetId).toBe('player');
    expect(snapshot.visible).toBe(true);
    expect(snapshot.velocity?.x ?? 0).toBeGreaterThan(3);
    const brainTarget = perception.toBrainTarget(snapshot);
    expect(brainTarget?.velocity?.[0] ?? 0).toBeGreaterThan(3);
    expect(brainTarget?.visible).toBe(true);
  });

  it('recuerda el último-visto y lo suelta al expirar la memoria', () => {
    const perception = new VehicleAiPerception('v', config);
    const position = new Vector3(0, 0, 30);
    perception.update(0.1, SELF, FORWARD, [target('player', position)], clearRaycast);
    const seen = perception.update(
      0.1,
      SELF,
      FORWARD,
      [target('player', position)],
      clearRaycast,
    );
    expect(seen.visible).toBe(true);

    const hidden = new Vector3(40, 0, 30);
    let snapshot = perception.update(
      0.5,
      SELF,
      FORWARD,
      [target('player', hidden)],
      blockedRaycast,
    );
    expect(snapshot.visible).toBe(false);
    expect(snapshot.hasMemory).toBe(true);
    // La posición recordada es donde se lo vio, no donde está ahora.
    expect(snapshot.position?.x ?? 99).toBeCloseTo(0, 3);

    for (let frame = 0; frame < 12; frame += 1) {
      snapshot = perception.update(
        0.5,
        SELF,
        FORWARD,
        [target('player', hidden)],
        blockedRaycast,
      );
    }
    expect(snapshot.hasMemory).toBe(false);
    expect(snapshot.position).toBeNull();
  });

  it('no alterna de blanco entre dos hostiles casi equidistantes', () => {
    const perception = new VehicleAiPerception('v', config);
    const first = new Vector3(0, 0, 20);
    const second = new Vector3(0, 0, 21);
    const candidates = [target('a', first), target('b', second)];
    const initial = perception.update(0.6, SELF, FORWARD, candidates, clearRaycast);
    expect(initial.targetId).toBe('a');
    // `b` se acerca pero no lo suficiente para robar el blanco.
    second.z = 19;
    for (let frame = 0; frame < 10; frame += 1) {
      const snapshot = perception.update(0.6, SELF, FORWARD, candidates, clearRaycast);
      expect(snapshot.targetId).toBe('a');
    }
    // Bien más cerca sí lo roba.
    second.z = 8;
    let switched = false;
    for (let frame = 0; frame < 5; frame += 1) {
      const snapshot = perception.update(0.6, SELF, FORWARD, candidates, clearRaycast);
      switched = switched || snapshot.targetId === 'b';
    }
    expect(switched).toBe(true);
  });

  it('descarta un blanco muerto', () => {
    const perception = new VehicleAiPerception('v', config);
    const position = new Vector3(0, 0, 20);
    perception.update(0.6, SELF, FORWARD, [target('a', position)], clearRaycast);
    const snapshot = perception.update(
      0.6,
      SELF,
      FORWARD,
      [{ id: 'a', position, isAlive: false }],
      clearRaycast,
    );
    expect(snapshot.targetId).toBeNull();
  });
});
