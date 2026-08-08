import { CylinderGeometry } from "three";

import { chamferBox, chamferWedge, panel, wheel } from "../shared/gltf/geometry.js";
import { variantRandom, type PropBuilder } from "./builderKit.js";
import type { AtlasTile, GeometryPart } from "./types.js";

/**
 * Utilería de autoría. No es contenido de campaña: es lo que un autor de mapas
 * quiere tener a mano para vestir un espacio sin modelar nada.
 *
 * Tiene dos cosas propias del pack. Los cajones de suministros son los primeros
 * props con reacción `spawnItem` —se abren y dejan pickups—, y los objetos con
 * ruedas son los primeros que ruedan de verdad, con fricción baja y poco freno
 * angular.
 *
 * Tiles: 0 chapa pintada, 1 acero galvanizado, 2 madera, 3 goma y plástico.
 */

/** Bastidor de tubos: la base de carros, changuitos y bicicletas. */
function tubeFrame(
  segments: readonly (readonly [number, number, number, number, number, number])[],
  radius: number,
  sides: number,
  tile: AtlasTile,
): GeometryPart[] {
  return segments.map(([x, y, z, length, rotX, rotZ]) => ({
    geometry: new CylinderGeometry(radius, radius, length, sides, 1),
    position: [x, y, z],
    rotation: [rotX, 0, rotZ],
    tile,
  }));
}

/** Escalera de gato: dos largueros y peldaños. */
const ladder: PropBuilder = (variant, lod) => {
  const width = 0.44;
  const height = 2.6;
  const depth = 0.09;
  const parts: GeometryPart[] = [];
  for (const sx of [-1, 1]) {
    parts.push({
      geometry: chamferBox(0.045, height, depth, 0.006),
      position: [(sx * (width - 0.045)) / 2, 0, 0],
      tile: 1,
    });
  }
  // Peldaños: la grilla es fija y el LOD1 saltea de a uno, para que el
  // envolvente no cambie con el nivel de detalle.
  const rungs = 9;
  for (let index = 0; index < rungs; index += 1) {
    if (lod === 1 && index % 2 === 1) continue;
    parts.push({
      geometry: new CylinderGeometry(0.016, 0.016, width - 0.05, lod === 0 ? 8 : 5, 1),
      position: [0, -height / 2 + 0.18 + index * ((height - 0.36) / (rungs - 1)), 0],
      rotation: [0, 0, Math.PI / 2],
      tile: 1,
    });
  }
  if (lod === 0) {
    const random = variantRandom("ladder", variant);
    // Grampas de amure: es lo que la separa de una escalera de mano.
    for (const y of [-0.85, 0.85]) {
      parts.push({
        geometry: chamferBox(width * 0.9, 0.03, 0.06, 0.006),
        position: [0, y + (random() - 0.5) * 0.1, -depth / 2],
        tile: 1,
      });
    }
  }
  return { parts };
};

/** Tramo de baranda: dos parantes, pasamanos y travesaño. */
const handrail: PropBuilder = (variant, lod) => {
  const random = variantRandom("handrail", variant);
  const width = 2;
  const height = 1.06;
  const parts: GeometryPart[] = [
    {
      geometry: new CylinderGeometry(0.024, 0.024, width, lod === 0 ? 10 : 5, 1),
      position: [0, height / 2 - 0.024, 0],
      rotation: [0, 0, Math.PI / 2],
      tile: 1,
    },
    {
      geometry: new CylinderGeometry(0.018, 0.018, width * 0.98, lod === 0 ? 8 : 4, 1),
      position: [0, height * 0.06, 0],
      rotation: [0, 0, Math.PI / 2],
      tile: 1,
    },
  ];
  for (const sx of [-1, 1]) {
    parts.push({
      geometry: chamferBox(0.05, height, 0.05, 0.006),
      position: [sx * (width / 2 - 0.06), 0, 0],
      tile: 1,
    });
    parts.push({
      geometry: chamferBox(0.14, 0.016, 0.14, 0.004),
      position: [sx * (width / 2 - 0.06), -height / 2 + 0.008, 0],
      tile: 1,
    });
  }
  if (lod === 0 && random() > 0.45) {
    parts.push({
      geometry: chamferBox(0.04, height, 0.04, 0.005),
      position: [(random() - 0.5) * width * 0.4, 0, 0],
      tile: 1,
    });
  }
  return { parts };
};

/** Tramo de cerco: marco de tubo con malla adentro. */
const fenceSection: PropBuilder = (variant, lod) => {
  const random = variantRandom("fenceSection", variant);
  const width = 2.2;
  const height = 1.9;
  const parts: GeometryPart[] = [];
  for (const sx of [-1, 1]) {
    parts.push({
      geometry: new CylinderGeometry(0.03, 0.03, height, lod === 0 ? 8 : 5, 1),
      position: [sx * (width / 2 - 0.04), 0, 0],
      tile: 1,
    });
  }
  for (const sy of [-1, 1]) {
    parts.push({
      geometry: new CylinderGeometry(0.024, 0.024, width, lod === 0 ? 8 : 5, 1),
      position: [0, (sy * (height - 0.05)) / 2, 0],
      rotation: [0, 0, Math.PI / 2],
      tile: 1,
    });
  }
  // La malla como un panel fino: tejerla alambre por alambre serían cientos de
  // cascos convexos para algo que a dos metros se lee igual.
  parts.push({
    geometry: panel(width * 0.96, height * 0.92, 0.01),
    position: [0, 0, (random() - 0.5) * 0.01],
    tile: 1,
  });
  if (lod === 0) {
    parts.push({
      geometry: new CylinderGeometry(0.018, 0.018, width * 0.98, 6, 1),
      position: [0, height * 0.06, 0],
      rotation: [0, 0, Math.PI / 2],
      tile: 1,
    });
  }
  return { parts };
};

/** Cajón de suministros: el que se abre y deja munición o botiquines. */
function supplyCrate(id: string, lidTile: AtlasTile): PropBuilder {
  return (variant, lod) => {
    const random = variantRandom(id, variant);
    const width = 0.78;
    const height = 0.46;
    const depth = 0.5;
    const wall = 0.026;
    const parts: GeometryPart[] = [
      {
        geometry: chamferBox(width, wall, depth, 0.006),
        position: [0, -height / 2 + wall / 2, 0],
        tile: 0,
      },
    ];
    for (const sx of [-1, 1]) {
      parts.push({
        geometry: chamferBox(wall, height - wall, depth, 0.006),
        position: [(sx * (width - wall)) / 2, wall / 2, 0],
        tile: 0,
      });
    }
    for (const sz of [-1, 1]) {
      parts.push({
        geometry: chamferBox(width - wall * 2, height - wall, wall, 0.006),
        position: [0, wall / 2, (sz * (depth - wall)) / 2],
        tile: 0,
      });
    }
    // Tapa: define el tope y va en los dos LODs.
    parts.push({
      geometry: chamferBox(width * 1.02, 0.05, depth * 1.02, 0.008),
      position: [0, height / 2 - 0.025, 0],
      tile: lidTile,
    });
    if (lod === 0) {
      // Refuerzos de canto y trabas.
      for (const sx of [-1, 1]) {
        parts.push({
          geometry: chamferBox(0.05, height * 0.9, 0.05, 0.006),
          position: [sx * (width / 2 - 0.03), 0, depth / 2 - 0.03],
          tile: 1,
        });
      }
      parts.push({
        geometry: chamferBox(width * 0.16, 0.05, 0.02, 0.004),
        position: [(random() - 0.5) * width * 0.3, height * 0.2, depth / 2 + 0.006],
        tile: 1,
      });
    }
    return { parts };
  };
}

const ammoCrate = supplyCrate("ammoCrate", 0);
const medCrate = supplyCrate("medCrate", 1);

/** Carro de herramientas: cajonera sobre ruedas. */
const toolCart: PropBuilder = (variant, lod) => {
  const random = variantRandom("toolCart", variant);
  const width = 0.68;
  const height = 0.92;
  const depth = 0.46;
  const casterRadius = 0.05;
  const bodyBottom = -height / 2 + casterRadius * 2;
  const parts: GeometryPart[] = [
    {
      geometry: chamferBox(width, height - casterRadius * 2 - 0.04, depth, 0.012),
      position: [0, bodyBottom + (height - casterRadius * 2 - 0.04) / 2, 0],
      tile: 0,
    },
    // Tapa de trabajo.
    {
      geometry: chamferBox(width * 1.04, 0.03, depth * 1.04, 0.006),
      position: [0, height / 2 - 0.015, 0],
      tile: 1,
    },
  ];
  // Ruedas: fijan el fondo del prop, en ambos LODs.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push({
        geometry: new CylinderGeometry(casterRadius, casterRadius, 0.03, lod === 0 ? 10 : 5, 1),
        position: [sx * (width / 2 - 0.09), -height / 2 + casterRadius, sz * (depth / 2 - 0.07)],
        rotation: [0, 0, Math.PI / 2],
        tile: 3,
      });
    }
  }
  if (lod === 0) {
    for (let index = 0; index < 3; index += 1) {
      parts.push({
        geometry: panel(width - 0.06, 0.19, 0.018),
        position: [0, bodyBottom + 0.14 + index * 0.22, depth / 2 - 0.01],
        tile: 0,
      });
      parts.push({
        geometry: chamferBox(width * 0.3, 0.022, 0.028, 0.005),
        position: [0, bodyBottom + 0.14 + index * 0.22, depth / 2 + 0.008],
        tile: 1,
      });
    }
    parts.push({
      geometry: new CylinderGeometry(0.016, 0.016, depth * 0.8, 8, 1),
      position: [-width / 2 + 0.02, height * (0.24 + random() * 0.04), 0],
      rotation: [Math.PI / 2, 0, 0],
      tile: 1,
    });
  }
  return { parts };
};

/** Carretilla: batea, una rueda y dos manijas. */
const wheelbarrow: PropBuilder = (variant, lod) => {
  const random = variantRandom("wheelbarrow", variant);
  const width = 0.66;
  const height = 0.62;
  const depth = 1.42;
  const parts: GeometryPart[] = [
    // Batea: se abre hacia arriba y hacia atrás.
    {
      geometry: chamferWedge({
        length: depth * 0.52,
        height: height * 0.42,
        frontWidth: width * 0.44,
        rearWidth: width,
        topFrontWidth: width * 0.66,
        topRearWidth: width,
        chamfer: 0.02,
      }),
      position: [0, height * 0.14, -depth * 0.12],
      tile: 0,
    },
  ];
  // Manijas y pata: fijan el largo declarado.
  for (const sx of [-1, 1]) {
    parts.push({
      geometry: new CylinderGeometry(0.022, 0.022, depth * 0.94, lod === 0 ? 8 : 5, 1),
      position: [sx * width * 0.3, -height * 0.06, 0],
      rotation: [0.1, 0, 0],
      tile: 2,
    });
    parts.push({
      geometry: chamferBox(0.04, height * 0.34, 0.05, 0.006),
      position: [sx * width * 0.3, -height * 0.3, -depth * 0.18],
      tile: 1,
    });
  }
  const { tire } = wheel({
    radius: 0.18,
    width: 0.08,
    rimRatio: 0.5,
    segments: lod === 0 ? 14 : 7,
    treadCount: 0,
  });
  parts.push({
    geometry: tire,
    position: [0, -height / 2 + 0.18, depth * 0.36],
    tile: 3,
  });
  if (lod === 0) {
    parts.push({
      geometry: chamferBox(0.05, 0.24, 0.05, 0.006),
      position: [0, -height * (0.1 + random() * 0.04), depth * 0.36],
      tile: 1,
    });
  }
  return { parts };
};

/** Changuito de supermercado: canasto de reja sobre cuatro ruedas. */
const shoppingCart: PropBuilder = (variant, lod) => {
  const random = variantRandom("shoppingCart", variant);
  const width = 0.58;
  const height = 1.02;
  const depth = 0.95;
  const basketBottom = -height / 2 + 0.42;
  const parts: GeometryPart[] = [
    // Canasto: se abre hacia atrás, como uno de verdad.
    {
      geometry: chamferWedge({
        length: depth * 0.72,
        height: 0.34,
        frontWidth: width * 0.72,
        rearWidth: width,
        topFrontWidth: width * 0.84,
        topRearWidth: width * 1.02,
        chamfer: 0.02,
      }),
      position: [0, basketBottom + 0.17, -depth * 0.08],
      tile: 1,
    },
  ];
  parts.push(
    ...tubeFrame(
      [
        // Manija.
        [0, height / 2 - 0.04, -depth / 2 + 0.06, width * 0.9, 0, Math.PI / 2],
        // Montantes traseros.
        [-width * 0.4, basketBottom + 0.08, -depth / 2 + 0.08, 0.5, 0.2, 0],
        [width * 0.4, basketBottom + 0.08, -depth / 2 + 0.08, 0.5, 0.2, 0],
      ],
      0.016,
      lod === 0 ? 8 : 4,
      1,
    ),
  );
  // Ruedas: fijan el fondo y el ancho.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push({
        geometry: new CylinderGeometry(0.055, 0.055, 0.026, lod === 0 ? 10 : 5, 1),
        position: [sx * (width / 2 - 0.05), -height / 2 + 0.055, sz * (depth / 2 - 0.12)],
        rotation: [0, 0, Math.PI / 2],
        tile: 3,
      });
      parts.push({
        geometry: chamferBox(0.03, 0.2, 0.03, 0.004),
        position: [sx * (width / 2 - 0.05), -height / 2 + 0.18, sz * (depth / 2 - 0.12)],
        tile: 1,
      });
    }
  }
  if (lod === 0) {
    // Rejas del canasto: tres nervios por lado alcanzan a esta escala.
    for (const sx of [-1, 1]) {
      for (let index = 0; index < 3; index += 1) {
        parts.push({
          geometry: chamferBox(0.012, 0.3, 0.012, 0.003),
          position: [
            sx * width * 0.44,
            basketBottom + 0.17,
            (index - 1) * depth * 0.2 + (random() - 0.5) * 0.02,
          ],
          tile: 1,
        });
      }
    }
  }
  return { parts };
};

/** Bicicleta apoyada: cuadro de tubos y dos ruedas. */
const bicycle: PropBuilder = (variant, lod) => {
  const random = variantRandom("bicycle", variant);
  const length = 1.72;
  const height = 1.02;
  const wheelRadius = 0.34;
  const segments = lod === 0 ? 14 : 7;
  const axleY = -height / 2 + wheelRadius;
  const parts: GeometryPart[] = [];
  for (const sx of [-1, 1]) {
    const { tire } = wheel({
      radius: wheelRadius,
      width: 0.05,
      rimRatio: 0.28,
      segments,
      treadCount: 0,
    });
    parts.push({
      geometry: tire,
      position: [sx * (length / 2 - wheelRadius), axleY, 0],
      rotation: [0, Math.PI / 2, 0],
      tile: 3,
    });
  }
  parts.push(
    ...tubeFrame(
      [
        // Tubo superior y diagonal.
        [0, axleY + 0.44, 0, 0.72, 0, Math.PI / 2 + 0.1],
        [-0.06, axleY + 0.28, 0, 0.78, 0, Math.PI / 2 - 0.42],
        // Vainas hacia el eje trasero.
        [-0.34, axleY + 0.16, 0, 0.5, 0, 0.95],
        // Horquilla delantera.
        [0.44, axleY + 0.24, 0, 0.56, 0, -0.28],
        // Tija del asiento y del manubrio: fijan el alto.
        [-0.26, axleY + 0.5, 0, 0.34, 0, 0.08],
        [0.5, axleY + 0.52, 0, 0.34, 0, -0.12],
      ],
      0.018,
      lod === 0 ? 8 : 4,
      2,
    ),
  );
  // Asiento y manubrio: los dos extremos del envolvente en Y y Z.
  parts.push({
    geometry: chamferBox(0.22, 0.05, 0.13, 0.02),
    position: [-0.28, height / 2 - 0.03, 0],
    tile: 3,
  });
  parts.push({
    geometry: new CylinderGeometry(0.014, 0.014, 0.46, lod === 0 ? 8 : 4, 1),
    position: [0.54, height / 2 - 0.08, 0],
    tile: 3,
  });
  if (lod === 0) {
    parts.push({
      geometry: new CylinderGeometry(0.052, 0.052, 0.03, 10, 1),
      position: [-0.16, axleY + (random() - 0.5) * 0.02, 0],
      rotation: [0, Math.PI / 2, 0],
      tile: 1,
    });
  }
  return { parts };
};

/** Cartel de calle: poste con chapa arriba. */
const streetSign: PropBuilder = (variant, lod) => {
  const random = variantRandom("streetSign", variant);
  const height = 2.35;
  const width = 0.6;
  const segments = lod === 0 ? 10 : 5;
  const parts: GeometryPart[] = [
    {
      geometry: new CylinderGeometry(0.032, 0.038, height, segments, 1),
      tile: 1,
    },
    // La chapa define el ancho declarado: va en los dos LODs.
    {
      geometry: chamferBox(width, 0.2, 0.016, 0.005),
      position: [width * 0.36, height / 2 - 0.22, 0],
      tile: 0,
    },
  ];
  if (lod === 0) {
    parts.push({
      geometry: chamferBox(width * 0.72, 0.16, 0.014, 0.004),
      position: [width * 0.3, height / 2 - 0.48, (random() - 0.5) * 0.01],
      rotation: [0, 0.35, 0],
      tile: 0,
    });
    parts.push({
      geometry: new CylinderGeometry(0.075, 0.09, 0.06, segments, 1),
      position: [0, -height / 2 + 0.03, 0],
      tile: 1,
    });
  }
  return { parts };
};

/** Buzón de calle: cuerpo con tapa curva sobre pie. */
const mailbox: PropBuilder = (variant, lod) => {
  const random = variantRandom("mailbox", variant);
  const width = 0.44;
  const height = 1.24;
  const depth = 0.4;
  const bodyHeight = 0.62;
  const bodyBottom = height / 2 - bodyHeight;
  const parts: GeometryPart[] = [
    {
      geometry: chamferWedge({
        length: depth,
        height: bodyHeight,
        frontWidth: width,
        rearWidth: width,
        topFrontWidth: width * 0.5,
        topRearWidth: width * 0.5,
        chamfer: 0.03,
      }),
      position: [0, bodyBottom + bodyHeight / 2, 0],
      tile: 0,
    },
    {
      geometry: new CylinderGeometry(0.05, 0.07, height - bodyHeight, lod === 0 ? 8 : 5, 1),
      position: [0, -height / 2 + (height - bodyHeight) / 2, 0],
      tile: 1,
    },
  ];
  if (lod === 0) {
    // Boca y bisagra.
    parts.push({
      geometry: chamferBox(width * 0.6, 0.09, 0.02, 0.005),
      position: [0, bodyBottom + bodyHeight * 0.55, depth / 2 - 0.008],
      rotation: [(random() - 0.5) * 0.2, 0, 0],
      tile: 1,
    });
    parts.push({
      geometry: chamferBox(width * 0.86, 0.02, 0.03, 0.004),
      position: [0, bodyBottom + 0.03, -depth / 2 + 0.02],
      tile: 1,
    });
  }
  return { parts };
};

/** Maceta de terracota con tierra. */
const flowerPot: PropBuilder = (variant, lod) => {
  const random = variantRandom("flowerPot", variant);
  const height = 0.34;
  const topRadius = 0.19;
  const segments = lod === 0 ? 14 : 7;
  const parts: GeometryPart[] = [
    {
      geometry: new CylinderGeometry(topRadius, topRadius * 0.66, height - 0.03, segments, 1),
      position: [0, -0.015, 0],
      tile: 2,
    },
    // Labio: es lo que la lee como maceta y no como balde.
    {
      geometry: new CylinderGeometry(topRadius * 1.06, topRadius * 1.06, 0.035, segments, 1),
      position: [0, height / 2 - 0.018, 0],
      tile: 2,
    },
  ];
  if (lod === 0) {
    parts.push({
      geometry: new CylinderGeometry(topRadius * 0.9, topRadius * 0.9, 0.03, segments, 1),
      position: [0, height / 2 - 0.05 + (random() - 0.5) * 0.02, 0],
      tile: 3,
    });
  }
  return { parts };
};

/** Cajón largo tipo armería. */
const crateLong: PropBuilder = (variant, lod) => {
  const random = variantRandom("crateLong", variant);
  const width = 1.55;
  const height = 0.42;
  const depth = 0.46;
  const wall = 0.03;
  const parts: GeometryPart[] = [];
  for (const sz of [-1, 1]) {
    parts.push({
      geometry: chamferBox(width, height, wall, 0.006),
      position: [0, 0, (sz * (depth - wall)) / 2],
      tile: 2,
    });
  }
  for (const sx of [-1, 1]) {
    parts.push({
      geometry: chamferBox(wall, height, depth - wall * 2, 0.006),
      position: [(sx * (width - wall)) / 2, 0, 0],
      tile: 2,
    });
  }
  for (const sy of [-1, 1]) {
    parts.push({
      geometry: chamferBox(width - wall * 2, wall, depth - wall * 2, 0.006),
      position: [0, (sy * (height - wall)) / 2, 0],
      tile: 2,
    });
  }
  if (lod === 0) {
    // Flejes de refuerzo: dos o tres según la variante, siempre adentro.
    const straps: number = random() > 0.5 ? 3 : 2;
    for (let index = 0; index < straps; index += 1) {
      const t = index / (straps - 1);
      parts.push({
        geometry: chamferBox(0.05, height * 1.005, depth * 1.005, 0.005),
        position: [(t - 0.5) * width * 0.62, 0, 0],
        tile: 1,
      });
    }
  }
  return { parts };
};

/** Cajón enorme: cobertura de cuerpo entero. */
const crateHuge: PropBuilder = (variant, lod) => {
  const random = variantRandom("crateHuge", variant);
  const side = 1.6;
  const wall = 0.05;
  const inset = (side - wall) / 2;
  const parts: GeometryPart[] = [];
  const face = (position: [number, number, number], rotation?: [number, number, number]): void => {
    parts.push({
      geometry: chamferBox(side - wall, side - wall, wall, 0.01),
      position,
      ...(rotation ? { rotation } : {}),
      tile: 2,
    });
  };
  face([0, 0, inset]);
  face([0, 0, -inset]);
  face([inset, 0, 0], [0, Math.PI / 2, 0]);
  face([-inset, 0, 0], [0, Math.PI / 2, 0]);
  face([0, inset, 0], [Math.PI / 2, 0, 0]);
  face([0, -inset, 0], [Math.PI / 2, 0, 0]);
  // Montantes de esquina: fijan el envolvente en los dos LODs.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push({
        geometry: chamferBox(wall * 1.5, side, wall * 1.5, 0.008),
        position: [sx * inset, 0, sz * inset],
        tile: 2,
      });
    }
  }
  if (lod === 0) {
    for (const sz of [-1, 1]) {
      parts.push({
        geometry: chamferBox(side * 0.96, 0.06, 0.018, 0.005),
        position: [0, side * (random() - 0.5) * 0.3, sz * (inset + wall / 2)],
        tile: 1,
      });
    }
  }
  return { parts };
};

export const KIT_BUILDERS = {
  ladder,
  handrail,
  fenceSection,
  ammoCrate,
  medCrate,
  toolCart,
  wheelbarrow,
  shoppingCart,
  bicycle,
  streetSign,
  mailbox,
  flowerPot,
  crateLong,
  crateHuge,
} as const;
