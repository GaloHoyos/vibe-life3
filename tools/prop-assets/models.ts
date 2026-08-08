import {
  BufferGeometry,
  CylinderGeometry,
  Euler as ThreeEuler,
  Matrix4,
  Quaternion,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { chamferBox, chamferWedge, wheel } from "../shared/gltf/geometry.js";
import type { PropBuilder, PropLod } from "./builderKit.js";
import { variantRandom } from "./builderKit.js";
import { DEBRIS_BUILDERS } from "./modelsDebris.js";
import { INTERIOR_BUILDERS } from "./modelsInterior.js";
import { TECH_BUILDERS } from "./modelsTech.js";
import type { Euler, GeometryPart, PropAssetId, Vec3 } from "./types.js";

/**
 * Geometría procedural de los props. Cada arquetipo se arma con las mismas
 * primitivas biseladas que los vehículos: un canto de pocos milímetros es lo que
 * separa un blockout de una pieza construida.
 *
 * El origen de cada prop es el CENTRO de su AABB (no la base), porque el cuerpo
 * físico vive en el centro y así la malla y el collider comparten marco.
 */

export type { PropBuilder, PropGeometry, PropLod } from "./builderKit.js";
export { variantRandom } from "./builderKit.js";

// ---------------------------------------------------------------------------
// Madera
// ---------------------------------------------------------------------------

/**
 * Cajón: seis tablas biseladas más listones de canto. Se arma con caras y no
 * con una caja maciza porque al romperse las caras SON los pedazos.
 */
const woodenCrate: PropBuilder = (variant, lod) => {
  const random = variantRandom("woodenCrate", variant);
  const side = 0.86;
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
    // Flejes metálicos de refuerzo: uno o dos, a distinta altura por variante.
    const straps = random() > 0.45 ? 2 : 1;
    for (let index = 0; index < straps; index += 1) {
      parts.push({
        geometry: chamferBox(side * 0.96, 0.035, 0.012, 0.004),
        position: [0, half * (straps === 1 ? 0.45 : index === 0 ? 0.55 : -0.35), inset + thickness / 2],
        tile: 2,
      });
    }
  }
  return { parts };
};

/** Pallet: tres tacos, tres largueros y las tablas de arriba. */
const pallet: PropBuilder = (variant, lod) => {
  const random = variantRandom("pallet", variant);
  const width = 1.2;
  const depth = 0.8;
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
  const seatY = -0.92 / 2 + 0.45 + (random() - 0.5) * 0.04;
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
  const width = 1.4;
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
    // El faldón corre en dos lados o en los cuatro, según la variante.
    const skirted: readonly (readonly [number, number])[] =
      random() > 0.5
        ? [[0, -1], [0, 1]]
        : [[0, -1], [0, 1], [-1, 0], [1, 0]];
    for (const [sx, sz] of skirted) {
      const alongX = sz !== 0;
      parts.push({
        geometry: alongX
          ? chamferBox(width - 0.2, 0.07, 0.02, 0.005)
          : chamferBox(0.02, 0.07, depth - 0.2, 0.005),
        position: [
          sx * (width / 2 - 0.06),
          height / 2 - topThickness - 0.06,
          sz * (depth / 2 - 0.06),
        ],
        tile: 0,
      });
    }
  }
  return { parts };
};

/**
 * Caja de cartón: cuatro paredes finas, fondo y solapas arriba.
 *
 * Hueca y no maciza porque al romperse las paredes SON los pedazos, igual que
 * en el cajón de madera.
 */
const cardboardBox: PropBuilder = (variant, lod) => {
  const random = variantRandom("cardboardBox", variant);
  const width = 0.45;
  const height = 0.4;
  const depth = 0.35;
  const wall = 0.012;
  // Las paredes no llegan al tope declarado: los últimos 4 cm son las solapas.
  const bodyHeight = 0.36;
  const bodyTop = -height / 2 + bodyHeight;
  const parts: GeometryPart[] = [];

  for (const sx of [-1, 1]) {
    parts.push({
      geometry: chamferBox(wall, bodyHeight, depth, 0.004),
      position: [(sx * (width - wall)) / 2, -height / 2 + bodyHeight / 2, 0],
      tile: 3,
    });
  }
  for (const sz of [-1, 1]) {
    parts.push({
      geometry: chamferBox(width - wall * 2, bodyHeight, wall, 0.004),
      position: [0, -height / 2 + bodyHeight / 2, (sz * (depth - wall)) / 2],
      tile: 3,
    });
  }
  parts.push({
    geometry: chamferBox(width - wall * 2, wall, depth - wall * 2, 0.004),
    position: [0, -height / 2 + wall / 2, 0],
    tile: 3,
  });

  // Solapas: una levantada y la otra caída hacia adentro. Que no sean simétricas
  // es lo que hace que la caja se lea abierta y no tapada.
  //
  // El ángulo es FIJO y va en los dos LODs a propósito: es lo que define el
  // tope de la caja, y una envolvente que cambie por variante o por LOD deja al
  // prop flotando (todas comparten un solo casco y un solo `bounds`).
  const flapDepth = depth * 0.46;
  const lifted = random() > 0.5 ? 1 : -1;
  for (const sz of [-1, 1]) {
    parts.push({
      geometry: chamferBox(width - wall * 2, wall, flapDepth, 0.003),
      position: [0, bodyTop - wall / 2, sz * depth * 0.24],
      rotation: [sz * lifted * 0.5, 0, 0],
      tile: 3,
    });
  }
  if (lod === 0) {
    parts.push({
      geometry: chamferBox(width * 0.24, wall * 0.5, depth * 0.99, 0.002),
      position: [(random() - 0.5) * width * 0.3, bodyTop - wall * 1.4, 0],
      tile: 0,
    });
  }
  return { parts };
};

/** Cartón de leche: prisma con el techo a dos aguas y la cresta plegada. */
const milkCarton: PropBuilder = (variant, lod) => {
  const random = variantRandom("milkCarton", variant);
  const side = 0.09;
  const height = 0.24;
  const bodyHeight = height * 0.72;
  const gableHeight = height - bodyHeight;
  const parts: GeometryPart[] = [
    {
      geometry: chamferBox(side, bodyHeight, side, 0.004),
      position: [0, -height / 2 + bodyHeight / 2, 0],
      tile: 3,
    },
    // El techo a dos aguas: full ancho abajo, cerrado hasta la cresta arriba.
    // La cuña se estrecha en X a lo largo de Y, así que el caballete corre
    // sobre Z sin necesidad de rotarla.
    {
      geometry: chamferWedge({
        length: side,
        height: gableHeight,
        frontWidth: side,
        rearWidth: side,
        topFrontWidth: side * 0.16,
        topRearWidth: side * 0.16,
        chamfer: 0.003,
      }),
      position: [0, -height / 2 + bodyHeight + gableHeight / 2, 0],
      tile: 3,
    },
  ];
  if (lod === 0) {
    parts.push({
      geometry: chamferBox(side * 0.14, gableHeight * 0.5, side * 0.98, 0.002),
      position: [0, height / 2 - gableHeight * 0.12, 0],
      tile: 3,
    });
    // Franja impresa: le da escala y un frente reconocible.
    parts.push({
      geometry: chamferBox(side * 1.01, bodyHeight * (0.3 + random() * 0.12), side * 1.01, 0.002),
      position: [0, -height / 2 + bodyHeight * 0.55, 0],
      tile: 0,
    });
  }
  return { parts };
};

/** Tabla suelta: la pieza alargada del set, para colliders que no son cubos. */
const woodPlank: PropBuilder = (variant, lod) => {
  const random = variantRandom("woodPlank", variant);
  const length = 1.6;
  const width = 0.19;
  const thickness = 0.045;
  const parts: GeometryPart[] = [
    {
      geometry: chamferBox(length, thickness, width, 0.005),
      tile: random() > 0.5 ? 0 : 1,
    },
  ];
  // Clavos pasantes en una punta: la tabla viene de algo que se desarmó. Van en
  // los dos LODs porque son ellos los que fijan el alto declarado, y una
  // envolvente que cambie por LOD deja al prop mal apoyado.
  const nails = 3;
  for (let index = 0; index < nails; index += 1) {
    parts.push({
      geometry: new CylinderGeometry(0.005, 0.005, 0.072, lod === 0 ? 6 : 4, 1),
      position: [
        length / 2 - 0.06 - index * 0.05,
        0,
        (index % 2 === 0 ? 1 : -1) * width * 0.28,
      ],
      tile: 2,
    });
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
  const height = 0.95;
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
  const height = 0.95;
  const segments = lod === 0 ? 20 : 10;
  const parts: GeometryPart[] = [
    {
      geometry: new CylinderGeometry(radius, radius, height - 0.04, segments, 1),
      tile: 0,
    },
  ];
  // Dos bandas anchas: es la marca que se lee de lejos. La variante las corre
  // sin tocar el envolvente.
  const bandOffset = 0.18 + random() * 0.06;
  for (const y of [-bandOffset, bandOffset]) {
    parts.push({
      geometry: new CylinderGeometry(radius * 1.02, radius * 1.02, 0.16, segments, 1),
      position: [0, y, 0],
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
  const depth = 0.62;
  const drawers: number = lod === 0 ? (random() > 0.5 ? 4 : 3) : 2;
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
  const depth = 0.2;
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
  // El tabique central corrido: dos celdas desiguales, como un bloque real.
  parts.push({
    geometry: chamferBox(wall, height, depth - wall * 2, 0.005),
    position: [(random() - 0.5) * 0.06, 0, 0],
    tile: 2,
  });
  return { parts };
};

/** Balde: tronco de cono, aro de boca y asa de alambre. */
const metalBucket: PropBuilder = (variant, lod) => {
  const random = variantRandom("metalBucket", variant);
  const topRadius = 0.14;
  const bottomRadius = 0.105;
  const height = 0.3;
  const segments = lod === 0 ? 16 : 8;
  const parts: GeometryPart[] = [
    {
      geometry: new CylinderGeometry(topRadius, bottomRadius, height - 0.02, segments, 1),
      position: [0, -0.01, 0],
      tile: random() > 0.5 ? 0 : 1,
    },
    {
      geometry: new CylinderGeometry(topRadius, topRadius, 0.02, segments, 1),
      position: [0, height / 2 - 0.01, 0],
      tile: 3,
    },
  ];
  // El asa arqueada, en tres tramos rectos. Es la silueta del balde: sin ella es
  // un tacho. Va en los dos LODs porque fija el alto declarado del prop.
  const wire = lod === 0 ? 6 : 4;
  parts.push({
    geometry: new CylinderGeometry(0.006, 0.006, topRadius * 1.7, wire, 1),
    position: [0, height / 2 + topRadius * 0.52, 0],
    rotation: [0, 0, Math.PI / 2],
    tile: 3,
  });
  for (const sx of [-1, 1]) {
    parts.push({
      geometry: new CylinderGeometry(0.006, 0.006, topRadius * 0.78, wire, 1),
      position: [sx * topRadius * 0.82, height / 2 + topRadius * 0.24, 0],
      rotation: [0, 0, sx * 0.42],
      tile: 3,
    });
  }
  return { parts };
};

/** Lata de pintura: cilindro bajo, tapa hundida y asa. */
const paintCan: PropBuilder = (variant, lod) => {
  const random = variantRandom("paintCan", variant);
  const radius = 0.095;
  const height = 0.22;
  const segments = lod === 0 ? 14 : 8;
  const parts: GeometryPart[] = [
    {
      geometry: new CylinderGeometry(radius, radius, height - 0.02, segments, 1),
      tile: random() > 0.5 ? 0 : 1,
    },
    // Reborde de la tapa: el escalón que se hace palanca para abrirla.
    {
      geometry: new CylinderGeometry(radius * 1.03, radius * 1.03, 0.018, segments, 1),
      position: [0, height / 2 - 0.009, 0],
      tile: 3,
    },
    {
      geometry: new CylinderGeometry(radius * 1.02, radius * 1.02, 0.014, segments, 1),
      position: [0, -height / 2 + 0.007, 0],
      tile: 3,
    },
  ];
  // Igual que en el balde: el asa fija el alto declarado, así que va en ambos.
  parts.push({
    geometry: new CylinderGeometry(0.005, 0.005, radius * 1.9, lod === 0 ? 6 : 4, 1),
    position: [0, height / 2 + radius * 0.42, 0],
    rotation: [0, 0, Math.PI / 2],
    tile: 3,
  });
  if (lod === 0) {
    // Etiqueta corrida: el color del contenido, que es lo que la identifica.
    parts.push({
      geometry: new CylinderGeometry(radius * 1.01, radius * 1.01, height * 0.42, segments, 1),
      position: [0, -height * 0.08, 0],
      tile: 0,
    });
  }
  return { parts };
};

/** Lata de conserva: el prop más liviano del set, munición de gravity gun. */
const soupCan: PropBuilder = (variant, lod) => {
  const random = variantRandom("soupCan", variant);
  const radius = 0.0375;
  const height = 0.11;
  const segments = lod === 0 ? 12 : 6;
  const parts: GeometryPart[] = [
    {
      geometry: new CylinderGeometry(radius * 0.97, radius * 0.97, height - 0.012, segments, 1),
      tile: 3,
    },
  ];
  // Los dos bordes engarzados: sin ellos es un cilindro, con ellos es una lata.
  for (const sy of [-1, 1]) {
    parts.push({
      geometry: new CylinderGeometry(radius, radius, 0.008, segments, 1),
      position: [0, (sy * (height - 0.008)) / 2, 0],
      tile: 3,
    });
  }
  if (lod === 0) {
    parts.push({
      geometry: new CylinderGeometry(radius * 1.005, radius * 1.005, height * (0.55 + random() * 0.1), segments, 1),
      tile: random() > 0.5 ? 0 : 1,
    });
  }
  return { parts };
};

/** Tacho de basura: cuerpo cónico nervado con tapa suelta. */
const trashBin: PropBuilder = (variant, lod) => {
  const random = variantRandom("trashBin", variant);
  const topRadius = 0.21;
  const bottomRadius = 0.165;
  const height = 0.62;
  const segments = lod === 0 ? 16 : 8;
  // La tapa va SIEMPRE: que estuviera o no por variante hacía que el tacho
  // midiera 2 cm distinto según cuál tocara, y todas comparten un solo casco.
  const bodyTop = height - 0.05;
  const parts: GeometryPart[] = [
    {
      geometry: new CylinderGeometry(topRadius, bottomRadius, bodyTop, segments, 1),
      position: [0, -(height - bodyTop) / 2, 0],
      tile: random() > 0.5 ? 0 : 1,
    },
  ];
  const ribs = lod === 0 ? 3 : 1;
  for (let index = 0; index < ribs; index += 1) {
    const t = ribs === 1 ? 0.5 : index / (ribs - 1);
    parts.push({
      geometry: new CylinderGeometry(topRadius * 1.02, topRadius * 1.02, 0.022, segments, 1),
      position: [0, -height / 2 + 0.1 + t * (bodyTop - 0.2), 0],
      tile: 3,
    });
  }
  parts.push({
    geometry: new CylinderGeometry(topRadius * 0.9, topRadius * 1.06, 0.05, segments, 1),
    position: [0, height / 2 - 0.025, 0],
    tile: 3,
  });
  return { parts };
};

/** Bidón de nafta tipo jerrican: chapa plana, pico y asa de puente. */
const gasCan: PropBuilder = (variant, lod) => {
  const random = variantRandom("gasCan", variant);
  const width = 0.18;
  const height = 0.42;
  const depth = 0.32;
  const parts: GeometryPart[] = [
    {
      geometry: chamferBox(width, height * 0.86, depth, 0.018),
      position: [0, -height * 0.07, 0],
      tile: random() > 0.5 ? 0 : 1,
    },
  ];
  if (lod === 0) {
    // Las dos nervaduras en X estampadas en el flanco: es LA marca del jerrican.
    for (const sx of [-1, 1]) {
      for (const angle of [0.62, -0.62]) {
        parts.push({
          geometry: chamferBox(0.008, height * 0.62, 0.03, 0.003),
          position: [sx * (width / 2), -height * 0.07, 0],
          rotation: [angle, 0, 0],
          tile: 3,
        });
      }
    }
    // Asa de puente sobre el lomo.
    parts.push({
      geometry: chamferBox(width * 0.55, 0.022, depth * 0.5, 0.006),
      position: [0, height / 2 - 0.02, -depth * 0.12],
      tile: 3,
    });
    // Pico roscado, adelante y arriba.
    parts.push({
      geometry: new CylinderGeometry(0.028, 0.032, 0.055, 10, 1),
      position: [0, height / 2 - 0.03, depth * 0.3],
      rotation: [0.5, 0, 0],
      tile: 3,
    });
  }
  return { parts };
};

/** Garrafa de propano: cuerpo, domo, collar de protección y válvula. */
const propaneTank: PropBuilder = (variant, lod) => {
  const random = variantRandom("propaneTank", variant);
  const radius = 0.155;
  const height = 0.58;
  const segments = lod === 0 ? 16 : 8;
  const bodyHeight = height * 0.62;
  const parts: GeometryPart[] = [
    {
      geometry: new CylinderGeometry(radius, radius, bodyHeight, segments, 1),
      position: [0, -height / 2 + bodyHeight / 2 + 0.03, 0],
      tile: random() > 0.5 ? 0 : 1,
    },
    // Domo superior: el hombro redondeado que la distingue de un barril.
    {
      geometry: new CylinderGeometry(radius * 0.42, radius, height * 0.16, segments, 1),
      position: [0, -height / 2 + bodyHeight + height * 0.08 + 0.03, 0],
      tile: 0,
    },
    // Pie anular.
    {
      geometry: new CylinderGeometry(radius * 0.94, radius * 0.94, 0.06, segments, 1),
      position: [0, -height / 2 + 0.03, 0],
      tile: 3,
    },
  ];
  if (lod === 0) {
    // Collar: el aro calado que protege la válvula. Es la lectura de "esto
    // tiene gas adentro" a distancia.
    parts.push({
      geometry: new CylinderGeometry(radius * 0.62, radius * 0.62, height * 0.14, segments, 1),
      position: [0, height / 2 - height * 0.07, 0],
      tile: 3,
    });
    parts.push({
      geometry: new CylinderGeometry(0.026, 0.03, 0.06, 8, 1),
      position: [0, height / 2 - height * 0.1, 0],
      tile: 3,
    });
  }
  return { parts };
};

/**
 * Trozo de losa reventada, con hierros salidos.
 *
 * Es escombro y no un bloque: caras irregulares por variante y armadura
 * asomando. `concreteBlock` es un ladrillo entero e indestructible; esto es lo
 * que queda DESPUÉS.
 */
const concreteChunk: PropBuilder = (variant, lod) => {
  const random = variantRandom("concreteChunk", variant);
  const width = 0.45;
  const height = 0.22;
  const depth = 0.38;
  const parts: GeometryPart[] = [
    {
      geometry: chamferWedge({
        length: depth,
        height,
        frontWidth: width,
        rearWidth: width * (0.68 + random() * 0.2),
        topFrontWidth: width * (0.74 + random() * 0.16),
        topRearWidth: width * (0.6 + random() * 0.2),
        chamfer: 0.02,
      }),
      tile: 2,
    },
  ];
  // Hierros doblados saliendo de la fractura. Cantidad, largo y ángulo FIJOS:
  // la variante ya cambia la forma de la losa, y si además cambiara el vuelo de
  // los hierros cada trozo mediría distinto (todos comparten un solo casco).
  // Van en los dos LODs porque son ellos los que fijan el fondo declarado.
  for (let index = 0; index < 3; index += 1) {
    const t = (index + 0.5) / 3;
    parts.push({
      geometry: new CylinderGeometry(0.008, 0.008, 0.2, lod === 0 ? 5 : 4, 1),
      position: [(t - 0.5) * width * 0.7, height * 0.16, -depth * 0.36],
      rotation: [1.15, (index - 1) * 0.3, 0],
      tile: 1,
    });
  }
  return { parts };
};

/** Caño suelto: la otra pieza alargada, en metal. */
const metalPipe: PropBuilder = (variant, lod) => {
  const random = variantRandom("metalPipe", variant);
  const length = 1.4;
  const radius = 0.045;
  const segments = lod === 0 ? 12 : 6;
  const parts: GeometryPart[] = [
    {
      geometry: new CylinderGeometry(radius, radius, length, segments, 1),
      rotation: [0, 0, Math.PI / 2],
      tile: random() > 0.5 ? 1 : 3,
    },
  ];
  if (lod === 0) {
    // Bridas en las puntas: un cilindro pelado lee como palo.
    for (const sx of [-1, 1]) {
      parts.push({
        geometry: new CylinderGeometry(radius * 1.28, radius * 1.28, 0.035, segments, 1),
        position: [sx * (length / 2 - 0.02), 0, 0],
        rotation: [0, 0, Math.PI / 2],
        tile: 3,
      });
    }
  }
  return { parts };
};

// ---------------------------------------------------------------------------
// Sintéticos
// ---------------------------------------------------------------------------

/** Bidón plástico: cuerpo nervado, boca roscada y asas laterales. */
const plasticDrum: PropBuilder = (variant, lod) => {
  const random = variantRandom("plasticDrum", variant);
  const radius = 0.3;
  const height = 0.9;
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
  const depth = 0.48;
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
    const knobs = random() > 0.5 ? 3 : 2;
    for (let index = 0; index < knobs; index += 1) {
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
  const height = 0.29;
  const radius = 0.037;
  const segments = lod === 0 ? 12 : 7;
  // Cuerpo más o menos alto contra el hombro: cambia la silueta sin cambiar el
  // alto total, que es lo que el casco y el `bounds` dan por sentado.
  const bodyHeight = height * (0.52 + random() * 0.12);
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

/** Botella de plástico: cuerpo nervado, hombro y tapa a rosca. */
const plasticBottle: PropBuilder = (variant, lod) => {
  const random = variantRandom("plasticBottle", variant);
  const height = 0.24;
  const radius = 0.0375;
  const segments = lod === 0 ? 12 : 6;
  const bodyHeight = height * (0.56 + random() * 0.08);
  const parts: GeometryPart[] = [
    {
      geometry: new CylinderGeometry(radius, radius * 0.96, bodyHeight, segments, 1),
      position: [0, -height / 2 + bodyHeight / 2, 0],
      tile: random() > 0.5 ? 1 : 3,
    },
    {
      geometry: new CylinderGeometry(radius * 0.34, radius, height * 0.22, segments, 1),
      position: [0, -height / 2 + bodyHeight + height * 0.11, 0],
      tile: 1,
    },
    {
      geometry: new CylinderGeometry(radius * 0.34, radius * 0.34, height * 0.12, segments, 1),
      position: [0, height / 2 - height * 0.1, 0],
      tile: 1,
    },
    {
      geometry: new CylinderGeometry(radius * 0.4, radius * 0.4, 0.022, segments, 1),
      position: [0, height / 2 - 0.011, 0],
      tile: 0,
    },
  ];
  if (lod === 0) {
    // Nervaduras del cuerpo: son las que hacen que se lea como PET y no como
    // tubo, y las que dan la escala real del objeto.
    for (let index = 0; index < 3; index += 1) {
      parts.push({
        geometry: new CylinderGeometry(radius * 1.02, radius * 1.02, 0.012, segments, 1),
        position: [0, -height / 2 + bodyHeight * (0.25 + index * 0.22), 0],
        tile: 1,
      });
    }
    parts.push({
      geometry: new CylinderGeometry(radius * 1.01, radius * 1.01, bodyHeight * 0.42, segments, 1),
      position: [0, -height / 2 + bodyHeight * 0.48, 0],
      tile: 0,
    });
  }
  return { parts };
};

/** Frasco de vidrio con tapa metálica: rotura de vidrio en interiores. */
const glassJar: PropBuilder = (variant, lod) => {
  const random = variantRandom("glassJar", variant);
  const height = 0.16;
  const radius = 0.055;
  const segments = lod === 0 ? 12 : 7;
  const bodyHeight = height * (0.66 + random() * 0.08);
  const glass: GeometryPart[] = [
    {
      geometry: new CylinderGeometry(radius, radius * 0.94, bodyHeight, segments, 1),
      position: [0, -height / 2 + bodyHeight / 2, 0],
      tile: 3,
    },
    {
      geometry: new CylinderGeometry(radius * 0.72, radius, height * 0.16, segments, 1),
      position: [0, -height / 2 + bodyHeight + height * 0.08, 0],
      tile: 3,
    },
  ];
  const parts: GeometryPart[] = [
    {
      geometry: new CylinderGeometry(radius * 0.76, radius * 0.76, height * 0.14, segments, 1),
      position: [0, height / 2 - height * 0.07, 0],
      tile: 3,
    },
  ];
  if (lod === 0) {
    parts.push({
      geometry: new CylinderGeometry(radius * 1.01, radius * 1.01, bodyHeight * 0.4, segments, 1),
      position: [0, -height / 2 + bodyHeight * 0.45, 0],
      tile: 1,
    });
  }
  return { parts, glass };
};

/** Cajón plástico de bebidas: paredes caladas y borde apilable. */
const plasticCrate: PropBuilder = (variant, lod) => {
  const random = variantRandom("plasticCrate", variant);
  const width = 0.6;
  const height = 0.32;
  const depth = 0.4;
  const wall = 0.016;
  const tile = random() > 0.5 ? 0 : 1;
  const parts: GeometryPart[] = [
    {
      geometry: chamferBox(width - wall * 2, wall, depth - wall * 2, 0.004),
      position: [0, -height / 2 + wall / 2, 0],
      tile,
    },
  ];

  // Marco: montantes en las esquinas más cintas arriba y abajo. Deja los huecos
  // por construcción, que es lo que distingue un cajón de bebidas de una caja.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push({
        geometry: chamferBox(wall * 1.8, height, wall * 1.8, 0.004),
        position: [(sx * (width - wall * 1.8)) / 2, 0, (sz * (depth - wall * 1.8)) / 2],
        tile,
      });
    }
  }
  const bands: number[] = lod === 0 ? [-0.42, 0, 0.46] : [0.46];
  for (const t of bands) {
    for (const sx of [-1, 1]) {
      parts.push({
        geometry: chamferBox(wall, height * 0.16, depth, 0.004),
        position: [(sx * (width - wall)) / 2, t * height, 0],
        tile,
      });
    }
    for (const sz of [-1, 1]) {
      parts.push({
        geometry: chamferBox(width - wall * 2, height * 0.16, wall, 0.004),
        position: [0, t * height, (sz * (depth - wall)) / 2],
        tile,
      });
    }
  }
  return { parts };
};

/**
 * Neumático suelto, apoyado de plano.
 *
 * `wheel()` arma la rueda con el eje sobre X porque los vehículos la montan así;
 * acostada es como descansa una cubierta tirada, de ahí el giro. Va sin llanta:
 * es una cubierta de descarte, no una rueda.
 */
const tire: PropBuilder = (_variant, lod) => {
  const segments = lod === 0 ? 18 : 9;
  const { tire: rubber } = wheel({
    radius: 0.31,
    width: 0.2,
    rimRatio: 0.62,
    segments,
    treadCount: lod === 0 ? 16 : 0,
  });
  return {
    parts: [{ geometry: rubber, rotation: [0, 0, Math.PI / 2], tile: 2 }],
  };
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
  cardboardBox,
  milkCarton,
  woodPlank,
  metalBucket,
  paintCan,
  soupCan,
  trashBin,
  gasCan,
  propaneTank,
  concreteChunk,
  metalPipe,
  plasticBottle,
  glassJar,
  plasticCrate,
  tire,
  ...INTERIOR_BUILDERS,
  ...DEBRIS_BUILDERS,
  ...TECH_BUILDERS,
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

/**
 * Corre las piezas para que el AABB del prop quede centrado en el origen.
 *
 * Es la convención que declara el manifiesto (`origin: "aabb-center"`) y de la
 * que depende `PropSystem` para apoyar el prop: coloca el cuerpo en
 * `base + altura/2` y da por hecho que la malla y el casco están centrados ahí.
 * Un detalle asimétrico —el racimo de válvulas del barril explosivo, los
 * tiradores del archivero— rompe esa suposición y el prop queda flotando.
 */
export function centerParts(parts: readonly GeometryPart[], offset: Vector3): GeometryPart[] {
  return parts.map((part) => {
    const position = part.position ?? [0, 0, 0];
    return {
      ...part,
      position: [
        position[0] + offset.x,
        position[1] + offset.y,
        position[2] + offset.z,
      ] as Vec3,
    };
  });
}

/** Desplazamiento que lleva el centro del AABB al origen. */
export function centeringOffset(bounds: Bounds): Vector3 {
  return new Vector3().addVectors(bounds.min, bounds.max).multiplyScalar(-0.5);
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
