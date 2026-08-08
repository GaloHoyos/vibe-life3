import { CylinderGeometry } from "three";

import { chamferBox, chamferWedge, panel } from "../shared/gltf/geometry.js";
import { variantRandom, type PropBuilder } from "./builderKit.js";
import type { AtlasTile, GeometryPart } from "./types.js";

/**
 * Electrónica, laboratorio y Combine. Es la familia con dos cosas que ninguna
 * otra tiene: piezas que **emiten** y vidrio de pantalla.
 *
 * Los emisores van a su propio material, no pintados en el atlas: una casilla
 * opaca da una mancha clara, y lo que se busca es que la pieza se lea encendida
 * en un cuarto a oscuras. Nada de esto agrega luces a la escena — sumar o
 * esconder una luz recompila todos los materiales y cuesta segundos de freeze.
 *
 * Tiles: 0 chapa gris de gabinete, 1 acero Combine oscuro, 2 plástico beige,
 * 3 goma y detalle negro.
 */

/** Rejilla de ventilación: filas de ranuras finas sobre una cara. */
function vents(
  count: number,
  width: number,
  y: number,
  z: number,
  spacing: number,
  tile: AtlasTile,
): GeometryPart[] {
  const parts: GeometryPart[] = [];
  for (let index = 0; index < count; index += 1) {
    parts.push({
      geometry: chamferBox(width, 0.008, 0.012, 0.002),
      position: [0, y - index * spacing, z],
      tile,
    });
  }
  return parts;
}

/** Testigos en fila: los puntitos que dicen que el aparato está vivo. */
function indicators(
  count: number,
  x: number,
  y: number,
  z: number,
  spacing: number,
): GeometryPart[] {
  const parts: GeometryPart[] = [];
  for (let index = 0; index < count; index += 1) {
    parts.push({
      geometry: new CylinderGeometry(0.006, 0.006, 0.006, 6, 1),
      position: [x + index * spacing, y, z],
      rotation: [Math.PI / 2, 0, 0],
      tile: 0,
    });
  }
  return parts;
}

/** Monitor CRT de laboratorio: gabinete, bisel y pantalla encendida. */
const monitor: PropBuilder = (variant, lod) => {
  const random = variantRandom("monitor", variant);
  const width = 0.42;
  const height = 0.38;
  const depth = 0.44;
  const parts: GeometryPart[] = [
    // Gabinete que se afina hacia atrás, como todo tubo.
    {
      geometry: chamferWedge({
        length: depth * 0.82,
        height: height * 0.82,
        frontWidth: width,
        rearWidth: width * 0.6,
        topFrontWidth: width * 0.96,
        topRearWidth: width * 0.56,
        chamfer: 0.012,
      }),
      position: [0, height * 0.05, -depth * 0.06],
      rotation: [0, Math.PI, 0],
      tile: 2,
    },
    // Pie inclinable.
    {
      geometry: chamferBox(width * 0.62, 0.05, depth * 0.6, 0.01),
      position: [0, -height / 2 + 0.025, 0],
      tile: 2,
    },
  ];
  // El bisel define el frente y va en ambos LODs.
  parts.push({
    geometry: chamferBox(width, height * 0.78, 0.03, 0.008),
    position: [0, height * 0.05, depth / 2 - 0.015],
    tile: 2,
  });
  const emissive: GeometryPart[] = [
    {
      geometry: chamferBox(width * 0.82, height * 0.6, 0.012, 0.006),
      position: [0, height * 0.05, depth / 2 - 0.004],
      tile: 0,
    },
  ];
  if (lod === 0) {
    parts.push(...indicators(2, -width * 0.36, -height * 0.32, depth / 2 - 0.002, 0.028));
    parts.push({
      geometry: new CylinderGeometry(0.012, 0.012, 0.016, 8, 1),
      position: [width * (0.3 + random() * 0.06), -height * 0.32, depth / 2 - 0.006],
      rotation: [Math.PI / 2, 0, 0],
      tile: 3,
    });
  }
  return { parts, emissive };
};

/** Rack de servidores: el prop alto del pack, lleno de testigos. */
const serverRack: PropBuilder = (variant, lod) => {
  const random = variantRandom("serverRack", variant);
  const width = 0.6;
  const height = 1.85;
  const depth = 0.8;
  const parts: GeometryPart[] = [
    { geometry: chamferBox(width, height, depth, 0.014), position: [0, 0, 0], tile: 0 },
  ];
  const emissive: GeometryPart[] = [];
  // La grilla de bahías es FIJA y el LOD1 saltea de a una. Derivar el tamaño de
  // la cantidad hacía que el LOD1, con menos bahías, las dibujara más grandes y
  // se saliera del volumen del LOD0.
  const bays = 5;
  const bayHeight = (height * 0.62) / bays;
  const pitch = (height * 0.85) / bays;
  for (let index = 0; index < bays; index += 1) {
    if (lod === 1 && index % 2 === 1) continue;
    const y = height / 2 - 0.16 - index * pitch;
    parts.push({
      geometry: panel(width * 0.9, bayHeight, 0.018),
      position: [0, y, depth / 2 - 0.009],
      tile: 1,
    });
    if (lod === 0) {
      parts.push(...vents(1, width * 0.5, y + 0.02, depth / 2 + 0.005, 0.022, 3));
      // Una tira de testigos por bahía: es lo que lo lee como equipo vivo.
      emissive.push({
        geometry: chamferBox(0.05, 0.008, 0.008, 0.002),
        position: [width * 0.32, y - 0.02, depth / 2 + 0.006],
        tile: 0,
      });
    }
  }
  if (lod === 0 && random() > 0.5) {
    parts.push({
      geometry: chamferBox(width * 0.86, 0.04, 0.03, 0.006),
      position: [0, -height / 2 + 0.1, depth / 2 + 0.01],
      tile: 3,
    });
  }
  return { parts, emissive };
};

/** Disco rígido suelto: chico, pesado para su tamaño y muy tirable. */
const harddrive: PropBuilder = (variant, lod) => {
  const random = variantRandom("harddrive", variant);
  const width = 0.15;
  const height = 0.032;
  const depth = 0.106;
  const parts: GeometryPart[] = [
    { geometry: chamferBox(width, height, depth, 0.004), tile: 0 },
  ];
  if (lod === 0) {
    // Tapa atornillada arriba y placa verde abajo: las dos caras del disco.
    parts.push({
      geometry: chamferBox(width * 0.88, 0.004, depth * 0.86, 0.002),
      position: [0, height / 2 - 0.001, 0],
      tile: 1,
    });
    parts.push({
      geometry: chamferBox(width * 0.8, 0.004, depth * 0.78, 0.002),
      position: [(random() - 0.5) * 0.006, -height / 2 + 0.002, 0],
      tile: 3,
    });
  }
  return { parts };
};

/** Caja de energía de pared: tapa con bisagra y bornera. */
const powerBox: PropBuilder = (variant, lod) => {
  const random = variantRandom("powerBox", variant);
  const width = 0.34;
  const height = 0.46;
  const depth = 0.17;
  const parts: GeometryPart[] = [
    { geometry: chamferBox(width, height, depth * 0.82, 0.01), position: [0, 0, -depth * 0.09], tile: 0 },
    // Tapa entornada SIEMPRE al mismo ángulo: variarla movería el envolvente.
    {
      geometry: panel(width * 0.94, height * 0.94, 0.016),
      position: [width * 0.06, 0, depth * 0.3],
      rotation: [0, 0.34, 0],
      tile: 0,
    },
  ];
  const emissive: GeometryPart[] = [
    {
      geometry: new CylinderGeometry(0.011, 0.011, 0.008, 8, 1),
      position: [-width * 0.3, height * 0.34, depth * 0.3],
      rotation: [Math.PI / 2, 0, 0],
      tile: 0,
    },
  ];
  if (lod === 0) {
    // Bornera y cables: lo que hay adentro cuando la tapa está abierta.
    for (let index = 0; index < 4; index += 1) {
      parts.push({
        geometry: chamferBox(0.02, 0.05, 0.02, 0.004),
        position: [(index - 1.5) * 0.06, height * (0.1 + random() * 0.05), 0],
        tile: 3,
      });
    }
    parts.push({
      geometry: new CylinderGeometry(0.012, 0.012, 0.12, 6, 1),
      position: [0, -height * 0.36, 0],
      rotation: [0, 0, Math.PI / 2],
      tile: 3,
    });
  }
  return { parts, emissive };
};

/** Teclado numérico Combine: el que abre puertas. */
const keypad: PropBuilder = (variant, lod) => {
  const random = variantRandom("keypad", variant);
  const width = 0.19;
  const height = 0.26;
  const depth = 0.075;
  const parts: GeometryPart[] = [
    {
      geometry: chamferWedge({
        length: depth,
        height,
        frontWidth: width,
        rearWidth: width,
        topFrontWidth: width * 0.9,
        topRearWidth: width * 0.9,
        chamfer: 0.008,
      }),
      rotation: [0, Math.PI / 2, 0],
      tile: 1,
    },
  ];
  const emissive: GeometryPart[] = [
    {
      geometry: chamferBox(width * 0.66, 0.05, 0.006, 0.003),
      position: [0, height * 0.28, depth / 2 - 0.002],
      tile: 0,
    },
  ];
  if (lod === 0) {
    // Tres filas y no nueve botones sueltos: cada `chamferBox` es un casco
    // convexo entero, y a distancia de juego una fila se lee igual que sus
    // teclas por 1/3 del costo.
    for (let row = 0; row < 3; row += 1) {
      parts.push({
        geometry: chamferBox(0.128, 0.026, 0.008, 0.002),
        position: [0, height * 0.04 - row * 0.05, depth / 2 - 0.001],
        tile: random() > 0.7 ? 0 : 3,
      });
    }
  }
  return { parts, emissive };
};

/** Radio de resistencia: la que transmite el mensaje. */
const radio: PropBuilder = (variant, lod) => {
  const random = variantRandom("radio", variant);
  const width = 0.3;
  const height = 0.22;
  const depth = 0.19;
  const parts: GeometryPart[] = [
    { geometry: chamferBox(width, height * 0.86, depth, 0.012), position: [0, -height * 0.07, 0], tile: 2 },
    // La antena fija el alto declarado: va en los dos LODs.
    {
      geometry: new CylinderGeometry(0.005, 0.007, height * 0.6, 6, 1),
      position: [width * 0.36, height * 0.35, -depth * 0.3],
      rotation: [0, 0, -0.18],
      tile: 3,
    },
  ];
  const emissive: GeometryPart[] = [
    {
      geometry: chamferBox(width * 0.3, 0.03, 0.006, 0.002),
      position: [-width * 0.24, height * 0.02, depth / 2 - 0.002],
      tile: 0,
    },
  ];
  if (lod === 0) {
    // Parlante calado y dos perillas.
    parts.push(...vents(4, width * 0.34, height * 0.2, depth / 2 + 0.002, 0.022, 3));
    for (let index = 0; index < 2; index += 1) {
      parts.push({
        geometry: new CylinderGeometry(0.018, 0.018, 0.016, 8, 1),
        position: [width * (0.2 + index * 0.16), -height * (0.22 + random() * 0.04), depth / 2 - 0.004],
        rotation: [Math.PI / 2, 0, 0],
        tile: 3,
      });
    }
    parts.push({
      geometry: chamferBox(width * 0.6, 0.016, 0.016, 0.004),
      position: [0, height * 0.42, 0],
      tile: 3,
    });
  }
  return { parts, emissive };
};

/** Expendedora: alta, pesada y con la vidriera iluminada. */
const vendingMachine: PropBuilder = (variant, lod) => {
  const random = variantRandom("vendingMachine", variant);
  const width = 0.82;
  const height = 1.88;
  const depth = 0.78;
  const parts: GeometryPart[] = [
    { geometry: chamferBox(width, height - 0.08, depth, 0.016), position: [0, 0.04, 0], tile: 0 },
    {
      geometry: chamferBox(width * 0.9, 0.08, depth * 0.9, 0.008),
      position: [0, -height / 2 + 0.04, 0],
      tile: 3,
    },
    // Marco de la vidriera.
    {
      geometry: chamferBox(width * 0.62, height * 0.62, 0.02, 0.008),
      position: [-width * 0.13, height * 0.12, depth / 2 - 0.01],
      tile: 1,
    },
  ];
  const glass: GeometryPart[] = [
    {
      geometry: chamferBox(width * 0.56, height * 0.56, 0.01, 0.004),
      position: [-width * 0.13, height * 0.12, depth / 2 - 0.002],
      tile: 3,
    },
  ];
  const emissive: GeometryPart[] = [
    // El cartel de arriba: es lo que la hace visible al fondo de un pasillo.
    {
      geometry: chamferBox(width * 0.78, height * 0.1, 0.012, 0.004),
      position: [0, height * 0.38, depth / 2 - 0.004],
      tile: 0,
    },
  ];
  if (lod === 0) {
    // Estantes detrás del vidrio y la botonera lateral.
    for (let index = 0; index < 2; index += 1) {
      parts.push({
        geometry: chamferBox(width * 0.54, 0.014, depth * 0.3, 0.004),
        position: [-width * 0.13, height * (0.26 - index * 0.2), depth * 0.24],
        tile: 3,
      });
    }
    // Botonera como una tira, no botón por botón: mismo motivo que el teclado.
    parts.push({
      geometry: chamferBox(0.036, height * 0.24, 0.01, 0.003),
      position: [width * 0.32, height * (0.12 + random() * 0.04), depth / 2 - 0.004],
      tile: 3,
    });
    // Boca de entrega.
    parts.push({
      geometry: chamferBox(width * 0.5, 0.11, 0.03, 0.006),
      position: [-width * 0.13, -height * 0.32, depth / 2 - 0.012],
      tile: 3,
    });
  }
  return { parts, glass, emissive };
};

/** Dispenser de agua: bidón invertido sobre su pedestal. */
const waterCooler: PropBuilder = (variant, lod) => {
  const random = variantRandom("waterCooler", variant);
  const width = 0.34;
  const height = 1.12;
  const depth = 0.34;
  const segments = lod === 0 ? 14 : 7;
  const bottleHeight = 0.42;
  const parts: GeometryPart[] = [
    { geometry: chamferBox(width, height - bottleHeight, depth, 0.012), position: [0, -bottleHeight / 2, 0], tile: 2 },
  ];
  const glass: GeometryPart[] = [
    // El bidón: define el tope, así que va en los dos LODs.
    {
      geometry: new CylinderGeometry(width * 0.42, width * 0.34, bottleHeight * 0.8, segments, 1),
      position: [0, height / 2 - bottleHeight * 0.42, 0],
      tile: 3,
    },
    {
      geometry: new CylinderGeometry(width * 0.16, width * 0.4, bottleHeight * 0.24, segments, 1),
      position: [0, height / 2 - bottleHeight * 0.9, 0],
      tile: 3,
    },
  ];
  if (lod === 0) {
    // Dos canillas, una fría y una caliente.
    for (const sx of [-1, 1]) {
      parts.push({
        geometry: chamferBox(0.024, 0.05, 0.05, 0.006),
        position: [sx * width * 0.18, -bottleHeight * 0.1, depth / 2 - 0.012],
        tile: sx > 0 ? 3 : 1,
      });
    }
    parts.push({
      geometry: chamferBox(width * 0.6, 0.012, depth * 0.3, 0.004),
      position: [0, -height / 2 + 0.16 + (random() - 0.5) * 0.02, depth / 2 - 0.06],
      tile: 3,
    });
  }
  return { parts, glass };
};

/** Frasco de laboratorio con líquido que brilla. */
const labJar: PropBuilder = (variant, lod) => {
  const random = variantRandom("labJar", variant);
  const height = 0.26;
  const radius = 0.075;
  const segments = lod === 0 ? 14 : 7;
  const parts: GeometryPart[] = [
    // Tapa y aro de la base: los que marcan el borde.
    {
      geometry: new CylinderGeometry(radius * 0.9, radius * 0.9, 0.032, segments, 1),
      position: [0, height / 2 - 0.016, 0],
      tile: 1,
    },
    {
      geometry: new CylinderGeometry(radius, radius, 0.02, segments, 1),
      position: [0, -height / 2 + 0.01, 0],
      tile: 1,
    },
  ];
  const glass: GeometryPart[] = [
    {
      geometry: new CylinderGeometry(radius * 0.94, radius * 0.94, height - 0.06, segments, 1),
      position: [0, 0, 0],
      tile: 3,
    },
  ];
  const emissive: GeometryPart[] = [
    // El líquido, a media altura variable: es el detalle que lo hace un frasco
    // de laboratorio y no un vaso.
    {
      geometry: new CylinderGeometry(radius * 0.82, radius * 0.82, height * (0.4 + random() * 0.16), segments, 1),
      position: [0, -height * 0.14, 0],
      tile: 0,
    },
  ];
  return { parts, glass, emissive };
};

/** Bandeja de repuestos: caja abierta con separadores. */
const partsBin: PropBuilder = (variant, lod) => {
  const random = variantRandom("partsBin", variant);
  const width = 0.42;
  const height = 0.18;
  const depth = 0.3;
  const wall = 0.014;
  const parts: GeometryPart[] = [
    { geometry: chamferBox(width, wall, depth, 0.004), position: [0, -height / 2 + wall / 2, 0], tile: 1 },
  ];
  for (const sx of [-1, 1]) {
    parts.push({
      geometry: chamferBox(wall, height, depth, 0.004),
      position: [(sx * (width - wall)) / 2, 0, 0],
      tile: 1,
    });
  }
  for (const sz of [-1, 1]) {
    parts.push({
      geometry: chamferBox(width - wall * 2, height, wall, 0.004),
      position: [0, 0, (sz * (depth - wall)) / 2],
      tile: 1,
    });
  }
  if (lod === 0) {
    parts.push({
      geometry: chamferBox(wall * 0.7, height * 0.8, depth - wall * 2, 0.003),
      position: [(random() - 0.5) * width * 0.3, -height * 0.1, 0],
      tile: 1,
    });
    // Un puñado de piezas sueltas adentro, encerradas por las paredes.
    for (let index = 0; index < 4; index += 1) {
      parts.push({
        geometry: chamferBox(0.05, 0.02, 0.035, 0.004),
        position: [
          (random() - 0.5) * width * 0.5,
          -height * 0.28,
          (random() - 0.5) * depth * 0.4,
        ],
        rotation: [0, random() * 3, 0],
        tile: 3,
      });
    }
  }
  return { parts };
};

/** Cajón Combine: chapa acanalada y sellos que brillan. */
const combineCrate: PropBuilder = (variant, lod) => {
  const random = variantRandom("combineCrate", variant);
  const side = 0.74;
  const half = side / 2;
  const parts: GeometryPart[] = [
    { geometry: chamferBox(side, side * 0.92, side, 0.018), tile: 1 },
  ];
  const emissive: GeometryPart[] = [];
  // Las cintas que cruzan cada cara: la firma Combine.
  for (const sz of [-1, 1]) {
    parts.push({
      geometry: chamferBox(side * 0.98, 0.05, 0.016, 0.005),
      position: [0, side * 0.16, sz * (half + 0.006)],
      tile: 0,
    });
    emissive.push({
      geometry: chamferBox(0.07, 0.024, 0.008, 0.003),
      position: [side * 0.28, side * 0.16, sz * (half + 0.014)],
      tile: 0,
    });
  }
  if (lod === 0) {
    for (const sx of [-1, 1]) {
      parts.push({
        geometry: chamferBox(0.016, side * 0.6, side * 0.9, 0.005),
        position: [sx * (half + 0.006), -side * 0.08, 0],
        tile: 0,
      });
    }
    parts.push({
      geometry: chamferBox(side * 0.5, 0.03, side * 0.5, 0.006),
      position: [(random() - 0.5) * 0.04, side * 0.46, 0],
      tile: 0,
    });
  }
  return { parts, emissive };
};

/** Barricada Combine: el parapeto desplegable que ponen en las calles. */
const combineBarrier: PropBuilder = (variant, lod) => {
  const random = variantRandom("combineBarrier", variant);
  const width = 1.25;
  const height = 1.1;
  const depth = 0.42;
  const parts: GeometryPart[] = [
    // Paño principal, echado hacia atrás.
    {
      geometry: chamferBox(width, height * 0.78, 0.06, 0.012),
      position: [0, height * 0.08, 0],
      rotation: [0.22, 0, 0],
      tile: 1,
    },
  ];
  // Las patas fijan el fondo declarado: en ambos LODs.
  for (const sx of [-1, 1]) {
    parts.push({
      geometry: chamferBox(0.07, height * 0.62, 0.07, 0.008),
      position: [sx * (width / 2 - 0.1), -height * 0.18, -depth * 0.3],
      rotation: [-0.45, 0, 0],
      tile: 1,
    });
    parts.push({
      geometry: chamferBox(0.06, 0.05, depth * 0.5, 0.008),
      position: [sx * (width / 2 - 0.1), -height / 2 + 0.025, -depth * 0.18],
      tile: 0,
    });
  }
  const emissive: GeometryPart[] = [
    {
      geometry: chamferBox(width * 0.9, 0.022, 0.01, 0.004),
      position: [0, height * 0.34, 0.03],
      rotation: [0.22, 0, 0],
      tile: 0,
    },
  ];
  if (lod === 0) {
    for (let index = 0; index < 3; index += 1) {
      parts.push({
        geometry: chamferBox(width * 0.96, 0.02, 0.02, 0.004),
        position: [0, height * (0.28 - index * 0.17), 0.036 - index * 0.036],
        rotation: [0.22, 0, 0],
        tile: random() > 0.6 ? 0 : 3,
      });
    }
  }
  return { parts, emissive };
};

/** Emisor Combine: la baliza que marca territorio ocupado. */
const combineEmitter: PropBuilder = (variant, lod) => {
  const random = variantRandom("combineEmitter", variant);
  const width = 0.36;
  const height = 0.92;
  const segments = lod === 0 ? 12 : 6;
  const parts: GeometryPart[] = [
    // Base tripartita.
    {
      geometry: new CylinderGeometry(width * 0.5, width * 0.42, 0.09, segments, 1),
      position: [0, -height / 2 + 0.045, 0],
      tile: 1,
    },
    // Mástil.
    {
      geometry: new CylinderGeometry(0.045, 0.06, height * 0.62, segments, 1),
      position: [0, -height * 0.06, 0],
      tile: 1,
    },
    // Cabezal: define el tope, en ambos LODs.
    {
      geometry: chamferWedge({
        length: width * 0.62,
        height: height * 0.2,
        frontWidth: width * 0.62,
        rearWidth: width * 0.62,
        topFrontWidth: width * 0.34,
        topRearWidth: width * 0.34,
        chamfer: 0.012,
      }),
      position: [0, height / 2 - height * 0.1, 0],
      tile: 1,
    },
  ];
  const emissive: GeometryPart[] = [
    {
      geometry: new CylinderGeometry(width * 0.2, width * 0.2, 0.05, segments, 1),
      position: [0, height / 2 - height * 0.06, 0],
      tile: 0,
    },
  ];
  if (lod === 0) {
    // Aletas radiales del mástil.
    for (let index = 0; index < 3; index += 1) {
      const angle = (index / 3) * Math.PI * 2 + random() * 0.3;
      parts.push({
        geometry: chamferBox(0.02, height * 0.3, 0.07, 0.005),
        position: [Math.cos(angle) * 0.06, -height * 0.12, Math.sin(angle) * 0.06],
        rotation: [0, -angle, 0],
        tile: 1,
      });
    }
    emissive.push({
      geometry: chamferBox(0.05, 0.012, 0.012, 0.003),
      position: [0, -height * 0.32, width * 0.16],
      tile: 0,
    });
  }
  return { parts, emissive };
};

/** Lámpara Combine de pared: la jaula con el tubo adentro. */
const combineLamp: PropBuilder = (variant, lod) => {
  const random = variantRandom("combineLamp", variant);
  const width = 0.42;
  const height = 0.24;
  const depth = 0.26;
  const parts: GeometryPart[] = [
    // Carcasa que se abre hacia adelante.
    {
      geometry: chamferWedge({
        length: depth,
        height,
        frontWidth: width,
        rearWidth: width * 0.66,
        topFrontWidth: width * 0.9,
        topRearWidth: width * 0.6,
        chamfer: 0.01,
      }),
      tile: 1,
    },
  ];
  const emissive: GeometryPart[] = [
    {
      geometry: chamferBox(width * 0.72, height * 0.5, 0.014, 0.005),
      position: [0, 0, depth / 2 - 0.012],
      tile: 0,
    },
  ];
  if (lod === 0) {
    // Reja protectora: tres barrotes cruzados sobre el vidrio.
    for (let index = 0; index < 3; index += 1) {
      parts.push({
        geometry: chamferBox(0.014, height * 0.86, 0.014, 0.003),
        position: [(index - 1) * width * 0.24, 0, depth / 2 - 0.004],
        tile: 3,
      });
    }
    parts.push({
      geometry: chamferBox(width * 0.5, 0.05, 0.05, 0.008),
      position: [0, height * (0.3 + random() * 0.06), -depth * 0.42],
      tile: 1,
    });
  }
  return { parts, emissive };
};

export const TECH_BUILDERS = {
  monitor,
  serverRack,
  harddrive,
  powerBox,
  keypad,
  radio,
  vendingMachine,
  waterCooler,
  labJar,
  partsBin,
  combineCrate,
  combineBarrier,
  combineEmitter,
  combineLamp,
} as const;
