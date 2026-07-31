import type RAPIER from "@dimforge/rapier3d-compat";

export type SerializedVector3 = [number, number, number];
export type SerializedQuaternion = [number, number, number, number];

/**
 * Estado plano de Rapier apto para JSON. No conserva handles ni referencias al
 * world: el cuerpo debe existir antes de aplicar el snapshot.
 */
export interface RigidBodySnapshot {
  position: SerializedVector3;
  rotation: SerializedQuaternion;
  linearVelocity: SerializedVector3;
  angularVelocity: SerializedVector3;
  enabled: boolean;
  sleeping: boolean;
}

export function captureRigidBodySnapshot(
  body: RAPIER.RigidBody,
): RigidBodySnapshot {
  const position = body.translation();
  const rotation = body.rotation();
  const linearVelocity = body.linvel();
  const angularVelocity = body.angvel();
  return {
    position: vectorTuple(position),
    rotation: quaternionTuple(rotation),
    linearVelocity: vectorTuple(linearVelocity),
    angularVelocity: vectorTuple(angularVelocity),
    enabled: body.isEnabled(),
    sleeping: body.isSleeping(),
  };
}

export function restoreRigidBodySnapshot(
  body: RAPIER.RigidBody,
  snapshot: Readonly<RigidBodySnapshot>,
): void {
  const position = vector(snapshot.position);
  const rotation = quaternion(snapshot.rotation);
  body.setEnabled(snapshot.enabled);
  body.setTranslation(position, true);
  body.setRotation(rotation, true);
  body.setLinvel(vector(snapshot.linearVelocity), true);
  body.setAngvel(vector(snapshot.angularVelocity), true);
  if (body.isKinematic()) {
    body.setNextKinematicTranslation(position);
    body.setNextKinematicRotation(rotation);
  }
  if (snapshot.sleeping && snapshot.enabled) {
    body.sleep();
  } else if (snapshot.enabled) {
    body.wakeUp();
  }
}

function vectorTuple(value: RAPIER.Vector): SerializedVector3 {
  return [finite(value.x), finite(value.y), finite(value.z)];
}

function quaternionTuple(value: RAPIER.Rotation): SerializedQuaternion {
  const tuple: SerializedQuaternion = [
    finite(value.x),
    finite(value.y),
    finite(value.z),
    finite(value.w, 1),
  ];
  const length = Math.hypot(...tuple);
  if (length <= Number.EPSILON) {
    return [0, 0, 0, 1];
  }
  return tuple.map((component) => component / length) as SerializedQuaternion;
}

function vector(value: readonly [number, number, number]): RAPIER.Vector {
  return {
    x: finite(value[0]),
    y: finite(value[1]),
    z: finite(value[2]),
  };
}

function quaternion(
  value: readonly [number, number, number, number],
): RAPIER.Rotation {
  const x = finite(value[0]);
  const y = finite(value[1]);
  const z = finite(value[2]);
  const w = finite(value[3], 1);
  const length = Math.hypot(x, y, z, w);
  if (length <= Number.EPSILON) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }
  return {
    x: x / length,
    y: y / length,
    z: z / length,
    w: w / length,
  };
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}
