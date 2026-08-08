import { CylinderGeometry } from "three";

import { chamferBox, chamferWedge, loftedBody } from "../shared/gltf/geometry.js";
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
  // Hiladas trabadas y SEPARADAS. La clave para que se lean como ladrillos
  // sueltos y no como un bloque blanco es el hueco entre ellos: sin junta la
  // pila se funde en una sola masa al mirarla de lejos.
  const gap = 0.022;
  const reach = width / 2 - brick.w * 0.78;
  const rows = lod === 0 ? 4 : 2;
  for (let row = 0; row < rows; row += 1) {
    // Cada hilada más corta: es un montón, no una pared.
    const count = Math.max(1, 4 - row);
    // Traba de media pieza en las hiladas impares, como una pila de verdad.
    const stagger = row % 2 === 0 ? 0 : brick.w * 0.5;
    for (let index = 0; index < count; index += 1) {
      const slot = count === 1 ? 0 : ((index - (count - 1) / 2) / ((count - 1) / 2)) * reach;
      parts.push({
        geometry: chamferBox(brick.w - gap, brick.h - gap * 0.4, brick.d - gap, 0.008),
        position: [
          slot + stagger * 0.4,
          -height / 2 + brick.h / 2 + row * (brick.h + gap * 0.5) * (rows === 2 ? 2 : 1),
          (random() - 0.5) * depth * 0.34,
        ],
        // Poco giro y sólo en Y: un ladrillo apilado no queda de canto.
        rotation: [0, (random() - 0.5) * 0.35, (random() - 0.5) * 0.05],
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
    // Base: dos chapas grandes cruzadas que fijan la huella. Antes era una cuña
    // maciza, y una masa lisa con óxido encima lee como cerámica, no como
    // chatarra: el montón parecía una vasija de terracota.
    {
      geometry: chamferBox(width, 0.016, depth * 0.78, 0.005),
      position: [0, -height * 0.42, 0],
      rotation: [0.06, 0.2, 0.04],
      tile: 1,
    },
    {
      geometry: chamferBox(width * 0.78, 0.016, depth, 0.005),
      position: [0, -height * 0.34, 0],
      rotation: [-0.05, 1.1, 0.07],
      tile: 1,
    },
  ];
  // Chapa de coronación: define el tope del montón. Es fija, en ambos LODs, y
  // por eso las piezas sueltas pueden ir donde quieran sin cambiar el
  // envolvente. Sin un ancla así, cada variante mide y se centra distinto.
  parts.push({
    geometry: chamferBox(0.36, 0.02, 0.26, 0.004),
    position: [0, height * 0.4, 0],
    rotation: [0.18, 0.5, -0.12],
    tile: 1,
  });

  // Chatarra = chapas dobladas y hierros, NUNCA una masa lisa. El montón tenía
  // una base maciza y con el óxido encima leía como una vasija de terracota.
  // Todo lo suelto vive DENTRO de las chapas ancla. Los márgenes de abajo no
  // son estéticos: cualquier pieza que se pase hace que la variante mida
  // distinto, y las tres comparten un solo casco de colisión.
  const plates = lod === 0 ? 6 : 3;
  for (let index = 0; index < plates; index += 1) {
    parts.push({
      geometry: chamferBox(0.26 + random() * 0.08, 0.012, 0.2 + random() * 0.06, 0.004),
      position: [
        (random() - 0.5) * 0.3,
        -height * 0.32 + index * (height * 0.09),
        (random() - 0.5) * 0.24,
      ],
      // Casi planas y cruzadas entre sí: es como cae la chapa.
      rotation: [(random() - 0.5) * 0.4, random() * 3, (random() - 0.5) * 0.4],
      tile: 1,
    });
  }
  const rods = lod === 0 ? 5 : 2;
  for (let index = 0; index < rods; index += 1) {
    parts.push({
      geometry: new CylinderGeometry(0.014, 0.011, 0.36, 5, 1),
      position: [
        (random() - 0.5) * 0.26,
        -height * 0.06 + random() * height * 0.2,
        (random() - 0.5) * 0.2,
      ],
      // `CylinderGeometry` nace sobre Y: hay que tumbarlo con el giro en Z. Sin
      // eso quedaban casi parados, sobresalían por arriba de las chapas y cada
      // variante medía distinto de alto.
      rotation: [0, random() * 3, Math.PI / 2 + (random() - 0.5) * 0.4],
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
    // Listones del bastidor asomando por el canto roto: es lo que dice que la
    // placa se arrancó de una pared y no que salió así de fábrica.
    for (const z of [-0.2, 0.18]) {
      parts.push({
        geometry: chamferBox(width * 0.8, 0.026, 0.05, 0.004),
        position: [(random() - 0.5) * 0.08, -height / 2 - 0.008, z],
        tile: 3,
      });
    }
    // Papel despegado: tiras finas levantadas del canto y de una cara. Sin
    // esto la placa es una lámina blanca lisa y no se lee como escombro.
    // Tamaño e inclinación FIJOS, y apoyadas por debajo del canto: levantarlas
    // desde la cara con ángulo de semilla las sacaba del envolvente y cada
    // variante medía y se centraba distinto.
    for (let index = 0; index < 3; index += 1) {
      parts.push({
        geometry: chamferBox(width * 0.26, 0.003, depth * 0.2, 0.001),
        position: [
          (random() - 0.5) * width * 0.44,
          height / 2 - 0.032,
          (random() - 0.5) * depth * 0.44,
        ],
        rotation: [0.14, random() * 3, -0.1],
        tile: 2,
      });
    }
    // Yeso desmoronado en un borde: el canto nunca queda recto.
    for (let index = 0; index < 4; index += 1) {
      parts.push({
        geometry: chamferBox(0.05, height * 0.7, 0.05, 0.008),
        position: [
          -width / 2 + 0.02,
          0,
          (index / 3 - 0.5) * depth * 0.8,
        ],
        rotation: [0, (random() - 0.5) * 0.6, 0],
        tile: 2,
      });
    }
  }
  return { parts };
};

/**
 * Bolsa de arena.
 *
 * Se arma por rebanadas transversales que se ensanchan hacia el centro, en vez
 * de una cuña con una caja encima. Es lo que le da la panza: una bolsa llena no
 * tiene lados rectos, se abomba donde está el peso y se pellizca en las puntas.
 * Antes leía como una piedra justamente por eso.
 */
const sandbag: PropBuilder = (variant, lod) => {
  const random = variantRandom("sandbag", variant);
  const width = 0.52;
  const height = 0.2;
  const depth = 0.32;
  const half = width / 2;
  const belly = depth / 2;
  const rise = height / 2;

  // Cuerpo barrido de una sola pieza. Apilar cajas —con chaflán o con esquinas
  // esféricas— daba bultos facetados y la bolsa leía como una piedra. Un barrido
  // con secciones que se abren y se vuelven a pellizcar es lo que da la tela
  // llena: panza continua en el medio y puntas atadas en los extremos.
  const sections = [
    { z: -half, halfWidth: belly * 0.1, top: rise * 0.16, bottom: rise * 0.16, y: -rise * 0.5 },
    { z: -half * 0.66, halfWidth: belly * 0.62, top: rise * 0.66, bottom: rise * 0.72, y: -rise * 0.16 },
    { z: -half * 0.24, halfWidth: belly * 0.97, top: rise * 0.97, bottom: rise, y: 0 },
    { z: half * 0.24, halfWidth: belly, top: rise, bottom: rise, y: 0 },
    { z: half * 0.66, halfWidth: belly * 0.62, top: rise * 0.66, bottom: rise * 0.72, y: -rise * 0.16 },
    { z: half, halfWidth: belly * 0.1, top: rise * 0.16, bottom: rise * 0.16, y: -rise * 0.5 },
  ];
  const parts: GeometryPart[] = [
    {
      // Exponente cerca de 1: sección elíptica, o sea sin cantos. Más alto
      // volvería a darle esquinas y con eso vuelve a parecer una piedra.
      geometry: loftedBody(sections, lod === 0 ? 14 : 8, 1.05),
      // El barrido corre sobre Z y la bolsa es larga en X.
      rotation: [0, Math.PI / 2, 0],
      tile: 3,
    },
  ];

  if (lod === 0) {
    // Pliegues de la costura: aros HUNDIDOS en la panza. A ras de superficie
    // sobresalían por las esquinas de la sección y la bolsa parecía tener
    // aletas; un pliegue de tela va hacia adentro, no hacia afuera.
    for (let index = 0; index < 3; index += 1) {
      // El radio se toma de la media ALTURA, no de la media profundidad: un
      // cilindro reparte su radio entre Y y Z por igual, y usando la
      // profundidad el aro medía en Y exactamente lo mismo que la bolsa y
      // asomaba justo por arriba, como tres aletas.
      parts.push({
        geometry: new CylinderGeometry(rise * 0.82, rise * 0.82, 0.012, 12, 1),
        position: [(index - 1) * width * 0.2 + (random() - 0.5) * 0.015, 0, 0],
        rotation: [0, 0, Math.PI / 2],
        scale: [1, 1, belly / rise],
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
