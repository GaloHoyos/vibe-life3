import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  computeTransitionKinematics,
  createLandmarkTransform,
  normalizeLandmark,
  transformRigidBodyKinematics,
  transformTransitionWorld,
  type QuaternionTuple,
} from '@game/levels/LevelTransition';

describe('LevelTransition', () => {
  it('normaliza tuples legacy sin compartir su array', () => {
    const legacy: [number, number, number] = [1, 2, 3];
    const normalized = normalizeLandmark(legacy);

    expect(normalized).toEqual({ position: [1, 2, 3], yaw: 0 });
    expect(normalized.position).not.toBe(legacy);
  });

  it('rota offset, yaw y velocidades entre landmarks orientados', () => {
    const transform = createLandmarkTransform(
      { position: [10, 0, 20], yaw: 0 },
      { position: [100, 4, 200], yaw: Math.PI / 2 },
    );
    const state = transform.transformKinematics({
      position: [10, 1, 24],
      yaw: -Math.PI / 4,
      linearVelocity: [0, 0, 8],
      angularVelocity: [0, 2, 1],
    });

    expectTupleClose(state.position, [104, 5, 200]);
    expect(state.yaw).toBeCloseTo(Math.PI / 4);
    expectTupleClose(state.linearVelocity, [8, 0, 0]);
    expectTupleClose(state.angularVelocity, [1, 2, 0]);
  });

  it('premultiplica la orientación world-space por el delta de yaw', () => {
    const transform = createLandmarkTransform(
      [0, 0, 0],
      { position: [0, 0, 0], yaw: Math.PI / 2 },
    );
    const rotation = new Quaternion().setFromAxisAngle(
      new Vector3(1, 0, 0),
      Math.PI / 6,
    );
    const transformed = new Quaternion(
      ...transform.transformRotation(quaternionTuple(rotation)),
    );
    const expected = new Vector3(0, 0, 1)
      .applyQuaternion(rotation)
      .applyAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    const actual = new Vector3(0, 0, 1).applyQuaternion(transformed);

    expect(actual.distanceTo(expected)).toBeLessThan(1e-6);
  });

  it('aplica la misma base a jugador, NPCs, vehículo y ocupantes', () => {
    const transform = createLandmarkTransform(
      { position: [0, 0, 0], yaw: Math.PI / 2 },
      { position: [20, 0, 30], yaw: Math.PI },
    );
    const transformed = transformTransitionWorld(
      {
        player: { id: "player", position: [0, 1, 2], yaw: 0 },
        npcs: [{ id: "alyx", position: [1, 0, 0], linearVelocity: [1, 0, 0] }],
        vehicles: [
          {
            id: "heli",
            transitionKey: "flight-heli",
            position: [0, 0, 4],
            rotation: [0, 0, 0, 1],
            linearVelocity: [0, 0, 10],
            angularVelocity: [0, 1, 0],
            occupants: [{
              actor: "alyx",
              seatId: "passenger",
              position: [0.5, 1, 4],
              yaw: Math.PI / 2,
            }],
          },
        ],
      },
      transform,
    );

    expectTupleClose(transformed.player.position, [22, 1, 30]);
    expectTupleClose(transformed.npcs[0]?.position, [20, 0, 29]);
    expectTupleClose(transformed.npcs[0]?.linearVelocity, [0, 0, -1]);
    expectTupleClose(transformed.vehicles[0]?.position, [24, 0, 30]);
    expectTupleClose(
      transformed.vehicles[0]?.occupants?.[0]?.position,
      [24, 1, 29.5],
    );
    expect(transformed.npcs[0]?.id).toBe("alyx");
    expect(transformed.vehicles[0]).toMatchObject({
      id: "heli",
      transitionKey: "flight-heli",
      occupants: [{ actor: "alyx", seatId: "passenger" }],
    });
  });

  it('transforma el bloque de cuerpo rígido serializado por los vehículos', () => {
    const transform = createLandmarkTransform(
      [0, 0, 0],
      { position: [10, 0, 10], yaw: Math.PI / 2 },
    );
    const transformed = transformRigidBodyKinematics(
      {
        position: [0, 2, 3],
        rotation: [0, 0, 0, 1],
        linearVelocity: [0, 0, 6],
        angularVelocity: [1, 0, 0],
      },
      transform,
    );

    expectTupleClose(transformed.position, [13, 2, 10]);
    expectTupleClose(transformed.linearVelocity, [6, 0, 0]);
    expectTupleClose(transformed.angularVelocity, [0, 0, -1]);
  });

  it('usa playerStart sin rotar momentum cuando el destino no tiene landmark', () => {
    const transformed = computeTransitionKinematics(
      {
        position: [5, 2, 8],
        yaw: 1.2,
        linearVelocity: [3, -1, 4],
      },
      { position: [5, 0, 5], yaw: Math.PI },
      [0, 0, 0],
      undefined,
      [40, 1.6, -20],
    );

    expect(transformed).toEqual({
      position: [40, 1.6, -20],
      yaw: 1.2,
      linearVelocity: [3, -1, 4],
    });
  });
});

function quaternionTuple(quaternion: Quaternion): QuaternionTuple {
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

function expectTupleClose(
  actual: readonly number[] | undefined,
  expected: readonly number[],
): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, index) => {
    expect(actual?.[index]).toBeCloseTo(value);
  });
}
