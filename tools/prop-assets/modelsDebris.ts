import { CylinderGeometry } from "three";

import { chamferBox, chamferWedge } from "../shared/gltf/geometry.js";
import { variantRandom, type PropBuilder } from "./builderKit.js";
import type { AtlasTile, GeometryPart } from "./types.js";

/**
 * Escombro: lo que convierte un pasillo en un pasillo DERRUMBADO.
 *
 * Regla de la familia: nada es simétrico ni entero. Las piezas se generan con
 * caras irregulares por variante y con la armadura o las astillas asomando,
 * porque una losa prolija se lee como bloque de construcción, no como ruina.
 *
 * Tiles: 0 hormigón, 1 acero oxidado, 2 yeso, 3 madera astillada y arpillera.
 */

/** Losa fracturada: caras que se estrechan distinto según la variante. */
function brokenSlab(
  id: string,
  variant: number,
  width: number,
  height: number,
  depth: number,
  tile: AtlasTile,
): GeometryPart {
  const random = variantRandom(id, variant);
  return {
    geometry: chamferWedge({
      length: depth,
      height,
      // El frente queda a medida y el resto se come: así el ancho declarado no
      // depende de la variante, que es lo que rompe el casco compartido.
      frontWidth: width,
      rearWidth: width * (0.64 + random() * 0.22),
      topFrontWidth: width * (0.7 + random() * 0.2),
      topRearWidth: width * (0.56 + random() * 0.22),
      chamfer: 0.025,
    }),
    tile,
  };
}

/** Hierros de armadura saliendo de una fractura. Cantidad y largo FIJOS. */
function rebarStubs(
  count: number,
  spread: number,
  y: number,
  z: number,
  length: number,
  lod: 0 | 1,
): GeometryPart[] {
  const parts: GeometryPart[] = [];
  for (let index = 0; index < count; index += 1) {
    const t = (index + 0.5) / count;
    parts.push({
      geometry: new CylinderGeometry(0.008, 0.008, length, lod === 0 ? 5 : 4, 1),
      position: [(t - 0.5) * spread, y, z],
      rotation: [1.15, (index - (count - 1) / 2) * 0.28, 0],
      tile: 1,
    });
  }
  return parts;
}

/** Losa grande: el escombro que sirve de cobertura, no de proyectil. */
const concreteSlab: PropBuilder = (variant, lod) => {
  const parts: GeometryPart[] = [
    brokenSlab("concreteSlab", variant, 1.25, 0.24, 0.9, 0),
  ];
  parts.push(...rebarStubs(4, 0.85, 0.05, -0.42, 0.28, lod));
  if (lod === 0) {
    // Baldosas pegadas a una cara: la losa venía de un piso, no de un molde.
    parts.push({
      geometry: chamferBox(1.1, 0.02, 0.7, 0.006),
      position: [0, 0.13, 0.03],
      tile: 2,
    });
  }
  return { parts };
};

/** Tramo de columna reventada: se para solo y bloquea la vista. */
const brokenPillar: PropBuilder = (variant, lod) => {
  const random = variantRandom("brokenPillar", variant);
  const side = 0.44;
  const height = 1.35;
  const parts: GeometryPart[] = [
    {
      geometry: chamferWedge({
        length: side,
        height,
        frontWidth: side,
        rearWidth: side * 0.94,
        // La quiebra de arriba: la columna se cortó en diagonal.
        topFrontWidth: side * (0.5 + random() * 0.2),
        topRearWidth: side * (0.4 + random() * 0.2),
        topOffsetY: 0,
        chamfer: 0.02,
      }),
      tile: 0,
    },
  ];
  parts.push(...rebarStubs(4, side * 0.6, height / 2 - 0.02, 0, 0.34, lod));
  if (lod === 0) {
    // Anillo de estribo asomando donde saltó el recubrimiento.
    parts.push({
      geometry: new CylinderGeometry(side * 0.34, side * 0.34, 0.012, 8, 1),
      position: [0, height * (random() * 0.2 - 0.05), 0],
      tile: 1,
    });
  }
  return { parts };
};

/** Pila de ladrillos: se desarma en pedazos que ya son ladrillos. */
const brickPile: PropBuilder = (variant, lod) => {
  const random = variantRandom("brickPile", variant);
  const width = 0.78;
  const height = 0.44;
  const depth = 0.6;
  const brick = { w: 0.22, h: 0.1, d: 0.11 };
  const parts: GeometryPart[] = [];
  // Los ladrillos de borde fijan la huella y van alineados, en los dos LODs.
  for (const sx of [-1, 1]) {
    parts.push({
      geometry: chamferBox(brick.w, brick.h, brick.d, 0.006),
      position: [(sx * (width - brick.w)) / 2, -height / 2 + brick.h / 2, (sx * (depth - brick.d)) / 2],
      tile: 0,
    });
  }
  // Los sueltos se desparraman DENTRO de ese borde. El margen no es estético:
  // un ladrillo girado al azar que se pase del borde hace que cada variante
  // mida distinto, y todas comparten un solo casco de colisión.
  const reach = width / 2 - brick.w * 0.78;
  const rows = lod === 0 ? 4 : 2;
  for (let row = 0; row < rows; row += 1) {
    // Cada hilada más corta y más girada: es un montón, no una pared.
    const count = Math.max(1, 4 - row);
    for (let index = 0; index < count; index += 1) {
      const slot = count === 1 ? 0 : ((index - (count - 1) / 2) / ((count - 1) / 2)) * reach;
      parts.push({
        geometry: chamferBox(brick.w, brick.h, brick.d, 0.006),
        position: [
          slot,
          -height / 2 + brick.h / 2 + row * (brick.h * (rows === 2 ? 2 : 1)),
          (random() - 0.5) * depth * 0.4,
        ],
        rotation: [0, (random() - 0.5) * 0.7, (random() - 0.5) * 0.12],
        tile: 0,
      });
    }
  }
  return { parts };
};

/** Atado de hierros del 12: largo, pesado y con las puntas desparejas. */
const rebarBundle: PropBuilder = (variant, lod) => {
  const random = variantRandom("rebarBundle", variant);
  const length = 1.7;
  const radius = 0.011;
  const bars = lod === 0 ? 7 : 4;
  const parts: GeometryPart[] = [];
  for (let index = 0; index < bars; index += 1) {
    const angle = (index / bars) * Math.PI * 2;
    const spread = index === 0 ? 0 : 0.035;
    parts.push({
      geometry: new CylinderGeometry(radius, radius, length * (0.86 + random() * 0.14), lod === 0 ? 5 : 4, 1),
      position: [0, Math.sin(angle) * spread, Math.cos(angle) * spread],
      rotation: [0, 0, Math.PI / 2],
      tile: 1,
    });
  }
  // Las dos barras que fijan el largo declarado, enteras y en ambos LODs.
  for (const sy of [-1, 1]) {
    parts.push({
      geometry: new CylinderGeometry(radius, radius, length, lod === 0 ? 5 : 4, 1),
      position: [0, sy * 0.045, 0],
      rotation: [0, 0, Math.PI / 2],
      tile: 1,
    });
  }
  if (lod === 0) {
    // Alambres de atado.
    for (const x of [-0.45, 0.1, 0.55]) {
      parts.push({
        geometry: new CylinderGeometry(0.055, 0.055, 0.01, 8, 1),
        position: [x, 0, 0],
        rotation: [0, 0, Math.PI / 2],
        tile: 1,
      });
    }
  }
  return { parts };
};

/** Perfil doble T: el miembro estructural del set. */
const iBeam: PropBuilder = (variant, lod) => {
  const random = variantRandom("iBeam", variant);
  const length = 2.2;
  const flange = 0.2;
  const height = 0.24;
  const web = 0.022;
  const parts: GeometryPart[] = [];
  for (const sy of [-1, 1]) {
    parts.push({
      geometry: chamferBox(length, 0.024, flange, 0.005),
      position: [0, sy * (height - 0.024) / 2, 0],
      tile: 1,
    });
  }
  parts.push({
    geometry: chamferBox(length, height - 0.048, web, 0.004),
    tile: 1,
  });
  if (lod === 0) {
    // Placas de unión atornilladas en una punta: la viga se arrancó de algo.
    const side = random() > 0.5 ? 1 : -1;
    parts.push({
      geometry: chamferBox(0.13, height * 0.9, web * 4, 0.004),
      position: [side * (length / 2 - 0.09), 0, 0],
      tile: 1,
    });
    for (let index = 0; index < 4; index += 1) {
      parts.push({
        geometry: new CylinderGeometry(0.012, 0.012, web * 5, 6, 1),
        position: [
          side * (length / 2 - 0.06 - (index % 2) * 0.06),
          (Math.floor(index / 2) - 0.5) * height * 0.4,
          0,
        ],
        rotation: [Math.PI / 2, 0, 0],
        tile: 1,
      });
    }
  }
  return { parts };
};

/** Chapa doblada: liviana, grande y con el canto filoso. */
const metalPanel: PropBuilder = (variant, lod) => {
  const random = variantRandom("metalPanel", variant);
  const width = 1.15;
  const height = 0.85;
  const thickness = 0.014;
  const fold = 0.24;
  const parts: GeometryPart[] = [
    {
      geometry: chamferBox(width - fold, height, thickness, 0.004),
      position: [-fold / 2, 0, 0.05],
      tile: 1,
    },
    // El doblez: sin él es una placa plana y lee como cartel. El ángulo es FIJO
    // porque es el que define el fondo de la chapa; variarlo por variante corría
    // el centro del AABB y dejaba al prop descentrado de su propio casco.
    {
      geometry: chamferBox(fold, height, thickness, 0.004),
      position: [(width - fold) / 2, 0, -0.02],
      rotation: [0, 1, 0],
      tile: 1,
    },
  ];
  if (lod === 0) {
    // Nervaduras estampadas a lo largo, corridas según la variante.
    const offset = (random() - 0.5) * height * 0.12;
    for (let index = 0; index < 3; index += 1) {
      parts.push({
        geometry: chamferBox(width - fold - 0.1, 0.02, 0.012, 0.003),
        position: [-fold / 2, (index - 1) * height * 0.28 + offset, 0.058],
        tile: 1,
      });
    }
  }
  return { parts };
};

/** Montón de chatarra retorcida. */
const scrapHeap: PropBuilder = (variant, lod) => {
  const random = variantRandom("scrapHeap", variant);
  const width = 0.95;
  const height = 0.5;
  const depth = 0.8;
  const parts: GeometryPart[] = [
    // Base: la masa que sostiene el resto y fija la huella.
    {
      geometry: chamferWedge({
        length: depth,
        height: height * 0.5,
        frontWidth: width,
        rearWidth: width * 0.7,
        topFrontWidth: width * 0.72,
        topRearWidth: width * 0.5,
        chamfer: 0.03,
      }),
      position: [0, -height * 0.25, 0],
      tile: 1,
    },
  ];
  // Chapa de coronación: define el tope del montón. Es fija, en ambos LODs, y
  // por eso las piezas sueltas pueden ir donde quieran sin cambiar el
  // envolvente. Sin un ancla así, cada variante mide y se centra distinto.
  parts.push({
    geometry: chamferBox(0.36, 0.05, 0.26, 0.008),
    position: [0, height * 0.4, 0],
    rotation: [0.18, 0.5, -0.12],
    tile: 1,
  });

  // Los sueltos van de largo FIJO y encerrados bien adentro del ancla: es la
  // rotación libre la que da el desorden, no el tamaño ni el alcance.
  const pieces = lod === 0 ? 7 : 3;
  for (let index = 0; index < pieces; index += 1) {
    const long = random() > 0.5;
    parts.push({
      geometry: long
        ? new CylinderGeometry(0.018, 0.014, 0.36, 5, 1)
        : chamferBox(0.3, 0.014, 0.2, 0.005),
      position: [
        (random() - 0.5) * 0.36,
        random() * 0.08 - 0.06,
        (random() - 0.5) * 0.28,
      ],
      rotation: [random() * 2, random() * 3, random() * 2],
      tile: 1,
    });
  }
  return { parts };
};

/** Tubo de andamio con sus grampas: el miembro de `scaffoldTowerStructure`. */
const scaffoldPipe: PropBuilder = (variant, lod) => {
  const random = variantRandom("scaffoldPipe", variant);
  const length = 1.9;
  const radius = 0.024;
  const segments = lod === 0 ? 10 : 5;
  const parts: GeometryPart[] = [
    {
      geometry: new CylinderGeometry(radius, radius, length, segments, 1),
      rotation: [0, 0, Math.PI / 2],
      tile: 1,
    },
  ];
  // Las grampas van en ambos LODs: son las que fijan el grosor declarado.
  for (const x of [-0.55, 0.6]) {
    parts.push({
      geometry: new CylinderGeometry(radius * 1.9, radius * 1.9, 0.06, segments, 1),
      position: [x, 0, 0],
      rotation: [0, 0, Math.PI / 2],
      tile: 1,
    });
    parts.push({
      geometry: chamferBox(0.05, radius * 3.6, 0.018, 0.004),
      position: [x, 0, radius * 1.9],
      rotation: [(random() - 0.5) * 0.3, 0, 0],
      tile: 1,
    });
  }
  return { parts };
};

/** Placa de yeso partida. */
const plasterSlab: PropBuilder = (variant, lod) => {
  const random = variantRandom("plasterSlab", variant);
  const width = 1.05;
  const height = 0.09;
  const depth = 0.72;
  const parts: GeometryPart[] = [
    brokenSlab("plasterSlab", variant, width, height, depth, 2),
  ];
  if (lod === 0) {
    // Listones del bastidor pegados atrás y papel colgando del canto.
    for (const z of [-0.2, 0.18]) {
      parts.push({
        geometry: chamferBox(width * 0.8, 0.026, 0.05, 0.004),
        position: [(random() - 0.5) * 0.08, -height / 2 - 0.008, z],
        tile: 3,
      });
    }
    parts.push({
      geometry: chamferBox(width * 0.3, 0.004, depth * 0.34, 0.002),
      position: [width * 0.28, height / 2 - 0.01, -depth * 0.2],
      rotation: [0.2, 0.3, 0],
      tile: 2,
    });
  }
  return { parts };
};

/** Bolsa de arena: cobertura blanda que se apila. */
const sandbag: PropBuilder = (variant, lod) => {
  const random = variantRandom("sandbag", variant);
  const width = 0.52;
  const height = 0.2;
  const depth = 0.32;
  const parts: GeometryPart[] = [
    // Panza: más ancha en el medio que en las puntas.
    {
      geometry: chamferWedge({
        length: width,
        height,
        frontWidth: depth * 0.66,
        rearWidth: depth * 0.66,
        topFrontWidth: depth * 0.52,
        topRearWidth: depth * 0.52,
        chamfer: 0.05,
      }),
      rotation: [0, Math.PI / 2, 0],
      tile: 3,
    },
    {
      geometry: chamferBox(width * 0.72, height * 0.92, depth, 0.06),
      position: [0, (random() - 0.5) * 0.008, 0],
      tile: 3,
    },
  ];
  if (lod === 0) {
    // Costuras de las puntas atadas.
    for (const sx of [-1, 1]) {
      parts.push({
        geometry: chamferBox(0.04, height * 0.5, depth * 0.4, 0.008),
        position: [sx * (width / 2 - 0.02), 0, 0],
        tile: 3,
      });
    }
  }
  return { parts };
};

/** Barricada de tablas clavadas. */
const barricadeWood: PropBuilder = (variant, lod) => {
  const random = variantRandom("barricadeWood", variant);
  const width = 1.5;
  const height = 1.05;
  const parts: GeometryPart[] = [];
  // Montantes: fijan el alto y van en los dos LODs.
  for (const sx of [-1, 1]) {
    parts.push({
      geometry: chamferBox(0.075, height, 0.075, 0.006),
      position: [sx * (width / 2 - 0.06), 0, 0],
      rotation: [0, 0, sx * 0.03],
      tile: 3,
    });
  }
  const planks: number = lod === 0 ? 5 : 3;
  for (let index = 0; index < planks; index += 1) {
    const t = index / (planks - 1);
    parts.push({
      geometry: chamferBox(width, 0.14, 0.03, 0.005),
      position: [0, (t - 0.5) * (height - 0.2), (random() - 0.5) * 0.03],
      rotation: [0, 0, (random() - 0.5) * 0.06],
      tile: 3,
    });
  }
  if (lod === 0) {
    // Una tabla cruzada en diagonal: es lo que la lee como tapiada a las apuradas.
    parts.push({
      geometry: chamferBox(width * 1.02, 0.13, 0.028, 0.005),
      position: [0, 0, 0.03],
      rotation: [0, 0, 0.5],
      tile: 3,
    });
  }
  return { parts };
};

export const DEBRIS_BUILDERS = {
  concreteSlab,
  brokenPillar,
  brickPile,
  rebarBundle,
  iBeam,
  metalPanel,
  scrapHeap,
  scaffoldPipe,
  plasterSlab,
  sandbag,
  barricadeWood,
} as const;
