import RAPIER from '@dimforge/rapier3d-compat';

export type Vec3Tuple = readonly [number, number, number];
/** Cuaternión [x, y, z, w]. */
export type QuatTuple = readonly [number, number, number, number];

export type ColliderShapeSpec =
  | { readonly kind: 'box'; readonly halfExtents: Vec3Tuple }
  | { readonly kind: 'sphere'; readonly radius: number }
  | { readonly kind: 'capsule'; readonly radius: number; readonly halfHeight: number }
  /**
   * Nube de puntos en espacio local de la parte; Rapier calcula el casco
   * convexo. Se puede pasar un buffer de posiciones crudo (los hulls de props
   * salen del atributo `position` de una malla `collider_*` del GLB).
   */
  | { readonly kind: 'hull'; readonly points: Float32Array };

export interface ColliderPartSpec {
  readonly shape: ColliderShapeSpec;
  /** Traslación local respecto del cuerpo. */
  readonly position?: Vec3Tuple;
  /** Rotación local respecto del cuerpo. */
  readonly rotation?: QuatTuple;
  readonly friction?: number;
  readonly restitution?: number;
  readonly collisionGroups?: number;
}

/**
 * Un cuerpo con N partes es un compound: una sola masa y un solo tensor de
 * inercia derivados de todas las formas juntas, sin joints entre ellas.
 */
export type ColliderSpec = readonly ColliderPartSpec[];

interface LocalBounds {
  min: [number, number, number];
  max: [number, number, number];
}

/** Media extensión mínima de una caja de fallback: una chapa de 2 mm. */
const MIN_HALF_EXTENT = 1e-3;

/**
 * Construye el `ColliderDesc` de una parte, con su pose local y tuning.
 * Devuelve `null` sólo si la forma no tiene datos usables (hull con menos de
 * cuatro puntos).
 *
 * OJO: `ColliderDesc.convexHull` NO rechaza nubes coplanares o colineales — el
 * casco recién se calcula al crear el collider, así que la degeneración sólo se
 * detecta midiendo `collider.volume()`. Por eso el fallback vive en
 * `PhysicsWorld` y no acá.
 */
export function colliderDescFromPart(part: ColliderPartSpec): RAPIER.ColliderDesc | null {
  const shape = part.shape;
  let desc: RAPIER.ColliderDesc | null;

  switch (shape.kind) {
    case 'box': {
      const [hx, hy, hz] = shape.halfExtents;
      desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz);
      break;
    }
    case 'sphere':
      desc = RAPIER.ColliderDesc.ball(shape.radius);
      break;
    case 'capsule':
      desc = RAPIER.ColliderDesc.capsule(shape.halfHeight, shape.radius);
      break;
    case 'hull':
      desc = shape.points.length >= 12 ? RAPIER.ColliderDesc.convexHull(shape.points) : null;
      break;
  }

  if (!desc) return null;

  if (part.position) {
    desc = desc.setTranslation(part.position[0], part.position[1], part.position[2]);
  }
  if (part.rotation) {
    const [x, y, z, w] = part.rotation;
    desc = desc.setRotation({ x, y, z, w });
  }
  if (part.friction !== undefined) desc = desc.setFriction(part.friction);
  if (part.restitution !== undefined) desc = desc.setRestitution(part.restitution);
  if (part.collisionGroups !== undefined) desc = desc.setCollisionGroups(part.collisionGroups);

  return desc;
}

/**
 * La misma parte con su forma cambiada por la caja de su AABB local, para
 * degradar un hull que resultó sin volumen. Las extensiones se acotan a un
 * mínimo, así una chapa plana sobrevive como chapa en vez de desaparecer.
 */
export function toBoxPart(part: ColliderPartSpec): ColliderPartSpec {
  const bounds = shapeLocalBounds(part.shape);
  const half = (axis: number): number =>
    Math.max((bounds.max[axis] - bounds.min[axis]) / 2, MIN_HALF_EXTENT);
  const center: Vec3Tuple = [
    (bounds.max[0] + bounds.min[0]) / 2,
    (bounds.max[1] + bounds.min[1]) / 2,
    (bounds.max[2] + bounds.min[2]) / 2,
  ];
  const offset = part.position ?? [0, 0, 0];
  return {
    ...part,
    shape: { kind: 'box', halfExtents: [half(0), half(1), half(2)] },
    position: [offset[0] + center[0], offset[1] + center[1], offset[2] + center[2]],
  };
}

/** AABB de la forma en su propio espacio, antes de la pose de la parte. */
function shapeLocalBounds(shape: ColliderShapeSpec): LocalBounds {
  switch (shape.kind) {
    case 'box': {
      const [hx, hy, hz] = shape.halfExtents;
      return { min: [-hx, -hy, -hz], max: [hx, hy, hz] };
    }
    case 'sphere': {
      const r = shape.radius;
      return { min: [-r, -r, -r], max: [r, r, r] };
    }
    case 'capsule': {
      const r = shape.radius;
      const h = shape.halfHeight + r;
      return { min: [-r, -h, -r], max: [r, h, r] };
    }
    case 'hull': {
      const points = shape.points;
      if (points.length < 3) return { min: [0, 0, 0], max: [0, 0, 0] };
      const min: [number, number, number] = [Infinity, Infinity, Infinity];
      const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i + 2 < points.length; i += 3) {
        for (let axis = 0; axis < 3; axis += 1) {
          const value = points[i + axis] as number;
          if (value < min[axis]) min[axis] = value;
          if (value > max[axis]) max[axis] = value;
        }
      }
      return { min, max };
    }
  }
}

/** Rota `v` por el cuaternión `q`, en el lugar sobre `out`. */
function rotateByQuat(v: Vec3Tuple, q: QuatTuple, out: [number, number, number]): void {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  // t = 2 * (q.xyz x v); v' = v + w * t + (q.xyz x t)
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  out[0] = vx + w * tx + (y * tz - z * ty);
  out[1] = vy + w * ty + (z * tx - x * tz);
  out[2] = vz + w * tz + (x * ty - y * tx);
}

/**
 * Extensiones completas (no medias) del AABB que envuelve a todas las partes en
 * espacio del cuerpo. Lo consume `navigationObstacleSize` y el placeholder del
 * editor. Las partes rotadas se acotan por las 8 esquinas de su AABB local, así
 * que el resultado es conservador, que es el lado seguro para un obstáculo.
 */
export function colliderSpecBounds(spec: ColliderSpec): [number, number, number] {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const corner: [number, number, number] = [0, 0, 0];

  for (const part of spec) {
    const local = shapeLocalBounds(part.shape);
    const offset = part.position ?? [0, 0, 0];
    for (let index = 0; index < 8; index += 1) {
      const source: Vec3Tuple = [
        index & 1 ? local.max[0] : local.min[0],
        index & 2 ? local.max[1] : local.min[1],
        index & 4 ? local.max[2] : local.min[2],
      ];
      if (part.rotation) {
        rotateByQuat(source, part.rotation, corner);
      } else {
        corner[0] = source[0];
        corner[1] = source[1];
        corner[2] = source[2];
      }
      for (let axis = 0; axis < 3; axis += 1) {
        const value = (corner[axis] as number) + (offset[axis] as number);
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
    }
  }

  if (!Number.isFinite(min[0])) return [0, 0, 0];
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
}

/** Spec de una sola caja centrada, para fallbacks y props sin malla. */
export function boxColliderSpec(size: Vec3Tuple): ColliderSpec {
  return [{ shape: { kind: 'box', halfExtents: [size[0] / 2, size[1] / 2, size[2] / 2] } }];
}
