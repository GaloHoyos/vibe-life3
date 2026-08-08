import { CylinderGeometry } from "three";

import { chamferBox, chamferWedge, panel } from "../shared/gltf/geometry.js";
import { variantRandom, type PropBuilder } from "./builderKit.js";
import type { AtlasTile, GeometryPart, Vec3 } from "./types.js";

/**
 * Mobiliario e instalaciones. Es lo que convierte un cuarto vacío en un cuarto
 * donde vivía alguien, y donde el catálogo estaba más flojo.
 *
 * Dos packs por atlas, no por capricho: el tapizado y la madera barnizada no
 * comparten paleta con el esmalte blanco y el acero de los electrodomésticos.
 *
 * Tiles de `propsInterior`: 0 tapizado, 1 madera barnizada, 2 melamina clara,
 * 3 herraje/patas. Tiles de `propsAppliance`: 0 esmalte, 1 acero, 2 porcelana,
 * 3 goma y plástico oscuro.
 */

// ---------------------------------------------------------------------------
// Tapizado
// ---------------------------------------------------------------------------

/** Patas cilíndricas cortas en las cuatro esquinas de una huella. */
function legs(
  width: number,
  depth: number,
  height: number,
  y: number,
  inset: number,
  tile: AtlasTile,
  segments: number,
): GeometryPart[] {
  const parts: GeometryPart[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push({
        geometry: new CylinderGeometry(0.022, 0.018, height, segments, 1),
        position: [sx * (width / 2 - inset), y, sz * (depth / 2 - inset)],
        tile,
      });
    }
  }
  return parts;
}

/**
 * Sillón de tres cuerpos: base, respaldo inclinado, apoyabrazos y almohadones.
 *
 * Los almohadones van hundidos y separados por una ranura. Un bloque de
 * tapizado liso lee como caja pintada; la ranura es lo que lo vuelve un sillón.
 */
const couch: PropBuilder = (variant, lod) => {
  const random = variantRandom("couch", variant);
  const width = 2;
  const height = 0.82;
  const depth = 0.9;
  const legHeight = 0.09;
  const seatY = -height / 2 + legHeight;
  const armWidth = 0.19;
  const parts: GeometryPart[] = [
    // Cuerpo del asiento.
    {
      geometry: chamferBox(width, 0.26, depth, 0.03),
      position: [0, seatY + 0.13, 0],
      tile: 0,
    },
    // Respaldo, echado hacia atrás.
    {
      geometry: chamferWedge({
        length: 0.24,
        height: height - legHeight - 0.26,
        frontWidth: width,
        rearWidth: width,
        topOffsetY: 0,
        chamfer: 0.03,
      }),
      position: [0, seatY + 0.26 + (height - legHeight - 0.26) / 2, -depth / 2 + 0.14],
      rotation: [-0.12, 0, 0],
      tile: 0,
    },
  ];
  for (const sx of [-1, 1]) {
    parts.push({
      geometry: chamferBox(armWidth, height - legHeight - 0.16, depth * 0.94, 0.03),
      position: [sx * (width - armWidth) / 2, seatY + (height - legHeight - 0.16) / 2, 0.01],
      tile: 0,
    });
  }
  parts.push(...legs(width, depth, legHeight, -height / 2 + legHeight / 2, 0.12, 3, lod === 0 ? 6 : 4));

  if (lod === 0) {
    // Almohadones: dos o tres según variante, siempre dentro del envolvente.
    const cushions = random() > 0.5 ? 3 : 2;
    const usable = width - armWidth * 2 - 0.04;
    for (let index = 0; index < cushions; index += 1) {
      const slot = usable / cushions;
      parts.push({
        geometry: chamferBox(slot - 0.03, 0.12, depth * 0.7, 0.035),
        position: [(index - (cushions - 1) / 2) * slot, seatY + 0.3, 0.06],
        tile: 0,
      });
    }
  }
  return { parts };
};

/** Sillón individual: el mismo idioma que el sofá, en un cuerpo. */
const armchair: PropBuilder = (variant, lod) => {
  const random = variantRandom("armchair", variant);
  const width = 0.95;
  const height = 0.85;
  const depth = 0.9;
  const legHeight = 0.09;
  const seatY = -height / 2 + legHeight;
  const armWidth = 0.17;
  const parts: GeometryPart[] = [
    {
      geometry: chamferBox(width, 0.26, depth, 0.03),
      position: [0, seatY + 0.13, 0],
      tile: 0,
    },
    {
      geometry: chamferBox(width, height - legHeight - 0.26, 0.22, 0.03),
      position: [0, seatY + 0.26 + (height - legHeight - 0.26) / 2, -depth / 2 + 0.13],
      rotation: [-0.13, 0, 0],
      tile: 0,
    },
  ];
  for (const sx of [-1, 1]) {
    parts.push({
      geometry: chamferBox(armWidth, height - legHeight - 0.2, depth * 0.92, 0.03),
      position: [sx * (width - armWidth) / 2, seatY + (height - legHeight - 0.2) / 2, 0.02],
      tile: 0,
    });
  }
  parts.push(...legs(width, depth, legHeight, -height / 2 + legHeight / 2, 0.11, 3, lod === 0 ? 6 : 4));
  if (lod === 0) {
    parts.push({
      geometry: chamferBox(width - armWidth * 2 - 0.04, 0.12, depth * 0.68, 0.035),
      position: [0, seatY + 0.3, 0.06 + (random() - 0.5) * 0.03],
      tile: 0,
    });
  }
  return { parts };
};

/** Colchón suelto: el primer prop blando del catálogo. */
const mattress: PropBuilder = (variant, lod) => {
  const random = variantRandom("mattress", variant);
  const width = 1.35;
  const height = 0.22;
  const depth = 1.95;
  const parts: GeometryPart[] = [
    {
      geometry: chamferBox(width, height, depth, 0.055),
      tile: 0,
    },
  ];
  if (lod === 0) {
    // Costura perimetral hundida: es lo que lo separa de un bloque de gomaespuma.
    parts.push({
      geometry: chamferBox(width * 1.004, 0.035, depth * 1.004, 0.012),
      position: [0, (random() - 0.5) * 0.02, 0],
      tile: 2,
    });
  }
  return { parts };
};

/** Cama: bastidor de madera, respaldo y colchón encima. */
const bed: PropBuilder = (variant, lod) => {
  const random = variantRandom("bed", variant);
  const width = 1.45;
  const height = 0.72;
  const depth = 2.05;
  const frameTop = -height / 2 + 0.34;
  const parts: GeometryPart[] = [
    // Bastidor.
    {
      geometry: chamferBox(width, 0.16, depth, 0.012),
      position: [0, frameTop - 0.08, 0],
      tile: 1,
    },
    // Colchón, hundido dentro del bastidor.
    {
      geometry: chamferBox(width - 0.08, 0.2, depth - 0.12, 0.05),
      position: [0, frameTop + 0.1, 0.02],
      tile: 0,
    },
    // Respaldo: define el alto del prop, así que va en los dos LODs.
    {
      geometry: chamferBox(width, height - 0.1, 0.06, 0.012),
      position: [0, -height / 2 + (height - 0.1) / 2 + 0.1, -depth / 2 + 0.03],
      tile: 1,
    },
  ];
  parts.push(
    ...legs(width, depth, 0.26, -height / 2 + 0.13, 0.07, 1, lod === 0 ? 6 : 4),
  );
  if (lod === 0) {
    // Almohada, corrida al azar hacia un lado.
    parts.push({
      geometry: chamferBox(width * 0.44, 0.1, 0.34, 0.04),
      position: [(random() - 0.5) * width * 0.3, frameTop + 0.25, -depth / 2 + 0.32],
      tile: 0,
    });
  }
  return { parts };
};

// ---------------------------------------------------------------------------
// Madera
// ---------------------------------------------------------------------------

/** Frente de cajón con su tirador. */
function drawerFace(
  width: number,
  height: number,
  z: number,
  y: number,
  handleTile: AtlasTile,
  withHandle: boolean,
): GeometryPart[] {
  const parts: GeometryPart[] = [
    { geometry: panel(width, height, 0.022), position: [0, y, z], tile: 2 },
  ];
  if (withHandle) {
    parts.push({
      geometry: chamferBox(width * 0.32, 0.022, 0.03, 0.006),
      position: [0, y, z + 0.024],
      tile: handleTile,
    });
  }
  return parts;
}

/** Caja de mueble: laterales, techo, piso y fondo. Base de casi todo lo demás. */
function carcass(
  width: number,
  height: number,
  depth: number,
  tile: AtlasTile,
  wall = 0.02,
): GeometryPart[] {
  const parts: GeometryPart[] = [];
  for (const sx of [-1, 1]) {
    parts.push({
      geometry: chamferBox(wall, height, depth, 0.005),
      position: [sx * (width - wall) / 2, 0, 0],
      tile,
    });
  }
  for (const sy of [-1, 1]) {
    parts.push({
      geometry: chamferBox(width - wall * 2, wall, depth, 0.005),
      position: [0, sy * (height - wall) / 2, 0],
      tile,
    });
  }
  parts.push({
    geometry: chamferBox(width - wall * 2, height - wall * 2, wall * 0.6, 0.004),
    position: [0, 0, -(depth - wall * 0.6) / 2],
    tile,
  });
  return parts;
}

/** Cómoda de cuatro cajones. */
const dresser: PropBuilder = (variant, lod) => {
  const random = variantRandom("dresser", variant);
  const width = 1;
  const height = 0.82;
  const depth = 0.5;
  const parts: GeometryPart[] = carcass(width, height, depth, 1);
  const drawers = 4;
  const slot = (height - 0.06) / drawers;
  for (let index = 0; index < drawers; index += 1) {
    const y = -height / 2 + 0.03 + slot * (index + 0.5);
    // Un cajón salido: la cómoda queda revuelta, no exhibida.
    const pulled = lod === 0 && index === Math.floor(random() * drawers);
    parts.push(
      ...drawerFace(width - 0.06, slot - 0.012, depth / 2 - 0.012 + (pulled ? 0.05 : 0), y, 3, lod === 0),
    );
  }
  return { parts };
};

/** Ropero de dos puertas. */
const wardrobe: PropBuilder = (variant, lod) => {
  const random = variantRandom("wardrobe", variant);
  const width = 1;
  const height = 1.9;
  const depth = 0.58;
  const parts: GeometryPart[] = carcass(width, height, depth, 1, 0.024);
  const doorWidth = (width - 0.06) / 2;
  for (const sx of [-1, 1]) {
    parts.push({
      geometry: panel(doorWidth, height - 0.06, 0.024),
      // La derecha va SIEMPRE entornada. Que se abriera o no según la variante
      // cambiaba el fondo del ropero en 10 cm, y todas comparten un solo casco.
      position: [sx * (doorWidth / 2 + 0.012), 0, depth / 2 - 0.012],
      rotation: sx > 0 ? [0, -0.42, 0] : undefined,
      tile: 1,
    });
    if (lod === 0) {
      parts.push({
        geometry: new CylinderGeometry(0.012, 0.012, 0.16, 6, 1),
        position: [sx * 0.045, (random() - 0.5) * 0.1, depth / 2 + 0.012],
        tile: 3,
      });
    }
  }
  return { parts };
};

/** Biblioteca abierta con estantes. */
const bookshelf: PropBuilder = (variant, lod) => {
  const random = variantRandom("bookshelf", variant);
  const width = 0.9;
  const height = 1.8;
  const depth = 0.32;
  const parts: GeometryPart[] = carcass(width, height, depth, 1);
  const shelves = 4;
  for (let index = 1; index <= shelves; index += 1) {
    const y = -height / 2 + (height / (shelves + 1)) * index;
    parts.push({
      geometry: chamferBox(width - 0.04, 0.018, depth - 0.03, 0.005),
      position: [0, y, 0.01],
      tile: 1,
    });
    if (lod === 0 && random() > 0.35) {
      // Fila de libros: un bloque con el canto irregular alcanza a esta escala.
      parts.push({
        geometry: chamferBox((width - 0.1) * (0.4 + random() * 0.5), 0.22, depth * 0.6, 0.008),
        position: [(random() - 0.5) * width * 0.25, y + 0.12, 0.02],
        tile: 2,
      });
    }
  }
  return { parts };
};

/** Escritorio con pedestal de cajones a un lado. */
const desk: PropBuilder = (variant, lod) => {
  const random = variantRandom("desk", variant);
  const width = 1.3;
  const height = 0.75;
  const depth = 0.65;
  const topThickness = 0.035;
  const side = random() > 0.5 ? 1 : -1;
  const pedestalWidth = 0.4;
  const parts: GeometryPart[] = [
    {
      geometry: chamferBox(width, topThickness, depth, 0.008),
      position: [0, height / 2 - topThickness / 2, 0],
      tile: 1,
    },
    // Pedestal de cajones.
    ...carcass(pedestalWidth, height - topThickness, depth - 0.04, 1).map((part) => ({
      ...part,
      position: [
        (part.position?.[0] ?? 0) + side * (width - pedestalWidth) / 2,
        (part.position?.[1] ?? 0) - topThickness / 2,
        part.position?.[2] ?? 0,
      ] as Vec3,
    })),
  ];
  // Pata del lado libre.
  parts.push({
    geometry: chamferBox(0.05, height - topThickness, depth - 0.08, 0.008),
    position: [-side * (width - 0.05) / 2, -topThickness / 2, 0],
    tile: 1,
  });
  if (lod === 0) {
    for (let index = 0; index < 3; index += 1) {
      const y = -height / 2 + 0.14 + index * 0.2;
      parts.push(
        ...drawerFace(pedestalWidth - 0.05, 0.17, depth / 2 - 0.03, y, 3, true).map((part) => ({
          ...part,
          position: [
            (part.position?.[0] ?? 0) + side * (width - pedestalWidth) / 2,
            part.position?.[1] ?? 0,
            part.position?.[2] ?? 0,
          ] as Vec3,
        })),
      );
    }
  }
  return { parts };
};

/** Mesa de luz. */
const nightstand: PropBuilder = (variant, lod) => {
  const width = 0.45;
  const height = 0.55;
  const depth = 0.4;
  const parts: GeometryPart[] = carcass(width, height, depth, 1);
  parts.push(...drawerFace(width - 0.05, 0.16, depth / 2 - 0.011, height / 2 - 0.14, 3, lod === 0));
  if (lod === 0) {
    parts.push({
      geometry: chamferBox(width - 0.05, 0.014, depth - 0.05, 0.004),
      position: [0, -height / 2 + 0.16, 0],
      tile: 1,
    });
  }
  return { parts };
};

/** Banqueta de tres patas. */
const stool: PropBuilder = (variant, lod) => {
  const random = variantRandom("stool", variant);
  const height = 0.72;
  const seatRadius = 0.17;
  const segments = lod === 0 ? 12 : 6;
  const parts: GeometryPart[] = [
    {
      geometry: new CylinderGeometry(seatRadius, seatRadius, 0.04, segments, 1),
      position: [0, height / 2 - 0.02, 0],
      tile: 1,
    },
  ];
  const splay = 0.11;
  for (let index = 0; index < 3; index += 1) {
    const angle = (index / 3) * Math.PI * 2 + random() * 0.2;
    parts.push({
      geometry: new CylinderGeometry(0.017, 0.021, height - 0.04, lod === 0 ? 6 : 4, 1),
      position: [
        Math.cos(angle) * splay,
        -0.02,
        Math.sin(angle) * splay,
      ],
      rotation: [Math.sin(angle) * 0.12, 0, -Math.cos(angle) * 0.12],
      tile: 1,
    });
  }
  if (lod === 0) {
    parts.push({
      geometry: new CylinderGeometry(splay * 1.5, splay * 1.5, 0.016, segments, 1),
      position: [0, -height / 2 + 0.2, 0],
      tile: 1,
    });
  }
  return { parts };
};

/** Banco de plaza: listones sobre dos caballetes. */
const bench: PropBuilder = (variant, lod) => {
  const random = variantRandom("bench", variant);
  const width = 1.6;
  const height = 0.45;
  const depth = 0.4;
  const parts: GeometryPart[] = [];
  const slats = lod === 0 ? 4 : 2;
  for (let index = 0; index < slats; index += 1) {
    parts.push({
      geometry: chamferBox(width, 0.03, depth / slats - 0.02, 0.006),
      position: [0, height / 2 - 0.015, (index - (slats - 1) / 2) * (depth / slats)],
      tile: 1,
    });
  }
  for (const sx of [-1, 1]) {
    parts.push({
      geometry: chamferBox(0.05, height - 0.03, depth * 0.9, 0.006),
      position: [sx * (width / 2 - 0.16), -0.015, 0],
      tile: 3,
    });
  }
  if (lod === 0 && random() > 0.5) {
    parts.push({
      geometry: chamferBox(width * 0.9, 0.026, 0.03, 0.005),
      position: [0, 0, -depth / 2 + 0.015],
      tile: 3,
    });
  }
  return { parts };
};

/** Silla de oficina: base de estrella, columna y respaldo. */
const officeChair: PropBuilder = (variant, lod) => {
  const random = variantRandom("officeChair", variant);
  const height = 1;
  const seatY = -height / 2 + 0.46;
  const segments = lod === 0 ? 10 : 5;
  const spokes = 5;
  const reach = 0.29;
  const parts: GeometryPart[] = [
    { geometry: new CylinderGeometry(0.028, 0.028, 0.4, segments, 1), position: [0, seatY - 0.2, 0], tile: 3 },
    { geometry: chamferBox(0.44, 0.07, 0.44, 0.02), position: [0, seatY + 0.035, 0], tile: 0 },
    {
      geometry: chamferBox(0.42, 0.42, 0.06, 0.02),
      position: [0, seatY + 0.28, -0.19],
      rotation: [-0.16, 0, 0],
      tile: 0,
    },
  ];
  // Las patas fijan el ancho declarado: van en los dos LODs.
  for (let index = 0; index < spokes; index += 1) {
    const angle = (index / spokes) * Math.PI * 2;
    parts.push({
      geometry: chamferBox(reach, 0.03, 0.05, 0.008),
      position: [Math.cos(angle) * reach / 2, -height / 2 + 0.05, Math.sin(angle) * reach / 2],
      rotation: [0, -angle, 0],
      tile: 3,
    });
    parts.push({
      geometry: new CylinderGeometry(0.03, 0.03, 0.026, lod === 0 ? 8 : 4, 1),
      position: [Math.cos(angle) * reach, -height / 2 + 0.03, Math.sin(angle) * reach],
      rotation: [Math.PI / 2, 0, 0],
      tile: 3,
    });
  }
  if (lod === 0 && random() > 0.4) {
    for (const sx of [-1, 1]) {
      parts.push({
        geometry: chamferBox(0.04, 0.03, 0.28, 0.008),
        position: [sx * 0.24, seatY + 0.19, -0.02],
        tile: 3,
      });
    }
  }
  return { parts };
};

// ---------------------------------------------------------------------------
// Electrodomésticos e instalaciones
// ---------------------------------------------------------------------------

/** Gabinete de electrodoméstico: caja de chapa con zócalo hundido. */
function applianceBody(
  width: number,
  height: number,
  depth: number,
  tile: AtlasTile,
): GeometryPart[] {
  const plinth = 0.06;
  return [
    {
      geometry: chamferBox(width, height - plinth, depth, 0.012),
      position: [0, plinth / 2, 0],
      tile,
    },
    {
      geometry: chamferBox(width * 0.9, plinth, depth * 0.9, 0.008),
      position: [0, -height / 2 + plinth / 2, 0],
      tile: 3,
    },
  ];
}

/** Heladera de dos puertas: el prop más alto del pack. */
const fridge: PropBuilder = (variant, lod) => {
  const random = variantRandom("fridge", variant);
  const width = 0.7;
  const height = 1.75;
  const depth = 0.68;
  const parts: GeometryPart[] = applianceBody(width, height, depth, random() > 0.5 ? 0 : 1 as AtlasTile);
  // Corte entre freezer y heladera, más arriba que el medio.
  const split = height * 0.28;
  parts.push({
    geometry: chamferBox(width * 0.99, 0.02, 0.03, 0.005),
    position: [0, height / 2 - split, depth / 2],
    tile: 3,
  });
  if (lod === 0) {
    for (const [y, tall] of [
      [height / 2 - split / 2, split - 0.05],
      [-split / 2 + 0.02, height - split - 0.14],
    ] as const) {
      parts.push({
        geometry: chamferBox(0.035, tall * 0.7, 0.045, 0.01),
        position: [-width / 2 + 0.09, y, depth / 2 + 0.022],
        tile: 1,
      });
    }
  }
  return { parts };
};

/** Lavarropas: puerta redonda de ojo de buey y panel de mandos. */
const washingMachine: PropBuilder = (variant, lod) => {
  const random = variantRandom("washingMachine", variant);
  const width = 0.6;
  const height = 0.85;
  const depth = 0.6;
  const segments = lod === 0 ? 14 : 7;
  const parts: GeometryPart[] = applianceBody(width, height, depth, 0);
  parts.push({
    geometry: new CylinderGeometry(0.16, 0.16, 0.03, segments, 1),
    position: [0, -0.03, depth / 2],
    rotation: [Math.PI / 2, 0, 0],
    tile: 3,
  });
  if (lod === 0) {
    parts.push({
      geometry: new CylinderGeometry(0.125, 0.125, 0.02, segments, 1),
      position: [0, -0.03, depth / 2 + 0.012],
      rotation: [Math.PI / 2, 0, 0],
      tile: 1,
    });
    // Panel de mandos con la perilla corrida por variante.
    parts.push({
      geometry: chamferBox(width * 0.94, 0.1, 0.02, 0.006),
      position: [0, height / 2 - 0.1, depth / 2 + 0.005],
      tile: 1,
    });
    parts.push({
      geometry: new CylinderGeometry(0.024, 0.024, 0.022, 8, 1),
      position: [(random() - 0.5) * width * 0.5, height / 2 - 0.1, depth / 2 + 0.02],
      rotation: [Math.PI / 2, 0, 0],
      tile: 3,
    });
  }
  return { parts };
};

/** Cocina: horno con puerta y cuatro hornallas. */
const stove: PropBuilder = (variant, lod) => {
  const random = variantRandom("stove", variant);
  const width = 0.6;
  const height = 0.9;
  const depth = 0.62;
  const parts: GeometryPart[] = applianceBody(width, height, depth, 0);
  // Tapa de acero: define el tope, así que va en ambos LODs.
  parts.push({
    geometry: chamferBox(width, 0.025, depth, 0.006),
    position: [0, height / 2 - 0.012, 0],
    tile: 1,
  });
  parts.push({
    geometry: chamferBox(width * 0.9, 0.32, 0.02, 0.006),
    position: [0, -0.06, depth / 2 + 0.005],
    tile: 1,
  });
  if (lod === 0) {
    const segments = 10;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        parts.push({
          geometry: new CylinderGeometry(0.062, 0.055, 0.014, segments, 1),
          position: [sx * width * 0.22, height / 2, sz * depth * 0.2],
          tile: 3,
        });
      }
    }
    for (let index = 0; index < 4; index += 1) {
      parts.push({
        geometry: new CylinderGeometry(0.018, 0.018, 0.024, 8, 1),
        position: [(index - 1.5) * width * 0.2, height / 2 - 0.13, depth / 2 + 0.014],
        rotation: [Math.PI / 2, 0, 0],
        tile: random() > 0.5 ? 3 : 1,
      });
    }
  }
  return { parts };
};

/** Mesada de cocina con puertas bajo mesada. */
const kitchenCounter: PropBuilder = (variant, lod) => {
  const random = variantRandom("kitchenCounter", variant);
  const width = 1.2;
  const height = 0.9;
  const depth = 0.65;
  const topThickness = 0.04;
  const parts: GeometryPart[] = [
    {
      geometry: chamferBox(width, topThickness, depth, 0.008),
      position: [0, height / 2 - topThickness / 2, 0],
      tile: 2,
    },
    {
      geometry: chamferBox(width, height - topThickness - 0.08, depth - 0.06, 0.008),
      position: [0, 0.02, -0.01],
      tile: 0,
    },
    {
      geometry: chamferBox(width * 0.94, 0.08, depth * 0.8, 0.006),
      position: [0, -height / 2 + 0.04, -0.03],
      tile: 3,
    },
  ];
  if (lod === 0) {
    for (const sx of [-1, 1]) {
      parts.push({
        geometry: panel(width / 2 - 0.03, height - topThickness - 0.16, 0.02),
        position: [sx * width * 0.25, 0.01, depth / 2 - 0.04],
        tile: 0,
      });
      parts.push({
        geometry: chamferBox(0.02, 0.11, 0.022, 0.005),
        position: [sx * 0.06, 0.16 + (random() - 0.5) * 0.02, depth / 2 - 0.02],
        tile: 1,
      });
    }
  }
  return { parts };
};

/** Bañera de patas. */
const bathtub: PropBuilder = (variant, lod) => {
  const width = 1.7;
  const height = 0.62;
  const depth = 0.75;
  const wall = 0.05;
  const parts: GeometryPart[] = [
    // Faldón exterior, apenas más ancho arriba.
    {
      geometry: chamferWedge({
        length: width,
        height: height - 0.12,
        frontWidth: depth * 0.92,
        rearWidth: depth * 0.92,
        topFrontWidth: depth,
        topRearWidth: depth,
        chamfer: 0.03,
      }),
      position: [0, 0.06, 0],
      rotation: [0, Math.PI / 2, 0],
      tile: 2,
    },
    // Borde superior: el aro que cierra la bañera y define el tope.
    {
      geometry: chamferBox(width, 0.05, depth, 0.02),
      position: [0, height / 2 - 0.025, 0],
      tile: 2,
    },
    // Hueco: la cavidad hundida bajo el borde.
    {
      geometry: chamferBox(width - wall * 2, 0.04, depth - wall * 2, 0.015),
      position: [0, height / 2 - 0.07, 0],
      tile: 2,
    },
  ];
  if (lod === 0) {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        parts.push({
          geometry: new CylinderGeometry(0.03, 0.035, 0.12, 6, 1),
          position: [sx * (width / 2 - 0.16), -height / 2 + 0.06, sz * (depth / 2 - 0.12)],
          tile: 3,
        });
      }
    }
    parts.push({
      geometry: new CylinderGeometry(0.022, 0.022, 0.14, 8, 1),
      position: [-width / 2 + 0.1, height / 2 - 0.02, 0],
      tile: 1,
    });
  }
  return { parts };
};

/** Inodoro: mochila, taza y tapa. */
const toilet: PropBuilder = (variant, lod) => {
  const width = 0.4;
  const height = 0.78;
  const depth = 0.7;
  const segments = lod === 0 ? 12 : 6;
  const parts: GeometryPart[] = [
    // Mochila.
    {
      geometry: chamferBox(width, 0.4, 0.19, 0.02),
      position: [0, height / 2 - 0.2, -depth / 2 + 0.095],
      tile: 2,
    },
    // Pie: se afina hacia abajo.
    {
      geometry: chamferWedge({
        length: 0.3,
        height: height - 0.42,
        frontWidth: width * 0.62,
        rearWidth: width * 0.5,
        topFrontWidth: width * 0.82,
        topRearWidth: width * 0.7,
        chamfer: 0.02,
      }),
      position: [0, -height / 2 + (height - 0.42) / 2, 0.04],
      tile: 2,
    },
    // Taza.
    {
      geometry: new CylinderGeometry(width / 2, width * 0.42, 0.16, segments, 1),
      position: [0, -height / 2 + (height - 0.42) + 0.06, 0.1],
      tile: 2,
    },
  ];
  if (lod === 0) {
    parts.push({
      geometry: new CylinderGeometry(width * 0.46, width * 0.46, 0.02, segments, 1),
      position: [0, -height / 2 + (height - 0.42) + 0.15, 0.1],
      tile: 3,
    });
  }
  return { parts };
};

/** Lavatorio de pie. */
const sink: PropBuilder = (variant, lod) => {
  const random = variantRandom("sink", variant);
  const width = 0.58;
  const height = 0.85;
  const depth = 0.48;
  const parts: GeometryPart[] = [
    // Bacha.
    {
      geometry: chamferBox(width, 0.17, depth, 0.03),
      position: [0, height / 2 - 0.085, 0],
      tile: 2,
    },
    // Pedestal, afinado en el medio.
    {
      geometry: chamferWedge({
        length: depth * 0.55,
        height: height - 0.17,
        frontWidth: width * 0.34,
        rearWidth: width * 0.3,
        topFrontWidth: width * 0.44,
        topRearWidth: width * 0.4,
        chamfer: 0.02,
      }),
      position: [0, -0.085, -0.02],
      tile: 2,
    },
  ];
  if (lod === 0) {
    parts.push({
      geometry: chamferBox(width * 0.72, 0.03, depth * 0.6, 0.012),
      position: [0, height / 2 - 0.03, 0.03],
      tile: 2,
    });
    parts.push({
      geometry: new CylinderGeometry(0.018, 0.018, 0.13, 8, 1),
      position: [(random() - 0.5) * 0.04, height / 2 + 0.02, -depth / 2 + 0.09],
      tile: 1,
    });
  }
  return { parts };
};

/** Fila de lockers metálicos. */
const lockerBank: PropBuilder = (variant, lod) => {
  const random = variantRandom("lockerBank", variant);
  const width = 0.92;
  const height = 1.8;
  const depth = 0.5;
  const parts: GeometryPart[] = applianceBody(width, height, depth, 1);
  const doors = 3;
  const doorWidth = width / doors;
  for (let index = 0; index < doors; index += 1) {
    const x = (index - (doors - 1) / 2) * doorWidth;
    parts.push({
      geometry: panel(doorWidth - 0.012, height - 0.1, 0.018),
      // Siempre la del medio entreabierta: cuál se abría por variante cambiaba
      // el fondo del mueble, y el casco de colisión es uno solo para todas.
      position: [x, 0.02, depth / 2 - 0.009],
      rotation: index === 1 ? [0, 0.3, 0] : undefined,
      tile: 1,
    });
    if (lod === 0) {
      parts.push({
        geometry: chamferBox(0.03, 0.09, 0.02, 0.005),
        position: [x + doorWidth * 0.32, 0.02, depth / 2 + 0.006],
        tile: 3,
      });
      // Rejilla de ventilación arriba de cada puerta.
      for (let slot = 0; slot < 3; slot += 1) {
        parts.push({
          geometry: chamferBox(doorWidth * 0.42, 0.012, 0.014, 0.003),
          position: [x, height / 2 - 0.14 - slot * 0.03, depth / 2 + 0.004],
          tile: 3,
        });
      }
    }
  }
  return { parts };
};

export const INTERIOR_BUILDERS = {
  couch,
  armchair,
  mattress,
  bed,
  dresser,
  wardrobe,
  bookshelf,
  desk,
  nightstand,
  stool,
  bench,
  officeChair,
  fridge,
  washingMachine,
  stove,
  kitchenCounter,
  bathtub,
  toilet,
  sink,
  lockerBank,
} as const;
