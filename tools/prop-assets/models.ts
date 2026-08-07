import {
  BufferGeometry,
  CylinderGeometry,
  Euler as ThreeEuler,
  Matrix4,
  Quaternion,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { chamferBox, chamferWedge } from "../shared/gltf/geometry.js";
import type { Euler, GeometryPart, PropAssetId, Vec3 } from "./types.js";

/**
 * Geometría procedural de los props. Cada arquetipo se arma con las mismas
 * primitivas biseladas que los vehículos: un canto de pocos milímetros es lo que
 * separa un blockout de una pieza construida.
 *
 * El origen de cada prop es el CENTRO de su AABB (no la base), porque el cuerpo
 * físico vive en el centro y así la malla y el collider comparten marco.
 */

export type PropLod = 0 | 1;

export interface PropGeometry {
  readonly parts: readonly GeometryPart[];
  /** Piezas translúcidas: van a un material aparte. */
  readonly glass?: readonly GeometryPart[];
}

export type PropBuilder = (variant: number, lod: PropLod) => PropGeometry;

/** Ruido determinista por arquetipo y variante. */
export function variantRandom(id: string, variant: number): () => number {
  let state = variant * 0x9e3779b1 + 1;
  for (let i = 0; i < id.length; i += 1) state = Math.imul(state ^ id.charCodeAt(i), 0x85ebca6b);
  return () => {
    state = Math.imul(state ^ (state >>> 15), 0x2c1b3c6d);
    state = Math.imul(state ^ (state >>> 12), 0x297a2d39);
    return ((state ^ (state >>> 15)) >>> 0) / 0xffffffff;
  };
}

/** Jitter simétrico: `±amount` alrededor de 1. */
function jitter(random: () => number, amount: number): number {
  return 1 + (random() - 0.5) * 2 * amount;
}

// ---------------------------------------------------------------------------
// Madera
// ---------------------------------------------------------------------------

/**
 * Cajón: seis tablas biseladas más listones de canto. Se arma con caras y no
 * con una caja maciza porque al romperse las caras SON los pedazos.
 */
const woodenCrate: PropBuilder = (variant, lod) => {
  const random = variantRandom("woodenCrate", variant);
  const side = 0.86 * jitter(random, 0.04);
  const half = side / 2;
  const thickness = 0.045;
  const inset = half - thickness / 2;
  const parts: GeometryPart[] = [];

  const face = (position: Vec3, rotation: Euler): GeometryPart => ({
    geometry: chamferBox(side - thickness, side - thickness, thickness, 0.008),
    position,
    rotation,
    tile: 0,
  });
  parts.push(
    face([0, 0, inset], [0, 0, 0]),
    face([0, 0, -inset], [0, 0, 0]),
    face([inset, 0, 0], [0, Math.PI / 2, 0]),
    face([-inset, 0, 0], [0, Math.PI / 2, 0]),
    face([0, inset, 0], [Math.PI / 2, 0, 0]),
    face([0, -inset, 0], [Math.PI / 2, 0, 0]),
  );

  if (lod === 0) {
    // Listones de canto: los cuatro verticales dan la silueta de cajón armado.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        parts.push({
          geometry: chamferBox(thickness * 1.6, side, thickness * 1.6, 0.006),
          position: [sx * inset, 0, sz * inset],
          tile: 1,
        });
      }
    }
    // Fleje metálico de refuerzo en una cara.
    parts.push({
      geometry: chamferBox(side * 0.96, 0.035, 0.012, 0.004),
      position: [0, half * 0.45, inset + thickness / 2],
      tile: 2,
    });
  }
  return { parts };
};

/** Pallet: tres tacos, tres largueros y las tablas de arriba. */
const pallet: PropBuilder = (variant, lod) => {
  const random = variantRandom("pallet", variant);
  const width = 1.2;
  const depth = 0.8 * jitter(random, 0.03);
  const height = 0.14;
  const plankCount: number = lod === 0 ? (random() > 0.5 ? 6 : 5) : 3;
  const parts: GeometryPart[] = [];

  for (const x of [-1, 0, 1]) {
    parts.push({
      geometry: chamferBox(0.1, 0.075, depth, 0.006),
      position: [x * (width / 2 - 0.05), -height / 2 + 0.037, 0],
      tile: 1,
    });
  }
  for (const z of [-1, 0, 1]) {
    parts.push({
      geometry: chamferBox(width, 0.022, 0.1, 0.005),
      position: [0, -height / 2 + 0.086, z * (depth / 2 - 0.05)],
      tile: 0,
    });
  }
  for (let index = 0; index < plankCount; index += 1) {
    const t = plankCount === 1 ? 0.5 : index / (plankCount - 1);
    parts.push({
      geometry: chamferBox(width, 0.024, depth / plankCount - 0.03, 0.005),
      position: [0, height / 2 - 0.012, (t - 0.5) * (depth - depth / plankCount)],
      tile: 0,
    });
  }
  return { parts };
};

/** Silla: asiento, cuatro patas y respaldo con travesaños. */
const chair: PropBuilder = (variant, lod) => {
  const random = variantRandom("chair", variant);
  const seatY = -0.92 / 2 + 0.45 * jitter(random, 0.05);
  const seatWidth = 0.42;
  const seatDepth = 0.44;
  const parts: GeometryPart[] = [
    { geometry: chamferBox(seatWidth, 0.04, seatDepth, 0.008), position: [0, seatY, 0], tile: 0 },
  ];

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const backLeg = sz < 0;
      const legHeight = backLeg ? 0.92 : seatY + 0.92 / 2;
      parts.push({
        geometry: chamferBox(0.036, legHeight, 0.036, 0.005),
        position: [
          sx * (seatWidth / 2 - 0.03),
          -0.92 / 2 + legHeight / 2,
          sz * (seatDepth / 2 - 0.03),
        ],
        tile: 1,
      });
    }
  }
  const slats = lod === 0 ? 2 : 1;
  for (let index = 0; index < slats; index += 1) {
    parts.push({
      geometry: chamferBox(seatWidth - 0.06, 0.055, 0.022, 0.006),
      position: [0, 0.92 / 2 - 0.06 - index * 0.13, -(seatDepth / 2 - 0.03)],
      tile: 0,
    });
  }
  if (lod === 0) {
    // Travesaño bajo entre patas: sin él la silla se lee como un banquito.
    parts.push({
      geometry: chamferBox(seatWidth - 0.06, 0.026, 0.022, 0.005),
      position: [0, -0.92 / 2 + 0.14, 0],
      tile: 1,
    });
  }
  return { parts };
};

/** Mesa: tabla, faldón y cuatro patas. */
const table: PropBuilder = (variant, lod) => {
  const random = variantRandom("table", variant);
  const width = 1.4 * jitter(random, 0.03);
  const depth = 0.8;
  const height = 0.74;
  const topThickness = 0.045;
  const parts: GeometryPart[] = [
    {
      geometry: chamferBox(width, topThickness, depth, 0.01),
      position: [0, height / 2 - topThickness / 2, 0],
      tile: 0,
    },
  ];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push({
        geometry: chamferBox(0.06, height - topThickness, 0.06, 0.006),
        position: [
          sx * (width / 2 - 0.07),
          -topThickness / 2,
          sz * (depth / 2 - 0.07),
        ],
        tile: 1,
      });
    }
  }
  if (lod === 0) {
    for (const sz of [-1, 1]) {
      parts.push({
        geometry: chamferBox(width - 0.2, 0.07, 0.02, 0.005),
        position: [0, height / 2 - topThickness - 0.06, sz * (depth / 2 - 0.06)],
        tile: 0,
      });
    }
  }
  return { parts };
};

// ---------------------------------------------------------------------------
// Metal y hormigón
// ---------------------------------------------------------------------------

/** Barril de 200 litros: cuerpo cilíndrico, aros de rodadura y tapa con bocas. */
const metalBarrel: PropBuilder = (variant, lod) => {
  const random = variantRandom("metalBarrel", variant);
  const radius = 0.28;
  const height = 0.95 * jitter(random, 0.02);
  const segments = lod === 0 ? 20 : 10;
  const parts: GeometryPart[] = [
    {
      geometry: new CylinderGeometry(radius, radius, height - 0.04, segments, 1),
      position: [0, 0, 0],
      tile: random() > 0.5 ? 0 : 1,
    },
  ];
  // Aros: el barril rueda sobre ellos, por eso sobresalen del cuerpo.
  for (const y of [-0.24, 0.06, 0.3]) {
    parts.push({
      geometry: new CylinderGeometry(radius * 1.045, radius * 1.045, 0.045, segments, 1),
      position: [0, y * (height / 0.95), 0],
      tile: 3,
    });
  }
  for (const sy of [-1, 1]) {
    parts.push({
      geometry: new CylinderGeometry(radius * 1.02, radius * 1.02, 0.03, segments, 1),
      position: [0, (sy * (height - 0.03)) / 2, 0],
      tile: 3,
    });
  }
  if (lod === 0) {
    parts.push({
      geometry: new CylinderGeometry(0.035, 0.035, 0.025, 8, 1),
      position: [radius * 0.55, height / 2, 0],
      tile: 3,
    });
  }
  return { parts };
};

/**
 * Barril explosivo. Comparte casco con el barril común, pero se distingue por
 * silueta: bandas anchas de acero desnudo contra la chapa pintada, un collar de
 * protección y el racimo de válvulas arriba. Sin eso el jugador no puede saber
 * cuál de los dos barriles conviene disparar.
 */
const explosiveBarrel: PropBuilder = (variant, lod) => {
  const random = variantRandom("explosiveBarrel", variant);
  const radius = 0.28;
  const height = 0.95 * jitter(random, 0.015);
  const segments = lod === 0 ? 20 : 10;
  const parts: GeometryPart[] = [
    {
      geometry: new CylinderGeometry(radius, radius, height - 0.04, segments, 1),
      tile: 0,
    },
  ];
  // Dos bandas anchas: es la marca que se lee de lejos.
  for (const y of [-0.2, 0.2]) {
    parts.push({
      geometry: new CylinderGeometry(radius * 1.02, radius * 1.02, 0.16, segments, 1),
      position: [0, y * (height / 0.95), 0],
      tile: 3,
    });
  }
  for (const sy of [-1, 1]) {
    parts.push({
      geometry: new CylinderGeometry(radius * 1.05, radius * 1.05, 0.05, segments, 1),
      position: [0, (sy * (height - 0.05)) / 2, 0],
      tile: 3,
    });
  }
  if (lod === 0) {
    // Collar y racimo de válvulas: la silueta que lo separa del barril común.
    parts.push({
      geometry: new CylinderGeometry(radius * 0.72, radius * 0.72, 0.05, segments, 1),
      position: [0, height / 2 + 0.02, 0],
      tile: 3,
    });
    for (const sx of [-1, 1]) {
      parts.push({
        geometry: new CylinderGeometry(0.032, 0.032, 0.09, 8, 1),
        position: [sx * 0.1, height / 2 + 0.07, 0],
        tile: 3,
      });
    }
    parts.push({
      geometry: chamferBox(0.24, 0.028, 0.05, 0.006),
      position: [0, height / 2 + 0.11, 0],
      tile: 3,
    });
  }
  return { parts };
};

/** Archivero: chasis, zócalo y cuatro cajones con tiradores. */
const filingCabinet: PropBuilder = (variant, lod) => {
  const random = variantRandom("filingCabinet", variant);
  const width = 0.5;
  const height = 1.32;
  const depth = 0.62 * jitter(random, 0.02);
  const drawers = lod === 0 ? 4 : 2;
  const parts: GeometryPart[] = [
    { geometry: chamferBox(width, height, depth, 0.012), position: [0, 0, 0], tile: 0 },
    {
      geometry: chamferBox(width * 0.94, 0.08, depth * 0.94, 0.008),
      position: [0, -height / 2 + 0.04, 0],
      tile: 3,
    },
  ];
  const drawerHeight = (height - 0.16) / drawers;
  for (let index = 0; index < drawers; index += 1) {
    const y = -height / 2 + 0.12 + drawerHeight * (index + 0.5);
    parts.push({
      geometry: chamferBox(width * 0.9, drawerHeight - 0.02, 0.02, 0.005),
      position: [0, y, depth / 2],
      tile: 0,
    });
    if (lod === 0) {
      parts.push({
        geometry: chamferBox(width * 0.34, 0.03, 0.03, 0.006),
        position: [0, y, depth / 2 + 0.02],
        tile: 3,
      });
    }
  }
  return { parts };
};

/** Radiador de fundición: colectores arriba y abajo, aletas verticales, llave. */
const radiator: PropBuilder = (_variant, lod) => {
  const width = 0.9;
  const height = 0.6;
  const depth = 0.14;
  const fins: number = lod === 0 ? 11 : 5;
  const parts: GeometryPart[] = [];
  for (const sy of [-1, 1]) {
    parts.push({
      geometry: new CylinderGeometry(0.035, 0.035, width, lod === 0 ? 10 : 6, 1),
      position: [0, (sy * (height - 0.07)) / 2, 0],
      rotation: [0, 0, Math.PI / 2],
      tile: 1,
    });
  }
  for (let index = 0; index < fins; index += 1) {
    const t = fins === 1 ? 0.5 : index / (fins - 1);
    parts.push({
      geometry: chamferBox(width / fins - 0.014, height - 0.1, depth, 0.006),
      position: [(t - 0.5) * (width - width / fins), 0, 0],
      tile: 1,
    });
  }
  if (lod === 0) {
    parts.push({
      geometry: new CylinderGeometry(0.03, 0.03, 0.07, 8, 1),
      position: [width / 2 - 0.02, -height / 2 + 0.04, 0],
      rotation: [0, 0, Math.PI / 2],
      tile: 3,
    });
  }
  return { parts };
};

/** Bloque hueco de hormigón, con sus dos celdas. */
const concreteBlock: PropBuilder = (variant, lod) => {
  const random = variantRandom("concreteBlock", variant);
  const width = 0.4;
  const height = 0.2;
  const depth = 0.2 * jitter(random, 0.04);
  const wall = 0.032;
  if (lod === 1) {
    return { parts: [{ geometry: chamferBox(width, height, depth, 0.006), tile: 2 }] };
  }
  const parts: GeometryPart[] = [];
  // Paredes exteriores más dos tabiques: las celdas quedan por construcción.
  for (const sx of [-1, 1]) {
    parts.push({
      geometry: chamferBox(wall, height, depth, 0.005),
      position: [sx * (width - wall) / 2, 0, 0],
      tile: 2,
    });
  }
  for (const sz of [-1, 1]) {
    parts.push({
      geometry: chamferBox(width - wall * 2, height, wall, 0.005),
      position: [0, 0, sz * (depth - wall) / 2],
      tile: 2,
    });
  }
  parts.push({
    geometry: chamferBox(wall, height, depth - wall * 2, 0.005),
    position: [0, 0, 0],
    tile: 2,
  });
  return { parts };
};

// ---------------------------------------------------------------------------
// Sintéticos
// ---------------------------------------------------------------------------

/** Bidón plástico: cuerpo nervado, boca roscada y asas laterales. */
const plasticDrum: PropBuilder = (variant, lod) => {
  const random = variantRandom("plasticDrum", variant);
  const radius = 0.3;
  const height = 0.9 * jitter(random, 0.02);
  const segments = lod === 0 ? 18 : 9;
  const parts: GeometryPart[] = [
    {
      geometry: new CylinderGeometry(radius * 0.96, radius, height - 0.06, segments, 1),
      position: [0, 0, 0],
      tile: random() > 0.5 ? 0 : 1,
    },
    {
      geometry: new CylinderGeometry(radius * 0.82, radius * 0.9, 0.06, segments, 1),
      position: [0, height / 2 - 0.03, 0],
      tile: 0,
    },
  ];
  const ribs = lod === 0 ? 3 : 1;
  for (let index = 0; index < ribs; index += 1) {
    const t = ribs === 1 ? 0.5 : index / (ribs - 1);
    parts.push({
      geometry: new CylinderGeometry(radius * 1.03, radius * 1.03, 0.03, segments, 1),
      position: [0, (t - 0.5) * (height - 0.3), 0],
      tile: 1,
    });
  }
  if (lod === 0) {
    parts.push({
      geometry: new CylinderGeometry(0.055, 0.055, 0.04, 10, 1),
      position: [0, height / 2, 0],
      tile: 2,
    });
  }
  return { parts };
};

/** Televisor de tubo: gabinete que se afina hacia atrás, bisel y pantalla. */
const crtTelevision: PropBuilder = (variant, lod) => {
  const random = variantRandom("crtTelevision", variant);
  const width = 0.52;
  const height = 0.44;
  const depth = 0.48 * jitter(random, 0.03);
  const parts: GeometryPart[] = [
    {
      geometry: chamferWedge({
        length: depth,
        height,
        frontWidth: width,
        rearWidth: width * 0.62,
        chamfer: 0.012,
      }),
      rotation: [0, Math.PI, 0],
      tile: 3,
    },
    {
      geometry: chamferBox(width * 0.94, height * 0.9, 0.03, 0.008),
      position: [0, 0, depth / 2 - 0.01],
      tile: 1,
    },
  ];
  if (lod === 0) {
    for (let index = 0; index < 2; index += 1) {
      parts.push({
        geometry: new CylinderGeometry(0.022, 0.022, 0.02, 10, 1),
        position: [width / 2 - 0.05, -height / 2 + 0.07 + index * 0.06, depth / 2],
        rotation: [Math.PI / 2, 0, 0],
        tile: 2,
      });
    }
  }
  return {
    parts,
    glass: [
      {
        geometry: chamferBox(width * 0.8, height * 0.76, 0.02, 0.02),
        position: [0, 0, depth / 2 + 0.002],
        tile: 3,
      },
    ],
  };
};

/** Botella: cuerpo, hombro cónico, cuello y tapa. */
const glassBottle: PropBuilder = (variant, lod) => {
  const random = variantRandom("glassBottle", variant);
  const height = 0.29 * jitter(random, 0.05);
  const radius = 0.037;
  const segments = lod === 0 ? 12 : 7;
  const bodyHeight = height * 0.58;
  const glass: GeometryPart[] = [
    {
      geometry: new CylinderGeometry(radius, radius, bodyHeight, segments, 1),
      position: [0, -height / 2 + bodyHeight / 2, 0],
      tile: 3,
    },
    {
      geometry: new CylinderGeometry(radius * 0.42, radius, height * 0.2, segments, 1),
      position: [0, -height / 2 + bodyHeight + height * 0.1, 0],
      tile: 3,
    },
    {
      geometry: new CylinderGeometry(radius * 0.4, radius * 0.42, height * 0.22, segments, 1),
      position: [0, height / 2 - height * 0.11 - 0.01, 0],
      tile: 3,
    },
  ];
  const parts: GeometryPart[] = [
    {
      geometry: new CylinderGeometry(radius * 0.44, radius * 0.44, 0.02, segments, 1),
      position: [0, height / 2 - 0.01, 0],
      tile: 1,
    },
  ];
  if (lod === 0) {
    // Etiqueta: sin ella la botella es un cilindro de vidrio sin escala.
    parts.push({
      geometry: new CylinderGeometry(radius * 1.02, radius * 1.02, bodyHeight * 0.45, segments, 1),
      position: [0, -height / 2 + bodyHeight * 0.5, 0],
      tile: 0,
    });
  }
  return { parts, glass };
};

/** Cono: base cuadrada, cuerpo cónico y dos bandas reflectivas. */
const trafficCone: PropBuilder = (_variant, lod) => {
  const height = 0.72;
  const baseSide = 0.36;
  const segments = lod === 0 ? 14 : 7;
  const coneHeight = height - 0.03;
  const parts: GeometryPart[] = [
    {
      geometry: chamferBox(baseSide, 0.03, baseSide, 0.008),
      position: [0, -height / 2 + 0.015, 0],
      tile: 2,
    },
    {
      geometry: new CylinderGeometry(0.028, baseSide * 0.42, coneHeight, segments, 1),
      position: [0, -height / 2 + 0.03 + coneHeight / 2, 0],
      tile: 0,
    },
  ];
  if (lod === 0) {
    for (const [y, scale] of [
      [0.34, 0.62],
      [0.5, 0.44],
    ] as const) {
      parts.push({
        geometry: new CylinderGeometry(
          baseSide * scale * 0.4,
          baseSide * scale * 0.46,
          0.06,
          segments,
          1,
        ),
        position: [0, -height / 2 + coneHeight * y, 0],
        tile: 1,
      });
    }
  }
  return { parts };
};

export const PROP_BUILDERS: Readonly<Record<PropAssetId, PropBuilder>> = {
  woodenCrate,
  pallet,
  chair,
  table,
  metalBarrel,
  explosiveBarrel,
  filingCabinet,
  radiator,
  concreteBlock,
  plasticDrum,
  crtTelevision,
  glassBottle,
  trafficCone,
};

// ---------------------------------------------------------------------------
// Cascos de colisión y fragmentos
// ---------------------------------------------------------------------------

/** Puntos de una parte en espacio del prop, ya con su pose aplicada. */
function partPoints(part: GeometryPart): Vector3[] {
  const matrix = new Matrix4().compose(
    new Vector3(...(part.position ?? [0, 0, 0])),
    new Quaternion().setFromEuler(new ThreeEuler(...(part.rotation ?? [0, 0, 0]))),
    new Vector3(...(part.scale ?? [1, 1, 1])),
  );
  const attribute = part.geometry.getAttribute("position");
  const points: Vector3[] = [];
  for (let index = 0; index < attribute.count; index += 1) {
    points.push(
      new Vector3(
        attribute.getX(index),
        attribute.getY(index),
        attribute.getZ(index),
      ).applyMatrix4(matrix),
    );
  }
  return points;
}

export interface Bounds {
  readonly min: Vector3;
  readonly max: Vector3;
}

export function boundsOf(parts: readonly GeometryPart[]): Bounds {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const part of parts) {
    for (const point of partPoints(part)) {
      min.min(point);
      max.max(point);
    }
  }
  return { min, max };
}

/**
 * Casco de colisión del prop: la caja envolvente, salvo que el prop sea
 * claramente cilíndrico, en cuyo caso un prisma de ocho caras rueda como debe.
 * No se usa el casco convexo de la malla completa porque un radiador con once
 * aletas daría 400 vértices para describir una caja.
 */
export function colliderPoints(
  bounds: Bounds,
  cylindrical: boolean,
): Float32Array<ArrayBuffer> {
  const center = new Vector3().addVectors(bounds.min, bounds.max).multiplyScalar(0.5);
  const size = new Vector3().subVectors(bounds.max, bounds.min);
  const points: number[] = [];
  if (cylindrical) {
    const radius = Math.max(size.x, size.z) / 2;
    const sides = 8;
    for (let index = 0; index < sides; index += 1) {
      const angle = (index / sides) * Math.PI * 2;
      // El radio se corrige para que el prisma circunscriba al cilindro real.
      const scaled = radius / Math.cos(Math.PI / sides);
      for (const sy of [-1, 1]) {
        points.push(
          center.x + Math.cos(angle) * scaled,
          center.y + (sy * size.y) / 2,
          center.z + Math.sin(angle) * scaled,
        );
      }
    }
  } else {
    for (let corner = 0; corner < 8; corner += 1) {
      points.push(
        center.x + ((corner & 1 ? 1 : -1) * size.x) / 2,
        center.y + ((corner & 2 ? 1 : -1) * size.y) / 2,
        center.z + ((corner & 4 ? 1 : -1) * size.z) / 2,
      );
    }
  }
  return new Float32Array(points);
}

export interface PropChunk {
  readonly parts: readonly GeometryPart[];
  /** Dirección del centroide del fragmento desde el centro del prop. */
  readonly sector: Vec3;
  readonly massFraction: number;
}

function partCentroid(part: GeometryPart): Vector3 {
  const points = partPoints(part);
  const centroid = new Vector3();
  for (const point of points) centroid.add(point);
  return points.length > 0 ? centroid.divideScalar(points.length) : centroid;
}

function partVolume(part: GeometryPart): number {
  const points = partPoints(part);
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const point of points) {
    min.min(point);
    max.max(point);
  }
  const size = new Vector3().subVectors(max, min);
  return Math.max(size.x * size.y * size.z, 1e-6);
}

/**
 * Reparte las piezas del prop en `count` fragmentos, agrupándolas por su ángulo
 * alrededor del eje Y.
 *
 * Los pedazos no se autoran aparte: un cajón roto SON sus seis tablas y una mesa
 * rota son su tabla y sus patas. Derivarlos de la construcción da gibs que
 * calzan con el prop entero, y evita mantener dos geometrías por arquetipo que
 * se desincronizarían a la primera corrección de proporciones.
 */
export function deriveChunks(
  parts: readonly GeometryPart[],
  count: number,
): PropChunk[] {
  if (count <= 0 || parts.length === 0) return [];
  const entries = parts.map((part) => ({
    part,
    centroid: partCentroid(part),
    volume: partVolume(part),
  }));
  // El ángulo ordena; la altura desempata para que un prop plano (pallet, mesa)
  // no reparta todos sus tablones en el mismo sector.
  entries.sort((a, b) => {
    const angleA = Math.atan2(a.centroid.z, a.centroid.x);
    const angleB = Math.atan2(b.centroid.z, b.centroid.x);
    return angleA === angleB ? a.centroid.y - b.centroid.y : angleA - angleB;
  });

  const groups = Math.min(count, entries.length);
  const chunks: PropChunk[] = [];
  const totalVolume = entries.reduce((sum, entry) => sum + entry.volume, 0);
  for (let index = 0; index < groups; index += 1) {
    const from = Math.floor((index * entries.length) / groups);
    const to = Math.floor(((index + 1) * entries.length) / groups);
    const slice = entries.slice(from, Math.max(to, from + 1));
    if (slice.length === 0) continue;
    const centroid = new Vector3();
    let volume = 0;
    for (const entry of slice) {
      centroid.add(entry.centroid);
      volume += entry.volume;
    }
    centroid.divideScalar(slice.length);
    const sector = centroid.lengthSq() > 1e-8 ? centroid.clone().normalize() : new Vector3(0, 1, 0);
    chunks.push({
      parts: slice.map((entry) => entry.part),
      sector: [sector.x, sector.y, sector.z],
      massFraction: volume / totalVolume,
    });
  }
  return chunks;
}

/** Geometría fusionada sin UVs: sólo para cascos de colisión. */
export function mergeRaw(parts: readonly GeometryPart[]): BufferGeometry {
  const geometries = parts.map((part) => {
    const geometry = part.geometry.clone();
    geometry.applyMatrix4(
      new Matrix4().compose(
        new Vector3(...(part.position ?? [0, 0, 0])),
        new Quaternion().setFromEuler(new ThreeEuler(...(part.rotation ?? [0, 0, 0]))),
        new Vector3(...(part.scale ?? [1, 1, 1])),
      ),
    );
    geometry.deleteAttribute("uv");
    geometry.deleteAttribute("normal");
    return geometry;
  });
  const merged = mergeGeometries(geometries, false);
  for (const geometry of geometries) geometry.dispose();
  if (merged === null) throw new Error("No se pudo combinar la geometría del prop.");
  return merged;
}
