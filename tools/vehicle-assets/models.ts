import {
  Accessor,
  Document,
  type Buffer as GltfBuffer,
  type Material,
  type Mesh,
  type Node,
} from "@gltf-transform/core";
import { EXTTextureWebP } from "@gltf-transform/extensions";
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Euler as ThreeEuler,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import {
  bakeVertexOcclusion,
  chamferBox,
  chamferWedge,
  loftedBody,
  panel,
  rivetRow,
  roundedBox,
  wheel as buildWheel,
} from "./geometry.js";
import type { LoftSection } from "./geometry.js";
import type {
  AtlasTile,
  Euler,
  GeneratedTextureSet,
  GeneratedVehicleStats,
  LodStats,
  Vec3,
  VehicleAssetSpec,
} from "./types.js";

interface GeometryPart {
  readonly geometry: BufferGeometry;
  readonly position?: Vec3;
  readonly rotation?: Euler;
  readonly scale?: Vec3;
  readonly tile: AtlasTile;
}

interface BuildContext {
  readonly document: Document;
  readonly buffer: GltfBuffer;
  readonly material: Material;
  readonly sceneRoot: Node;
  readonly nodeNames: string[];
  readonly spec: VehicleAssetSpec;
}

/**
 * Rueda del buggy, derivada del preset físico (`vehicles.config.ts`: body.size
 * [2.15, 1.35, 3.8], colliderCenter.y 0.75) y de cómo arma las ruedas
 * `VehicleEntity.createMotor`. La malla tiene que coincidir con el raycast o el
 * chasis se ve flotando sobre el piso.
 */
const BUGGY_WHEEL = {
  radius: 0.46,
  halfWidth: 2.15 * 0.46,
  halfLength: 3.8 * 0.36,
  /** Conexión (0.75 − 0.24) menos la suspensión totalmente extendida (0.36). */
  restY: 0.75 - 0.24 - 0.36,
} as const;

/**
 * Puesto de manejo. Con `physicalForward` +Z y up +Y la derecha del vehículo es
 * −X, así que el volante, los relojes y la butaca del conductor van en +X.
 */
const BUGGY_DRIVER_X = 0.38;

/**
 * Pedestal del cañón: sobre el larguero del artillero, delante de su butaca y
 * por fuera del capó.
 *
 * La altura no es estética. Con la boca a 1.32 m del pivote y la depresión
 * máxima del preset (−0.45 rad), la punta baja 0.57 m: por debajo de 1.76 el
 * caño se entierra en el capó cada vez que se apunta hacia abajo y adelante,
 * que es exactamente lo que hacía el montaje anterior.
 */
const BUGGY_GUN_X = -0.72;
const BUGGY_GUN_Z = 0.6;
const BUGGY_GUN_Y = 1.78;
const BUGGY_GUN_REACH = 1.32;

/**
 * Piso al que apoya la chatarra. Al pasar a wreckage el vehículo deja de rodar
 * sobre el raycast y se acuesta sobre el collider del preset (centro 0.75, alto
 * 1.35), así que el suelo salta del eje de ruedas a y = 0.075. Modelar los
 * restos alrededor del cero del vehículo, como estaban antes, los dejaba
 * enterrados hasta la mitad.
 */
const BUGGY_WRECK_GROUND = 0.075;

/**
 * Pose de lo que sigue soldado al bastidor. Va inclinada hacia el lado del
 * artillero, que es de donde se arrancó la rueda delantera.
 */
const BUGGY_WRECK_POSITION: Vec3 = [0, 0.06, 0];
const BUGGY_WRECK_ROTATION: Euler = [-0.04, 0.06, 0.07];

/**
 * Casco del hidrodeslizador, atado al preset físico (`vehicles.config.ts`:
 * body.size [2.35, 1.45, 4.4], colliderCenter.y 0.55). El fondo de planeo va
 * al piso del collider y la cubierta a media altura; si la cubierta sube más,
 * el piloto sentado sobresale de la caja de colisión.
 */
const AIRBOAT_HULL = {
  bottomY: 0.28,
  deckY: 0.96,
  halfWidth: 1.07,
  sternZ: -2.14,
} as const;

/**
 * Ventilador de popa. El radio deja la punta de pala apenas por encima de la
 * cubierta: bajar el eje obliga a recortar la jaula contra el espejo de popa,
 * y es justo la jaula entera lo que da la silueta del hidrodeslizador.
 */
const AIRBOAT_FAN = {
  y: 1.92,
  z: -1.74,
  radius: 0.92,
  cageRadius: 1.0,
} as const;

/**
 * Pintle del cañón sobre el castillo de proa. La altura sale de la depresión
 * máxima del preset (−0.35 rad): con 1.24 m de caño la punta baja 0.43 m, así
 * que por debajo de 1.3 el arma termina apuntando a la propia roda.
 */
const AIRBOAT_GUN_Y = 1.52;
const AIRBOAT_GUN_Z = 1.72;
const AIRBOAT_GUN_REACH = 1.16;

/**
 * Alzada del castillo de proa, en radianes. Levanta la roda para que el casco
 * monte el hielo en vez de clavarse, y de paso deja la boca del cañón por
 * encima de la cubierta en depresión máxima.
 */
const AIRBOAT_BOW_RAKE = -0.15;

/** Puesto del piloto: centrado, entre el cañón de proa y la bancada del motor. */
const AIRBOAT_DRIVER_Z = -0.52;

/**
 * Piso al que apoya la chatarra. Mientras el motor hover lo sostiene, el casco
 * vuela por encima de su collider; al pasar a wreckage el cuerpo cae a dinámico
 * y se acuesta sobre la caja del preset (centro 0.55, alto 1.45), así que el
 * suelo queda 0.45 por debajo del fondo de planeo intacto.
 */
const AIRBOAT_WRECK_GROUND = -0.175;

/**
 * Pose del casco varado: escorado a estribor y con la popa clavada. Las piezas
 * que siguen unidas al casco se escriben en las cotas del modelo intacto y esta
 * transformación las baja hasta el piso.
 */
const AIRBOAT_WRECK_POSITION: Vec3 = [0, -0.19, 0];
const AIRBOAT_WRECK_ROTATION: Euler = [-0.05, 0.05, 0.1];

/**
 * Fuselaje del helicóptero. Las cotas salen del preset físico
 * (`vehicles.config.ts`: body.size [3.4, 2.8, 9.2], colliderCenter [0, 1.25,
 * 0.1]) y de las anclas de tripulación, que ya estaban calibradas para este
 * habitáculo: el piso queda 0.16 m por debajo del almohadón de las butacas.
 */
const HELI_CABIN = {
  halfWidth: 1.08,
  floorY: 0.72,
  roofY: 2.3,
  /** Cara interna del forro de bodega, por dentro de la piel. */
  liningX: 0.99,
  /** Largo útil de bodega, entre el mamparo de popa y el del puesto. */
  lining: [-1.94, 1.18],
  /** Vano de la puerta corrediza de babor, en Z. */
  doorway: [-0.15, 0.85],
  portholeY: 1.72,
  portholeRadius: 0.2,
} as const;

const HELI_PORTHOLES: readonly (readonly [number, number])[] = [
  [-1, -0.45],
  [-1, -1.15],
  [1, 0.95],
  [1, 0.25],
  [1, -0.45],
  [1, -1.15],
] as const;

/**
 * Parabrisas: cristal muy tumbado, con la base adelante y el canto superior
 * contra el techo. El ojo del piloto (`camera_pilot`, y 1.72) cae dentro de
 * este tramo, así que el cristal tiene que ser transparente de verdad.
 */
const HELI_WINDSHIELD = {
  rake: -0.66,
  y: 1.74,
  z: 2.6,
  height: 0.98,
} as const;

const HELI_ROTOR = { y: 2.98, z: -0.12 } as const;

/** Rotor de cola: de canto sobre la deriva, a dos tercios de su altura. */
const HELI_TAIL_ROTOR = { x: 0.3, y: 2.33, z: -5.92 } as const;

/**
 * Tren de rodaje del transporte oruga. Conserva las cuatro muestras de
 * suspensión del motor raycast, pero las ruedas quedan dentro de una banda
 * continua: visualmente es un snowcat, aunque esta primera entrega todavía
 * dobla como un vehículo terrestre convencional.
 */
const REBEL_CRAWLER_WHEEL = {
  radius: 0.46,
  halfWidth: 2.7 * 0.46,
  halfLength: 4.9 * 0.36,
  restY: 1 - 0.24 - 0.42,
} as const;

const REBEL_CRAWLER_DRIVER_X = 0.48;

/**
 * Piso al que apoya la chatarra: fondo del collider del preset (centro 1, alto
 * 2.05). Queda 0.1 por encima de donde corre la banda con el vehículo entero,
 * así que la oruga que sobrevive termina apenas hundida en el terreno.
 */
const CRAWLER_WRECK_GROUND = -0.025;

/**
 * Pose del casco. Escora hacia estribor porque es el lado que perdió la banda:
 * ahí el tren apoya sobre los rodillos pelados, un palmo más abajo.
 */
const CRAWLER_WRECK_POSITION: Vec3 = [0, 0.05, 0];
const CRAWLER_WRECK_ROTATION: Euler = [0.03, 0.05, 0.06];

const COMBINE_GLIDER = {
  halfWidth: 1.02,
  noseZ: 1.72,
  sternZ: -1.7,
  deckY: 0.72,
  coreY: 0.84,
  coreZ: -0.9,
} as const;

/**
 * Nadador Combine: la misma máquina que el deslizador resuelta como criatura
 * reconvertida. Comparte preset, así que comparte casco (`vehicles.config.ts`:
 * body.size [2.2, 1.25, 3.5], colliderCenter.y 0.55) y las mismas anclas de
 * asiento, cámara y salidas. El disco pectoral ocupa el ancho del collider y la
 * cola sale por detrás, donde el deslizador tiene el núcleo antigravedad.
 */
const COMBINE_SWIMMER = {
  halfWidth: 1.08,
  noseZ: 1.6,
  tailZ: -1.9,
  bellyY: 0.32,
  backY: 0.88,
  /** Injerto de propulsión, grapado en la base de la cola. */
  graftY: 0.66,
  graftZ: -1.12,
} as const;

function createBladeGeometry(
  length: number,
  width: number,
  thickness: number,
): BufferGeometry {
  return new BoxGeometry(width, thickness, length);
}

function createTubePart(
  start: Vec3,
  end: Vec3,
  radius: number,
  segments: number,
  tile: AtlasTile,
): GeometryPart {
  const startVector = new Vector3(...start);
  const endVector = new Vector3(...end);
  const direction = endVector.clone().sub(startVector);
  const length = direction.length();
  const center = startVector.clone().add(endVector).multiplyScalar(0.5);
  const quaternion = new Quaternion().setFromUnitVectors(
    new Vector3(0, 1, 0),
    direction.normalize(),
  );
  const euler = new ThreeEuler().setFromQuaternion(quaternion);
  return {
    geometry: new CylinderGeometry(radius, radius, length, segments),
    position: [center.x, center.y, center.z],
    rotation: [euler.x, euler.y, euler.z],
    tile,
  };
}

/**
 * Guardabarros: arco de placas cortas siguiendo el radio de la rueda. Un arco
 * segmentado lee mucho mejor que una caja plana y cierra el paso de rueda, que
 * es donde el AO horneado deja la sombra de contacto.
 */
function fenderParts(
  center: Vec3,
  radius: number,
  width: number,
  segments: number,
  tile: AtlasTile,
  arc: readonly [number, number] = [0.15, Math.PI - 0.15],
): GeometryPart[] {
  const parts: GeometryPart[] = [];
  const [from, to] = arc;
  const span = (to - from) / segments;
  for (let index = 0; index < segments; index += 1) {
    const angle = from + span * (index + 0.5);
    const plateLength = radius * span * 1.16;
    parts.push({
      geometry: chamferBox(width, 0.05, plateLength, 0.014),
      position: [
        center[0],
        center[1] + Math.sin(angle) * radius,
        center[2] + Math.cos(angle) * radius,
      ],
      rotation: [-angle + Math.PI / 2, 0, 0],
      tile,
    });
  }
  return parts;
}

/** Costillas paralelas: cubiertas de carga, blindaje soldado, pisos chapa. */
function ribParts(
  origin: Vec3,
  direction: Vec3,
  count: number,
  spacing: number,
  size: Vec3,
  tile: AtlasTile,
): GeometryPart[] {
  const parts: GeometryPart[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = (index - (count - 1) / 2) * spacing;
    parts.push({
      geometry: chamferBox(size[0], size[1], size[2], 0.01),
      position: [
        origin[0] + direction[0] * offset,
        origin[1] + direction[1] * offset,
        origin[2] + direction[2] * offset,
      ],
      tile,
    });
  }
  return parts;
}

/**
 * Amortiguador con espiral a la vista: vástago, copas y anillos apilados sobre
 * el eje. Los anillos son lo que hace leer el resorte; un cilindro liso queda
 * como un caño, y la suspensión expuesta es media personalidad del buggy.
 */
function coilOverParts(
  top: Vec3,
  bottom: Vec3,
  options: {
    readonly radius: number;
    readonly coils: number;
    readonly segments: number;
    readonly springTile: AtlasTile;
    readonly bodyTile: AtlasTile;
  },
): GeometryPart[] {
  const start = new Vector3(...top);
  const end = new Vector3(...bottom);
  const axis = end.clone().sub(start).normalize();
  const quaternion = new Quaternion().setFromUnitVectors(
    new Vector3(0, 1, 0),
    axis,
  );
  const euler = new ThreeEuler().setFromQuaternion(quaternion);
  const alongAxis: Euler = [euler.x, euler.y, euler.z];
  // El toro nace en el plano XY: hay que acostarlo antes de alinearlo al eje.
  const ringEuler = new ThreeEuler().setFromQuaternion(
    quaternion
      .clone()
      .multiply(
        new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2),
      ),
  );
  const parts: GeometryPart[] = [
    createTubePart(
      top,
      bottom,
      options.radius * 0.36,
      options.segments,
      options.bodyTile,
    ),
  ];
  for (const t of [0.1, 0.9]) {
    const point = start.clone().lerp(end, t);
    parts.push({
      geometry: new CylinderGeometry(
        options.radius * 1.2,
        options.radius * 1.2,
        0.04,
        options.segments,
      ),
      position: [point.x, point.y, point.z],
      rotation: alongAxis,
      tile: options.bodyTile,
    });
  }
  for (let index = 0; index < options.coils; index += 1) {
    const t = 0.16 + (index / Math.max(1, options.coils - 1)) * 0.68;
    const point = start.clone().lerp(end, t);
    parts.push({
      geometry: new TorusGeometry(
        options.radius,
        options.radius * 0.26,
        5,
        Math.max(8, options.segments),
      ),
      position: [point.x, point.y, point.z],
      rotation: [ringEuler.x, ringEuler.y, ringEuler.z],
      tile: options.springTile,
    });
  }
  return parts;
}

/**
 * Aplica una transformación común a un subconjunto ya armado. Sirve para piezas
 * que se diseñan cómodas en su propio origen (el volante) y después se cuelgan
 * inclinadas en el habitáculo.
 */
function groupParts(
  parts: readonly GeometryPart[],
  options: { readonly position?: Vec3; readonly rotation?: Euler },
): GeometryPart[] {
  return parts.map((part) => {
    const geometry = part.geometry.clone();
    geometry.applyMatrix4(
      new Matrix4().compose(
        new Vector3(...(part.position ?? [0, 0, 0])),
        new Quaternion().setFromEuler(
          new ThreeEuler(...(part.rotation ?? [0, 0, 0])),
        ),
        new Vector3(...(part.scale ?? [1, 1, 1])),
      ),
    );
    return {
      geometry,
      position: options.position,
      rotation: options.rotation,
      tile: part.tile,
    };
  });
}

/** Nudo de la jaula antivuelco: cubre la unión entre tubos. */
function gusset(position: Vec3, size: number, tile: AtlasTile): GeometryPart {
  return {
    geometry: chamferBox(size, size, size, size * 0.28),
    position,
    tile,
  };
}

/** Volante: aro con cubo y radios. */
function steeringWheelParts(
  center: Vec3,
  radius: number,
  segments: number,
  tile: AtlasTile,
): GeometryPart[] {
  const parts: GeometryPart[] = [
    {
      geometry: new TorusGeometry(radius, radius * 0.14, 8, segments),
      position: center,
      tile,
    },
    {
      geometry: new CylinderGeometry(radius * 0.24, radius * 0.24, 0.07, 10),
      position: center,
      rotation: [Math.PI / 2, 0, 0],
      tile,
    },
  ];
  for (let index = 0; index < 3; index += 1) {
    const angle = (index / 3) * Math.PI * 2 + Math.PI / 2;
    parts.push({
      geometry: chamferBox(radius * 0.12, radius * 0.95, 0.035, 0.008),
      position: [
        center[0] + Math.cos(angle) * radius * 0.45,
        center[1] + Math.sin(angle) * radius * 0.45,
        center[2],
      ],
      rotation: [0, 0, angle - Math.PI / 2],
      tile,
    });
  }
  return parts;
}

/**
 * Repetición espejada dentro de [0,1]. La proyección plana de abajo se sale del
 * rango en cuanto una pieza pasa los 2 m del origen, y recortar ahí deja a toda
 * la pieza muestreando un solo téxel del borde: la roda de proa salía como una
 * plancha de color liso. Espejar mantiene idéntico lo que ya caía en rango y le
 * devuelve grano a los extremos sin invadir la casilla vecina del atlas.
 */
function mirrorUnit(value: number): number {
  const wrapped = ((value % 2) + 2) % 2;
  return wrapped > 1 ? 2 - wrapped : wrapped;
}

function remapUv(geometry: BufferGeometry, tile: AtlasTile): void {
  const uv = geometry.getAttribute("uv");
  if (uv === undefined) {
    const position = geometry.getAttribute("position");
    const generated = new Float32Array(position.count * 2);
    for (let index = 0; index < position.count; index += 1) {
      generated[index * 2] = mirrorUnit(position.getX(index) * 0.25 + 0.5);
      generated[index * 2 + 1] = mirrorUnit(position.getZ(index) * 0.25 + 0.5);
    }
    geometry.setAttribute("uv", new Float32BufferAttribute(generated, 2));
  }

  const targetUv = geometry.getAttribute("uv");
  const tileX = tile % 2;
  const tileY = tile >= 2 ? 1 : 0;
  for (let index = 0; index < targetUv.count; index += 1) {
    const sourceU = Math.max(0, Math.min(1, targetUv.getX(index)));
    const sourceV = Math.max(0, Math.min(1, targetUv.getY(index)));
    targetUv.setXY(
      index,
      Math.max(0, Math.min(1, tileX * 0.5 + sourceU * 0.5)),
      Math.max(0, Math.min(1, tileY * 0.5 + sourceV * 0.5)),
    );
  }
  targetUv.needsUpdate = true;
}

function prepareGeometry(part: GeometryPart): BufferGeometry {
  const geometry = part.geometry.clone();
  const position = new Vector3(...(part.position ?? [0, 0, 0]));
  const rotation = new Quaternion().setFromEuler(
    new ThreeEuler(...(part.rotation ?? [0, 0, 0])),
  );
  const scale = new Vector3(...(part.scale ?? [1, 1, 1]));
  geometry.applyMatrix4(new Matrix4().compose(position, rotation, scale));
  remapUv(geometry, part.tile);
  return geometry;
}

function mergeParts(
  parts: readonly GeometryPart[],
  options: {
    readonly bakeOcclusion?: boolean;
    readonly occlusionStrength?: number;
  } = {},
): BufferGeometry {
  const geometries = parts.map(prepareGeometry);
  const merged = mergeGeometries(geometries, false);
  for (const geometry of geometries) {
    geometry.dispose();
  }
  if (merged === null) {
    throw new Error("No se pudo combinar la geometría procedural del vehículo.");
  }
  if (options.bakeOcclusion !== false) {
    bakeVertexOcclusion(merged, { strength: options.occlusionStrength });
  }
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Vidrio de cabina. Va como material aparte porque el atlas de cuatro casillas
 * es opaco por definición: una ventana pintada sobre la chapa nunca deja ver el
 * interior. Alcanza con `BLEND` y alfa baja; `KHR_materials_transmission` sería
 * más correcto pero obliga a un render target extra por cuadro, que es mucho
 * pedir para una ventanilla.
 */
function createGlassMaterial(
  document: Document,
  spec: VehicleAssetSpec,
): Material {
  return document
    .createMaterial(`${spec.id}_glazing`)
    .setBaseColorFactor([0.24, 0.29, 0.34, 0.4])
    .setMetallicFactor(0.04)
    // Casi espejo (0.07) el cristal devolvía el entorno como una mancha blanca
    // que tapaba la cabina entera. Con algo de rugosidad el reflejo se abre y
    // se ve lo que hay detrás, que es todo el punto de ponerle vidrio.
    .setRoughnessFactor(0.17)
    .setAlphaMode("BLEND")
    // Desde la butaca se mira el cristal por su cara interna.
    .setDoubleSided(true);
}

function createCombineEnergyMaterial(
  document: Document,
  spec: VehicleAssetSpec,
): Material {
  return document
    .createMaterial(`${spec.id}_energy`)
    .setBaseColorFactor([0.2, 0.72, 0.9, 1])
    .setEmissiveFactor([0.12, 0.78, 1])
    .setMetallicFactor(0.16)
    .setRoughnessFactor(0.24);
}

function createMesh(
  context: BuildContext,
  name: string,
  geometry: BufferGeometry,
  material: Material = context.material,
): Mesh {
  geometry.computeTangents();
  const document = context.document;
  const positionAttribute = geometry.getAttribute("position");
  const normalAttribute = geometry.getAttribute("normal");
  const uvAttribute = geometry.getAttribute("uv");
  const tangentAttribute = geometry.getAttribute("tangent");
  const indexAttribute = geometry.getIndex();
  if (
    positionAttribute === undefined ||
    normalAttribute === undefined ||
    uvAttribute === undefined ||
    tangentAttribute === undefined ||
    indexAttribute === null
  ) {
    throw new Error(`La geometría ${name} no está completa.`);
  }

  const colorAttribute = geometry.getAttribute("color");
  const positions = new Float32Array(positionAttribute.count * 3);
  const normals = new Float32Array(normalAttribute.count * 3);
  const uvs = new Float32Array(uvAttribute.count * 2);
  const tangents = new Float32Array(tangentAttribute.count * 4);
  const colors =
    colorAttribute === undefined
      ? null
      : new Float32Array(colorAttribute.count * 4);
  for (let index = 0; index < positionAttribute.count; index += 1) {
    positions[index * 3] = positionAttribute.getX(index);
    positions[index * 3 + 1] = positionAttribute.getY(index);
    positions[index * 3 + 2] = positionAttribute.getZ(index);
    normals[index * 3] = normalAttribute.getX(index);
    normals[index * 3 + 1] = normalAttribute.getY(index);
    normals[index * 3 + 2] = normalAttribute.getZ(index);
    uvs[index * 2] = uvAttribute.getX(index);
    uvs[index * 2 + 1] = uvAttribute.getY(index);
    tangents[index * 4] = tangentAttribute.getX(index);
    tangents[index * 4 + 1] = tangentAttribute.getY(index);
    tangents[index * 4 + 2] = tangentAttribute.getZ(index);
    tangents[index * 4 + 3] = tangentAttribute.getW(index);
    if (colors && colorAttribute) {
      colors[index * 4] = colorAttribute.getX(index);
      colors[index * 4 + 1] = colorAttribute.getY(index);
      colors[index * 4 + 2] = colorAttribute.getZ(index);
      colors[index * 4 + 3] = 1;
    }
  }

  const sourceIndices = indexAttribute.array;
  const useUint32 = positionAttribute.count > 65_535;
  const indices = useUint32
    ? new Uint32Array(sourceIndices)
    : new Uint16Array(sourceIndices);
  const positionAccessor = document
    .createAccessor(`${name}_position`, context.buffer)
    .setType(Accessor.Type.VEC3)
    .setArray(positions);
  const normalAccessor = document
    .createAccessor(`${name}_normal`, context.buffer)
    .setType(Accessor.Type.VEC3)
    .setArray(normals);
  const uvAccessor = document
    .createAccessor(`${name}_uv`, context.buffer)
    .setType(Accessor.Type.VEC2)
    .setArray(uvs);
  const tangentAccessor = document
    .createAccessor(`${name}_tangent`, context.buffer)
    .setType(Accessor.Type.VEC4)
    .setArray(tangents);
  const indexAccessor = document
    .createAccessor(`${name}_index`, context.buffer)
    .setType(Accessor.Type.SCALAR)
    .setArray(indices);
  const primitive = document
    .createPrimitive()
    .setAttribute("POSITION", positionAccessor)
    .setAttribute("NORMAL", normalAccessor)
    .setAttribute("TEXCOORD_0", uvAccessor)
    .setAttribute("TANGENT", tangentAccessor)
    .setIndices(indexAccessor)
    .setMaterial(material);
  if (colors) {
    // AO horneada: el loader activa `vertexColors` solo y multiplica el albedo.
    primitive.setAttribute(
      "COLOR_0",
      document
        .createAccessor(`${name}_color`, context.buffer)
        .setType(Accessor.Type.VEC4)
        .setArray(colors),
    );
  }
  return document.createMesh(name).addPrimitive(primitive);
}

function createNode(
  context: BuildContext,
  parent: Node,
  name: string,
  options: {
    readonly mesh?: Mesh;
    readonly position?: Vec3;
    readonly rotation?: Euler;
    readonly scale?: Vec3;
    readonly extras?: Record<string, unknown>;
    /**
     * Rumbo del ancla de cámara: `true` mira a proa, un número la gira ese
     * ángulo en Y. Las anclas NO llevan la corrección de "hacia adelante" —
     * ésa la aplica `VehicleCameraRig`, y horneada acá se sumaba a la del rig
     * y dejaba la cámara mirando la cola.
     *
     * El rig conserva el yaw del ancla íntegro y el `localYaw` del jugador es
     * relativo a él, así que este ángulo también fija el cero del arma: si se
     * gira el ancla del artillero hay que girar igual la base de la torreta.
     */
    readonly camera?: boolean | number;
  } = {},
): Node {
  const node = context.document.createNode(name);
  context.nodeNames.push(name);
  if (options.mesh !== undefined) {
    node.setMesh(options.mesh);
  }
  if (options.position !== undefined) {
    node.setTranslation([...options.position]);
  }
  if (options.rotation !== undefined) {
    const quaternion = new Quaternion().setFromEuler(
      new ThreeEuler(...options.rotation),
    );
    node.setRotation([quaternion.x, quaternion.y, quaternion.z, quaternion.w]);
  }
  if (options.scale !== undefined) {
    node.setScale([...options.scale]);
  }
  if (options.camera !== undefined && options.camera !== false) {
    const yaw = options.camera === true ? 0 : options.camera;
    const quaternion = new Quaternion().setFromEuler(new ThreeEuler(0, yaw, 0));
    node.setRotation([quaternion.x, quaternion.y, quaternion.z, quaternion.w]);
  }
  if (options.extras !== undefined) {
    node.setExtras(options.extras);
  }
  parent.addChild(node);
  return node;
}

function createVisualNode(
  context: BuildContext,
  parent: Node,
  name: string,
  parts: readonly GeometryPart[],
  options: {
    readonly position?: Vec3;
    readonly rotation?: Euler;
    readonly extras?: Record<string, unknown>;
    readonly material?: Material;
    readonly bakeOcclusion?: boolean;
    readonly occlusionStrength?: number;
  } = {},
): Node {
  const geometry = mergeParts(parts, {
    bakeOcclusion: options.bakeOcclusion,
    occlusionStrength: options.occlusionStrength,
  });
  const mesh = createMesh(context, `${name}_mesh`, geometry, options.material);
  geometry.dispose();
  return createNode(context, parent, name, {
    mesh,
    position: options.position,
    rotation: options.rotation,
    extras: options.extras,
  });
}

function createAnchor(
  context: BuildContext,
  name: string,
  position: Vec3,
  kind: string,
  extras: Record<string, unknown> = {},
  camera: boolean | number = false,
): Node {
  return createNode(context, context.sceneRoot, name, {
    position,
    camera,
    extras: { kind, ...extras },
  });
}

function buildBuggyLod(
  context: BuildContext,
  root: Node,
  lod: 0 | 1 | 2,
): void {
  const suffix = lod === 0 ? "" : `_lod${lod}`;
  const segments = lod === 0 ? 20 : lod === 1 ? 12 : 6;
  const detailed = lod === 0;
  const { halfWidth, halfLength, restY } = BUGGY_WHEEL;
  const driverX = BUGGY_DRIVER_X;
  const bodyParts: GeometryPart[] = [
    // Bastidor: piso de chapa, largueros y travesaños.
    { geometry: chamferBox(1.44, 0.1, 2.92, 0.03), position: [0, 0.6, -0.05], tile: 3 },
    { geometry: chamferBox(0.15, 0.24, 3.2, 0.035), position: [-0.73, 0.66, -0.05], tile: 2 },
    { geometry: chamferBox(0.15, 0.24, 3.2, 0.035), position: [0.73, 0.66, -0.05], tile: 2 },
    { geometry: chamferBox(1.5, 0.12, 0.15, 0.03), position: [0, 0.62, 1.22], tile: 2 },
    { geometry: chamferBox(1.5, 0.12, 0.15, 0.03), position: [0, 0.62, -1.3], tile: 2 },
    // Capó: cae hacia la trompa y se angosta arriba, así desde la butaca se ve
    // el piso cerca del paragolpes en vez de una tapa plana.
    {
      geometry: chamferWedge({
        length: 1.44,
        height: 0.4,
        frontWidth: 1.06,
        rearWidth: 1.3,
        topFrontWidth: 0.9,
        topRearWidth: 1.16,
        chamfer: 0.045,
      }),
      position: [0, 0.99, 1.15],
      rotation: [-0.05, 0, 0],
      tile: 0,
    },
    // Cortaviento: cierra el frente del habitáculo sin meter un travesaño a la
    // altura de los ojos, que es lo que tapaba la vista con la jaula anterior.
    { geometry: chamferBox(1.36, 0.26, 0.18, 0.04), position: [0, 1.14, 0.5], rotation: [-0.34, 0, 0], tile: 0 },
    // Mamparo trasero y tapa del motor.
    { geometry: panel(1.44, 0.5, 0.07), position: [0, 1.0, -0.8], tile: 2 },
    { geometry: roundedBox(1.32, 0.44, 0.94, 0.07, detailed ? 3 : 1), position: [0, 1.0, -1.3], tile: 0 },
  ];

  // Butacas: base, respaldo y apoyacabeza en vez de una caja suelta.
  for (const side of [-1, 1] as const) {
    const x = side * driverX;
    bodyParts.push(
      { geometry: chamferBox(0.46, 0.14, 0.52, 0.03), position: [x, 0.78, -0.24], tile: 3 },
      { geometry: chamferBox(0.46, 0.66, 0.14, 0.03), position: [x, 1.1, -0.52], rotation: [-0.15, 0, 0], tile: 3 },
    );
    if (detailed) {
      bodyParts.push(
        { geometry: chamferBox(0.34, 0.2, 0.13, 0.03), position: [x, 1.46, -0.57], tile: 3 },
        { geometry: panel(0.05, 0.42, 0.46), position: [x + side * 0.23, 0.98, -0.3], tile: 2 },
        // Arnés cruzado sobre el respaldo.
        { geometry: panel(0.07, 0.52, 0.03), position: [x - side * 0.09, 1.14, -0.44], rotation: [-0.15, 0, side * 0.5], tile: 1 },
      );
    }
  }

  if (lod < 2) {
    const tube = 0.052;
    for (const side of [-1, 1] as const) {
      bodyParts.push(
        // Arco antivuelco principal, detrás de las butacas.
        createTubePart([side * 0.74, 0.7, -0.66], [side * 0.74, 1.94, -0.66], tube, segments, 2),
        // Montante hacia el cortaviento: baja pegado al flanco, fuera del cono
        // de visión del conductor.
        createTubePart([side * 0.75, 1.92, -0.68], [side * 0.79, 1.24, 0.56], 0.046, segments, 2),
        createTubePart([side * 0.79, 1.24, 0.56], [side * 0.77, 0.74, 0.68], 0.046, segments, 2),
        // Tirante trasero y barra lateral anti-intrusión.
        createTubePart([side * 0.74, 1.92, -0.68], [side * 0.72, 0.84, -1.68], 0.048, segments, 2),
        createTubePart([side * 0.78, 0.88, 0.6], [side * 0.78, 0.86, -0.64], 0.044, segments, 2),
        gusset([side * 0.74, 1.94, -0.66], 0.14, 1),
        // Paragolpes tubular delantero.
        createTubePart([side * 0.68, 0.72, 1.9], [side * 0.72, 0.66, 1.42], 0.045, segments, 2),
        createTubePart([side * 0.62, 1.08, 1.82], [side * 0.68, 0.72, 1.9], 0.042, segments, 2),
      );
    }
    bodyParts.push(
      createTubePart([-0.74, 1.94, -0.66], [0.74, 1.94, -0.66], tube, segments, 2),
      createTubePart([-0.72, 0.86, -1.7], [0.72, 0.86, -1.7], 0.048, segments, 2),
      createTubePart([-0.68, 0.72, 1.9], [0.68, 0.72, 1.9], 0.055, segments, 2),
    );
    if (detailed) {
      bodyParts.push(
        // Cruz de refuerzo del arco principal.
        createTubePart([-0.72, 1.9, -0.7], [0.72, 0.88, -0.7], 0.038, 8, 2),
        createTubePart([0.72, 1.9, -0.7], [-0.72, 0.88, -0.7], 0.038, 8, 2),
      );
    }
    // Pedestal del cañón, soldado al larguero y arriostrado contra el montante.
    bodyParts.push(
      { geometry: chamferBox(0.3, 0.16, 0.34, 0.03), position: [BUGGY_GUN_X, 0.86, BUGGY_GUN_Z], tile: 1 },
      { geometry: new CylinderGeometry(0.058, 0.085, 0.84, segments), position: [BUGGY_GUN_X, 1.34, BUGGY_GUN_Z], tile: 2 },
      { geometry: chamferBox(0.24, 0.06, 0.26, 0.02), position: [BUGGY_GUN_X, 1.73, BUGGY_GUN_Z], tile: 2 },
      createTubePart([BUGGY_GUN_X, 1.58, BUGGY_GUN_Z], [-0.78, 1.4, 0.28], 0.034, 8, 2),
      gusset([BUGGY_GUN_X - 0.05, 1.02, BUGGY_GUN_Z + 0.04], 0.13, 1),
    );
  }

  if (detailed) {
    bodyParts.push(
      // Parrilla y faros en la trompa. El marco va del color de la carrocería:
      // con el marco oscuro toda la trompa se leía como un bloque negro.
      { geometry: chamferBox(0.72, 0.3, 0.07, 0.02), position: [0, 0.92, 1.84], tile: 0 },
      ...ribParts([0, 0.92, 1.87], [1, 0, 0], 5, 0.13, [0.045, 0.24, 0.05], 3),
      { geometry: new CylinderGeometry(0.11, 0.11, 0.18, 12), position: [-0.35, 1.05, 1.8], rotation: [Math.PI / 2, 0, 0], tile: 2 },
      { geometry: new CylinderGeometry(0.11, 0.11, 0.18, 12), position: [0.35, 1.05, 1.8], rotation: [Math.PI / 2, 0, 0], tile: 2 },
      { geometry: new CylinderGeometry(0.085, 0.085, 0.04, 12), position: [-0.35, 1.05, 1.89], rotation: [Math.PI / 2, 0, 0], tile: 0 },
      { geometry: new CylinderGeometry(0.085, 0.085, 0.04, 12), position: [0.35, 1.05, 1.89], rotation: [Math.PI / 2, 0, 0], tile: 0 },
      // Persianas de ventilación del capó.
      ...ribParts([0, 1.19, 1.45], [0, 0, 1], 4, 0.12, [0.46, 0.04, 0.06], 2),
      // Chapas remendadas en los flancos, fuera de escuadra.
      { geometry: panel(0.06, 0.42, 0.88), position: [-0.8, 1.0, 0.76], rotation: [0, 0, 0.05], tile: 1 },
      { geometry: panel(0.06, 0.36, 0.72), position: [0.8, 1.04, 0.62], rotation: [0, 0, -0.04], tile: 1 },
      // Remaches sobre las costuras del capó y del mamparo.
      { geometry: rivetRow([-0.56, 1.17, 0.5], [-0.45, 1.15, 1.76], 9, 0.016, "y"), tile: 2 },
      { geometry: rivetRow([0.56, 1.17, 0.5], [0.45, 1.15, 1.76], 9, 0.016, "y"), tile: 2 },
      { geometry: rivetRow([-0.42, 1.13, 1.89], [0.42, 1.13, 1.89], 8, 0.016, "z"), tile: 2 },
      { geometry: rivetRow([-0.66, 1.18, -0.76], [0.66, 1.18, -0.76], 9, 0.016, "z"), tile: 2 },
      // Motor a la vista sobre la cubierta trasera.
      { geometry: chamferBox(0.82, 0.42, 0.62, 0.04), position: [0, 1.34, -1.28], tile: 2 },
      ...ribParts([0, 1.56, -1.28], [1, 0, 0], 4, 0.19, [0.09, 0.06, 0.5], 2),
      ...[-0.27, -0.09, 0.09, 0.27].map((x) => ({
        geometry: new CylinderGeometry(0.05, 0.065, 0.14, 10),
        position: [x, 1.62, -1.14] as Vec3,
        tile: 2 as AtlasTile,
      })),
      // Escapes, tanque auxiliar y bidón atado a la cubierta.
      createTubePart([-0.3, 1.16, -1.5], [-0.36, 1.52, -1.9], 0.05, 10, 2),
      createTubePart([0.3, 1.16, -1.5], [0.36, 1.52, -1.9], 0.05, 10, 2),
      { geometry: new CylinderGeometry(0.15, 0.15, 0.44, 12), position: [-0.56, 1.36, -1.5], tile: 1 },
      { geometry: chamferBox(0.32, 0.38, 0.18, 0.03), position: [0.56, 1.34, -1.5], tile: 1 },
      // Tablero del conductor: bisel, relojes, columna y volante. El bisel va
      // chico y por detrás del aro, si no tapa el volante desde la butaca.
      { geometry: chamferBox(0.36, 0.13, 0.17, 0.03), position: [driverX, 1.37, 0.56], rotation: [-0.38, 0, 0], tile: 2 },
      { geometry: new CylinderGeometry(0.06, 0.06, 0.04, 12), position: [driverX - 0.09, 1.39, 0.49], rotation: [Math.PI / 2 - 0.38, 0, 0], tile: 3 },
      { geometry: new CylinderGeometry(0.06, 0.06, 0.04, 12), position: [driverX + 0.09, 1.39, 0.49], rotation: [Math.PI / 2 - 0.38, 0, 0], tile: 3 },
      createTubePart([driverX, 1.26, 0.4], [driverX, 0.98, 0.62], 0.032, 8, 2),
      ...groupParts(steeringWheelParts([0, 0, 0], 0.175, 12, 2), {
        position: [driverX, 1.3, 0.34],
        rotation: [0.42, 0, 0],
      }),
      // Palanca de cambios y freno de mano entre las butacas.
      createTubePart([0.08, 0.84, -0.06], [0.12, 1.1, 0.02], 0.028, 8, 2),
      { geometry: new SphereGeometry(0.045, 8, 6), position: [0.12, 1.12, 0.02], tile: 3 },
      createTubePart([-0.08, 0.82, 0], [-0.14, 1.0, 0.2], 0.026, 8, 2),
    );
  }

  // Guardabarros y suspensión a la vista. El guardabarros va fijo al chasis
  // mientras la rueda oscila, así que se dibuja a media carrera; el radio deja
  // pasar la compresión completa sin tocar el taco del neumático.
  const guardY = restY + 0.16;
  const hubY = restY + 0.12;
  if (lod < 2) {
    for (const side of [-1, 1] as const) {
      for (const z of [halfLength, -halfLength] as const) {
        const x = side * halfWidth;
        bodyParts.push(
          ...fenderParts(
            [side * 1.02, guardY, z],
            0.64,
            0.46,
            detailed ? 6 : 4,
            1,
            [0.72, 2.42],
          ),
          // Soportes al larguero: sin ellos el guardabarros flota sobre la rueda.
          createTubePart([side * 0.8, 0.88, z - 0.24], [side * 0.72, 0.72, z - 0.5], 0.03, 6, 2),
          createTubePart([side * 0.8, 0.88, z + 0.24], [side * 0.72, 0.72, z + 0.5], 0.03, 6, 2),
          createTubePart([side * 0.5, 0.54, z], [x * 0.9, hubY - 0.12, z], 0.05, 8, 2),
          createTubePart([side * 0.44, 0.84, z], [x * 0.88, hubY + 0.13, z], 0.04, 8, 2),
        );
        if (detailed) {
          bodyParts.push(
            ...coilOverParts(
              [side * 0.72, 1.0, z * 0.8],
              [x * 0.86, hubY + 0.06, z],
              {
                radius: 0.078,
                coils: 6,
                segments: 10,
                springTile: 1,
                bodyTile: 2,
              },
            ),
            { geometry: new CylinderGeometry(0.09, 0.09, 0.14, 10), position: [x * 0.9, hubY, z], rotation: [0, 0, Math.PI / 2], tile: 2 },
          );
        }
      }
    }
  }

  createVisualNode(context, root, `buggy_body${suffix}`, bodyParts);
  const built = buildWheel({
    radius: BUGGY_WHEEL.radius,
    width: 0.38,
    segments,
    treadCount: detailed ? 18 : lod === 1 ? 10 : 0,
  });
  const wheelGeometry = mergeParts([
    { geometry: built.tire, tile: 3 },
    { geometry: built.rim, tile: 2 },
  ]);
  built.tire.dispose();
  built.rim.dispose();
  const wheelMesh = createMesh(
    context,
    `buggy_wheel_lod${lod}_mesh`,
    wheelGeometry,
  );
  wheelGeometry.dispose();
  const wheelNodes: readonly [string, Vec3][] = [
    ["wheel_front_left", [-halfWidth, restY, halfLength]],
    ["wheel_front_right", [halfWidth, restY, halfLength]],
    ["wheel_rear_left", [-halfWidth, restY, -halfLength]],
    ["wheel_rear_right", [halfWidth, restY, -halfLength]],
  ];
  for (const [name, position] of wheelNodes) {
    createNode(context, root, `${name}${suffix}`, {
      mesh: wheelMesh,
      position,
      extras: {
        kind: "wheel",
        axle: name.includes("front") ? "front" : "rear",
        side: name.includes("left") ? "left" : "right",
      },
    });
  }

  if (lod < 2) {
    const yawParts: GeometryPart[] = [
      { geometry: new CylinderGeometry(0.15, 0.19, 0.11, segments), tile: 2 },
      { geometry: new CylinderGeometry(0.105, 0.105, 0.14, segments), position: [0, 0.08, 0], tile: 2 },
    ];
    if (detailed) {
      yawParts.push(
        { geometry: panel(0.05, 0.2, 0.22), position: [0.13, 0.08, 0.02], tile: 1 },
        { geometry: panel(0.05, 0.2, 0.22), position: [-0.13, 0.08, 0.02], tile: 1 },
      );
    }
    const turretYaw = createVisualNode(
      context,
      root,
      `turret_yaw${suffix}`,
      yawParts,
      {
        position: [BUGGY_GUN_X, BUGGY_GUN_Y, BUGGY_GUN_Z],
        extras: { kind: "turret-yaw" },
      },
    );

    const pitchParts: GeometryPart[] = [
      // Recámara, camisa y freno de boca.
      { geometry: chamferBox(0.28, 0.26, 0.44, 0.035), position: [0, 0, 0.1], tile: 2 },
      { geometry: new CylinderGeometry(0.062, 0.075, 0.92, segments), position: [0, 0, 0.7], rotation: [Math.PI / 2, 0, 0], tile: 2 },
      { geometry: new CylinderGeometry(0.088, 0.1, 0.16, segments), position: [0, 0, 1.22], rotation: [Math.PI / 2, 0, 0], tile: 2 },
    ];
    if (detailed) {
      pitchParts.push(
        // Bobinas de inducción: el cobre es lo que lo separa de una ametralladora.
        ...[0.82, 0.94, 1.06].map((z) => ({
          geometry: new TorusGeometry(0.09, 0.026, 6, segments),
          position: [0, 0, z] as Vec3,
          tile: 1 as AtlasTile,
        })),
        { geometry: chamferBox(0.16, 0.2, 0.28, 0.03), position: [-0.2, -0.02, 0.04], tile: 1 },
        { geometry: chamferBox(0.06, 0.1, 0.16, 0.02), position: [0, 0.18, 0.28], tile: 2 },
        createTubePart([0, -0.06, -0.16], [0, -0.24, -0.3], 0.026, 8, 2),
      );
    }
    createVisualNode(
      context,
      turretYaw,
      `turret_pitch${suffix}`,
      pitchParts,
      { extras: { kind: "turret-pitch" } },
    );
  }
}

/**
 * Bastidor calcinado. Lo que hace leer la chatarra no es la deformación sino
 * que las piezas sigan siendo reconocibles —largueros, butacas, volante— con
 * los cortes y los desgarros a la vista.
 */
function wreckedBuggyChassisParts(segments: number): GeometryPart[] {
  return [
    // Piso: chapas sueltas plegadas sobre el travesaño central, con las juntas
    // abiertas. Una plancha entera leía como una mesa; lo que dice "reventado"
    // son los huecos por los que se ve el piso entre chapa y chapa.
    {
      geometry: chamferBox(0.62, 0.06, 1.34, 0.02),
      position: [0.34, 0.45, 0.86],
      rotation: [0.13, 0.05, -0.09],
      tile: 1,
    },
    {
      geometry: chamferBox(0.54, 0.06, 1.18, 0.02),
      position: [-0.33, 0.42, 0.92],
      rotation: [0.16, -0.06, 0.06],
      tile: 1,
    },
    {
      geometry: chamferBox(0.58, 0.06, 1.14, 0.02),
      position: [0.33, 0.32, -0.76],
      rotation: [-0.08, 0.06, -0.05],
      tile: 1,
    },
    {
      geometry: chamferBox(0.5, 0.06, 1.0, 0.02),
      position: [-0.35, 0.28, -0.84],
      rotation: [-0.12, -0.08, 0.09],
      tile: 1,
    },
    // Chapa del túnel central, levantada entre las dos mitades.
    {
      geometry: chamferBox(0.28, 0.05, 0.76, 0.02),
      position: [0.01, 0.5, 0.36],
      rotation: [0.3, 0.14, 0.16],
      tile: 1,
    },
    { geometry: rivetRow([0.34, 0.5, 0.34], [0.36, 0.52, 1.38], 7, 0.014), tile: 2 },
    { geometry: rivetRow([-0.33, 0.47, 0.44], [-0.34, 0.49, 1.36], 6, 0.014), tile: 2 },
    // Cresta del pliegue: es lo que dice "se dobló" y no "está inclinado".
    {
      geometry: chamferBox(1.24, 0.28, 0.1, 0.03),
      position: [0, 0.5, 0.08],
      rotation: [0.38, 0.04, -0.06],
      tile: 1,
    },
    // Largueros: el izquierdo aguantó pandeado; el derecho se partió y se
    // levantó en la punta, que es por donde salió la rueda delantera.
    {
      geometry: chamferBox(0.13, 0.2, 1.66, 0.03),
      position: [0.71, 0.48, 0.86],
      rotation: [0.11, 0.02, -0.04],
      tile: 2,
    },
    {
      geometry: chamferBox(0.13, 0.19, 1.62, 0.03),
      position: [0.67, 0.36, -0.84],
      rotation: [-0.07, 0.06, 0.05],
      tile: 2,
    },
    {
      geometry: chamferBox(0.13, 0.19, 1.5, 0.03),
      position: [-0.69, 0.34, -0.78],
      rotation: [-0.05, -0.04, 0.03],
      tile: 2,
    },
    {
      geometry: chamferBox(0.13, 0.18, 0.86, 0.03),
      position: [-0.7, 0.42, 0.42],
      rotation: [0.06, -0.03, 0.02],
      tile: 2,
    },
    {
      geometry: chamferBox(0.12, 0.17, 0.94, 0.03),
      position: [-0.66, 0.66, 1.24],
      rotation: [-0.52, -0.14, 0.09],
      tile: 2,
    },
    // Travesaños: el de proa quedó torcido y del de popa sobrevive medio.
    {
      geometry: chamferBox(1.5, 0.11, 0.13, 0.03),
      position: [0.03, 0.5, 1.46],
      rotation: [0.12, 0.1, -0.16],
      tile: 2,
    },
    {
      geometry: chamferBox(0.84, 0.1, 0.13, 0.03),
      position: [0.34, 0.32, -1.5],
      rotation: [0.04, 0.18, -0.09],
      tile: 2,
    },
    // Mamparo trasero vencido hacia adentro.
    {
      geometry: panel(1.24, 0.44, 0.07),
      position: [-0.04, 0.56, -1.06],
      rotation: [-0.52, 0.05, 0.07],
      tile: 1,
    },
    // Único panel pintado que sobrevivió: sin algo del color original la
    // chatarra deja de leerse como este vehículo.
    {
      geometry: panel(0.06, 0.4, 0.86),
      position: [0.79, 0.68, 0.76],
      rotation: [0.08, 0.04, -0.14],
      tile: 0,
    },
    { geometry: rivetRow([-0.46, 0.52, 1.2], [0.5, 0.53, 1.18], 8, 0.015), tile: 2 },
    // Butaca del conductor: queda el esqueleto con el respaldo vencido.
    {
      geometry: chamferBox(0.44, 0.12, 0.5, 0.03),
      position: [0.38, 0.56, -0.2],
      rotation: [0.08, 0.05, -0.07],
      tile: 3,
    },
    {
      geometry: chamferBox(0.42, 0.56, 0.11, 0.03),
      position: [0.35, 0.7, -0.52],
      rotation: [-0.72, 0.06, -0.1],
      tile: 3,
    },
    {
      geometry: chamferBox(0.3, 0.18, 0.12, 0.03),
      position: [0.33, 0.62, -0.86],
      rotation: [-0.92, 0.04, -0.12],
      tile: 3,
    },
    // Del lado del artillero sólo quedó el bastidor atornillado al piso.
    {
      geometry: chamferBox(0.42, 0.09, 0.46, 0.03),
      position: [-0.4, 0.4, -0.26],
      rotation: [0.06, -0.12, 0.14],
      tile: 3,
    },
    createTubePart([-0.58, 0.44, -0.46], [-0.26, 0.82, -0.56], 0.026, 8, 2),
    createTubePart([-0.26, 0.82, -0.56], [-0.34, 0.56, -0.22], 0.026, 8, 2),
    // Columna de dirección arrancada, con el volante torcido todavía puesto.
    createTubePart([0.4, 0.52, 0.52], [0.52, 0.94, 0.3], 0.03, 8, 2),
    ...groupParts(steeringWheelParts([0, 0, 0], 0.17, segments, 2), {
      position: [0.53, 0.97, 0.26],
      rotation: [1.2, 0.22, 0.44],
    }),
    // Chapa desgarrada en los bordes del pliegue y del larguero partido.
    {
      geometry: chamferBox(0.3, 0.05, 0.26, 0.015),
      position: [0.5, 0.58, 0.3],
      rotation: [0.62, 0.2, -0.3],
      tile: 1,
    },
    {
      geometry: chamferBox(0.24, 0.05, 0.2, 0.015),
      position: [-0.44, 0.54, 0.26],
      rotation: [-0.74, -0.3, 0.42],
      tile: 1,
    },
    {
      geometry: chamferBox(0.22, 0.04, 0.3, 0.012),
      position: [-0.7, 0.5, 0.88],
      rotation: [0.36, 0.5, 0.85],
      tile: 1,
    },
    {
      geometry: chamferBox(0.26, 0.05, 0.22, 0.014),
      position: [-0.16, 0.34, -1.32],
      rotation: [0.5, -0.4, 0.3],
      tile: 1,
    },
  ];
}

/**
 * Jaula antivuelco aplastada. Los anillos en las puntas son la mitad del
 * efecto: sin ellos un tubo cortado se ve macizo y el arco parece doblado en
 * vez de partido.
 */
function wreckedBuggyCageParts(segments: number): GeometryPart[] {
  return [
    // Montante izquierdo: se plegó en tres tramos hacia el centro.
    createTubePart([0.71, 0.44, -0.62], [0.69, 0.9, -0.66], 0.052, segments, 1),
    createTubePart([0.69, 0.9, -0.66], [0.54, 1.2, -0.54], 0.052, segments, 1),
    createTubePart([0.54, 1.2, -0.54], [0.14, 1.29, -0.46], 0.052, segments, 1),
    // Travesaño superior: cae hacia el lado del artillero y termina al aire.
    createTubePart([0.14, 1.29, -0.46], [-0.5, 1.12, -0.5], 0.05, segments, 1),
    {
      geometry: new TorusGeometry(0.05, 0.015, 5, segments),
      position: [-0.51, 1.11, -0.5],
      rotation: [1.32, 0.24, 0],
      tile: 2,
    },
    // Montante derecho: cortado a media altura, con la boca del caño a la vista.
    createTubePart([-0.69, 0.36, -0.6], [-0.66, 0.72, -0.63], 0.052, segments, 1),
    {
      geometry: new TorusGeometry(0.052, 0.015, 5, segments),
      position: [-0.66, 0.73, -0.63],
      rotation: [Math.PI / 2 + 0.08, 0, 0.06],
      tile: 2,
    },
    // Montante hacia el cortaviento: el izquierdo se acostó sobre el capó y del
    // derecho quedó el tocón.
    createTubePart([0.62, 1.24, -0.48], [0.74, 0.94, 0.32], 0.046, segments, 1),
    createTubePart([0.74, 0.94, 0.32], [0.68, 0.66, 0.9], 0.046, segments, 1),
    createTubePart([-0.74, 0.44, 0.74], [-0.71, 0.66, 0.44], 0.044, segments, 1),
    {
      geometry: new TorusGeometry(0.044, 0.013, 5, segments),
      position: [-0.71, 0.67, 0.43],
      rotation: [Math.PI / 2 - 0.66, 0.1, 0],
      tile: 2,
    },
    // Tirantes traseros: uno aguantó y el otro quedó colgando del nudo.
    createTubePart([0.67, 1.22, -0.54], [0.69, 0.48, -1.5], 0.048, segments, 1),
    createTubePart([-0.48, 1.08, -0.54], [-0.32, 0.74, -1.14], 0.046, segments, 1),
    {
      geometry: new TorusGeometry(0.046, 0.013, 5, segments),
      position: [-0.315, 0.73, -1.15],
      rotation: [1.05, 0.2, 0],
      tile: 2,
    },
    // Barras laterales anti-intrusión abiertas hacia afuera.
    createTubePart([0.78, 0.6, 0.64], [0.88, 0.5, -0.58], 0.044, segments, 1),
    createTubePart([-0.78, 0.44, 0.46], [-0.92, 0.38, -0.5], 0.044, segments, 1),
    // Cruz de refuerzo: se partió y quedó la mitad colgando del arco.
    createTubePart([0.66, 1.16, -0.7], [0.04, 0.78, -0.74], 0.036, 8, 1),
    createTubePart([-0.46, 1.04, -0.72], [-0.2, 0.88, -0.72], 0.034, 8, 1),
    gusset([0.7, 0.9, -0.66], 0.13, 2),
    gusset([0.54, 1.2, -0.54], 0.12, 2),
    gusset([-0.68, 0.4, -0.6], 0.12, 2),
    gusset([0.68, 0.5, -1.46], 0.11, 2),
  ];
}

/** Motor trasero al descubierto: la tapa y los soportes ya no están. */
function wreckedBuggyEngineParts(segments: number): GeometryPart[] {
  return [
    // El bloque es lo más macizo del buggy: sobrevive entero y torcido.
    {
      geometry: chamferBox(0.82, 0.4, 0.6, 0.04),
      position: [0.04, 0.62, -1.3],
      rotation: [0.12, 0.07, -0.1],
      tile: 2,
    },
    ...ribParts([0.04, 0.84, -1.28], [1, 0, 0], 4, 0.18, [0.09, 0.06, 0.46], 2),
    // Tapa de balancines volada: los tubos de admisión quedan al aire.
    ...[-0.26, -0.09, 0.09, 0.26].map((x) => ({
      geometry: new CylinderGeometry(0.05, 0.062, 0.16, 10),
      position: [0.04 + x, 0.92, -1.18] as Vec3,
      rotation: [0.14, 0, -0.08] as Euler,
      tile: 2 as AtlasTile,
    })),
    // Escapes: uno retorcido hacia arriba, el otro cortado al ras.
    createTubePart([-0.3, 0.48, -1.5], [-0.44, 0.86, -1.86], 0.05, segments, 1),
    createTubePart([-0.44, 0.86, -1.86], [-0.22, 1.0, -2.02], 0.048, segments, 1),
    {
      geometry: new TorusGeometry(0.048, 0.014, 5, segments),
      position: [-0.21, 1.01, -2.03],
      rotation: [1.14, 0.34, 0],
      tile: 2,
    },
    createTubePart([0.3, 0.48, -1.5], [0.4, 0.6, -1.74], 0.05, segments, 1),
    {
      geometry: new TorusGeometry(0.05, 0.014, 5, segments),
      position: [0.41, 0.61, -1.76],
      rotation: [1.0, 0, 0],
      tile: 2,
    },
    // Tanque auxiliar rajado, volcado sobre la cubierta.
    {
      geometry: new CylinderGeometry(0.15, 0.15, 0.42, 12),
      position: [-0.52, 0.5, -1.72],
      rotation: [1.4, 0.2, 0.35],
      tile: 1,
    },
    {
      geometry: chamferBox(0.2, 0.05, 0.26, 0.015),
      position: [-0.5, 0.64, -1.68],
      rotation: [1.2, 0.4, 0.5],
      tile: 1,
    },
    // Bidón reventado contra el mamparo.
    {
      geometry: chamferBox(0.32, 0.38, 0.18, 0.03),
      position: [0.56, 0.44, -1.62],
      rotation: [0.5, 0.3, 1.25],
      scale: [1, 0.68, 1],
      tile: 1,
    },
    // Mangueras y cables colgando del bloque.
    createTubePart([-0.2, 0.68, -1.06], [0.3, 0.5, -0.92], 0.022, 6, 1),
    createTubePart([0.24, 0.8, -1.1], [-0.36, 0.54, -0.9], 0.02, 6, 1),
    createTubePart([0.44, 0.7, -1.34], [0.66, 0.42, -1.5], 0.024, 6, 1),
    // Polea y correa a la vista.
    {
      geometry: new CylinderGeometry(0.16, 0.16, 0.06, segments),
      position: [0.44, 0.68, -1.02],
      rotation: [0, 0, Math.PI / 2],
      tile: 2,
    },
    {
      geometry: new TorusGeometry(0.17, 0.02, 5, segments),
      position: [0.44, 0.68, -1.02],
      rotation: [0, Math.PI / 2, 0],
      tile: 3,
    },
  ];
}

/**
 * Ruedas: tres reventadas en su puesto y la delantera derecha arrancada. El
 * aplastado vertical es lo que las separa de una rueda sana puesta más abajo.
 */
function wreckedBuggyWheelParts(segments: number): GeometryPart[] {
  const built = buildWheel({
    radius: BUGGY_WHEEL.radius,
    width: 0.38,
    segments,
    treadCount: 16,
  });
  const { halfLength } = BUGGY_WHEEL;
  const stations: readonly {
    readonly x: number;
    readonly z: number;
    readonly rotation: Euler;
    readonly squash: number;
  }[] = [
    { x: 0.93, z: -halfLength, rotation: [0.05, 0.1, 0.26], squash: 0.74 },
    { x: -0.91, z: -halfLength + 0.05, rotation: [-0.04, -0.08, -0.32], squash: 0.71 },
    { x: 0.97, z: halfLength - 0.07, rotation: [0.09, 0.22, 0.42], squash: 0.78 },
  ];
  const parts: GeometryPart[] = [];
  for (const station of stations) {
    const position: Vec3 = [
      station.x,
      BUGGY_WRECK_GROUND + BUGGY_WHEEL.radius * station.squash,
      station.z,
    ];
    const scale: Vec3 = [1, station.squash, 1];
    parts.push(
      { geometry: built.tire, position, rotation: station.rotation, scale, tile: 3 },
      { geometry: built.rim, position, rotation: station.rotation, scale, tile: 2 },
      // Amortiguador plegado hasta el tope: la espiral comprimida es lo que
      // explica por qué el bastidor quedó apoyado tan abajo.
      ...coilOverParts(
        [station.x * 0.74, 0.68, station.z * 0.82],
        [station.x * 0.92, 0.42, station.z],
        { radius: 0.075, coils: 6, segments: 10, springTile: 1, bodyTile: 2 },
      ),
      createTubePart(
        [station.x * 0.5, 0.42, station.z],
        [station.x * 0.9, BUGGY_WRECK_GROUND + 0.24, station.z],
        0.05,
        8,
        2,
      ),
    );
  }

  // Rueda delantera derecha: rodó hasta el flanco y quedó tumbada de plano.
  const looseWheel: Vec3 = [-1.44, BUGGY_WRECK_GROUND + 0.19, -0.4];
  const looseRotation: Euler = [0.06, 0.2, Math.PI / 2 - 0.09];
  parts.push(
    { geometry: built.tire, position: looseWheel, rotation: looseRotation, tile: 3 },
    { geometry: built.rim, position: looseWheel, rotation: looseRotation, tile: 2 },
    // Muñón pelado en su lugar: sin el buje la esquina se lee como si nunca
    // hubiera tenido rueda.
    {
      geometry: new CylinderGeometry(0.09, 0.09, 0.16, 10),
      position: [-0.84, 0.46, halfLength - 0.12],
      rotation: [0, 0, Math.PI / 2 + 0.34],
      tile: 2,
    },
    {
      geometry: new CylinderGeometry(0.045, 0.045, 0.22, 8),
      position: [-0.93, 0.49, halfLength - 0.12],
      rotation: [0, 0, Math.PI / 2 + 0.34],
      tile: 2,
    },
    createTubePart(
      [-0.5, 0.44, halfLength - 0.02],
      [-0.82, 0.46, halfLength - 0.12],
      0.048,
      8,
      2,
    ),
    // Brazo de suspensión partido, colgando del larguero.
    createTubePart([-0.66, 0.62, 1.02], [-0.78, 0.24, 1.32], 0.042, 8, 2),
    {
      geometry: new TorusGeometry(0.042, 0.012, 5, 8),
      position: [-0.785, 0.23, 1.33],
      rotation: [0.9, 0.3, 0],
      tile: 2,
    },
  );
  return parts;
}

/** Cañón de inducción caído del pedestal, cruzado sobre el capó plegado. */
function wreckedBuggyTurretParts(segments: number): GeometryPart[] {
  return [
    // Recámara, camisa y freno de boca, con el caño combado.
    { geometry: chamferBox(0.28, 0.26, 0.44, 0.035), position: [0, 0, 0.1], tile: 2 },
    {
      geometry: new CylinderGeometry(0.062, 0.075, 0.92, segments),
      position: [0, -0.03, 0.68],
      rotation: [Math.PI / 2 + 0.07, 0, 0],
      tile: 2,
    },
    {
      geometry: new CylinderGeometry(0.088, 0.1, 0.16, segments),
      position: [0.01, -0.11, 1.19],
      rotation: [Math.PI / 2 + 0.07, 0, 0.06],
      tile: 2,
    },
    // Bobinas: dos siguen en el caño y la tercera saltó al lado.
    {
      geometry: new TorusGeometry(0.09, 0.026, 6, segments),
      position: [0, -0.05, 0.8],
      rotation: [0.07, 0, 0],
      tile: 1,
    },
    {
      geometry: new TorusGeometry(0.09, 0.026, 6, segments),
      position: [0, -0.06, 0.93],
      rotation: [0.07, 0, 0],
      tile: 1,
    },
    {
      geometry: new TorusGeometry(0.09, 0.03, 6, segments),
      position: [0.34, -0.24, 0.6],
      rotation: [1.2, 0.4, 0.3],
      tile: 1,
    },
    { geometry: chamferBox(0.16, 0.2, 0.28, 0.03), position: [-0.19, -0.04, 0.04], tile: 1 },
    // Cuna y pedestal: el caño de montaje se partió al ras del larguero.
    {
      geometry: new CylinderGeometry(0.15, 0.19, 0.11, segments),
      position: [0, -0.17, -0.06],
      rotation: [0.28, 0, 0.18],
      tile: 2,
    },
    createTubePart([0, -0.22, -0.1], [0.09, -0.5, -0.32], 0.055, segments, 2),
    {
      geometry: new TorusGeometry(0.055, 0.015, 5, segments),
      position: [0.095, -0.52, -0.33],
      rotation: [1.0, 0.2, 0],
      tile: 2,
    },
    createTubePart([-0.16, -0.06, -0.06], [-0.4, -0.3, -0.48], 0.03, 8, 1),
  ];
}

/**
 * Piezas que salieron despedidas. Todas apoyan en el piso, así que la altura
 * sale de su propio espesor y de cuánto las inclina la pose: centrarlas en el
 * suelo las hunde hasta la mitad.
 */
function wreckedBuggyDebrisParts(segments: number): GeometryPart[] {
  return [
    // Capó arrancado: chapa fina con el pliegue del golpe. Como cuña maciza
    // —que es la forma que tiene cerrado sobre el motor— leía como un bloque.
    {
      geometry: chamferBox(1.22, 0.07, 0.92, 0.03),
      position: [0.34, BUGGY_WRECK_GROUND + 0.14, 1.92],
      rotation: [0.1, 0.46, 0.09],
      tile: 0,
    },
    {
      geometry: chamferBox(1.04, 0.06, 0.42, 0.025),
      position: [0.16, BUGGY_WRECK_GROUND + 0.19, 2.34],
      rotation: [-0.34, 0.46, 0.12],
      tile: 0,
    },
    // Tapa del motor, volada hacia atrás. Va oxidada y no pintada: es la chapa
    // que estuvo sobre el fuego.
    {
      geometry: chamferBox(1.2, 0.09, 0.86, 0.04),
      position: [-0.28, BUGGY_WRECK_GROUND + 0.21, -2.1],
      rotation: [0.22, 0.24, 0.12],
      tile: 1,
    },
    {
      geometry: chamferBox(0.48, 0.07, 0.34, 0.025),
      position: [-0.74, BUGGY_WRECK_GROUND + 0.26, -2.34],
      rotation: [0.5, 0.3, 0.34],
      tile: 1,
    },
    // Guardabarros suelto, apoyado sobre sus dos extremos.
    ...groupParts(fenderParts([0, 0, 0], 0.62, 0.44, 5, 1, [0.4, Math.PI - 0.4]), {
      position: [1.3, -0.05, -0.1],
      rotation: [0.12, 0.35, 0.16],
    }),
    // Faro reventado: quedan el aro y el reflector partido.
    {
      geometry: new CylinderGeometry(0.11, 0.11, 0.18, 12),
      position: [-1.12, BUGGY_WRECK_GROUND + 0.11, -0.3],
      rotation: [1.42, 0.2, 0.3],
      tile: 2,
    },
    {
      geometry: new CylinderGeometry(0.085, 0.085, 0.04, 12),
      position: [-1.3, BUGGY_WRECK_GROUND + 0.09, -0.58],
      rotation: [1.24, -0.4, 0.5],
      tile: 0,
    },
    // Chapas de flanco arrancadas, todavía con la hilera de remaches.
    {
      geometry: panel(0.06, 0.4, 0.8),
      position: [1.32, BUGGY_WRECK_GROUND + 0.09, -1.35],
      rotation: [0.14, 0.4, 1.55],
      tile: 0,
    },
    {
      geometry: panel(0.05, 0.34, 0.62),
      position: [-1.24, BUGGY_WRECK_GROUND + 0.08, -1.38],
      rotation: [0.1, -0.5, 1.6],
      tile: 1,
    },
    { geometry: rivetRow([-1.38, 0.19, -1.52], [-1.1, 0.19, -1.24], 6, 0.015), tile: 2 },
    // Barras del arco que se soltaron enteras.
    createTubePart(
      [0.88, BUGGY_WRECK_GROUND + 0.06, -2.0],
      [1.42, BUGGY_WRECK_GROUND + 0.08, -1.6],
      0.05,
      segments,
      1,
    ),
    createTubePart(
      [-1.3, BUGGY_WRECK_GROUND + 0.05, -1.92],
      [-0.78, BUGGY_WRECK_GROUND + 0.07, -2.24],
      0.044,
      segments,
      1,
    ),
    createTubePart(
      [0.38, BUGGY_WRECK_GROUND + 0.04, 2.12],
      [0.98, BUGGY_WRECK_GROUND + 0.05, 1.82],
      0.038,
      8,
      2,
    ),
    // Silenciador arrancado y recortes de chapa: restos chicos que ensucian el
    // contorno para que la chatarra no termine en un borde limpio.
    {
      geometry: new CylinderGeometry(0.09, 0.09, 0.5, segments),
      position: [-0.88, BUGGY_WRECK_GROUND + 0.11, -2.18],
      rotation: [0.1, 0.5, Math.PI / 2],
      tile: 2,
    },
    {
      geometry: chamferBox(0.22, 0.05, 0.28, 0.014),
      position: [-0.55, BUGGY_WRECK_GROUND + 0.03, 2.18],
      rotation: [0.08, 0.6, 0.06],
      tile: 1,
    },
    {
      geometry: chamferBox(0.18, 0.05, 0.2, 0.012),
      position: [1.08, BUGGY_WRECK_GROUND + 0.03, 1.32],
      rotation: [0.06, -0.5, 0.1],
      tile: 1,
    },
  ];
}

function buildBuggy(context: BuildContext): void {
  for (const lod of [0, 1, 2] as const) {
    const root = createNode(context, context.sceneRoot, `visual_lod${lod}`, {
      extras: {
        kind: "vehicle-lod",
        lod,
        hiddenByDefault: lod !== 0,
        screenCoverage: lod === 0 ? 0.28 : lod === 1 ? 0.09 : 0,
      },
    });
    buildBuggyLod(context, root, lod);
  }

  // El puesto de manejo va en +X, la izquierda del vehículo.
  createAnchor(context, "seat_driver", [BUGGY_DRIVER_X, 1.22, -0.2], "seat", {
    role: "driver",
  });
  createAnchor(context, "seat_gunner", [-BUGGY_DRIVER_X, 1.22, -0.2], "seat", {
    role: "gunner",
  });
  createAnchor(
    context,
    "camera_driver",
    [BUGGY_DRIVER_X, 1.66, -0.14],
    "camera",
    { role: "driver", fov: 76 },
    true,
  );
  // El artillero comparte el habitáculo: sin ancla propia, cambiar de asiento
  // saltaba al rig procedural, que tiene otra disposición. Va incorporado
  // detrás de la recámara: sentado a la altura del conductor miraría por debajo
  // del cañón y el pedestal le taparía media pantalla.
  createAnchor(
    context,
    "camera_gunner",
    [BUGGY_GUN_X + 0.32, BUGGY_GUN_Y + 0.04, BUGGY_GUN_Z - 0.82],
    "camera",
    { role: "gunner", fov: 76 },
    true,
  );
  createAnchor(context, "exit_left", [1.4, 0.8, -0.2], "exit", {
    seat: "seat_driver",
  });
  createAnchor(context, "exit_right", [-1.4, 0.8, -0.2], "exit", {
    seat: "seat_gunner",
  });
  // Punta del freno de boca con el cañón en reposo: `VehicleVisual` cuelga el
  // ancla del nodo de elevación, así que de acá en más sigue al arma.
  createAnchor(
    context,
    "muzzle",
    [BUGGY_GUN_X, BUGGY_GUN_Y, BUGGY_GUN_Z + BUGGY_GUN_REACH],
    "muzzle",
    { weapon: "induction-cannon" },
  );
  createAnchor(context, "audio_engine", [0, 1.2, -1.3], "audio", {
    layer: "engine",
  });
  createAnchor(context, "audio_transmission", [0, 0.62, -0.1], "audio", {
    layer: "transmission",
  });
  createAnchor(context, "damage_engine", [0, 1.15, -1.3], "damage", {
    component: "engine",
    halfExtents: [0.55, 0.45, 0.55],
  });
  createAnchor(context, "damage_steering", [BUGGY_DRIVER_X, 1.1, 0.4], "damage", {
    component: "steering",
    halfExtents: [0.4, 0.35, 0.4],
  });
  createAnchor(
    context,
    "damage_weapon",
    [BUGGY_GUN_X, BUGGY_GUN_Y - 0.1, BUGGY_GUN_Z + 0.5],
    "damage",
    { component: "weapon", halfExtents: [0.25, 0.35, 0.8] },
  );
  createAnchor(context, "damage_fuel", [-0.56, 1.36, -1.5], "damage", {
    component: "fuel",
    halfExtents: [0.3, 0.3, 0.3],
  });
  const wreckage = createNode(context, context.sceneRoot, "wreckage", {
    extras: { kind: "wreckage", hiddenByDefault: true },
  });
  createVisualNode(context, wreckage, "wreckage_chassis", wreckedBuggyChassisParts(12), {
    position: BUGGY_WRECK_POSITION,
    rotation: BUGGY_WRECK_ROTATION,
  });
  createVisualNode(context, wreckage, "wreckage_cage", wreckedBuggyCageParts(10), {
    position: BUGGY_WRECK_POSITION,
    rotation: BUGGY_WRECK_ROTATION,
  });
  createVisualNode(context, wreckage, "wreckage_engine", wreckedBuggyEngineParts(12), {
    position: BUGGY_WRECK_POSITION,
    rotation: BUGGY_WRECK_ROTATION,
  });
  // Las ruedas y la chatarra suelta apoyan en el piso, así que quedan fuera de
  // la inclinación del bastidor.
  createVisualNode(context, wreckage, "wreckage_wheels", wreckedBuggyWheelParts(14));
  createVisualNode(context, wreckage, "wreckage_turret", wreckedBuggyTurretParts(12), {
    position: [-0.62, 0.72, 0.74],
    rotation: [0.42, -0.62, 0.34],
  });
  createVisualNode(context, wreckage, "wreckage_debris", wreckedBuggyDebrisParts(10));
}

function buildRebelCrawlerLod(
  context: BuildContext,
  root: Node,
  lod: 0 | 1 | 2,
  glassMaterial: Material,
): void {
  const suffix = lod === 0 ? "" : `_lod${lod}`;
  const detailed = lod === 0;
  const segments = lod === 0 ? 16 : lod === 1 ? 10 : 6;
  const { halfWidth, halfLength, restY, radius } = REBEL_CRAWLER_WHEEL;
  const bodyParts: GeometryPart[] = [
    // Bañera soldada sobre el tren de orugas.
    {
      geometry: chamferBox(2.18, 0.62, 4.18, 0.09),
      position: [0, 0.72, -0.02],
      tile: 0,
    },
    {
      geometry: chamferWedge({
        length: 0.9,
        height: 0.54,
        frontWidth: 1.74,
        rearWidth: 2.08,
        topFrontWidth: 1.48,
        topRearWidth: 1.86,
        chamfer: 0.06,
      }),
      position: [0, 1.08, 1.72],
      rotation: [-0.08, 0, 0],
      tile: 0,
    },
    // Piso de cabina y cubierta de carga trasera.
    {
      geometry: chamferBox(1.86, 0.16, 1.54, 0.04),
      position: [0, 1.02, 0.86],
      tile: 2,
    },
    {
      geometry: chamferBox(1.82, 0.14, 1.08, 0.035),
      position: [0, 1.1, -1.72],
      tile: 1,
    },
    // Guardas robustas: protegen la banda y ensanchan la silueta.
    {
      geometry: chamferBox(0.28, 0.32, 4.34, 0.05),
      position: [-1.13, 0.78, 0],
      tile: 1,
    },
    {
      geometry: chamferBox(0.28, 0.32, 4.34, 0.05),
      position: [1.13, 0.78, 0],
      tile: 1,
    },
  ];

  // Bandas de oruga construidas con zapatas separadas. En los LOD lejanos se
  // reducen, pero se conserva el ritmo que distingue una oruga de un patín.
  const shoeCount = detailed ? 13 : lod === 1 ? 8 : 4;
  const shoeLength = 3.76 / shoeCount;
  for (const side of [-1, 1] as const) {
    const x = side * 1.25;
    for (let index = 0; index < shoeCount; index += 1) {
      const z = -1.88 + shoeLength * (index + 0.5);
      bodyParts.push(
        {
          geometry: chamferBox(0.42, 0.11, shoeLength * 0.9, 0.018),
          position: [x, restY - radius + 0.03, z],
          tile: 3,
        },
        {
          geometry: chamferBox(0.42, 0.11, shoeLength * 0.9, 0.018),
          position: [x, restY + radius - 0.02, z],
          tile: 3,
        },
      );
    }
    const endShoeCount = detailed ? 5 : 3;
    for (const end of [-1, 1] as const) {
      for (let index = 0; index < endShoeCount; index += 1) {
        const t = (index + 0.5) / endShoeCount;
        const angle = -Math.PI / 2 + t * Math.PI;
        bodyParts.push({
          geometry: chamferBox(0.42, 0.11, 0.3, 0.018),
          position: [
            x,
            restY + Math.sin(angle) * radius,
            end * (1.88 + Math.cos(angle) * radius * 0.46),
          ],
          rotation: [end * angle, 0, 0],
          tile: 3,
        });
      }
    }
    // Tres rodillos centrales quedan fijos; las ruedas de los extremos son los
    // cuatro nodos animados que siguen las muestras de suspensión.
    for (const z of [-0.88, 0, 0.88]) {
      bodyParts.push(
        {
          geometry: new CylinderGeometry(0.36, 0.36, 0.3, segments),
          position: [x, restY, z],
          rotation: [0, 0, Math.PI / 2],
          tile: 2,
        },
        {
          geometry: new CylinderGeometry(0.16, 0.16, 0.32, segments),
          position: [x, restY, z],
          rotation: [0, 0, Math.PI / 2],
          tile: 1,
        },
      );
    }
  }

  if (lod < 2) {
    // Cabina parcialmente cerrada: techo, pilares y media puerta, sin convertir
    // el transporte en un blindado hermético.
    bodyParts.push(
      {
        geometry: chamferBox(1.9, 0.14, 1.62, 0.045),
        position: [0, 2.18, 0.92],
        tile: 0,
      },
      {
        geometry: chamferBox(0.14, 1.04, 0.16, 0.035),
        position: [-0.83, 1.66, 1.58],
        rotation: [0.08, 0, -0.04],
        tile: 2,
      },
      {
        geometry: chamferBox(0.14, 1.04, 0.16, 0.035),
        position: [0.83, 1.66, 1.58],
        rotation: [0.08, 0, 0.04],
        tile: 2,
      },
      {
        geometry: chamferBox(0.14, 1.08, 0.16, 0.035),
        position: [-0.88, 1.65, 0.18],
        tile: 2,
      },
      {
        geometry: chamferBox(0.14, 1.08, 0.16, 0.035),
        position: [0.88, 1.65, 0.18],
        tile: 2,
      },
      {
        geometry: chamferBox(0.08, 0.58, 1.1, 0.02),
        position: [-0.91, 1.3, 0.92],
        tile: 0,
      },
      {
        geometry: chamferBox(0.08, 0.58, 1.1, 0.02),
        position: [0.91, 1.3, 0.92],
        tile: 0,
      },
      // Arco de supervivencia y rack de carga.
      createTubePart([-0.88, 1.08, 0.08], [-0.88, 2.16, 0.08], 0.05, segments, 2),
      createTubePart([0.88, 1.08, 0.08], [0.88, 2.16, 0.08], 0.05, segments, 2),
      createTubePart([-0.88, 2.16, 0.08], [0.88, 2.16, 0.08], 0.05, segments, 2),
      createTubePart([-0.86, 1.18, -2.1], [-0.86, 1.52, -2.1], 0.045, segments, 2),
      createTubePart([0.86, 1.18, -2.1], [0.86, 1.52, -2.1], 0.045, segments, 2),
      createTubePart([-0.86, 1.52, -2.1], [0.86, 1.52, -2.1], 0.045, segments, 2),
      createTubePart([-0.86, 1.52, -2.1], [-0.86, 1.52, -1.25], 0.045, segments, 2),
      createTubePart([0.86, 1.52, -2.1], [0.86, 1.52, -1.25], 0.045, segments, 2),
    );
  }

  if (detailed) {
    const driverX = REBEL_CRAWLER_DRIVER_X;
    bodyParts.push(
      // Butacas y controles.
      { geometry: chamferBox(0.5, 0.16, 0.55, 0.035), position: [driverX, 1.2, 0.72], tile: 3 },
      { geometry: chamferBox(0.5, 0.68, 0.14, 0.035), position: [driverX, 1.52, 0.45], rotation: [-0.12, 0, 0], tile: 3 },
      { geometry: chamferBox(0.5, 0.16, 0.55, 0.035), position: [-driverX, 1.2, 0.72], tile: 3 },
      { geometry: chamferBox(0.5, 0.68, 0.14, 0.035), position: [-driverX, 1.52, 0.45], rotation: [-0.12, 0, 0], tile: 3 },
      { geometry: chamferBox(1.48, 0.2, 0.22, 0.04), position: [0, 1.55, 1.43], rotation: [-0.2, 0, 0], tile: 2 },
      ...groupParts(steeringWheelParts([0, 0, 0], 0.19, 14, 2), {
        position: [driverX, 1.55, 1.16],
        rotation: [0.48, 0, 0],
      }),
      // Motor diésel expuesto entre cabina y plataforma.
      { geometry: roundedBox(1.24, 0.62, 0.92, 0.08, 3), position: [0, 1.42, -0.55], tile: 2 },
      ...ribParts([0, 1.75, -0.55], [1, 0, 0], 5, 0.21, [0.11, 0.07, 0.72], 2),
      ...[-0.36, -0.12, 0.12, 0.36].map((x) => ({
        geometry: new CylinderGeometry(0.055, 0.07, 0.18, 10),
        position: [x, 1.84, -0.38] as Vec3,
        tile: 1 as AtlasTile,
      })),
      createTubePart([0.46, 1.32, -0.72], [0.68, 2.02, -1.02], 0.055, 10, 2),
      { geometry: new CylinderGeometry(0.09, 0.12, 0.34, 10), position: [0.72, 2.12, -1.08], rotation: [-0.34, 0, 0], tile: 3 },
      // Batería, bidón y caja de herramientas en la zona de carga.
      { geometry: chamferBox(0.48, 0.42, 0.34, 0.035), position: [-0.58, 1.36, -1.68], tile: 1 },
      { geometry: chamferBox(0.52, 0.34, 0.4, 0.035), position: [0.56, 1.31, -1.72], tile: 0 },
      { geometry: chamferBox(0.26, 0.24, 0.22, 0.025), position: [0, 1.29, -1.72], tile: 2 },
      // Defensa y cabrestante visual, todavía sin mecánica propia.
      createTubePart([-0.98, 0.72, 2.35], [0.98, 0.72, 2.35], 0.065, 12, 2),
      { geometry: new CylinderGeometry(0.18, 0.18, 0.52, 14), position: [0, 0.82, 2.26], rotation: [0, 0, Math.PI / 2], tile: 2 },
      { geometry: new TorusGeometry(0.22, 0.035, 7, 16), position: [0, 0.82, 2.27], rotation: [0, Math.PI / 2, 0], tile: 1 },
      // Faros y marcas de reparación.
      { geometry: new CylinderGeometry(0.12, 0.12, 0.12, 14), position: [-0.56, 1.22, 2.05], rotation: [Math.PI / 2, 0, 0], tile: 2 },
      { geometry: new CylinderGeometry(0.12, 0.12, 0.12, 14), position: [0.56, 1.22, 2.05], rotation: [Math.PI / 2, 0, 0], tile: 2 },
      { geometry: panel(0.06, 0.5, 0.9), position: [-1.09, 1.02, -0.25], rotation: [0, 0, 0.04], tile: 1 },
      { geometry: rivetRow([-1.12, 0.82, -0.64], [-1.12, 1.2, 0.14], 8, 0.017, "x"), tile: 2 },
    );
  }

  createVisualNode(context, root, `rebelCrawler_body${suffix}`, bodyParts);

  if (lod < 2) {
    createVisualNode(
      context,
      root,
      `rebelCrawler_glass${suffix}`,
      [
        {
          geometry: new BoxGeometry(1.48, 0.64, 0.035),
          position: [0, 1.78, 1.53],
          rotation: [-0.12, 0, 0],
          tile: 0,
        },
        {
          geometry: new BoxGeometry(0.035, 0.52, 0.72),
          position: [-0.895, 1.78, 0.87],
          tile: 0,
        },
        {
          geometry: new BoxGeometry(0.035, 0.52, 0.72),
          position: [0.895, 1.78, 0.87],
          tile: 0,
        },
      ],
      { material: glassMaterial, bakeOcclusion: false },
    );
  }

  const builtWheel = buildWheel({
    radius,
    width: 0.32,
    segments,
    treadCount: detailed ? 14 : lod === 1 ? 8 : 0,
  });
  const wheelGeometry = mergeParts([
    { geometry: builtWheel.tire, tile: 3 },
    { geometry: builtWheel.rim, tile: 2 },
  ]);
  builtWheel.tire.dispose();
  builtWheel.rim.dispose();
  const wheelMesh = createMesh(
    context,
    `rebelCrawler_wheel_lod${lod}_mesh`,
    wheelGeometry,
  );
  wheelGeometry.dispose();
  const wheelNodes: readonly [string, Vec3][] = [
    ["wheel_front_left", [-halfWidth, restY, halfLength]],
    ["wheel_front_right", [halfWidth, restY, halfLength]],
    ["wheel_rear_left", [-halfWidth, restY, -halfLength]],
    ["wheel_rear_right", [halfWidth, restY, -halfLength]],
  ];
  for (const [name, position] of wheelNodes) {
    createNode(context, root, `${name}${suffix}`, {
      mesh: wheelMesh,
      position,
      extras: {
        kind: "track-wheel",
        axle: name.includes("front") ? "front" : "rear",
        side: name.includes("left") ? "left" : "right",
      },
    });
  }
}

/** Bañera reventada: el volumen que sostiene todo lo demás. */
function wreckedCrawlerHullParts(segments: number): GeometryPart[] {
  return [
    // La bañera se pandeó a la altura del motor y quedó en dos tramos.
    {
      geometry: chamferBox(2.14, 0.6, 2.16, 0.09),
      position: [0.03, 0.74, 1.02],
      rotation: [0.05, 0.02, -0.04],
      tile: 0,
    },
    // La cuba de popa quedó abierta: piso, mamparo y la banda de babor. La de
    // estribor se desprendió, y ese hueco es lo que deja ver adentro. Como caja
    // cerrada el transporte se leía apenas abollado.
    {
      geometry: chamferBox(2.0, 0.14, 1.92, 0.05),
      position: [-0.04, 0.44, -1.08],
      rotation: [-0.06, -0.03, 0.06],
      tile: 0,
    },
    {
      geometry: chamferBox(0.16, 0.54, 1.92, 0.05),
      position: [0.88, 0.7, -1.08],
      rotation: [-0.06, -0.03, 0.06],
      tile: 0,
    },
    {
      geometry: chamferBox(0.16, 0.46, 0.78, 0.05),
      position: [-0.98, 0.64, -1.62],
      rotation: [-0.08, -0.06, 0.1],
      tile: 0,
    },
    {
      geometry: chamferBox(1.96, 0.5, 0.16, 0.05),
      position: [-0.05, 0.68, -1.98],
      rotation: [-0.12, -0.03, 0.06],
      tile: 0,
    },
    // Costura del pliegue, con la chapa levantada.
    {
      geometry: chamferBox(2.0, 0.24, 0.12, 0.03),
      position: [0, 0.88, -0.02],
      rotation: [0.34, 0.02, 0.02],
      tile: 1,
    },
    // Trompa hundida: la cuña de proa se comió el golpe.
    {
      geometry: chamferWedge({
        length: 0.86,
        height: 0.5,
        frontWidth: 1.66,
        rearWidth: 2.02,
        topFrontWidth: 1.32,
        topRearWidth: 1.78,
        chamfer: 0.06,
      }),
      position: [0.05, 1.02, 1.78],
      rotation: [-0.26, 0.04, -0.08],
      tile: 0,
    },
    // Guardas: la de babor doblada hacia afuera, la de estribor arrancada salvo
    // el tramo de popa.
    {
      geometry: chamferBox(0.28, 0.32, 4.2, 0.05),
      position: [1.15, 0.78, 0],
      rotation: [0.02, 0.02, -0.1],
      tile: 1,
    },
    {
      geometry: chamferBox(0.28, 0.3, 1.5, 0.05),
      position: [-1.14, 0.72, -1.32],
      rotation: [-0.04, -0.04, 0.12],
      tile: 1,
    },
    {
      geometry: chamferBox(0.26, 0.26, 0.34, 0.05),
      position: [-1.1, 0.8, 1.5],
      rotation: [0.3, -0.24, 0.36],
      tile: 1,
    },
    // Piso de cabina partido y cubierta de carga desfondada.
    {
      geometry: chamferBox(1.8, 0.14, 0.86, 0.04),
      position: [0.04, 1.02, 1.1],
      rotation: [0.06, 0.04, -0.07],
      tile: 2,
    },
    {
      geometry: chamferBox(0.82, 0.13, 0.6, 0.04),
      position: [0.5, 0.96, 0.34],
      rotation: [-0.16, 0.14, -0.12],
      tile: 2,
    },
    {
      geometry: chamferBox(1.0, 0.13, 0.66, 0.035),
      position: [0.42, 1.02, -1.74],
      rotation: [-0.14, -0.08, 0.12],
      tile: 1,
    },
    // Cuadernas de la bañera, a la vista donde faltó el piso.
    ...ribParts([0, 0.86, -0.6], [0, 0, 1], 4, 0.62, [1.9, 0.09, 0.07], 2),
    { geometry: rivetRow([1.14, 0.86, -0.7], [1.14, 1.16, 0.2], 8, 0.017, "x"), tile: 2 },
    // Chapa desgarrada en el flanco abierto.
    {
      geometry: chamferBox(0.3, 0.05, 0.32, 0.014),
      position: [-1.02, 1.0, 0.5],
      rotation: [0.5, -0.4, 0.6],
      tile: 0,
    },
    {
      geometry: chamferBox(0.26, 0.05, 0.28, 0.014),
      position: [0.4, 1.12, -0.9],
      rotation: [-0.6, 0.3, 0.4],
      tile: 0,
    },
    createTubePart([-0.9, 0.94, -1.9], [0.5, 1.0, -1.6], 0.035, segments, 1),
  ];
}

/**
 * Tren de rodaje que sigue montado. Va en cotas del modelo intacto porque
 * acompaña la escora del casco: es la banda de babor la que sostiene ese lado.
 */
function wreckedCrawlerRunningGearParts(segments: number): GeometryPart[] {
  const { restY, radius } = REBEL_CRAWLER_WHEEL;
  const parts: GeometryPart[] = [];
  const shoeCount = 12;
  const shoeLength = 3.76 / shoeCount;

  // Banda de babor: sigue puesta pero descarrilada, con el ramal superior
  // descolgado entre los rodillos y dos zapatas de menos.
  for (let index = 0; index < shoeCount; index += 1) {
    const t = (index + 0.5) / shoeCount;
    const z = -1.88 + shoeLength * (index + 0.5);
    parts.push({
      geometry: chamferBox(0.42, 0.11, shoeLength * 0.9, 0.018),
      position: [1.25, restY - radius + 0.03, z],
      tile: 3,
    });
    if (index === 4 || index === 5) continue;
    const sag = Math.sin(t * Math.PI) * 0.17;
    parts.push({
      geometry: chamferBox(0.42, 0.11, shoeLength * 0.9, 0.018),
      position: [1.25, restY + radius - 0.02 - sag, z],
      rotation: [Math.cos(t * Math.PI) * 0.16, 0, 0],
      tile: 3,
    });
  }
  for (const end of [-1, 1] as const) {
    for (let index = 0; index < 4; index += 1) {
      const angle = -Math.PI / 2 + ((index + 0.5) / 4) * Math.PI;
      parts.push({
        geometry: chamferBox(0.42, 0.11, 0.3, 0.018),
        position: [
          1.25,
          restY + Math.sin(angle) * radius,
          end * (1.88 + Math.cos(angle) * radius * 0.46),
        ],
        rotation: [end * angle, 0, 0],
        tile: 3,
      });
    }
  }

  // Rodillos: los de babor siguen bajo la banda, los de estribor quedaron
  // pelados y uno se salió del eje.
  for (const z of [-0.88, 0, 0.88]) {
    parts.push(
      {
        geometry: new CylinderGeometry(0.36, 0.36, 0.3, segments),
        position: [1.25, restY, z],
        rotation: [0, 0, Math.PI / 2],
        tile: 2,
      },
      {
        geometry: new CylinderGeometry(0.16, 0.16, 0.32, segments),
        position: [1.25, restY, z],
        rotation: [0, 0, Math.PI / 2],
        tile: 1,
      },
      {
        geometry: new CylinderGeometry(0.36, 0.36, 0.3, segments),
        position: [-1.25, restY - 0.04, z],
        rotation: [0.06, 0, Math.PI / 2 + (z === 0 ? 0.22 : 0.04)],
        tile: 2,
      },
      {
        geometry: new CylinderGeometry(0.16, 0.16, 0.34, segments),
        position: [-1.25, restY - 0.04, z],
        rotation: [0.06, 0, Math.PI / 2 + (z === 0 ? 0.22 : 0.04)],
        tile: 1,
      },
    );
  }
  // Brazo tensor de estribor, doblado y sin rueda.
  parts.push(createTubePart([-1.2, 0.5, 1.7], [-1.5, 0.26, 1.74], 0.05, segments, 2));
  return parts;
}

/**
 * Banda de estribor desenrollada sobre el terreno. Es lo que identifica a la
 * chatarra de un vehículo de orugas: sin ella el casco podría ser el de
 * cualquier transporte volcado. Va en cotas del piso, no del casco.
 */
function wreckedCrawlerThrownTrackParts(segments: number): GeometryPart[] {
  const parts: GeometryPart[] = [
    // Rueda tensora que se fue con la banda. Va de canto y volcada contra el
    // terreno: tumbada de plano leía como una tapa de alcantarilla.
    {
      geometry: new CylinderGeometry(0.36, 0.36, 0.3, segments),
      position: [-1.66, CRAWLER_WRECK_GROUND + 0.34, 1.72],
      rotation: [1.18, 0.24, 0.16],
      tile: 2,
    },
    {
      geometry: new CylinderGeometry(0.16, 0.16, 0.34, segments),
      position: [-1.66, CRAWLER_WRECK_GROUND + 0.34, 1.72],
      rotation: [1.18, 0.24, 0.16],
      tile: 1,
    },
  ];
  const thrown = 17;
  for (let index = 0; index < thrown; index += 1) {
    const t = index / (thrown - 1);
    const wave = t * 2.9;
    const x = -1.74 - Math.sin(wave) * 0.44;
    const z = 2.0 - t * 4.3;
    const yaw = Math.atan2(-Math.cos(wave) * 2.9 * 0.44, -4.3);
    parts.push({
      geometry: chamferBox(0.42, 0.1, 0.3, 0.018),
      position: [x, CRAWLER_WRECK_GROUND + 0.05, z],
      rotation: [0, yaw, Math.sin(t * 8) * 0.1],
      tile: 3,
    });
    if (index % 4 === 0) {
      parts.push({
        geometry: new CylinderGeometry(0.03, 0.03, 0.44, 8),
        position: [x, CRAWLER_WRECK_GROUND + 0.09, z + 0.15],
        rotation: [0, yaw, Math.PI / 2],
        tile: 2,
      });
    }
  }
  // Cola amontonada: la banda no termina, se apila.
  for (let index = 0; index < 5; index += 1) {
    const t = index / 4;
    parts.push({
      geometry: chamferBox(0.42, 0.1, 0.3, 0.018),
      position: [
        -1.42 + t * 0.34,
        CRAWLER_WRECK_GROUND + 0.06 + t * 0.13,
        -2.36 - t * 0.16,
      ],
      rotation: [0.5 + t * 0.5, 0.3 - t * 0.2, 0.24],
      tile: 3,
    });
  }
  return parts;
}

/** Cabina aplastada: el techo se corrió y los montantes se doblaron. */
function wreckedCrawlerCabinParts(segments: number): GeometryPart[] {
  const driverX = REBEL_CRAWLER_DRIVER_X;
  return [
    // Techo partido y volcado hacia estribor. Entero y horizontal quedaba como
    // una tapa sana: además de no leerse roto, tapaba la cabina entera.
    {
      geometry: chamferBox(1.28, 0.12, 1.5, 0.045),
      position: [-0.52, 1.76, 0.86],
      rotation: [0.16, 0.08, 0.52],
      tile: 0,
    },
    {
      geometry: chamferBox(0.66, 0.11, 1.34, 0.04),
      position: [0.42, 1.98, 0.92],
      rotation: [0.1, 0.06, -0.34],
      tile: 0,
    },
    {
      geometry: chamferBox(0.72, 0.1, 0.6, 0.035),
      position: [-1.16, 1.28, 1.5],
      rotation: [0.34, 0.28, 0.86],
      tile: 0,
    },
    // Montantes: los de babor doblados, los de estribor cortados al ras.
    createTubePart([0.83, 1.14, 1.58], [0.72, 1.72, 1.5], 0.07, segments, 2),
    createTubePart([0.88, 1.12, 0.18], [0.7, 1.78, 0.26], 0.07, segments, 2),
    createTubePart([-0.83, 1.14, 1.56], [-0.86, 1.4, 1.54], 0.07, segments, 2),
    {
      geometry: new TorusGeometry(0.068, 0.018, 5, segments),
      position: [-0.86, 1.41, 1.54],
      rotation: [Math.PI / 2 + 0.1, 0, 0],
      tile: 2,
    },
    createTubePart([-0.88, 1.12, 0.18], [-0.9, 1.46, 0.22], 0.07, segments, 2),
    {
      geometry: new TorusGeometry(0.068, 0.018, 5, segments),
      position: [-0.9, 1.47, 0.22],
      rotation: [Math.PI / 2 - 0.08, 0, 0],
      tile: 2,
    },
    // Arco de supervivencia aplastado hacia proa.
    createTubePart([0.88, 1.08, 0.08], [0.84, 1.86, 0.2], 0.05, segments, 2),
    createTubePart([0.84, 1.86, 0.2], [-0.2, 1.98, 0.36], 0.05, segments, 2),
    createTubePart([-0.2, 1.98, 0.36], [-0.86, 1.7, 0.3], 0.05, segments, 2),
    // Media puerta: una colgando de la bisagra y la otra arrancada.
    {
      geometry: chamferBox(0.08, 0.56, 1.06, 0.02),
      position: [0.96, 1.24, 0.94],
      rotation: [0.04, 0.16, -0.3],
      tile: 0,
    },
    // Tablero volcado y volante torcido.
    {
      geometry: chamferBox(1.44, 0.19, 0.22, 0.04),
      position: [0.04, 1.44, 1.4],
      rotation: [-0.5, 0.04, -0.08],
      tile: 2,
    },
    ...groupParts(steeringWheelParts([0, 0, 0], 0.19, segments, 2), {
      position: [driverX, 1.44, 1.12],
      rotation: [1.02, 0.2, 0.36],
    }),
    // Butacas: la del conductor con el respaldo vencido, la del acompañante
    // arrancada del piso.
    {
      geometry: chamferBox(0.5, 0.16, 0.55, 0.035),
      position: [driverX, 1.16, 0.72],
      rotation: [0.06, 0.04, -0.06],
      tile: 3,
    },
    {
      geometry: chamferBox(0.5, 0.64, 0.13, 0.035),
      position: [driverX - 0.02, 1.32, 0.36],
      rotation: [-0.78, 0.05, -0.08],
      tile: 3,
    },
    {
      geometry: chamferBox(0.5, 0.15, 0.54, 0.035),
      position: [-0.62, 1.14, 0.5],
      rotation: [0.24, -0.36, 0.3],
      tile: 3,
    },
    {
      geometry: chamferBox(0.48, 0.6, 0.13, 0.035),
      position: [-0.68, 1.32, 0.16],
      rotation: [-0.5, -0.3, 0.42],
      tile: 3,
    },
  ];
}

/** Diésel al descubierto entre la cabina y la plataforma. */
function wreckedCrawlerEngineParts(segments: number): GeometryPart[] {
  return [
    {
      geometry: roundedBox(1.22, 0.6, 0.9, 0.08, 2),
      position: [0.02, 1.38, -0.58],
      rotation: [0.1, 0.05, -0.09],
      tile: 2,
    },
    ...ribParts([0.02, 1.7, -0.58], [1, 0, 0], 5, 0.21, [0.11, 0.07, 0.7], 2),
    ...[-0.36, -0.12, 0.12, 0.36].map((x) => ({
      geometry: new CylinderGeometry(0.055, 0.07, 0.18, 10),
      position: [0.02 + x, 1.8, -0.42] as Vec3,
      rotation: [0.12, 0, -0.06] as Euler,
      tile: 1 as AtlasTile,
    })),
    // Escape partido, con la boca del caño a la vista.
    createTubePart([0.46, 1.3, -0.74], [0.66, 1.82, -1.0], 0.055, segments, 2),
    {
      geometry: new TorusGeometry(0.055, 0.015, 5, segments),
      position: [0.665, 1.83, -1.01],
      rotation: [1.1, 0.3, 0],
      tile: 2,
    },
    // Radiador reventado y mangueras sueltas.
    {
      geometry: chamferBox(0.66, 0.5, 0.1, 0.03),
      position: [-0.02, 1.42, 0.02],
      rotation: [0.3, 0.06, 0.12],
      tile: 1,
    },
    createTubePart([-0.4, 1.28, -0.3], [0.2, 1.1, -0.06], 0.026, 6, 1),
    createTubePart([0.34, 1.24, -0.2], [-0.3, 1.02, 0.02], 0.024, 6, 1),
  ];
}

/** Carga y herrajes que salieron despedidos. */
function wreckedCrawlerDebrisParts(segments: number): GeometryPart[] {
  const ground = CRAWLER_WRECK_GROUND;
  return [
    // Defensa y cabrestante arrancados de la trompa.
    createTubePart(
      [-0.6, ground + 0.07, 2.86],
      [1.32, ground + 0.09, 2.46],
      0.065,
      12,
      2,
    ),
    {
      geometry: new CylinderGeometry(0.18, 0.18, 0.5, 14),
      position: [0.42, ground + 0.19, 2.62],
      rotation: [0.1, 0.22, Math.PI / 2 - 0.12],
      tile: 2,
    },
    // Cable desenrollado del tambor.
    createTubePart(
      [0.2, ground + 0.05, 2.5],
      [-0.68, ground + 0.06, 2.18],
      0.022,
      6,
      1,
    ),
    // Bidón, batería y caja de herramientas volcados desde la plataforma.
    {
      geometry: chamferBox(0.48, 0.42, 0.34, 0.035),
      position: [-1.28, ground + 0.2, -2.02],
      rotation: [0.34, 0.4, 1.28],
      tile: 1,
    },
    {
      geometry: chamferBox(0.52, 0.34, 0.4, 0.035),
      position: [1.36, ground + 0.19, -2.24],
      rotation: [1.32, 0.2, 0.24],
      tile: 0,
    },
    {
      geometry: chamferBox(0.26, 0.24, 0.22, 0.025),
      position: [0.62, ground + 0.13, -2.72],
      rotation: [0.2, -0.4, 0.3],
      tile: 2,
    },
    // Barras del rack de carga, sueltas sobre el terreno.
    createTubePart(
      [-0.86, ground + 0.05, -2.56],
      [0.9, ground + 0.06, -2.9],
      0.045,
      segments,
      2,
    ),
    createTubePart(
      [1.62, ground + 0.05, -0.9],
      [1.9, ground + 0.06, 0.72],
      0.045,
      segments,
      2,
    ),
    // Faros reventados, silenciador arrancado y chapa de reparación suelta.
    {
      geometry: new CylinderGeometry(0.12, 0.12, 0.12, 14),
      position: [0.92, ground + 0.12, 2.14],
      rotation: [1.4, 0.3, 0.2],
      tile: 2,
    },
    {
      geometry: new CylinderGeometry(0.09, 0.12, 0.34, 10),
      position: [1.26, ground + 0.12, -1.42],
      rotation: [1.36, 0.4, 0.2],
      tile: 3,
    },
    {
      geometry: panel(0.06, 0.5, 0.9),
      position: [-1.86, ground + 0.14, 0.6],
      rotation: [0.16, 0.3, 1.5],
      tile: 1,
    },
    {
      geometry: chamferBox(0.8, 0.07, 0.72, 0.03),
      position: [1.62, ground + 0.13, 1.5],
      rotation: [0.14, -0.44, 0.16],
      tile: 0,
    },
    // Zapatas sueltas de la banda que se salió.
    ...[
      [0.9, 2.9, 0.4],
      [-2.16, 0.34, 1.1],
      [1.86, -1.86, 2.2],
    ].map(([x, z, yaw]) => ({
      geometry: chamferBox(0.42, 0.1, 0.3, 0.018),
      position: [x!, ground + 0.05, z!] as Vec3,
      rotation: [0.06, yaw!, 0.1] as Euler,
      tile: 3 as AtlasTile,
    })),
  ];
}

/** Parabrisas reventado: astillas en el marco y en el piso. */
function wreckedCrawlerGlassParts(): GeometryPart[] {
  return [
    {
      geometry: chamferWedge({
        length: 0.62,
        height: 0.02,
        frontWidth: 0.1,
        rearWidth: 0.46,
        chamfer: 0.006,
      }),
      position: [0.42, 1.6, 1.5],
      rotation: [-0.42, 0.18, 0.26],
      tile: 0,
    },
    {
      geometry: chamferWedge({
        length: 0.46,
        height: 0.02,
        frontWidth: 0.08,
        rearWidth: 0.34,
        chamfer: 0.006,
      }),
      position: [-0.5, 1.5, 1.56],
      rotation: [-0.3, -0.36, -0.2],
      tile: 0,
    },
    // Astilla caída sobre la trompa hundida.
    {
      geometry: chamferWedge({
        length: 0.4,
        height: 0.018,
        frontWidth: 0.07,
        rearWidth: 0.3,
        chamfer: 0.006,
      }),
      position: [0.62, 1.24, 1.86],
      rotation: [-0.24, 0.7, 0.12],
      tile: 0,
    },
  ];
}

function buildRebelCrawler(context: BuildContext): void {
  const glassMaterial = createGlassMaterial(context.document, context.spec);
  for (const lod of [0, 1, 2] as const) {
    const root = createNode(context, context.sceneRoot, `visual_lod${lod}`, {
      extras: {
        kind: "vehicle-lod",
        lod,
        hiddenByDefault: lod !== 0,
        screenCoverage: lod === 0 ? 0.3 : lod === 1 ? 0.1 : 0,
      },
    });
    buildRebelCrawlerLod(context, root, lod, glassMaterial);
  }

  createAnchor(
    context,
    "seat_driver",
    [REBEL_CRAWLER_DRIVER_X, 1.45, 0.78],
    "seat",
    { role: "driver" },
  );
  createAnchor(context, "seat_passenger", [-0.48, 1.45, 0.78], "seat", {
    role: "passenger",
  });
  createAnchor(
    context,
    "camera_driver",
    [REBEL_CRAWLER_DRIVER_X, 1.86, 0.82],
    "camera",
    { role: "driver", fov: 74 },
    true,
  );
  createAnchor(
    context,
    "camera_passenger",
    [-0.48, 1.86, 0.82],
    "camera",
    { role: "passenger", fov: 76 },
    true,
  );
  createAnchor(context, "exit_left", [1.72, 0.72, 0.55], "exit", {
    seats: ["seat_driver", "seat_passenger"],
  });
  createAnchor(context, "exit_right", [-1.72, 0.72, 0.55], "exit", {
    seats: ["seat_driver", "seat_passenger"],
  });
  createAnchor(context, "audio_engine", [0, 1.42, -0.55], "audio", {
    layer: "engine",
  });
  createAnchor(context, "audio_transmission", [0, 0.68, 0], "audio", {
    layer: "transmission",
  });
  createAnchor(context, "damage_engine", [0, 1.42, -0.55], "damage", {
    component: "engine",
    halfExtents: [0.68, 0.48, 0.58],
  });
  createAnchor(
    context,
    "damage_steering",
    [REBEL_CRAWLER_DRIVER_X, 1.48, 1.12],
    "damage",
    { component: "steering", halfExtents: [0.34, 0.36, 0.4] },
  );
  createAnchor(context, "damage_fuel", [-0.58, 1.36, -1.68], "damage", {
    component: "fuel",
    halfExtents: [0.32, 0.32, 0.3],
  });
  const wreckage = createNode(context, context.sceneRoot, "wreckage", {
    extras: { kind: "wreckage", hiddenByDefault: true },
  });
  createVisualNode(
    context,
    wreckage,
    "wreckage_crawler_hull",
    wreckedCrawlerHullParts(12),
    { position: CRAWLER_WRECK_POSITION, rotation: CRAWLER_WRECK_ROTATION },
  );
  createVisualNode(context, wreckage, "wreckage_cabin", wreckedCrawlerCabinParts(12), {
    position: CRAWLER_WRECK_POSITION,
    rotation: CRAWLER_WRECK_ROTATION,
  });
  createVisualNode(context, wreckage, "wreckage_engine", wreckedCrawlerEngineParts(12), {
    position: CRAWLER_WRECK_POSITION,
    rotation: CRAWLER_WRECK_ROTATION,
  });
  createVisualNode(
    context,
    wreckage,
    "wreckage_tracks",
    wreckedCrawlerRunningGearParts(12),
    { position: CRAWLER_WRECK_POSITION, rotation: CRAWLER_WRECK_ROTATION },
  );
  // La banda desenrollada apoya en el terreno, así que queda fuera de la escora.
  createVisualNode(
    context,
    wreckage,
    "wreckage_thrown_track",
    wreckedCrawlerThrownTrackParts(10),
  );
  createVisualNode(context, wreckage, "wreckage_debris", wreckedCrawlerDebrisParts(10));
  createVisualNode(context, wreckage, "wreckage_glass", wreckedCrawlerGlassParts(), {
    position: CRAWLER_WRECK_POSITION,
    rotation: CRAWLER_WRECK_ROTATION,
    material: glassMaterial,
    bakeOcclusion: false,
    extras: { kind: "glazing" },
  });
}

function buildCombineGliderLod(
  context: BuildContext,
  root: Node,
  lod: 0 | 1 | 2,
  energyMaterial: Material,
  glassMaterial: Material,
): void {
  const suffix = lod === 0 ? "" : `_lod${lod}`;
  const detailed = lod === 0;
  const segments = lod === 0 ? 18 : lod === 1 ? 10 : 6;
  const { halfWidth, deckY, coreY, coreZ } = COMBINE_GLIDER;
  const bodyParts: GeometryPart[] = [
    // Vientre facetado y proa de reconocimiento: bajo, ancho atrás y afilado
    // hacia adelante, a medio camino entre una cápsula y un hunter pequeño.
    {
      geometry: chamferWedge({
        length: 3.22,
        height: 0.5,
        frontWidth: 0.72,
        rearWidth: 1.72,
        topFrontWidth: 1.38,
        topRearWidth: 2.02,
        chamfer: 0.07,
      }),
      position: [0, 0.48, 0],
      rotation: [-0.025, 0, 0],
      tile: 0,
    },
    {
      geometry: chamferWedge({
        length: 1.38,
        height: 0.32,
        frontWidth: 0.38,
        rearWidth: 1.36,
        topFrontWidth: 0.64,
        topRearWidth: 1.56,
        chamfer: 0.045,
      }),
      position: [0, 0.76, 1.12],
      rotation: [-0.08, 0, 0],
      tile: 1,
    },
    // Brazos laterales que abrazan los estabilizadores de popa.
    {
      geometry: chamferWedge({
        length: 1.7,
        height: 0.3,
        frontWidth: 0.28,
        rearWidth: 0.42,
        topFrontWidth: 0.34,
        topRearWidth: 0.5,
        chamfer: 0.04,
      }),
      position: [-0.82, 0.58, -0.76],
      rotation: [0.02, -0.08, 0.03],
      tile: 0,
    },
    {
      geometry: chamferWedge({
        length: 1.7,
        height: 0.3,
        frontWidth: 0.28,
        rearWidth: 0.42,
        topFrontWidth: 0.34,
        topRearWidth: 0.5,
        chamfer: 0.04,
      }),
      position: [0.82, 0.58, -0.76],
      rotation: [0.02, 0.08, -0.03],
      tile: 0,
    },
    // Borde cerámico y defensa ventral.
    { geometry: panel(1.42, 0.22, 0.05), position: [0, 0.7, 1.55], rotation: [-0.25, 0, 0], tile: 1 },
    { geometry: chamferBox(1.54, 0.12, 0.28, 0.035), position: [0, 0.26, -1.35], tile: 2 },
    // Cubeta del piloto y carenado del núcleo.
    { geometry: roundedBox(1.18, 0.42, 1.22, 0.12, detailed ? 3 : 1), position: [0, 0.92, 0.18], tile: 3 },
    { geometry: roundedBox(1.28, 0.56, 0.92, 0.12, detailed ? 3 : 1), position: [0, 0.92, -1.03], tile: 0 },
    { geometry: new TorusGeometry(0.48, 0.075, 7, segments), position: [0, coreY, coreZ], tile: 2 },
  ];

  if (lod < 2) {
    bodyParts.push(
      // Costillas biomécanicas: la asimetría leve evita que parezca un vehículo
      // humano pintado de azul.
      createTubePart([-0.64, 0.5, 1.24], [-0.92, 0.82, -0.58], 0.055, segments, 2),
      createTubePart([0.58, 0.48, 1.28], [0.88, 0.78, -0.72], 0.047, segments, 2),
      createTubePart([-0.9, 0.62, -0.62], [-0.68, 0.72, -1.52], 0.05, segments, 2),
      createTubePart([0.88, 0.6, -0.72], [0.68, 0.72, -1.52], 0.05, segments, 2),
      { geometry: panel(0.48, 0.42, 0.045), position: [-0.74, 0.9, 0.5], rotation: [0.08, 0.22, -0.1], tile: 1 },
      { geometry: panel(0.42, 0.38, 0.045), position: [0.72, 0.86, 0.42], rotation: [0.06, -0.18, 0.08], tile: 0 },
      // Consola suspendida y apoyos del asiento.
      { geometry: chamferBox(0.72, 0.16, 0.28, 0.045), position: [0, 1.08, 0.66], rotation: [-0.22, 0, 0], tile: 2 },
      createTubePart([-0.34, 0.72, -0.2], [-0.28, 1.0, 0.15], 0.032, 8, 2),
      createTubePart([0.34, 0.72, -0.2], [0.28, 1.0, 0.15], 0.032, 8, 2),
    );
  }

  if (detailed) {
    bodyParts.push(
      // Asiento encastrado, controles laterales y batería Combine.
      { geometry: chamferBox(0.56, 0.14, 0.58, 0.04), position: [0, 0.82, -0.08], tile: 3 },
      { geometry: chamferBox(0.56, 0.7, 0.14, 0.04), position: [0, 1.15, -0.38], rotation: [-0.18, 0, 0], tile: 3 },
      { geometry: chamferBox(0.16, 0.18, 0.48, 0.035), position: [-0.43, 1.02, 0.02], tile: 2 },
      { geometry: chamferBox(0.16, 0.18, 0.48, 0.035), position: [0.43, 1.02, 0.02], tile: 2 },
      createTubePart([-0.43, 1.08, 0.18], [-0.5, 1.24, 0.28], 0.028, 8, 2),
      createTubePart([0.43, 1.08, 0.18], [0.5, 1.24, 0.28], 0.028, 8, 2),
      { geometry: roundedBox(0.58, 0.34, 0.48, 0.07, 3), position: [0, 0.76, -1.15], tile: 2 },
      ...ribParts([0, 1.13, -1.08], [1, 0, 0], 4, 0.2, [0.08, 0.05, 0.48], 2),
      // Sensores y placas desparejas de campo.
      { geometry: new SphereGeometry(0.11, 12, 8), position: [0, 0.9, 1.54], scale: [1.25, 0.78, 0.65], tile: 1 },
      { geometry: new SphereGeometry(0.075, 10, 7), position: [-0.32, 0.84, 1.42], tile: 2 },
      { geometry: new SphereGeometry(0.06, 10, 7), position: [0.38, 0.82, 1.38], tile: 2 },
      { geometry: rivetRow([-0.64, 0.74, 1.18], [-0.86, 0.7, -0.72], 10, 0.015, "x"), tile: 2 },
      { geometry: rivetRow([0.58, 0.72, 1.16], [0.82, 0.68, -0.82], 10, 0.015, "x"), tile: 2 },
    );
  }

  createVisualNode(context, root, `combineGlider_body${suffix}`, bodyParts);

  if (lod < 2) {
    createVisualNode(
      context,
      root,
      `combineGlider_windscreen${suffix}`,
      [
        {
          geometry: new BoxGeometry(1.02, 0.48, 0.035),
          position: [0, 1.29, 0.52],
          rotation: [-0.48, 0, 0],
          tile: 0,
        },
      ],
      { material: glassMaterial, bakeOcclusion: false },
    );
  }

  // Giroscopio central: tres radios hacen visible la rotación en runtime.
  const coreParts: GeometryPart[] = [
    { geometry: new TorusGeometry(0.34, 0.055, 7, segments), tile: 0 },
    { geometry: new SphereGeometry(0.13, segments, Math.max(6, segments / 2)), tile: 0 },
  ];
  for (let index = 0; index < 3; index += 1) {
    const angle = (index / 3) * Math.PI * 2;
    coreParts.push({
      geometry: chamferBox(0.07, 0.45, 0.035, 0.012),
      position: [Math.cos(angle) * 0.14, Math.sin(angle) * 0.14, 0],
      rotation: [0, 0, angle],
      tile: 0,
    });
  }
  createVisualNode(
    context,
    root,
    `fan_main${suffix}`,
    coreParts,
    {
      position: [0, coreY, coreZ - 0.5],
      material: energyMaterial,
      bakeOcclusion: false,
      extras: { kind: "antigravity-core" },
    },
  );

  const stabilizers = [
    ["stabilizer_front", [0, 0.24, 1.35]],
    ["stabilizer_rear_left", [-0.78, 0.24, -0.92]],
    ["stabilizer_rear_right", [0.78, 0.24, -0.92]],
  ] as const;
  for (const [name, position] of stabilizers) {
    createVisualNode(
      context,
      root,
      `${name}${suffix}`,
      [
        { geometry: new TorusGeometry(0.22, 0.045, 6, segments), rotation: [Math.PI / 2, 0, 0], tile: 0 },
        { geometry: new CylinderGeometry(0.08, 0.12, 0.08, segments), tile: 0 },
      ],
      {
        position,
        material: energyMaterial,
        bakeOcclusion: false,
        extras: { kind: "hover-stabilizer" },
      },
    );
  }

  for (const [name, x] of [["rudder_left", -halfWidth], ["rudder_right", halfWidth]] as const) {
    createVisualNode(
      context,
      root,
      `${name}${suffix}`,
      [
        {
          geometry: chamferWedge({
            length: 0.64,
            height: 0.42,
            frontWidth: 0.08,
            rearWidth: 0.2,
            topFrontWidth: 0.05,
            topRearWidth: 0.14,
            chamfer: 0.025,
          }),
          tile: 1,
        },
      ],
      {
        position: [x * 0.82, deckY + 0.16, -1.28],
        extras: { kind: "control-fin" },
      },
    );
  }
}

function buildCombineGlider(context: BuildContext): void {
  const energyMaterial = createCombineEnergyMaterial(
    context.document,
    context.spec,
  );
  const glassMaterial = createGlassMaterial(context.document, context.spec);
  for (const lod of [0, 1, 2] as const) {
    const root = createNode(context, context.sceneRoot, `visual_lod${lod}`, {
      extras: {
        kind: "vehicle-lod",
        lod,
        hiddenByDefault: lod !== 0,
        screenCoverage: lod === 0 ? 0.3 : lod === 1 ? 0.1 : 0,
      },
    });
    buildCombineGliderLod(
      context,
      root,
      lod,
      energyMaterial,
      glassMaterial,
    );
  }

  createAnchor(context, "seat_driver", [0, 0.98, -0.08], "seat", {
    role: "driver",
  });
  createAnchor(
    context,
    "camera_driver",
    [0, 1.5, 0.02],
    "camera",
    { role: "driver", fov: 78 },
    true,
  );
  createAnchor(context, "exit_left", [-1.48, 0.52, -0.05], "exit", {
    seat: "seat_driver",
  });
  createAnchor(context, "exit_right", [1.48, 0.52, -0.05], "exit", {
    seat: "seat_driver",
  });
  createAnchor(context, "audio_engine", [0, COMBINE_GLIDER.coreY, -1.08], "audio", {
    layer: "engine",
  });
  createAnchor(context, "audio_hover", [0, 0.24, 0], "audio", {
    layer: "hover",
  });
  createAnchor(context, "damage_engine", [0, 0.9, -1.05], "damage", {
    component: "engine",
    halfExtents: [0.64, 0.36, 0.46],
  });
  createAnchor(context, "damage_hull", [0, 0.52, 0.12], "damage", {
    component: "hull",
    halfExtents: [1.05, 0.4, 1.55],
  });
  createAnchor(context, "damage_steering", [0, 1.08, 0.5], "damage", {
    component: "steering",
    halfExtents: [0.42, 0.3, 0.34],
  });
  createAnchor(context, "damage_fuel", [0, 0.72, -0.72], "damage", {
    component: "fuel",
    halfExtents: [0.38, 0.28, 0.36],
  });
  const wreckage = createNode(context, context.sceneRoot, "wreckage", {
    extras: { kind: "wreckage", hiddenByDefault: true },
  });
  createVisualNode(context, wreckage, "wreckage_combine_glider", [
    {
      geometry: chamferWedge({
        length: 2.8,
        height: 0.44,
        frontWidth: 0.58,
        rearWidth: 1.6,
        topFrontWidth: 1.1,
        topRearWidth: 1.82,
        chamfer: 0.06,
      }),
      rotation: [0.14, 0.12, -0.18],
      tile: 3,
    },
    {
      geometry: new TorusGeometry(0.38, 0.07, 7, 12),
      position: [0.72, 0.18, -0.88],
      rotation: [0.32, 0.2, 0.5],
      tile: 2,
    },
  ]);
}

/**
 * Contorno del cuerpo: secciones de popa a proa. El rombo de la manta sale de
 * cómo crece y decrece el semiancho, y el canto afilado del ala sale solo,
 * porque la altura de cada sección se anula en el borde.
 */
const COMBINE_SWIMMER_SECTIONS: readonly LoftSection[] = [
  { z: -1.94, halfWidth: 0, top: 0, bottom: 0 },
  { z: -1.68, halfWidth: 0.07, top: 0.05, bottom: 0.04, y: 0.56 },
  { z: -1.34, halfWidth: 0.14, top: 0.09, bottom: 0.07, y: 0.56 },
  { z: -1.06, halfWidth: 0.3, top: 0.14, bottom: 0.1, y: 0.55 },
  { z: -0.78, halfWidth: 0.6, top: 0.18, bottom: 0.13, y: 0.54 },
  { z: -0.5, halfWidth: 0.9, top: 0.21, bottom: 0.15, y: 0.53 },
  { z: -0.22, halfWidth: 1.08, top: 0.23, bottom: 0.17, y: 0.53 },
  { z: 0.16, halfWidth: 0.96, top: 0.26, bottom: 0.18, y: 0.53 },
  { z: 0.56, halfWidth: 0.78, top: 0.26, bottom: 0.17, y: 0.53 },
  { z: 0.96, halfWidth: 0.57, top: 0.23, bottom: 0.15, y: 0.52 },
  { z: 1.3, halfWidth: 0.37, top: 0.18, bottom: 0.11, y: 0.5 },
  { z: 1.54, halfWidth: 0.2, top: 0.13, bottom: 0.07, y: 0.48 },
  { z: 1.7, halfWidth: 0, top: 0, bottom: 0 },
];

/**
 * Exponente de la sección. En 1 es una elipse limpia, que es lo que hace que el
 * canto del ala termine en filo; por debajo se llena hacia el rectángulo y el
 * bicho entero se lee como un tubo.
 */
const COMBINE_SWIMMER_SECTION_SHAPE = 1.05;

function buildCombineSwimmerLod(
  context: BuildContext,
  root: Node,
  lod: 0 | 1 | 2,
  energyMaterial: Material,
  glassMaterial: Material,
): void {
  const suffix = lod === 0 ? "" : `_lod${lod}`;
  const detailed = lod === 0;
  const segments = lod === 0 ? 18 : lod === 1 ? 10 : 6;
  const { noseZ, bellyY, graftY, graftZ } = COMBINE_SWIMMER;
  const bodyParts: GeometryPart[] = [
    // Cuerpo entero en una sola superficie interpolada: disco pectoral, lomo y
    // cola salen de la misma piel, sin juntas ni facetas. Armado con cuñas y
    // cajas —aunque el contorno en planta fuera el correcto— el bicho se leía
    // siempre como un casco facetado.
    {
      geometry: loftedBody(
        COMBINE_SWIMMER_SECTIONS,
        detailed ? 26 : lod === 1 ? 16 : 10,
        COMBINE_SWIMMER_SECTION_SHAPE,
      ),
      tile: 0,
    },
    // Lomo: el bulto sobre el que va atado el arnés.
    {
      geometry: new SphereGeometry(0.5, segments, Math.max(6, segments / 2)),
      position: [0, 0.63, 0.16],
      scale: [0.86, 0.34, 1.7],
      tile: 0,
    },
    // Panza clara: la misma piel, apenas encogida y hundida, recortada contra
    // el lomo oscuro. Es la señal de que es un bicho de agua.
    {
      geometry: loftedBody(
        COMBINE_SWIMMER_SECTIONS.map((section) => ({
          ...section,
          halfWidth: section.halfWidth * 0.96,
          top: section.top * 0.12,
          bottom: section.bottom * 0.99,
          y: (section.y ?? 0) - 0.012,
        })),
        detailed ? 26 : lod === 1 ? 16 : 10,
        COMBINE_SWIMMER_SECTION_SHAPE,
      ),
      tile: 1,
    },
    // Hocico entre los lóbulos, con el reborde de la boca.
    {
      geometry: new SphereGeometry(0.5, segments, Math.max(6, segments / 2)),
      position: [0, 0.47, 1.4],
      scale: [0.72, 0.28, 0.6],
      rotation: [0.14, 0, 0],
      tile: 0,
    },
    // Lóbulos cefálicos: los dos cuernos de la raya, separados por el vano de
    // la boca. Sin ellos el frente es un borde de ataque y la criatura se lee
    // como un ala suelta.
    ...[-1, 1].map((side) => ({
      geometry: new SphereGeometry(0.5, segments, Math.max(6, segments / 2)),
      position: [side * 0.26, 0.52, noseZ + 0.06] as Vec3,
      scale: [0.19, 0.15, 0.46],
      rotation: [0.26, side * 0.34, 0] as Euler,
      tile: 0 as AtlasTile,
    })),
    // Boca ventral abierta, con el reborde de cartílago.
    { geometry: chamferBox(0.94, 0.13, 0.22, 0.03), position: [0, 0.38, 1.34], rotation: [0.1, 0, 0], tile: 3 },
    { geometry: chamferBox(1.0, 0.07, 0.1, 0.02), position: [0, 0.32, 1.44], rotation: [0.2, 0, 0], tile: 1 },
    // Cola: dos tramos que se afinan y el látigo.
    {
      geometry: chamferWedge({
        length: 0.72,
        height: 0.34,
        frontWidth: 0.52,
        rearWidth: 0.34,
        topFrontWidth: 0.46,
        topRearWidth: 0.28,
        chamfer: 0.04,
      }),
      position: [0, 0.58, -1.16],
      tile: 0,
    },
    {
      geometry: chamferWedge({
        length: 0.62,
        height: 0.22,
        frontWidth: 0.3,
        rearWidth: 0.15,
        topFrontWidth: 0.26,
        topRearWidth: 0.12,
        chamfer: 0.03,
      }),
      position: [0, 0.56, -1.58],
      rotation: [0.07, 0, 0],
      tile: 0,
    },
    // Collar del injerto: donde termina la carne y arranca el implante.
    { geometry: new TorusGeometry(0.3, 0.07, 7, segments), position: [0, graftY, graftZ + 0.1], tile: 2 },
    { geometry: new CylinderGeometry(0.28, 0.33, 0.16, segments), position: [0, graftY, graftZ + 0.22], rotation: [Math.PI / 2, 0, 0], tile: 2 },
    // Visera del sensor: la placa que le encajaron sobre la frente, con el
    // hueco oscuro del que sale la ranura luminosa.
    {
      geometry: chamferWedge({
        length: 0.46,
        height: 0.12,
        frontWidth: 0.94,
        rearWidth: 0.72,
        chamfer: 0.025,
      }),
      position: [0, 0.8, 1.36],
      rotation: [-0.42, 0, 0],
      tile: 2,
    },
    { geometry: chamferBox(0.9, 0.12, 0.16, 0.02), position: [0, 0.71, 1.4], rotation: [-0.46, 0, 0], tile: 3 },
  ];

  if (lod < 2) {
    bodyParts.push(
      // Placas Combine grapadas al lomo, por delante y por detrás del arnés.
      // Angostas a propósito: cubriendo el lomo entero, la maquinaria tapaba al
      // bicho desde arriba y volvía a ganar la lectura de vehículo.
      ...[0.86, 0.58, -0.64, -0.92].map((z, index) => ({
        geometry: chamferBox(0.34 - Math.abs(index - 1.5) * 0.04, 0.06, 0.24, 0.02),
        position: [0, 0.93 - Math.abs(z) * 0.05, z] as Vec3,
        rotation: [index % 2 === 0 ? 0.05 : -0.04, 0, 0.02] as Euler,
        tile: 2 as AtlasTile,
      })),
      // Arnés: montura de cuero sobre el lomo, respaldo y asideros. El asiento
      // del preset va a 0.98, así que la montura queda justo por debajo.
      { geometry: chamferBox(0.52, 0.1, 0.56, 0.04), position: [0, 0.86, -0.08], tile: 3 },
      { geometry: roundedBox(0.48, 0.3, 0.12, 0.05, detailed ? 2 : 1), position: [0, 0.98, -0.4], rotation: [-0.24, 0, 0], tile: 3 },
      // Cubrevientos del jinete: el visor se apoya acá. Suelto en el aire
      // parecía una lámina de vidrio flotando sobre el lomo.
      { geometry: chamferBox(0.5, 0.11, 0.16, 0.03), position: [0, 1.0, 0.52], rotation: [-0.4, 0, 0], tile: 2 },
      ...[-1, 1].map((side) => ({
        geometry: chamferBox(0.09, 0.19, 0.5, 0.025),
        position: [side * 0.35, 1.0, -0.02] as Vec3,
        tile: 2 as AtlasTile,
      })),
      // Cinchas que abrazan el cuerpo y cierran bajo el vientre.
      ...[-1, 1].flatMap((side) => [
        {
          geometry: chamferBox(0.09, 0.5, 0.22, 0.02),
          position: [side * 0.46, 0.66, -0.06] as Vec3,
          rotation: [0, 0, side * 0.24] as Euler,
          tile: 3 as AtlasTile,
        },
        {
          geometry: chamferBox(0.09, 0.42, 0.2, 0.02),
          position: [side * 0.44, 0.66, 0.62] as Vec3,
          rotation: [0, 0, side * 0.22] as Euler,
          tile: 3 as AtlasTile,
        },
      ]),
      // Conductos del injerto: bajan del sensor y recorren la columna hasta la
      // cola. Son el cable que ata las dos mitades de la criatura.
      createTubePart([-0.19, 0.93, 0.9], [-0.23, 0.83, -0.88], 0.034, segments, 2),
      createTubePart([0.19, 0.93, 0.9], [0.25, 0.83, -0.88], 0.031, segments, 2),
    );
  }

  if (detailed) {
    bodyParts.push(
      // Branquias a los dos costados del vientre.
      ...[-1, 1].flatMap((side) =>
        ribParts([side * 0.5, 0.44, 0.42], [0, 0, 1], 5, 0.17, [0.24, 0.13, 0.05], 3),
      ),
      // Espiráculos detrás de los ojos, con casquillo metálico.
      ...[-1, 1].flatMap((side) => [
        {
          geometry: new CylinderGeometry(0.07, 0.07, 0.06, 10),
          position: [side * 0.3, 0.87, 0.72] as Vec3,
          tile: 3 as AtlasTile,
        },
        {
          geometry: new TorusGeometry(0.075, 0.015, 5, 10),
          position: [side * 0.3, 0.89, 0.72] as Vec3,
          rotation: [Math.PI / 2, 0, 0] as Euler,
          tile: 2 as AtlasTile,
        },
      ]),
      // Grapas del blindaje: las que dicen que el metal está clavado en carne.
      { geometry: rivetRow([-0.3, 0.93, 0.86], [0.3, 0.93, 0.86], 6, 0.016), tile: 2 },
      { geometry: rivetRow([-0.28, 0.92, -0.9], [0.28, 0.92, -0.9], 6, 0.016), tile: 2 },
      { geometry: rivetRow([-0.26, 0.88, 1.06], [0.26, 0.88, 1.06], 5, 0.014), tile: 2 },
      // Costillas cartilaginosas marcadas bajo la piel del ala.
      ...[-1, 1].flatMap((side) => [
        createTubePart([side * 0.34, 0.62, 0.62], [side * 0.92, 0.5, -0.16], 0.03, 8, 0),
        createTubePart([side * 0.32, 0.6, 0.16], [side * 0.86, 0.48, -0.44], 0.027, 8, 0),
      ]),
      // Cicatrices de la reconversión: chapas desparejas sobre la carne.
      { geometry: panel(0.34, 0.28, 0.04), position: [-0.6, 0.66, 0.44], rotation: [0.1, 0.3, -0.14], tile: 2 },
      { geometry: panel(0.28, 0.24, 0.04), position: [0.66, 0.62, -0.3], rotation: [0.08, -0.24, 0.1], tile: 2 },
      // Látigo de la cola.
      {
        geometry: new CylinderGeometry(0.05, 0.018, 0.4, segments),
        position: [0, 0.56, -1.9],
        rotation: [Math.PI / 2 + 0.12, 0, 0],
        tile: 0,
      },
    );
  }

  createVisualNode(context, root, `combineSwimmer_body${suffix}`, bodyParts);

  if (lod < 2) {
    createVisualNode(
      context,
      root,
      `combineSwimmer_visor${suffix}`,
      [
        {
          geometry: new BoxGeometry(0.7, 0.3, 0.03),
          position: [0, 1.19, 0.48],
          rotation: [-0.42, 0, 0],
          tile: 0,
        },
      ],
      { material: glassMaterial, bakeOcclusion: false },
    );
    // Ojo Combine: una ranura ancha cruzada en la frente, no un punto. Es la
    // única fuente de luz del bicho y lo que lo marca como reconvertido en vez
    // de como fauna, así que tiene que leerse de lejos.
    createVisualNode(
      context,
      root,
      `combineSwimmer_eye${suffix}`,
      [
        {
          geometry: new SphereGeometry(0.1, segments, Math.max(5, segments / 2)),
          scale: [4.4, 0.62, 0.75],
          tile: 0,
        },
      ],
      {
        position: [0, 0.72, 1.42],
        rotation: [-0.46, 0, 0],
        material: energyMaterial,
        bakeOcclusion: false,
        extras: { kind: "sensor-eye" },
      },
    );
  }

  // Injerto de propulsión: ocupa el lugar del núcleo antigravedad del
  // deslizador y gira igual, porque el runtime anima este nodo por nombre.
  const graftParts: GeometryPart[] = [
    { geometry: new TorusGeometry(0.3, 0.05, 7, segments), tile: 0 },
    { geometry: new SphereGeometry(0.11, segments, Math.max(6, segments / 2)), tile: 0 },
  ];
  for (let index = 0; index < 3; index += 1) {
    const angle = (index / 3) * Math.PI * 2;
    graftParts.push({
      geometry: chamferBox(0.06, 0.4, 0.03, 0.01),
      position: [Math.cos(angle) * 0.12, Math.sin(angle) * 0.12, 0],
      rotation: [0, 0, angle],
      tile: 0,
    });
  }
  createVisualNode(context, root, `fan_main${suffix}`, graftParts, {
    position: [0, graftY, graftZ],
    material: energyMaterial,
    bakeOcclusion: false,
    extras: { kind: "antigravity-core" },
  });

  // Emisores de sustentación: mismas posiciones que en el deslizador, porque
  // salen de las sondas del motor. Acá van grapados al vientre.
  const stabilizers = [
    ["stabilizer_front", [0, 0.24, 1.35]],
    ["stabilizer_rear_left", [-0.78, 0.24, -0.92]],
    ["stabilizer_rear_right", [0.78, 0.24, -0.92]],
  ] as const;
  for (const [name, position] of stabilizers) {
    createVisualNode(
      context,
      root,
      `${name}${suffix}`,
      [
        { geometry: new TorusGeometry(0.2, 0.042, 6, segments), rotation: [Math.PI / 2, 0, 0], tile: 0 },
        { geometry: new CylinderGeometry(0.07, 0.11, 0.08, segments), tile: 0 },
      ],
      {
        position,
        material: energyMaterial,
        bakeOcclusion: false,
        extras: { kind: "hover-stabilizer" },
      },
    );
  }

  // Aletas caudales: son los timones del preset, así que guiñan con la
  // dirección. Van al costado de la cola, donde de verdad harían fuerza.
  for (const [name, side] of [["rudder_left", -1], ["rudder_right", 1]] as const) {
    createVisualNode(
      context,
      root,
      `${name}${suffix}`,
      [
        {
          geometry: chamferWedge({
            length: 0.66,
            height: 0.44,
            frontWidth: 0.16,
            rearWidth: 0.06,
            topFrontWidth: 0.1,
            topRearWidth: 0.04,
            chamfer: 0.025,
          }),
          rotation: [0.1, 0, side * 0.22],
          tile: 0,
        },
      ],
      {
        position: [side * 0.34, 0.62, -1.46],
        extras: { kind: "control-fin" },
      },
    );
  }
}

/**
 * Piso al que apoya el cadáver: fondo del collider del preset (centro 0.55,
 * alto 1.25). La criatura muerta se desploma sobre el vientre, así que casi
 * todo el volumen queda pegado a esa cota.
 */
const COMBINE_SWIMMER_WRECK_GROUND = -0.075;

/**
 * Cadáver desinflado. Una criatura muerta no se abolla como una chapa: se
 * aplasta, se le marcan las costillas bajo la piel y se le abren desgarros por
 * donde asoma el cartílago. Eso es lo que la separa de un casco roto.
 */
function wreckedCombineSwimmerCarcassParts(segments: number): GeometryPart[] {
  const ground = COMBINE_SWIMMER_WRECK_GROUND;
  return [
    // Cuerpo desplomado sobre el vientre, más chato y más ancho que en vida.
    {
      geometry: chamferWedge({
        length: 2.5,
        height: 0.34,
        frontWidth: 0.72,
        rearWidth: 1.02,
        topFrontWidth: 0.56,
        topRearWidth: 0.88,
        chamfer: 0.05,
      }),
      position: [0.04, ground + 0.24, 0.02],
      rotation: [0.03, 0.04, -0.05],
      tile: 0,
    },
    // Ala de babor extendida en el piso; la de estribor quedó plegada debajo
    // del cuerpo, que es de donde sale el bulto del costado.
    ...groupParts(
      [
        {
          geometry: chamferWedge({
            length: 0.82,
            height: 0.16,
            frontWidth: 1.5,
            rearWidth: 2.3,
            topFrontWidth: 1.2,
            topRearWidth: 1.98,
            chamfer: 0.035,
          }),
          rotation: [0, Math.PI / 2, 0],
          tile: 0,
        },
      ],
      { position: [0.66, ground + 0.13, -0.06], rotation: [0.02, 0, -0.06] },
    ),
    ...groupParts(
      [
        {
          geometry: chamferWedge({
            length: 0.54,
            height: 0.13,
            frontWidth: 0.5,
            rearWidth: 1.4,
            topFrontWidth: 0.4,
            topRearWidth: 1.15,
            chamfer: 0.03,
          }),
          rotation: [0, Math.PI / 2, 0],
          tile: 0,
        },
      ],
      { position: [1.28, ground + 0.1, -0.34], rotation: [0.06, 0.12, -0.3] },
    ),
    ...groupParts(
      [
        {
          geometry: chamferWedge({
            length: 0.6,
            height: 0.2,
            frontWidth: 1.2,
            rearWidth: 2.0,
            topFrontWidth: 0.96,
            topRearWidth: 1.7,
            chamfer: 0.035,
          }),
          rotation: [0, -Math.PI / 2, 0],
          tile: 0,
        },
      ],
      { position: [-0.6, ground + 0.16, -0.1], rotation: [0.04, 0, 0.34] },
    ),
    // Vientre pálido a la vista donde el ala plegada se dio vuelta.
    {
      geometry: chamferBox(0.66, 0.07, 1.1, 0.03),
      position: [-0.96, ground + 0.3, -0.18],
      rotation: [0.06, 0.14, 0.52],
      tile: 1,
    },
    // Cabeza de costado, con los lóbulos partidos.
    {
      geometry: chamferWedge({
        length: 0.6,
        height: 0.26,
        frontWidth: 0.5,
        rearWidth: 0.8,
        topFrontWidth: 0.4,
        topRearWidth: 0.68,
        chamfer: 0.04,
      }),
      position: [0.16, ground + 0.2, 1.26],
      rotation: [-0.12, 0.22, 0.16],
      tile: 0,
    },
    {
      geometry: chamferWedge({
        length: 0.5,
        height: 0.16,
        frontWidth: 0.1,
        rearWidth: 0.26,
        topFrontWidth: 0.08,
        topRearWidth: 0.22,
        chamfer: 0.025,
      }),
      position: [0.5, ground + 0.14, 1.6],
      rotation: [0.1, 0.6, 0.2],
      tile: 0,
    },
    // Boca abierta y reborde de cartílago colgando.
    { geometry: chamferBox(0.86, 0.14, 0.2, 0.03), position: [0.14, ground + 0.12, 1.5], rotation: [0.24, 0.2, 0.14], tile: 3 },
    // Desgarro en el lomo: cuadernas de cartílago y carne clara asomando.
    ...[-0.34, -0.06, 0.22, 0.5].map((z, index) => ({
      geometry: new CylinderGeometry(0.035, 0.028, 0.62 - index * 0.04, 8),
      position: [-0.04 + index * 0.03, ground + 0.36, z] as Vec3,
      rotation: [0.06, 0.04 * index, Math.PI / 2 + 0.12] as Euler,
      tile: 1 as AtlasTile,
    })),
    {
      geometry: chamferBox(0.5, 0.06, 0.84, 0.02),
      position: [-0.02, ground + 0.3, 0.1],
      rotation: [0.04, 0.06, 0.05],
      tile: 1,
    },
    // Colgajos de piel levantados en el borde del desgarro.
    {
      geometry: chamferBox(0.3, 0.05, 0.34, 0.015),
      position: [0.3, ground + 0.42, 0.24],
      rotation: [0.5, 0.3, -0.6],
      tile: 0,
    },
    {
      geometry: chamferBox(0.26, 0.05, 0.3, 0.015),
      position: [-0.34, ground + 0.4, -0.18],
      rotation: [-0.55, -0.24, 0.62],
      tile: 0,
    },
    // Cola tendida y retorcida.
    {
      geometry: chamferWedge({
        length: 0.74,
        height: 0.24,
        frontWidth: 0.5,
        rearWidth: 0.32,
        topFrontWidth: 0.44,
        topRearWidth: 0.26,
        chamfer: 0.035,
      }),
      position: [-0.12, ground + 0.16, -1.2],
      rotation: [0.04, 0.24, 0.1],
      tile: 0,
    },
    {
      geometry: chamferWedge({
        length: 0.66,
        height: 0.16,
        frontWidth: 0.28,
        rearWidth: 0.13,
        topFrontWidth: 0.24,
        topRearWidth: 0.1,
        chamfer: 0.025,
      }),
      position: [-0.4, ground + 0.11, -1.66],
      rotation: [0.06, 0.52, 0.14],
      tile: 0,
    },
    {
      geometry: new CylinderGeometry(0.045, 0.016, 0.42, segments),
      position: [-0.74, ground + 0.08, -1.92],
      rotation: [Math.PI / 2 + 0.1, 0.8, 0],
      tile: 0,
    },
    // Branquias abiertas sobre el flanco que quedó arriba.
    ...ribParts([0.5, ground + 0.3, 0.36], [0, 0, 1], 5, 0.16, [0.22, 0.11, 0.05], 3),
  ];
}

/** Injerto arrancado: el anillo salió de la carne y quedó colgando de la cola. */
function wreckedCombineSwimmerGraftParts(segments: number): GeometryPart[] {
  const ground = COMBINE_SWIMMER_WRECK_GROUND;
  return [
    // Collar del implante, todavía grapado al muñón.
    {
      geometry: new TorusGeometry(0.29, 0.065, 7, segments),
      position: [-0.14, ground + 0.24, -1.14],
      rotation: [0.24, 0.3, 0.4],
      tile: 2,
    },
    {
      geometry: new CylinderGeometry(0.26, 0.31, 0.15, segments),
      position: [-0.1, ground + 0.24, -1.0],
      rotation: [Math.PI / 2 + 0.2, 0.26, 0],
      tile: 2,
    },
    // Anillo del injerto, deformado y fuera de eje.
    {
      geometry: new TorusGeometry(0.3, 0.05, 7, segments, Math.PI * 1.5),
      position: [-0.66, ground + 0.2, -0.86],
      rotation: [1.2, 0.4, 0.5],
      scale: [1, 0.86, 1],
      tile: 2,
    },
    ...[0, 1].map((index) => ({
      geometry: chamferBox(0.05, 0.36, 0.03, 0.01),
      position: [-0.66, ground + 0.2, -0.86] as Vec3,
      rotation: [1.2, 0.4, 0.5 + index * 1.9] as Euler,
      tile: 2 as AtlasTile,
    })),
    // Grapas que lo sujetaban, arrancadas con carne.
    ...[-1, 1].map((side) => ({
      geometry: chamferBox(0.08, 0.06, 0.2, 0.02),
      position: [side * 0.22 - 0.12, ground + 0.34, -1.02] as Vec3,
      rotation: [0.3, side * 0.4, 0.2] as Euler,
      tile: 2 as AtlasTile,
    })),
    // Conductos reventados, todavía atados a la columna.
    createTubePart([-0.2, ground + 0.4, -0.72], [-0.56, ground + 0.24, -0.9], 0.032, 8, 2),
    createTubePart([0.16, ground + 0.38, -0.66], [-0.3, ground + 0.18, -1.3], 0.028, 8, 2),
    createTubePart([-0.02, ground + 0.42, 0.5], [-0.16, ground + 0.4, -0.6], 0.03, 8, 2),
  ];
}

/** Arnés y blindaje que se soltaron del lomo. */
function wreckedCombineSwimmerDebrisParts(segments: number): GeometryPart[] {
  const ground = COMBINE_SWIMMER_WRECK_GROUND;
  return [
    // Montura arrancada, boca abajo en el piso.
    {
      geometry: chamferBox(0.58, 0.11, 0.6, 0.04),
      position: [1.24, ground + 0.09, 0.78],
      rotation: [0.16, 0.4, 0.24],
      tile: 3,
    },
    {
      geometry: chamferBox(0.56, 0.44, 0.11, 0.04),
      position: [1.42, ground + 0.24, 0.5],
      rotation: [1.1, 0.36, 0.2],
      tile: 3,
    },
    ...[-1, 1].map((side) => ({
      geometry: chamferBox(0.08, 0.18, 0.46, 0.025),
      position: [1.2 + side * 0.16, ground + 0.14, 0.92] as Vec3,
      rotation: [0.14, 0.4, 0.3] as Euler,
      tile: 2 as AtlasTile,
    })),
    // Cinchas cortadas.
    {
      geometry: chamferBox(0.08, 0.06, 0.7, 0.02),
      position: [0.86, ground + 0.04, 1.36],
      rotation: [0.06, 0.9, 0.08],
      tile: 3,
    },
    // Placas del lomo, sueltas y dobladas.
    {
      geometry: chamferBox(0.56, 0.07, 0.3, 0.02),
      position: [-1.36, ground + 0.09, 0.62],
      rotation: [0.14, 0.5, 0.22],
      tile: 2,
    },
    {
      geometry: chamferBox(0.48, 0.06, 0.28, 0.02),
      position: [-1.02, ground + 0.06, 1.24],
      rotation: [0.1, -0.4, 0.16],
      tile: 2,
    },
    // Sensor de la frente, partido y apagado.
    {
      geometry: new SphereGeometry(0.15, segments, Math.max(6, segments / 2)),
      position: [0.72, ground + 0.14, 2.02],
      scale: [1.3, 0.66, 1.05],
      rotation: [0.4, 0.5, 0.9],
      tile: 2,
    },
    {
      geometry: chamferBox(0.5, 0.08, 0.42, 0.03),
      position: [0.5, ground + 0.08, 1.88],
      rotation: [0.12, 0.44, 0.18],
      tile: 2,
    },
    // Emisores de sustentación, arrancados del vientre.
    ...[
      [-1.5, -0.62],
      [1.02, -1.5],
    ].map(([x, z]) => ({
      geometry: new TorusGeometry(0.2, 0.042, 6, segments),
      position: [x!, ground + 0.06, z!] as Vec3,
      rotation: [Math.PI / 2 + 0.16, 0.3, 0] as Euler,
      tile: 2 as AtlasTile,
    })),
    // Punta de ala cercenada.
    ...groupParts(
      [
        {
          geometry: chamferWedge({
            length: 0.42,
            height: 0.11,
            frontWidth: 0.28,
            rearWidth: 0.86,
            topFrontWidth: 0.22,
            topRearWidth: 0.7,
            chamfer: 0.025,
          }),
          rotation: [0, Math.PI / 2, 0],
          tile: 0,
        },
      ],
      { position: [-1.58, ground + 0.07, -1.4], rotation: [0.08, 0.5, 0.16] },
    ),
    createTubePart(
      [0.4, ground + 0.04, -1.86],
      [1.16, ground + 0.05, -1.42],
      0.028,
      8,
      2,
    ),
  ];
}

/** Astillas del visor del jinete. */
function wreckedCombineSwimmerGlassParts(): GeometryPart[] {
  const ground = COMBINE_SWIMMER_WRECK_GROUND;
  return [
    {
      geometry: chamferWedge({
        length: 0.42,
        height: 0.018,
        frontWidth: 0.08,
        rearWidth: 0.3,
        chamfer: 0.006,
      }),
      position: [0.34, ground + 0.46, 0.36],
      rotation: [-0.3, 0.24, 0.3],
      tile: 0,
    },
    {
      geometry: chamferWedge({
        length: 0.34,
        height: 0.016,
        frontWidth: 0.06,
        rearWidth: 0.24,
        chamfer: 0.006,
      }),
      position: [1.06, ground + 0.03, 1.18],
      rotation: [0.06, 0.7, 0.08],
      tile: 0,
    },
  ];
}

function buildCombineSwimmer(context: BuildContext): void {
  const energyMaterial = createCombineEnergyMaterial(
    context.document,
    context.spec,
  );
  const glassMaterial = createGlassMaterial(context.document, context.spec);
  for (const lod of [0, 1, 2] as const) {
    const root = createNode(context, context.sceneRoot, `visual_lod${lod}`, {
      extras: {
        kind: "vehicle-lod",
        lod,
        hiddenByDefault: lod !== 0,
        screenCoverage: lod === 0 ? 0.3 : lod === 1 ? 0.1 : 0,
      },
    });
    buildCombineSwimmerLod(context, root, lod, energyMaterial, glassMaterial);
  }

  // Anclas idénticas a las del deslizador: comparten preset, así que el asiento,
  // la cámara y las salidas tienen que caer en el mismo lugar.
  createAnchor(context, "seat_driver", [0, 0.98, -0.08], "seat", {
    role: "driver",
  });
  createAnchor(
    context,
    "camera_driver",
    [0, 1.5, 0.02],
    "camera",
    { role: "driver", fov: 78 },
    true,
  );
  createAnchor(context, "exit_left", [-1.48, 0.52, -0.05], "exit", {
    seat: "seat_driver",
  });
  createAnchor(context, "exit_right", [1.48, 0.52, -0.05], "exit", {
    seat: "seat_driver",
  });
  createAnchor(context, "audio_engine", [0, COMBINE_SWIMMER.graftY, -1.08], "audio", {
    layer: "engine",
  });
  createAnchor(context, "audio_hover", [0, 0.24, 0], "audio", {
    layer: "hover",
  });
  createAnchor(context, "damage_engine", [0, 0.9, -1.05], "damage", {
    component: "engine",
    halfExtents: [0.64, 0.36, 0.46],
  });
  createAnchor(context, "damage_hull", [0, 0.52, 0.12], "damage", {
    component: "hull",
    halfExtents: [1.05, 0.4, 1.55],
  });
  createAnchor(context, "damage_steering", [0, 1.08, 0.5], "damage", {
    component: "steering",
    halfExtents: [0.42, 0.3, 0.34],
  });
  createAnchor(context, "damage_fuel", [0, 0.72, -0.72], "damage", {
    component: "fuel",
    halfExtents: [0.38, 0.28, 0.36],
  });

  const wreckage = createNode(context, context.sceneRoot, "wreckage", {
    extras: { kind: "wreckage", hiddenByDefault: true },
  });
  createVisualNode(
    context,
    wreckage,
    "wreckage_carcass",
    wreckedCombineSwimmerCarcassParts(12),
  );
  createVisualNode(
    context,
    wreckage,
    "wreckage_graft",
    wreckedCombineSwimmerGraftParts(12),
  );
  createVisualNode(
    context,
    wreckage,
    "wreckage_debris",
    wreckedCombineSwimmerDebrisParts(10),
  );
  createVisualNode(
    context,
    wreckage,
    "wreckage_glass",
    wreckedCombineSwimmerGlassParts(),
    {
      material: glassMaterial,
      bakeOcclusion: false,
      extras: { kind: "glazing" },
    },
  );
}

/**
 * Hélice de empuje: un solo rotor de popa, como el del hidrodeslizador de
 * Half-Life 2. El buje va largo porque es lo que se ve entre las palas cuando
 * el disco gira; sin él, a régimen el centro queda hueco.
 */
function createFanGeometry(segments: number, simplified: boolean): BufferGeometry {
  const hubRadius = 0.19;
  const tip = AIRBOAT_FAN.radius;
  const parts: GeometryPart[] = [
    {
      geometry: new CylinderGeometry(hubRadius, hubRadius * 0.82, 0.36, segments),
      rotation: [Math.PI / 2, 0, 0],
      tile: 2,
    },
    // Plato de bridas y cono de nariz.
    {
      geometry: new CylinderGeometry(0.3, 0.3, 0.055, segments),
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 0, -0.13],
      tile: 1,
    },
    {
      geometry: new SphereGeometry(0.17, segments, Math.max(4, segments / 2)),
      position: [0, 0, 0.2],
      scale: [1, 1, 1.5],
      tile: 2,
    },
  ];
  const blades = simplified ? 3 : 6;
  const bladeLength = tip - hubRadius;
  for (let index = 0; index < blades; index += 1) {
    const angle = (Math.PI * 2 * index) / blades;
    const radial: Vec3 = [
      Math.cos(angle + Math.PI / 2),
      Math.sin(angle + Math.PI / 2),
      0,
    ];
    // Pala con paso: torcida sobre su eje y afinada hacia la punta. El giro de
    // π/2 en X manda el +Z local hacia el buje, así que la cuerda ancha va en
    // `frontWidth`: al revés la pala sale afinada en la raíz y ancha en punta.
    // La punta va pintada aparte, y es lo que hace visible el disco: de un
    // solo tono oscuro la hélice se pierde contra los caños de la jaula.
    const split = hubRadius + bladeLength * 0.7;
    const splitChord = 0.3 - (0.3 - 0.17) * 0.7;
    parts.push(
      {
        geometry: chamferWedge({
          length: split - hubRadius,
          height: 0.055,
          frontWidth: 0.3,
          rearWidth: splitChord,
          chamfer: 0.016,
        }),
        position: [
          radial[0] * ((hubRadius + split) / 2),
          radial[1] * ((hubRadius + split) / 2),
          0,
        ],
        rotation: [Math.PI / 2, 0.38, angle],
        tile: 2,
      },
      {
        geometry: chamferWedge({
          length: tip - split,
          height: 0.055,
          frontWidth: splitChord,
          rearWidth: 0.17,
          chamfer: 0.016,
        }),
        position: [
          radial[0] * ((split + tip) / 2),
          radial[1] * ((split + tip) / 2),
          0,
        ],
        rotation: [Math.PI / 2, 0.38, angle],
        tile: 1,
      },
    );
    if (simplified) continue;
    parts.push(
      // Caña de raíz: la abrazadera que sujeta la pala al plato.
      {
        geometry: new CylinderGeometry(0.055, 0.055, 0.2, 8),
        position: [radial[0] * (hubRadius + 0.06), radial[1] * (hubRadius + 0.06), 0],
        rotation: [0, 0, angle],
        tile: 2,
      },
      {
        geometry: chamferBox(0.11, 0.11, 0.16, 0.02),
        position: [radial[0] * (hubRadius + 0.16), radial[1] * (hubRadius + 0.16), 0],
        rotation: [0, 0, angle],
        tile: 1,
      },
    );
  }
  return mergeParts(parts);
}

/**
 * Jaula del ventilador: aros concéntricos más radios en el plano del disco.
 * Los radios tienen que quedar EN el plano, no sobre el eje: una reja se lee
 * de frente, y salidos hacia adelante parecían púas clavadas en la popa.
 */
function fanCageParts(
  segments: number,
  detailed: boolean,
): GeometryPart[] {
  const { y, z, cageRadius } = AIRBOAT_FAN;
  const parts: GeometryPart[] = [];
  const ringDepths = detailed ? [0.3, 0.06, -0.24] : [0.04];
  for (const depth of ringDepths) {
    parts.push({
      geometry: new TorusGeometry(cageRadius, 0.042, 6, segments * 2),
      position: [0, y, z + depth],
      tile: 2,
    });
  }
  // Aro interior: sostiene los radios a media luz y hace leer la reja.
  if (detailed) {
    parts.push({
      geometry: new TorusGeometry(cageRadius * 0.54, 0.03, 5, segments * 2),
      position: [0, y, z + 0.3],
      tile: 2,
    });
  }
  const spokes = detailed ? 10 : 5;
  for (let index = 0; index < spokes; index += 1) {
    const angle = (index / spokes) * Math.PI;
    parts.push({
      geometry: new CylinderGeometry(0.021, 0.021, cageRadius * 2, 6),
      position: [0, y, z + 0.3],
      rotation: [0, 0, angle],
      tile: 2,
    });
    if (!detailed) continue;
    parts.push({
      geometry: new CylinderGeometry(0.019, 0.019, cageRadius * 2, 6),
      position: [0, y, z - 0.24],
      rotation: [0, 0, angle + Math.PI / (spokes * 2)],
      tile: 2,
    });
  }
  return parts;
}

function buildAirboatLod(
  context: BuildContext,
  root: Node,
  lod: 0 | 1 | 2,
): void {
  const suffix = lod === 0 ? "" : `_lod${lod}`;
  const segments = lod === 0 ? 18 : lod === 1 ? 10 : 6;
  const detailed = lod === 0;
  const { bottomY, deckY, halfWidth, sternZ } = AIRBOAT_HULL;
  /** Plano de los timones: por detrás del aro trasero de la jaula. */
  const rudderZ = AIRBOAT_FAN.z - 0.42;
  const bodyParts: GeometryPart[] = [
    // Casco de planeo en dos tramos partidos por el pantoque. Un único prisma
    // de costados verticales lee como cajón: el quiebre entre el fondo abierto
    // y la obra muerta es lo que hace que la silueta sea la de un casco.
    {
      geometry: chamferWedge({
        length: 3.34,
        height: 0.34,
        frontWidth: 1.34,
        rearWidth: 1.2,
        topFrontWidth: 2.06,
        topRearWidth: 1.92,
        chamfer: 0.05,
      }),
      position: [0, 0.45, -0.47],
      tile: 0,
    },
    {
      geometry: chamferWedge({
        length: 3.34,
        height: 0.36,
        frontWidth: 2.06,
        rearWidth: 1.92,
        topFrontWidth: 2.2,
        topRearWidth: 2.08,
        chamfer: 0.05,
      }),
      position: [0, 0.78, -0.47],
      tile: 0,
    },
    // Castillo de proa: levanta el fondo sobre la flotación para montarse en la
    // banquisa en vez de clavarse contra ella.
    {
      geometry: chamferWedge({
        length: 1.24,
        height: 0.62,
        frontWidth: 0.34,
        rearWidth: 1.34,
        topFrontWidth: 1,
        topRearWidth: 2.16,
        chamfer: 0.05,
      }),
      position: [0, 0.8, 1.74],
      rotation: [AIRBOAT_BOW_RAKE, 0, 0],
      tile: 0,
    },
    // Espejo de popa: cierra el casco y recibe la bancada del ventilador.
    { geometry: chamferBox(2.02, 0.66, 0.17, 0.05), position: [0, 0.64, sternZ], tile: 0 },
    // Cubierta de chapa entre regalas.
    { geometry: chamferBox(1.92, 0.09, 3.2, 0.03), position: [0, deckY, -0.48], tile: 2 },
    // Roda reforzada: la chapa que parte el hielo fino antes de que el casco lo
    // monte, y lo que separa este casco de un airboat de pantano. Va medida
    // POR FUERA del perfil de proa: a ras del casco queda enterrada y sólo se
    // ve la pintura clara.
    {
      geometry: chamferWedge({
        length: 0.34,
        height: 0.82,
        frontWidth: 0.42,
        rearWidth: 0.62,
        topFrontWidth: 1.08,
        topRearWidth: 1.4,
        chamfer: 0.022,
      }),
      position: [0, 0.98, 2.2],
      rotation: [AIRBOAT_BOW_RAKE, 0, 0],
      tile: 2,
    },
  ];

  for (const side of [-1, 1] as const) {
    bodyParts.push(
      // Regala: el borde grueso que separa casco de cubierta y se come los
      // golpes contra el hielo.
      {
        geometry: chamferBox(0.13, 0.16, 3.32, 0.04),
        position: [side * (halfWidth - 0.01), deckY + 0.04, -0.46],
        tile: 1,
      },
      // Tramo de proa: acompaña el afinado y la alzada del castillo.
      {
        geometry: chamferBox(0.13, 0.16, 1.34, 0.04),
        position: [side * 0.78, deckY + 0.17, 1.71],
        rotation: [-0.21, -side * 0.44, 0],
        tile: 1,
      },
      // Patín de hielo: correr sobre banquisa sin destrozar el fondo de planeo.
      // Va sobre el fondo, por dentro del pantoque, no en el costado.
      {
        geometry: chamferBox(0.18, 0.14, 3.3, 0.04),
        position: [side * 0.44, bottomY - 0.04, -0.5],
        tile: 2,
      },
    );
    if (detailed) {
      bodyParts.push(
        // Tacos del patín: el mordiente contra el hielo.
        ...ribParts(
          [side * 0.44, bottomY - 0.11, -0.5],
          [0, 0, 1],
          9,
          0.36,
          [0.2, 0.07, 0.09],
          2,
        ),
        // Banda naranja de rescate sobre la obra muerta.
        {
          geometry: chamferBox(0.06, 0.17, 2.42, 0.02),
          position: [side * 1.03, 0.79, -0.55],
          tile: 1,
        },
        // Cuadernas remachadas a la vista, sólo sobre la obra muerta: al ras y
        // del color del casco no rompen nada, pero pasadas de alto convierten
        // el flanco en una empalizada.
        ...ribParts(
          [side * 1.04, 0.78, -0.4],
          [0, 0, 1],
          5,
          0.62,
          [0.06, 0.3, 0.08],
          2,
        ),
        { geometry: rivetRow([side * 1.05, deckY - 0.1, -1.95], [side * 1.05, deckY - 0.1, 1.0], 14, 0.018, "x"), tile: 1 },
      );
    }
  }

  // Quilla-patín central: el casco apoya en tres líneas, no en el fondo entero.
  bodyParts.push({
    geometry: chamferBox(0.24, 0.13, 3.5, 0.035),
    position: [0, bottomY - 0.03, -0.42],
    tile: 2,
  });

  // Puntos de amarre sobre el aro: las patas y los tirantes tienen que morder
  // la circunferencia, no el aire de adentro, o la jaula queda cruzada de
  // caños por delante del disco.
  const ringLowX = 0.9;
  const ringLowY = AIRBOAT_FAN.y - Math.sqrt(
    AIRBOAT_FAN.cageRadius ** 2 - ringLowX ** 2,
  );
  const ringHighX = 0.78;
  const ringHighY = AIRBOAT_FAN.y + Math.sqrt(
    AIRBOAT_FAN.cageRadius ** 2 - ringHighX ** 2,
  );
  // Jaula, patas y bloque del motor entran en TODOS los LOD. Son la silueta del
  // hidrodeslizador: sin ellos el LOD lejano es una tabla flotando, y a 566
  // triángulos el nivel más barato tiene de sobra para pagarlos.
  bodyParts.push(
    ...fanCageParts(segments, detailed),
    createTubePart([-ringLowX, ringLowY, AIRBOAT_FAN.z - 0.3], [ringLowX, ringLowY, AIRBOAT_FAN.z - 0.3], 0.045, segments, 2),
    { geometry: chamferBox(0.84, 0.54, 0.76, 0.05), position: [0, 1.26, -1.04], tile: 2 },
    ...[-1, 1].flatMap((side) => [
      createTubePart([side * 0.95, deckY, -1.14], [side * ringLowX, ringLowY, AIRBOAT_FAN.z], 0.05, segments, 2),
      createTubePart([side * 0.95, deckY, -2.04], [side * ringLowX, ringLowY, AIRBOAT_FAN.z], 0.05, segments, 2),
    ]),
  );

  if (lod < 2) {
    for (const side of [-1, 1] as const) {
      bodyParts.push(
        // Tirante largo a proa: la jaula pesa y va alta; sin él el conjunto lee
        // como apoyado en vez de arriostrado.
        createTubePart([side * ringHighX, ringHighY, AIRBOAT_FAN.z], [side * 0.97, deckY + 0.14, -0.6], 0.034, segments, 2),
        gusset([side * ringLowX, ringLowY, AIRBOAT_FAN.z], 0.15, 1),
        // Candelero y barandilla de proa. Muere contra la roda por fuera en vez
        // de cerrar sobre crujía: cruzando el eje quedaba justo a la altura del
        // caño y le tapaba el tiro al cañón de proa.
        createTubePart([side * 0.92, deckY + 0.06, 0.96], [side * 0.9, deckY + 0.34, 1.0], 0.036, segments, 2),
        createTubePart([side * 0.9, deckY + 0.34, 1.0], [side * 0.62, deckY + 0.42, 1.94], 0.04, segments, 2),
        createTubePart([side * 0.62, deckY + 0.42, 1.94], [side * 0.3, deckY + 0.3, 2.28], 0.04, segments, 2),
      );
    }
    bodyParts.push(
      // Bastidor de timones: sin las barras superior e inferior las palas
      // quedan flotando por detrás del espejo, sin nada que las cuelgue.
      createTubePart([-0.76, AIRBOAT_FAN.y + 0.24, rudderZ], [0.76, AIRBOAT_FAN.y + 0.24, rudderZ], 0.034, segments, 2),
      createTubePart([-0.76, AIRBOAT_FAN.y - 0.64, rudderZ], [0.76, AIRBOAT_FAN.y - 0.64, rudderZ], 0.034, segments, 2),
      ...[-1, 1].flatMap((side) => [
        createTubePart([side * 0.76, AIRBOAT_FAN.y + 0.24, rudderZ], [side * ringLowX, ringLowY, AIRBOAT_FAN.z - 0.24], 0.03, segments, 2),
        createTubePart([side * 0.76, AIRBOAT_FAN.y - 0.64, rudderZ], [side * ringLowX, ringLowY, AIRBOAT_FAN.z - 0.24], 0.03, segments, 2),
      ]),
      // Pedestal del cañón, soldado sobre la roda.
      { geometry: chamferBox(0.36, 0.09, 0.38, 0.03), position: [0, 1.14, AIRBOAT_GUN_Z], tile: 1 },
      { geometry: new CylinderGeometry(0.08, 0.115, 0.36, segments), position: [0, 1.33, AIRBOAT_GUN_Z], tile: 2 },
      { geometry: chamferBox(0.28, 0.06, 0.3, 0.02), position: [0, 1.48, AIRBOAT_GUN_Z], tile: 2 },
      // Carcasa de transmisión del motor al buje.
      createTubePart([0, 1.5, -1.24], [0, AIRBOAT_FAN.y - 0.06, AIRBOAT_FAN.z + 0.22], 0.15, segments, 2),
    );

    bodyParts.push(
      // Consola: un volumen macizo desde la cubierta, no una chapa suelta. Es
      // lo que le da centro al casco y donde se apoyan tablero y guardaespuma.
      {
        geometry: chamferWedge({
          length: 0.54,
          height: 0.48,
          frontWidth: 1,
          rearWidth: 1.24,
          topFrontWidth: 0.86,
          topRearWidth: 1.12,
          chamfer: 0.045,
        }),
        position: [0, deckY + 0.26, 0.42],
        tile: 0,
      },
      { geometry: chamferBox(1.16, 0.08, 0.48, 0.03), position: [0, deckY + 0.52, 0.38], rotation: [-0.2, 0, 0], tile: 2 },
      // Guardaespuma, no una ventanilla: el atlas es opaco. Va bajo y adelante
      // a propósito: el canto superior queda 0.18 m por debajo del ojo del
      // piloto (deckY + 0.94) y a 0.8 m de él, que es lo que deja ver la proa.
      // Pegado a la butaca y a la altura de la vista tapaba media pantalla.
      { geometry: chamferBox(0.88, 0.3, 0.06, 0.025), position: [0, deckY + 0.56, 0.55], rotation: [-0.3, 0, 0], tile: 2 },
      { geometry: chamferBox(0.94, 0.05, 0.07, 0.018), position: [0, deckY + 0.69, 0.51], rotation: [-0.3, 0, 0], tile: 1 },
      createTubePart([-0.45, deckY + 0.48, 0.61], [-0.45, deckY + 0.68, 0.54], 0.026, segments, 1),
      createTubePart([0.45, deckY + 0.48, 0.61], [0.45, deckY + 0.68, 0.54], 0.026, segments, 1),
      // Brazola del puesto: encierra el cockpit y corta el agua que entra por
      // la regala. Sin ella la cubierta es una plancha vacía de dos metros.
      ...[-1, 1].flatMap((side) => [
        {
          geometry: chamferBox(0.11, 0.22, 1.5, 0.03),
          position: [side * 0.63, deckY + 0.14, -0.28] as Vec3,
          tile: 0 as AtlasTile,
        },
        {
          geometry: chamferBox(0.13, 0.06, 1.5, 0.02),
          position: [side * 0.63, deckY + 0.27, -0.28] as Vec3,
          tile: 1 as AtlasTile,
        },
      ]),
      // Butaca del piloto: almohadón sobre cajón, respaldo alto y apoyacabeza.
      // Va baja, encajada en el casco: es la altura que fija el ojo del piloto.
      { geometry: chamferBox(0.46, 0.22, 0.48, 0.035), position: [0, deckY + 0.02, AIRBOAT_DRIVER_Z], tile: 2 },
      { geometry: chamferBox(0.56, 0.16, 0.58, 0.04), position: [0, deckY + 0.16, AIRBOAT_DRIVER_Z], tile: 3 },
      { geometry: chamferBox(0.56, 0.6, 0.16, 0.04), position: [0, deckY + 0.53, AIRBOAT_DRIVER_Z - 0.3], rotation: [-0.16, 0, 0], tile: 3 },
      { geometry: chamferBox(0.34, 0.2, 0.14, 0.035), position: [0, deckY + 0.9, AIRBOAT_DRIVER_Z - 0.38], tile: 3 },
    );
  }

  if (detailed) {
    bodyParts.push(
      // Nervios verticales de la roda: el filo que muerde el hielo.
      ...ribParts([0, 1.05, 2.36], [1, 0, 0], 5, 0.17, [0.06, 0.34, 0.07], 2),
      { geometry: rivetRow([-0.5, 1.32, 2.12], [0.5, 1.32, 2.12], 8, 0.019, "z"), tile: 2 },
      // Cornamusas de amarre sobre la regala.
      ...(
        [
          [0.84, 1.44],
          [halfWidth - 0.02, -1.5],
        ] as const
      ).flatMap(([x, z]) =>
        [-1, 1].map((side) => ({
          geometry: chamferBox(0.09, 0.1, 0.26, 0.02),
          position: [side * x, deckY + 0.2, z] as Vec3,
          tile: 2 as AtlasTile,
        })),
      ),
      // Alas de la butaca y acolchado del respaldo.
      ...[-1, 1].map((side) => ({
        geometry: chamferBox(0.1, 0.16, 0.52, 0.03),
        position: [side * 0.27, deckY + 0.29, AIRBOAT_DRIVER_Z] as Vec3,
        tile: 3 as AtlasTile,
      })),
      ...ribParts(
        [0, deckY + 0.53, AIRBOAT_DRIVER_Z - 0.38],
        [0, 1, 0],
        4,
        0.15,
        [0.5, 0.05, 0.07],
        3,
      ),
      // Arco antivuelco de la butaca, con asidero naranja para el embarque.
      createTubePart([-0.32, deckY + 0.1, AIRBOAT_DRIVER_Z - 0.42], [-0.32, deckY + 0.98, AIRBOAT_DRIVER_Z - 0.46], 0.03, segments, 2),
      createTubePart([0.32, deckY + 0.1, AIRBOAT_DRIVER_Z - 0.42], [0.32, deckY + 0.98, AIRBOAT_DRIVER_Z - 0.46], 0.03, segments, 2),
      createTubePart([-0.32, deckY + 0.98, AIRBOAT_DRIVER_Z - 0.46], [0.32, deckY + 0.98, AIRBOAT_DRIVER_Z - 0.46], 0.03, segments, 1),
      // Chapa de la consola: galón, registro de acceso y remachado. Un frente
      // liso de un metro en blanco hielo lee como plástico.
      { geometry: chamferBox(1.14, 0.09, 0.05, 0.02), position: [0, deckY + 0.2, 0.7], tile: 1 },
      { geometry: chamferBox(0.42, 0.26, 0.05, 0.02), position: [0, deckY + 0.36, 0.7], tile: 2 },
      ...[-1, 1].map((side) => ({
        geometry: chamferBox(0.05, 0.28, 0.32, 0.02),
        position: [side * 0.56, deckY + 0.28, 0.4] as Vec3,
        tile: 2 as AtlasTile,
      })),
      { geometry: rivetRow([-0.5, deckY + 0.48, 0.68], [0.5, deckY + 0.48, 0.68], 8, 0.017, "z"), tile: 2 },
      // Registros de cubierta a proa y a popa del puesto.
      { geometry: chamferBox(0.54, 0.05, 0.5, 0.02), position: [0, deckY + 0.06, 1.0], tile: 2 },
      { geometry: new TorusGeometry(0.07, 0.018, 5, 10), position: [0, deckY + 0.09, 1.0], rotation: [Math.PI / 2, 0, 0], tile: 1 },
      { geometry: chamferBox(0.46, 0.05, 0.4, 0.02), position: [0, deckY + 0.06, -1.62], tile: 2 },
      // Relojes sobre el tablero y caña de timón con manillar: el mando del
      // casco es una barra, no un volante de auto.
      { geometry: new CylinderGeometry(0.062, 0.062, 0.04, 12), position: [-0.13, deckY + 0.57, 0.34], rotation: [Math.PI / 2 - 0.2, 0, 0], tile: 3 },
      { geometry: new CylinderGeometry(0.062, 0.062, 0.04, 12), position: [0.13, deckY + 0.57, 0.34], rotation: [Math.PI / 2 - 0.2, 0, 0], tile: 3 },
      createTubePart([0, deckY + 0.3, 0.06], [0, deckY + 0.54, 0.14], 0.04, 10, 2),
      { geometry: new CylinderGeometry(0.03, 0.03, 0.68, 10), position: [0, deckY + 0.55, 0.15], rotation: [0, 0, Math.PI / 2], tile: 2 },
      ...[-1, 1].map((side) => ({
        geometry: new CylinderGeometry(0.045, 0.045, 0.16, 10),
        position: [side * 0.27, deckY + 0.55, 0.15] as Vec3,
        rotation: [0, 0, Math.PI / 2] as Euler,
        tile: 3 as AtlasTile,
      })),
      // Piso antideslizante del puesto.
      ...ribParts([0, deckY + 0.06, -0.2], [0, 0, 1], 4, 0.13, [0.62, 0.03, 0.06], 2),
      // Culata, escape con pantalla térmica y bidón de reserva atado al motor.
      ...ribParts([0, 1.56, -1.04], [1, 0, 0], 4, 0.19, [0.11, 0.08, 0.6], 2),
      createTubePart([0.3, 1.5, -0.94], [0.38, 2.12, -0.86], 0.058, 10, 1),
      { geometry: new CylinderGeometry(0.088, 0.088, 0.34, 10), position: [0.35, 1.82, -0.9], tile: 2 },
      { geometry: new CylinderGeometry(0.19, 0.19, 0.52, 12), position: [-0.62, 1.32, -1.42], rotation: [0, 0, Math.PI / 2], tile: 1 },
      { geometry: chamferBox(0.06, 0.3, 0.3, 0.02), position: [-0.62, 1.32, -1.42], tile: 3 },
      // Faros de proa sobre los hombros del castillo, fuera del arco del cañón.
      ...[-1, 1].flatMap((side) => [
        {
          geometry: new CylinderGeometry(0.115, 0.115, 0.16, 12),
          position: [side * 0.54, 1.26, 1.96] as Vec3,
          rotation: [Math.PI / 2 - 0.1, 0, 0] as Euler,
          tile: 2 as AtlasTile,
        },
        {
          geometry: new CylinderGeometry(0.088, 0.088, 0.04, 12),
          position: [side * 0.54, 1.27, 2.04] as Vec3,
          rotation: [Math.PI / 2 - 0.1, 0, 0] as Euler,
          tile: 0 as AtlasTile,
        },
      ]),
      // Reflector de trabajo en la coronilla de la jaula.
      { geometry: chamferBox(0.22, 0.18, 0.16, 0.03), position: [0, AIRBOAT_FAN.y + AIRBOAT_FAN.cageRadius + 0.12, AIRBOAT_FAN.z + 0.24], rotation: [0.3, 0, 0], tile: 2 },
      // Bichero de hielo trincado a la regala de babor.
      createTubePart([0.98, deckY + 0.17, -1.3], [0.98, deckY + 0.17, 1.2], 0.032, 8, 2),
      { geometry: chamferBox(0.05, 0.16, 0.2, 0.02), position: [0.98, deckY + 0.24, 1.32], rotation: [0.5, 0, 0], tile: 2 },
      // Rollo de cabo sobre el castillo.
      ...[0, 1, 2].map((ring) => ({
        geometry: new TorusGeometry(0.19 - ring * 0.028, 0.036, 5, 12),
        position: [-0.5, 1.11 + ring * 0.06, 1.42] as Vec3,
        rotation: [Math.PI / 2 + AIRBOAT_BOW_RAKE, 0, 0] as Euler,
        tile: 3 as AtlasTile,
      })),
      // Espejo de popa: galón, estribo de embarque y asidero.
      { geometry: chamferBox(1.9, 0.14, 0.06, 0.02), position: [0, 0.84, sternZ - 0.12], tile: 1 },
      { geometry: chamferBox(0.56, 0.07, 0.3, 0.025), position: [0, 0.56, sternZ - 0.22], tile: 2 },
      createTubePart([-0.3, 0.6, sternZ - 0.32], [-0.3, deckY, sternZ - 0.08], 0.024, 8, 2),
      createTubePart([0.3, 0.6, sternZ - 0.32], [0.3, deckY, sternZ - 0.08], 0.024, 8, 2),
      // Antena de látigo y remachado del espejo de popa.
      createTubePart([0.86, deckY + 0.16, -1.98], [1.0, 2.42, -2.14], 0.017, 6, 2),
      { geometry: rivetRow([-0.9, deckY - 0.2, sternZ - 0.08], [0.9, deckY - 0.2, sternZ - 0.08], 11, 0.019, "z"), tile: 1 },
      { geometry: rivetRow([-0.44, 1.2, 2.26], [0.44, 1.2, 2.26], 7, 0.018, "z"), tile: 2 },
    );
  }
  createVisualNode(context, root, `airboat_body${suffix}`, bodyParts);

  if (lod < 2) {
    const fanGeometry = createFanGeometry(segments, lod !== 0);
    const fanMesh = createMesh(context, `airboat_fan_lod${lod}_mesh`, fanGeometry);
    fanGeometry.dispose();
    createNode(context, root, `fan_main${suffix}`, {
      mesh: fanMesh,
      position: [0, AIRBOAT_FAN.y, AIRBOAT_FAN.z],
      extras: { kind: "fan" },
    });

    const rudderGeometry = mergeParts([
      // Timón con perfil: borde de ataque grueso y fuga afilada, con la cuerda
      // afinándose hacia arriba. Una pala de una pieza, lisa y del color del
      // casco, colgaba de la popa como una puerta; el quiebre de cuerda y el
      // acero son los que la vuelven una superficie de mando.
      {
        geometry: chamferWedge({
          length: 0.5,
          height: 0.46,
          frontWidth: 0.085,
          rearWidth: 0.028,
          chamfer: 0.014,
        }),
        position: [0, -0.21, -0.16],
        tile: 2,
      },
      {
        geometry: chamferWedge({
          length: 0.38,
          height: 0.42,
          frontWidth: 0.08,
          rearWidth: 0.026,
          chamfer: 0.014,
        }),
        position: [0, 0.22, -0.1],
        tile: 2,
      },
      // Galón de rescate sobre el quiebre y herrajes de charnela.
      { geometry: chamferBox(0.075, 0.1, 0.46, 0.02), position: [0, 0.01, -0.17], tile: 1 },
      { geometry: chamferBox(0.1, 0.12, 0.13, 0.02), position: [0, 0.4, 0.02], tile: 1 },
      { geometry: chamferBox(0.1, 0.12, 0.13, 0.02), position: [0, -0.4, 0.02], tile: 1 },
      { geometry: new CylinderGeometry(0.028, 0.028, 0.94, 8), tile: 2 },
    ]);
    const rudderMesh = createMesh(
      context,
      `airboat_rudder_lod${lod}_mesh`,
      rudderGeometry,
    );
    rudderGeometry.dispose();
    createNode(context, root, `rudder_left${suffix}`, {
      mesh: rudderMesh,
      position: [-0.46, AIRBOAT_FAN.y - 0.2, rudderZ],
      extras: { kind: "rudder", side: "left" },
    });
    createNode(context, root, `rudder_right${suffix}`, {
      mesh: rudderMesh,
      position: [0.46, AIRBOAT_FAN.y - 0.2, rudderZ],
      extras: { kind: "rudder", side: "right" },
    });

    const yawParts: GeometryPart[] = [
      { geometry: new CylinderGeometry(0.15, 0.19, 0.12, segments), tile: 2 },
      { geometry: new CylinderGeometry(0.105, 0.105, 0.14, segments), position: [0, 0.08, 0], tile: 2 },
    ];
    if (detailed) {
      yawParts.push(
        { geometry: panel(0.05, 0.2, 0.22), position: [0.13, 0.08, -0.02], tile: 1 },
        { geometry: panel(0.05, 0.2, 0.22), position: [-0.13, 0.08, -0.02], tile: 1 },
      );
    }
    const turretYaw = createVisualNode(
      context,
      root,
      `turret_yaw${suffix}`,
      yawParts,
      {
        position: [0, AIRBOAT_GUN_Y, AIRBOAT_GUN_Z],
        extras: { kind: "turret-yaw" },
      },
    );

    const pitchParts: GeometryPart[] = [
      // Recámara, camisa de refrigeración y bocacha.
      { geometry: chamferBox(0.34, 0.3, 0.48, 0.04), position: [0, 0, 0.06], tile: 2 },
      { geometry: new CylinderGeometry(0.072, 0.088, 0.82, segments), position: [0, 0, 0.68], rotation: [Math.PI / 2, 0, 0], tile: 2 },
      { geometry: new CylinderGeometry(0.105, 0.12, 0.17, segments), position: [0, 0, 1.08], rotation: [Math.PI / 2, 0, 0], tile: 2 },
    ];
    if (detailed) {
      pitchParts.push(
        { geometry: new CylinderGeometry(0.098, 0.098, 0.36, segments), position: [0, 0, 0.4], rotation: [Math.PI / 2, 0, 0], tile: 1 },
        // Anillos de inducción: el cobre es lo que lo separa de una ametralladora.
        ...[0.74, 0.86, 0.98].map((z) => ({
          geometry: new TorusGeometry(0.082, 0.024, 6, segments),
          position: [0, 0, z] as Vec3,
          tile: 1 as AtlasTile,
        })),
        { geometry: chamferBox(0.16, 0.2, 0.26, 0.03), position: [0.2, -0.02, 0.02], tile: 1 },
        { geometry: chamferBox(0.06, 0.1, 0.16, 0.02), position: [0, 0.18, 0.24], tile: 2 },
        createTubePart([0, -0.06, -0.16], [0, -0.24, -0.3], 0.026, 8, 2),
      );
    }
    createVisualNode(
      context,
      turretYaw,
      `turret_pitch${suffix}`,
      pitchParts,
      { extras: { kind: "turret-pitch" } },
    );
  }
}

/**
 * Casco varado y abierto por la quilla. El fondo de planeo se parte en dos
 * mitades: es lo que separa un casco reventado de uno simplemente inclinado, y
 * la abertura es la que deja ver las cuadernas de adentro.
 */
function wreckedAirboatHullParts(): GeometryPart[] {
  const { bottomY, deckY, halfWidth, sternZ } = AIRBOAT_HULL;
  return [
    // Fondo de planeo entero. Partirlo en dos mitades separadas destruía la
    // silueta: sin un casco continuo la chatarra deja de leerse como bote y
    // pasa a ser una pila de chapas.
    {
      geometry: chamferWedge({
        length: 3.34,
        height: 0.34,
        frontWidth: 1.34,
        rearWidth: 1.2,
        topFrontWidth: 2.06,
        topRearWidth: 1.92,
        chamfer: 0.05,
      }),
      position: [0, bottomY + 0.17, -0.47],
      rotation: [0, 0.02, -0.03],
      tile: 0,
    },
    // Obra muerta: la banda de babor aguantó entera y la de estribor se abrió.
    // El tramo que falta es la ventana por la que se ve el interior.
    {
      geometry: chamferBox(0.3, 0.36, 3.2, 0.05),
      position: [0.86, 0.79, -0.5],
      rotation: [0.02, 0.02, -0.05],
      tile: 0,
    },
    {
      geometry: chamferBox(0.3, 0.34, 1.24, 0.05),
      position: [-0.86, 0.76, -1.4],
      rotation: [-0.02, -0.03, 0.07],
      tile: 0,
    },
    {
      geometry: chamferBox(0.28, 0.3, 0.66, 0.05),
      position: [-0.83, 0.73, 1.02],
      rotation: [-0.03, -0.07, 0.14],
      tile: 0,
    },
    // Labios desgarrados a los dos lados del hueco.
    {
      geometry: chamferBox(0.26, 0.22, 0.16, 0.03),
      position: [-0.84, 0.74, -0.72],
      rotation: [0.34, -0.2, 0.28],
      tile: 0,
    },
    {
      geometry: chamferBox(0.24, 0.2, 0.14, 0.03),
      position: [-0.82, 0.7, 0.62],
      rotation: [-0.4, 0.24, 0.2],
      tile: 0,
    },
    // Espejo de popa con su galón: el naranja de rescate es lo que identifica
    // al casco cuando ya no queda silueta.
    {
      geometry: chamferBox(1.96, 0.62, 0.16, 0.05),
      position: [0, 0.6, sternZ + 0.04],
      rotation: [0.22, 0.06, 0.08],
      tile: 0,
    },
    {
      geometry: chamferBox(1.84, 0.13, 0.06, 0.02),
      position: [0, 0.82, sternZ - 0.06],
      rotation: [0.22, 0.06, 0.08],
      tile: 1,
    },
    // Cuadernas al aire: sin cubierta son lo único que hay dentro del casco, y
    // un interior vacío se ve como una batea.
    ...ribParts([0.02, 0.68, -0.5], [0, 0, 1], 7, 0.46, [1.66, 0.09, 0.07], 2),
    // Varengas y un puntal caído en el fondo de la sentina.
    ...ribParts([0.02, 0.5, -0.5], [0, 0, 1], 4, 0.8, [0.9, 0.07, 0.06], 2),
    createTubePart([-0.62, 0.56, -1.5], [0.5, 0.62, 0.3], 0.035, 8, 1),
    // Chapas de cubierta que aguantaron, con las juntas abiertas.
    {
      geometry: chamferBox(0.78, 0.07, 1.46, 0.025),
      position: [0.5, deckY - 0.05, -1.12],
      rotation: [0.04, 0.05, -0.09],
      tile: 2,
    },
    {
      geometry: chamferBox(0.7, 0.07, 1.12, 0.025),
      position: [-0.54, deckY - 0.12, -1.24],
      rotation: [-0.06, -0.06, 0.12],
      tile: 2,
    },
    {
      geometry: chamferBox(0.84, 0.07, 0.96, 0.025),
      position: [0.44, deckY + 0.02, 0.52],
      rotation: [0.06, 0.04, -0.11],
      tile: 2,
    },
    // Regala doblada: entera a babor, arrancada a estribor.
    {
      geometry: chamferBox(0.12, 0.15, 2.2, 0.04),
      position: [halfWidth - 0.02, deckY + 0.06, -0.8],
      rotation: [0.03, 0.03, -0.12],
      tile: 1,
    },
    {
      geometry: chamferBox(0.12, 0.14, 1.06, 0.04),
      position: [-(halfWidth - 0.08), deckY - 0.02, 0.24],
      rotation: [-0.06, -0.12, 0.2],
      tile: 1,
    },
    // Bandas de rescate sobre la obra muerta que sobrevivió.
    {
      geometry: chamferBox(0.06, 0.16, 1.7, 0.02),
      position: [1.08, 0.82, -0.72],
      rotation: [0.02, 0.06, -0.24],
      tile: 1,
    },
    // Patines de hielo: el de babor sigue atornillado, del de estribor quedó
    // el tocón y la quilla central se partió a la mitad.
    {
      geometry: chamferBox(0.17, 0.13, 2.32, 0.04),
      position: [0.46, bottomY - 0.05, -0.6],
      rotation: [0.02, 0.03, -0.04],
      tile: 2,
    },
    {
      geometry: chamferBox(0.17, 0.12, 0.62, 0.04),
      position: [-0.44, bottomY - 0.04, -1.5],
      rotation: [0.04, -0.03, 0.05],
      tile: 2,
    },
    {
      geometry: chamferBox(0.22, 0.12, 1.54, 0.035),
      position: [0.02, bottomY - 0.02, -1.3],
      rotation: [0.02, 0.02, -0.03],
      tile: 2,
    },
    { geometry: rivetRow([1.06, deckY - 0.12, -1.8], [1.06, deckY - 0.12, 0.3], 10, 0.018, "x"), tile: 1 },
    // Chapa desgarrada en el borde de la abertura.
    {
      geometry: chamferBox(0.24, 0.05, 0.34, 0.014),
      position: [0.16, 0.66, 0.86],
      rotation: [0.5, 0.4, -0.6],
      tile: 0,
    },
    {
      geometry: chamferBox(0.3, 0.05, 0.26, 0.014),
      position: [-0.2, 0.6, -1.72],
      rotation: [-0.55, -0.3, 0.5],
      tile: 0,
    },
  ];
}

/**
 * Castillo de proa doblado hacia arriba en la línea de rotura. El nodo se
 * cuelga del quiebre, así que la rotación es literalmente el pliegue.
 */
function wreckedAirboatBowParts(segments: number): GeometryPart[] {
  return [
    {
      geometry: chamferWedge({
        length: 1.24,
        height: 0.6,
        frontWidth: 0.34,
        rearWidth: 1.3,
        topFrontWidth: 0.98,
        topRearWidth: 2.1,
        chamfer: 0.05,
      }),
      position: [0, 0.02, 0.6],
      tile: 0,
    },
    // Roda abollada y sus nervios. Va más baja que en el modelo intacto: a la
    // altura original, con la proa clavada, la chapa quedaba de pie tapando el
    // castillo entero de frente.
    {
      geometry: chamferWedge({
        length: 0.3,
        height: 0.5,
        frontWidth: 0.4,
        rearWidth: 0.58,
        topFrontWidth: 0.96,
        topRearWidth: 1.24,
        chamfer: 0.022,
      }),
      position: [0.05, 0.06, 1.24],
      rotation: [0.12, 0.08, 0.12],
      tile: 2,
    },
    ...ribParts([0.04, 0.12, 1.36], [1, 0, 0], 5, 0.16, [0.06, 0.2, 0.07], 2),
    // Candeleros de proa: uno doblado sobre la cubierta y el otro cortado.
    createTubePart([0.62, 0.42, 0.16], [0.5, 0.62, 0.8], 0.038, segments, 2),
    createTubePart([0.5, 0.62, 0.8], [0.16, 0.5, 1.14], 0.038, segments, 2),
    createTubePart([-0.6, 0.4, 0.2], [-0.66, 0.6, 0.5], 0.036, segments, 2),
    {
      geometry: new TorusGeometry(0.036, 0.011, 5, segments),
      position: [-0.66, 0.61, 0.51],
      rotation: [1.3, 0.2, 0],
      tile: 2,
    },
    // Faro reventado: queda el aro y el cable colgando.
    {
      geometry: new CylinderGeometry(0.115, 0.115, 0.16, 12),
      position: [0.5, 0.44, 0.86],
      rotation: [Math.PI / 2 + 0.4, 0.2, 0],
      tile: 2,
    },
    createTubePart([0.46, 0.36, 0.82], [0.28, 0.16, 0.5], 0.018, 6, 1),
    // Pedestal del cañón, arrancado de la cubierta.
    {
      geometry: chamferBox(0.34, 0.09, 0.36, 0.03),
      position: [0.04, 0.36, 0.54],
      rotation: [0.14, 0.1, 0.22],
      tile: 1,
    },
    createTubePart([0.04, 0.4, 0.54], [0.2, 0.62, 0.4], 0.075, segments, 2),
    {
      geometry: new TorusGeometry(0.075, 0.018, 5, segments),
      position: [0.21, 0.63, 0.39],
      rotation: [1.0, 0.4, 0],
      tile: 2,
    },
  ];
}

/**
 * Ventilador y su jaula, caídos sobre la popa. Los aros van como arcos y no
 * como circunferencias: un toro entero lee como jaula sana apenas torcida.
 */
function wreckedAirboatFanParts(segments: number): GeometryPart[] {
  const { cageRadius, radius } = AIRBOAT_FAN;
  const parts: GeometryPart[] = [
    // Los tres aros de guardia siguen siendo aros: ovalados, con un sector
    // arrancado distinto cada uno. Cortados en arcos cortos la jaula deja de
    // leerse como jaula, y es la firma de la silueta del hidrodeslizador.
    {
      geometry: new TorusGeometry(cageRadius, 0.042, 6, segments * 2, Math.PI * 1.78),
      position: [0, 0, 0.28],
      rotation: [0, 0, 0.5],
      scale: [1, 0.88, 1],
      tile: 2,
    },
    {
      geometry: new TorusGeometry(cageRadius, 0.042, 6, segments * 2, Math.PI * 1.46),
      position: [0.05, -0.03, 0.02],
      rotation: [0.04, 0.06, 1.25],
      scale: [0.94, 0.9, 1],
      tile: 2,
    },
    {
      geometry: new TorusGeometry(cageRadius, 0.04, 6, segments * 2, Math.PI * 0.92),
      position: [0.03, -0.01, -0.24],
      rotation: [0.02, 0.04, 2.45],
      scale: [1, 0.86, 1],
      tile: 2,
    },
    {
      geometry: new TorusGeometry(cageRadius * 0.54, 0.03, 5, segments * 2, Math.PI * 1.55),
      position: [0.02, 0.02, 0.26],
      rotation: [0, 0, 1.15],
      scale: [0.9, 1, 1],
      tile: 2,
    },
    // Buje y plato de bridas: la pieza que sobrevive siempre.
    {
      geometry: new CylinderGeometry(0.19, 0.156, 0.36, segments),
      rotation: [Math.PI / 2, 0, 0],
      tile: 2,
    },
    {
      geometry: new CylinderGeometry(0.3, 0.3, 0.055, segments),
      position: [0, 0, -0.13],
      rotation: [Math.PI / 2, 0, 0],
      tile: 1,
    },
  ];
  // Palas partidas a distinta altura: lo que queda del disco son muñones.
  const stumps: readonly (readonly [number, number])[] = [
    [0.2, 0.72],
    [1.35, 0.28],
    [2.5, 0.5],
    [3.6, 0.16],
    [4.7, 0.34],
  ];
  for (const [angle, span] of stumps) {
    const length = (radius - 0.19) * span;
    const reach = 0.19 + length / 2;
    parts.push({
      geometry: chamferWedge({
        length,
        height: 0.055,
        frontWidth: 0.3,
        rearWidth: 0.3 - 0.13 * span,
        chamfer: 0.014,
      }),
      position: [
        Math.cos(angle + Math.PI / 2) * reach,
        Math.sin(angle + Math.PI / 2) * reach,
        0,
      ],
      rotation: [Math.PI / 2, 0, angle + 0.3],
      tile: 2,
    });
  }
  // Radios: los que aguantaron cruzan el disco; los sueltos cuelgan del aro.
  parts.push(
    createTubePart([-0.62, 0.78, 0.28], [0.72, -0.68, 0.3], 0.03, segments, 2),
    createTubePart([0.86, 0.5, 0.28], [-0.44, -0.82, 0.26], 0.03, segments, 2),
    createTubePart([0.98, -0.16, 0.26], [-0.9, 0.34, 0.28], 0.03, segments, 2),
    createTubePart([-0.28, 0.94, 0.26], [0.4, -0.86, 0.3], 0.028, segments, 2),
    createTubePart([0.2, 0.98, 0.02], [0.16, 0.24, -0.02], 0.028, 8, 2),
    createTubePart([-0.9, -0.42, 0.0], [-1.42, -1.06, -0.22], 0.05, segments, 2),
    {
      geometry: new TorusGeometry(0.05, 0.014, 5, segments),
      position: [-1.44, -1.09, -0.23],
      rotation: [1.0, 0.5, 0],
      tile: 2,
    },
    createTubePart([0.78, -0.6, 0.02], [1.18, -1.16, -0.3], 0.05, segments, 2),
    gusset([0.8, -0.62, 0.02], 0.14, 1),
  );
  return parts;
}

/** Bancada del motor a la vista, con el eje de transmisión cortado. */
function wreckedAirboatEngineParts(segments: number): GeometryPart[] {
  return [
    {
      geometry: chamferBox(0.8, 0.44, 0.72, 0.05),
      position: [0, 0, 0],
      rotation: [0.12, 0.06, -0.1],
      tile: 2,
    },
    ...ribParts([0, 0.26, 0.02], [1, 0, 0], 4, 0.19, [0.11, 0.08, 0.56], 2),
    // Tapa del bloque arrancada: rompe la silueta de cajón limpio, que es lo
    // único que se veía de la bancada desde popa. Va tumbada y en acero; de
    // canto y en naranja quedaba como un cartel en medio del casco.
    {
      geometry: chamferBox(0.62, 0.07, 0.52, 0.03),
      position: [-0.36, 0.16, 0.34],
      rotation: [0.3, 0.24, 0.52],
      tile: 2,
    },
    {
      geometry: chamferBox(0.24, 0.05, 0.3, 0.014),
      position: [0.36, 0.24, -0.3],
      rotation: [0.6, -0.4, 0.5],
      tile: 2,
    },
    // Escape retorcido y su pantalla térmica.
    createTubePart([0.3, 0.22, 0.1], [0.44, 0.72, 0.24], 0.058, 10, 1),
    createTubePart([0.44, 0.72, 0.24], [0.72, 0.86, 0.02], 0.054, 10, 1),
    {
      geometry: new TorusGeometry(0.054, 0.015, 5, segments),
      position: [0.73, 0.87, 0.01],
      rotation: [1.2, 0.6, 0],
      tile: 2,
    },
    // Carcasa de transmisión, cortada al ras del bloque.
    createTubePart([0, 0.16, -0.24], [-0.1, 0.5, -0.72], 0.15, segments, 2),
    {
      geometry: new TorusGeometry(0.15, 0.02, 5, segments),
      position: [-0.105, 0.52, -0.74],
      rotation: [0.95, 0.2, 0],
      tile: 2,
    },
    // Bidón de reserva reventado contra la bancada.
    {
      geometry: new CylinderGeometry(0.19, 0.19, 0.5, 12),
      position: [-0.66, -0.1, -0.34],
      rotation: [0.3, 0.2, Math.PI / 2 - 0.4],
      scale: [1, 1, 0.72],
      tile: 1,
    },
    createTubePart([-0.3, 0.24, 0.2], [-0.66, -0.02, -0.1], 0.022, 6, 1),
    createTubePart([0.24, 0.3, 0.24], [0.5, -0.04, 0.36], 0.02, 6, 1),
  ];
}

/** Puesto de mando aplastado bajo la jaula que se le vino encima. */
function wreckedAirboatCockpitParts(segments: number): GeometryPart[] {
  const { deckY } = AIRBOAT_HULL;
  return [
    // Consola partida: el frente se abrió y el tablero quedó colgando.
    {
      geometry: chamferWedge({
        length: 0.5,
        height: 0.44,
        frontWidth: 0.96,
        rearWidth: 1.18,
        topFrontWidth: 0.82,
        topRearWidth: 1.06,
        chamfer: 0.045,
      }),
      position: [0.06, deckY + 0.2, 0.44],
      rotation: [0.16, 0.08, -0.14],
      tile: 0,
    },
    {
      geometry: chamferBox(1.1, 0.08, 0.46, 0.03),
      position: [0.1, deckY + 0.44, 0.28],
      rotation: [-0.62, 0.1, -0.2],
      tile: 2,
    },
    {
      geometry: chamferBox(0.86, 0.28, 0.06, 0.025),
      position: [0.02, deckY + 0.4, 0.72],
      rotation: [0.68, 0.14, -0.12],
      tile: 2,
    },
    // Relojes reventados sobre el tablero volcado.
    {
      geometry: new CylinderGeometry(0.062, 0.062, 0.04, 12),
      position: [-0.05, deckY + 0.5, 0.24],
      rotation: [Math.PI / 2 - 0.62, 0, 0],
      tile: 3,
    },
    {
      geometry: new CylinderGeometry(0.062, 0.062, 0.04, 12),
      position: [0.22, deckY + 0.49, 0.22],
      rotation: [Math.PI / 2 - 0.62, 0, 0],
      tile: 3,
    },
    // Butaca: el cajón sigue amarrado, el respaldo se dobló hacia atrás.
    {
      geometry: chamferBox(0.46, 0.2, 0.48, 0.035),
      position: [0.04, deckY, AIRBOAT_DRIVER_Z],
      rotation: [0.06, 0.04, -0.08],
      tile: 2,
    },
    {
      geometry: chamferBox(0.54, 0.15, 0.56, 0.04),
      position: [0.04, deckY + 0.13, AIRBOAT_DRIVER_Z],
      rotation: [0.06, 0.04, -0.08],
      tile: 3,
    },
    {
      geometry: chamferBox(0.54, 0.56, 0.15, 0.04),
      position: [0.02, deckY + 0.36, AIRBOAT_DRIVER_Z - 0.52],
      rotation: [-0.92, 0.06, -0.1],
      tile: 3,
    },
    // Arco antivuelco de la butaca, aplastado hacia proa.
    createTubePart([0.36, deckY + 0.08, AIRBOAT_DRIVER_Z - 0.42], [0.34, deckY + 0.62, AIRBOAT_DRIVER_Z - 0.3], 0.03, segments, 2),
    createTubePart([0.34, deckY + 0.62, AIRBOAT_DRIVER_Z - 0.3], [0.02, deckY + 0.74, AIRBOAT_DRIVER_Z - 0.22], 0.03, segments, 1),
    createTubePart([-0.28, deckY + 0.1, AIRBOAT_DRIVER_Z - 0.44], [-0.3, deckY + 0.4, AIRBOAT_DRIVER_Z - 0.4], 0.03, segments, 2),
    {
      geometry: new TorusGeometry(0.03, 0.009, 5, segments),
      position: [-0.3, deckY + 0.41, AIRBOAT_DRIVER_Z - 0.4],
      rotation: [Math.PI / 2 + 0.1, 0, 0],
      tile: 2,
    },
    // Caña de timón doblada: el mando del casco es una barra, no un volante.
    createTubePart([0.06, deckY + 0.24, 0.02], [0.16, deckY + 0.42, 0.16], 0.04, 10, 2),
    {
      geometry: new CylinderGeometry(0.03, 0.03, 0.64, 10),
      position: [0.16, deckY + 0.43, 0.17],
      rotation: [0, 0.3, Math.PI / 2 - 0.4],
      tile: 2,
    },
    // Brazola del puesto, partida en el costado que se abrió.
    {
      geometry: chamferBox(0.11, 0.2, 1.4, 0.03),
      position: [0.67, deckY + 0.12, -0.3],
      rotation: [0.04, 0.04, -0.12],
      tile: 0,
    },
    {
      geometry: chamferBox(0.11, 0.18, 0.6, 0.03),
      position: [-0.66, deckY + 0.06, -0.8],
      rotation: [-0.08, -0.14, 0.22],
      tile: 0,
    },
  ];
}

/** Lo que salió despedido y quedó sobre el hielo alrededor del casco. */
function wreckedAirboatDebrisParts(segments: number): GeometryPart[] {
  const ground = AIRBOAT_WRECK_GROUND;
  return [
    // Cañón de pulsos, arrancado del pintle y clavado de bocacha.
    {
      geometry: chamferBox(0.34, 0.3, 0.46, 0.04),
      position: [-1.42, ground + 0.28, 1.66],
      rotation: [0.42, -0.5, 0.24],
      tile: 2,
    },
    {
      geometry: new CylinderGeometry(0.072, 0.088, 0.82, segments),
      position: [-1.66, ground + 0.24, 2.16],
      rotation: [Math.PI / 2 - 0.42, -0.5, 0],
      tile: 2,
    },
    {
      geometry: new CylinderGeometry(0.105, 0.12, 0.17, segments),
      position: [-1.78, ground + 0.15, 2.5],
      rotation: [Math.PI / 2 - 0.42, -0.5, 0],
      tile: 2,
    },
    ...[2.0, 2.16, 2.32].map((z) => ({
      geometry: new TorusGeometry(0.082, 0.024, 6, segments),
      position: [-1.72, ground + 0.15, z] as Vec3,
      rotation: [-0.42, -0.5, 0] as Euler,
      tile: 1 as AtlasTile,
    })),
    // Timones arrancados del bastidor.
    {
      geometry: chamferWedge({
        length: 0.94,
        height: 0.44,
        frontWidth: 0.085,
        rearWidth: 0.028,
        chamfer: 0.014,
      }),
      position: [1.34, ground + 0.09, -1.86],
      rotation: [0.06, 0.34, Math.PI / 2 - 0.18],
      tile: 2,
    },
    {
      geometry: chamferWedge({
        length: 0.9,
        height: 0.42,
        frontWidth: 0.08,
        rearWidth: 0.026,
        chamfer: 0.014,
      }),
      position: [-0.62, ground + 0.08, -2.86],
      rotation: [0.12, -0.5, Math.PI / 2 + 0.24],
      tile: 2,
    },
    // Pala entera del ventilador, clavada de punta en el hielo.
    {
      geometry: chamferWedge({
        length: 0.86,
        height: 0.06,
        frontWidth: 0.3,
        rearWidth: 0.18,
        chamfer: 0.014,
      }),
      position: [1.7, ground + 0.41, 0.62],
      rotation: [1.05, 0.4, 0.3],
      tile: 2,
    },
    // Patín de hielo del fondo que se abrió.
    {
      geometry: chamferBox(0.17, 0.13, 1.9, 0.04),
      position: [-1.62, ground + 0.08, -0.42],
      rotation: [0.04, -0.32, 0.1],
      tile: 2,
    },
    // Chapas de casco: la banda naranja es lo que las ata a este vehículo.
    {
      geometry: chamferBox(0.9, 0.07, 1.1, 0.03),
      position: [1.5, ground + 0.18, 1.28],
      rotation: [0.12, 0.5, 0.14],
      tile: 0,
    },
    {
      geometry: chamferBox(0.72, 0.06, 0.16, 0.02),
      position: [1.44, ground + 0.23, 1.34],
      rotation: [0.12, 0.5, 0.14],
      tile: 1,
    },
    {
      geometry: chamferBox(0.66, 0.06, 0.8, 0.025),
      position: [0.32, ground + 0.09, -2.92],
      rotation: [0.1, -0.4, 0.12],
      tile: 0,
    },
    // Bichero, antena y rollo de cabo sobre el hielo.
    createTubePart([0.9, ground + 0.04, 1.9], [1.86, ground + 0.05, 0.98], 0.032, 8, 2),
    createTubePart([-1.16, ground + 0.03, -1.5], [-1.72, ground + 0.04, -2.24], 0.017, 6, 2),
    ...[0, 1, 2].map((ring) => ({
      geometry: new TorusGeometry(0.19 - ring * 0.028, 0.036, 5, 12),
      position: [-1.28, ground + 0.09 + ring * 0.06, 0.92] as Vec3,
      rotation: [Math.PI / 2 + 0.12, 0.2, 0] as Euler,
      tile: 3 as AtlasTile,
    })),
    // Recortes chicos para que el contorno no termine en un borde limpio.
    {
      geometry: chamferBox(0.24, 0.05, 0.3, 0.014),
      position: [-0.96, ground + 0.03, 2.62],
      rotation: [0.08, 0.6, 0.06],
      tile: 0,
    },
    {
      geometry: chamferBox(0.2, 0.05, 0.22, 0.012),
      position: [1.9, ground + 0.03, -0.7],
      rotation: [0.06, -0.5, 0.1],
      tile: 1,
    },
  ];
}

function buildAirboat(context: BuildContext): void {
  for (const lod of [0, 1, 2] as const) {
    const root = createNode(context, context.sceneRoot, `visual_lod${lod}`, {
      extras: {
        kind: "vehicle-lod",
        lod,
        hiddenByDefault: lod !== 0,
        screenCoverage: lod === 0 ? 0.3 : lod === 1 ? 0.1 : 0,
      },
    });
    buildAirboatLod(context, root, lod);
  }

  const { deckY } = AIRBOAT_HULL;
  // Puesto único: el preset del hidrodeslizador tiene una sola butaca y el
  // artillero dispara desde ella, así que no hay ancla de tripulante extra.
  createAnchor(context, "seat_driver", [0, deckY + 0.52, AIRBOAT_DRIVER_Z], "seat", {
    role: "driver",
  });
  // El ojo va justo por encima del marco del parabrisas: es la cota que fija
  // hasta dónde puede crecer la consola sin taparle el frente al piloto.
  createAnchor(
    context,
    "camera_driver",
    [0, deckY + 0.94, AIRBOAT_DRIVER_Z + 0.22],
    "camera",
    { role: "driver", fov: 78 },
    true,
  );
  createAnchor(context, "exit_left", [1.5, 0.95, -0.1], "exit", {
    seat: "seat_driver",
  });
  createAnchor(context, "exit_right", [-1.5, 0.95, -0.1], "exit", {
    seat: "seat_driver",
  });
  // Punta de la bocacha con el cañón en reposo: `VehicleVisual` cuelga el ancla
  // del nodo de elevación, así que de acá en más sigue al arma.
  createAnchor(
    context,
    "muzzle",
    [0, AIRBOAT_GUN_Y, AIRBOAT_GUN_Z + AIRBOAT_GUN_REACH],
    "muzzle",
    { weapon: "pulse-cannon" },
  );
  createAnchor(context, "audio_fan", [0, AIRBOAT_FAN.y, AIRBOAT_FAN.z], "audio", {
    layer: "fan",
  });
  createAnchor(context, "audio_water", [0, 0.35, 0.3], "audio", {
    layer: "water",
  });
  createAnchor(context, "damage_engine", [0, 1.3, -1.1], "damage", {
    component: "engine",
    halfExtents: [0.6, 0.5, 0.55],
  });
  createAnchor(context, "damage_hull", [0, 0.62, 0.2], "damage", {
    component: "hull",
    halfExtents: [1.15, 0.4, 2.2],
  });
  createAnchor(
    context,
    "damage_weapon",
    [0, AIRBOAT_GUN_Y, AIRBOAT_GUN_Z + 0.5],
    "damage",
    { component: "weapon", halfExtents: [0.3, 0.3, 0.8] },
  );
  createAnchor(context, "damage_fuel", [-0.62, 1.32, -1.42], "damage", {
    component: "fuel",
    halfExtents: [0.35, 0.35, 0.35],
  });
  const wreckage = createNode(context, context.sceneRoot, "wreckage", {
    extras: { kind: "wreckage", hiddenByDefault: true },
  });
  createVisualNode(context, wreckage, "wreckage_hull", wreckedAirboatHullParts(), {
    position: AIRBOAT_WRECK_POSITION,
    rotation: AIRBOAT_WRECK_ROTATION,
  });
  createVisualNode(context, wreckage, "wreckage_cockpit", wreckedAirboatCockpitParts(12), {
    position: AIRBOAT_WRECK_POSITION,
    rotation: AIRBOAT_WRECK_ROTATION,
  });
  // El nodo se cuelga de la línea de rotura, así que su rotación es el pliegue
  // del castillo sumado a la escora del casco.
  createVisualNode(context, wreckage, "wreckage_bow", wreckedAirboatBowParts(12), {
    position: [0.02, 0.58, 1.18],
    rotation: [0.16, 0.12, 0.12],
  });
  createVisualNode(context, wreckage, "wreckage_fan", wreckedAirboatFanParts(12), {
    position: [0.22, 1.24, -1.94],
    rotation: [0.48, 0.12, 0.22],
  });
  createVisualNode(context, wreckage, "wreckage_engine", wreckedAirboatEngineParts(12), {
    position: [0.06, 0.8, -1.16],
    rotation: [0.22, 0.12, 0.18],
  });
  createVisualNode(context, wreckage, "wreckage_debris", wreckedAirboatDebrisParts(10));
}

/**
 * Portilla redonda: marco, hueco oscuro y cristal. El hueco es lo que la hace
 * leer desde afuera; sin un fondo oscuro detrás, el vidrio se apoya contra la
 * piel del fuselaje y la ventana termina pareciendo un disco pintado.
 */
function portholeParts(
  center: Vec3,
  radius: number,
  segments: number,
): { readonly shell: GeometryPart[]; readonly glass: GeometryPart[] } {
  const side = Math.sign(center[0]);
  const acrossX: Euler = [0, 0, Math.PI / 2];
  return {
    shell: [
      // Sólo el aro: un disco macizo detrás del cristal quedaba enterrado en la
      // piel (invisible desde afuera) y encima tapaba la ventana desde la
      // bodega, que es desde donde se mira hacia el paisaje.
      {
        geometry: new TorusGeometry(radius, 0.024, 5, segments),
        position: [center[0] + side * 0.008, center[1], center[2]],
        rotation: [0, Math.PI / 2, 0],
        tile: 2,
      },
    ],
    glass: [
      {
        geometry: new CylinderGeometry(radius * 0.94, radius * 0.94, 0.02, segments),
        position: [center[0] + side * 0.014, center[1], center[2]],
        rotation: acrossX,
        tile: 0,
      },
    ],
  };
}

function cabinExteriorBandParts(
  side: -1 | 1,
  centerY: number,
  height: number,
  openings: readonly (readonly [number, number])[],
): GeometryPart[] {
  const fromZ = HELI_CABIN.lining[0] - 0.04;
  const toZ = HELI_CABIN.lining[1] + 0.04;
  const sorted = [...openings].sort((a, b) => a[0] - b[0]);
  const parts: GeometryPart[] = [];
  let cursor: number = fromZ;
  for (const [openFrom, openTo] of [...sorted, [toZ, toZ] as const]) {
    const length = Math.min(openFrom, toZ) - cursor;
    if (length > 0.03) {
      parts.push({
        geometry: chamferBox(0.12, height, length, 0.035),
        position: [
          side * HELI_CABIN.halfWidth,
          centerY,
          cursor + length / 2,
        ],
        tile: 0,
      });
    }
    cursor = Math.max(cursor, openTo);
  }
  return parts;
}

function helicopterCabinShellParts(detailed: boolean): GeometryPart[] {
  if (!detailed) {
    return [
      {
        geometry: roundedBox(2.16, 1.78, 3.26, 0.3, 1),
        position: [0, 1.42, -0.38],
        tile: 0,
      },
    ];
  }
  const { floorY, roofY, halfWidth, doorway, portholeRadius } = HELI_CABIN;
  const [fromZ, toZ] = HELI_CABIN.lining;
  const length = toZ - fromZ + 0.08;
  const centerZ = (fromZ + toZ) / 2;
  const parts: GeometryPart[] = [
    {
      geometry: chamferBox(halfWidth * 2, 0.2, length, 0.07),
      position: [0, floorY, centerZ],
      tile: 1,
    },
    {
      geometry: roundedBox(halfWidth * 2, 0.24, length, 0.11, 2),
      position: [0, roofY - 0.12, centerZ],
      tile: 0,
    },
    {
      geometry: chamferBox(halfWidth * 2, roofY - floorY - 0.16, 0.14, 0.05),
      position: [0, (roofY + floorY) / 2, fromZ - 0.03],
      tile: 0,
    },
  ];
  for (const side of [-1, 1] as const) {
    const windows = HELI_PORTHOLES
      .filter(([entry]) => entry === side)
      .map(([, z]) => [z - portholeRadius - 0.025, z + portholeRadius + 0.025] as const);
    const door = side === -1 ? [doorway] : [];
    const openings = [...windows, ...door];
    parts.push(
      ...cabinExteriorBandParts(side, 0.89, 0.34, []),
      ...cabinExteriorBandParts(side, 1.28, 0.44, door),
      ...cabinExteriorBandParts(side, 1.72, 0.44, openings),
      ...cabinExteriorBandParts(side, 2.04, 0.2, door),
      {
        geometry: chamferBox(0.13, 0.12, length, 0.035),
        position: [side * halfWidth, roofY - 0.18, centerZ],
        tile: 2,
      },
    );
  }
  return parts;
}

/**
 * Tramos macizos de una banda horizontal del forro de bodega: recibe los vanos
 * (portillas, puerta) y devuelve el complemento dentro del largo de cabina.
 */
function liningBandParts(
  side: -1 | 1,
  centerY: number,
  height: number,
  openings: readonly (readonly [number, number])[],
  tile: AtlasTile,
): GeometryPart[] {
  const [fromZ, toZ] = HELI_CABIN.lining;
  const sorted = [...openings].sort((a, b) => a[0] - b[0]);
  const parts: GeometryPart[] = [];
  let cursor: number = fromZ;
  for (const [openFrom, openTo] of [...sorted, [toZ, toZ] as const]) {
    const length = Math.min(openFrom, toZ) - cursor;
    if (length > 0.03) {
      parts.push({
        geometry: chamferBox(0.08, height, length, 0.025),
        position: [side * HELI_CABIN.liningX, centerY, cursor + length / 2],
        tile,
      });
    }
    cursor = Math.max(cursor, openTo);
  }
  return parts;
}

/**
 * Bodega vista desde adentro. El forro sigue los huecos de la piel exterior,
 * pero queda retirado para que ventanas y puerta tengan espesor.
 */
function cabinInteriorParts(
  segments: number,
  portholes: readonly (readonly [number, number])[],
): GeometryPart[] {
  const { liningX, doorway, portholeY, portholeRadius } = HELI_CABIN;
  const [fromZ, toZ] = HELI_CABIN.lining;
  const length = toZ - fromZ;
  const centerZ = (fromZ + toZ) / 2;
  const parts: GeometryPart[] = [
    // Piso, cielorraso y mamparo de popa.
    { geometry: chamferBox(2 * liningX, 0.09, length, 0.03), position: [0, 0.74, centerZ], tile: 3 },
    { geometry: chamferBox(2 * liningX, 0.09, length, 0.03), position: [0, 2.16, centerZ], tile: 1 },
    { geometry: chamferBox(2 * liningX, 1.42, 0.09, 0.03), position: [0, 1.45, fromZ + 0.05], tile: 1 },
    // Refuerzos del mamparo de popa y anclajes de carga en el piso: dos metros
    // de chapa lisa a un solo tono leen como un vacío blanco, no como el fondo
    // de una bodega.
    ...ribParts([0, 1.45, fromZ + 0.12], [0, 1, 0], 4, 0.36, [1.86, 0.07, 0.06], 2),
    // Cara de bodega del mamparo del puesto. El mamparo en sí va oscuro porque
    // es el fondo que se ve a través del parabrisas; de este lado se forra
    // claro, si no el pasajero mirando a proa tiene una pared negra encima.
    { geometry: chamferBox(2 * liningX, 1.42, 0.08, 0.03), position: [0, 1.45, toZ - 0.05], tile: 1 },
    ...ribParts([0, 1.45, toZ - 0.12], [0, 1, 0], 3, 0.42, [1.8, 0.06, 0.06], 2),
    { geometry: chamferBox(0.5, 0.42, 0.08, 0.03), position: [0, 0.95, fromZ + 0.12], tile: 3 },
    ...[-0.55, 0.55].flatMap((x) =>
      [-1.3, -0.4, 0.5].map((z) => ({
        geometry: new TorusGeometry(0.055, 0.016, 4, 8),
        position: [x, 0.74, z] as Vec3,
        rotation: [Math.PI / 2, 0, 0] as Euler,
        tile: 2 as AtlasTile,
      })),
    ),
    { geometry: chamferBox(0.7, 0.13, 1.72, 0.035), position: [-0.62, 0.87, -1.08], tile: 3 },
    { geometry: chamferBox(0.09, 0.46, 1.72, 0.03), position: [-0.9, 1.16, -1.08], tile: 3 },
    { geometry: chamferBox(0.7, 0.13, 2.5, 0.035), position: [0.62, 0.87, -0.7], tile: 3 },
    { geometry: chamferBox(0.09, 0.46, 2.5, 0.03), position: [0.9, 1.16, -0.7], tile: 3 },
  ];
  for (const side of [-1, 1] as const) {
    const windows = portholes
      .filter(([entry]) => entry === side)
      .map(([, z]) => [z - portholeRadius, z + portholeRadius] as const);
    const door = side === -1 ? [doorway] : [];
    const openings = [...windows, ...door];
    parts.push(
      ...liningBandParts(side, 0.89, 0.34, [], 1),
      ...liningBandParts(side, 1.28, 0.44, door, 1),
      ...liningBandParts(side, 1.72, 0.44, openings, 1),
      ...liningBandParts(side, 2.04, 0.2, door, 1),
      // Pasamanos del techo.
      createTubePart(
        [side * 0.62, 2.08, fromZ + 0.3],
        [side * 0.62, 2.08, toZ - 0.3],
        0.028,
        Math.max(6, segments / 2),
        2,
      ),
    );
    // Cuadernas a la vista, salteando los vanos. Sin este filtro una cuaderna
    // cae en mitad del vano de la puerta, a un palmo de la cara del artillero,
    // y otras cruzan las portillas por el medio.
    for (let index = 0; index < 5; index += 1) {
      const z = centerZ + (index - 2) * 0.62;
      const blocked = openings.some(
        ([openFrom, openTo]) => z > openFrom - 0.07 && z < openTo + 0.07,
      );
      if (blocked) continue;
      parts.push({
        geometry: chamferBox(0.05, 1.28, 0.07, 0.02),
        position: [side * (liningX - 0.06), 1.4, z],
        tile: 2,
      });
    }
    // Marco interior de cada portilla: el hueco del forro necesita canto.
    for (const [, z] of portholes.filter(([entry]) => entry === side)) {
      parts.push({
        geometry: new TorusGeometry(portholeRadius, 0.026, 5, Math.max(8, segments)),
        position: [side * (liningX - 0.05), portholeY, z],
        rotation: [0, Math.PI / 2, 0],
        tile: 2,
      });
    }
  }
  // Jambas y umbral del vano de la puerta.
  parts.push(
    { geometry: chamferBox(0.1, 0.9, 0.09, 0.025), position: [-liningX, 1.5, doorway[0]], tile: 2 },
    { geometry: chamferBox(0.1, 0.9, 0.09, 0.025), position: [-liningX, 1.5, doorway[1]], tile: 2 },
    { geometry: chamferBox(0.14, 0.07, doorway[1] - doorway[0], 0.02), position: [-liningX + 0.02, 1.09, (doorway[0] + doorway[1]) / 2], tile: 2 },
  );
  return parts;
}

function helicopterCockpitInteriorParts(segments: number): GeometryPart[] {
  const parts: GeometryPart[] = [
    {
      geometry: chamferWedge({
        length: 1.62,
        height: 0.09,
        frontWidth: 1.28,
        rearWidth: 1.78,
        chamfer: 0.035,
      }),
      position: [0, 0.75, 2.04],
      tile: 3,
    },
    // El cielorraso queda por encima del ojo y usa el forro claro: en la vista
    // anterior un bloque oscuro a 28 cm de la cámara ocupaba media pantalla.
    {
      geometry: chamferWedge({
        length: 1.34,
        height: 0.065,
        frontWidth: 1.3,
        rearWidth: 1.66,
        chamfer: 0.025,
      }),
      position: [0, 2.1, 1.98],
      rotation: [0.06, 0, 0],
      tile: 1,
    },
    // Revestimientos laterales bajos; por encima quedan sólo los marcos reales
    // de las ventanillas, sin paneles que atraviesen la vista del piloto.
    {
      geometry: chamferBox(0.07, 0.52, 1.38, 0.025),
      position: [-0.83, 1.08, 2.03],
      rotation: [0, 0.16, 0],
      tile: 1,
    },
    {
      geometry: chamferBox(0.07, 0.52, 1.38, 0.025),
      position: [0.83, 1.08, 2.03],
      rotation: [0, -0.16, 0],
      tile: 1,
    },
    {
      geometry: chamferBox(0.08, 0.46, 0.3, 0.025),
      position: [-0.86, 1.72, 1.46],
      tile: 1,
    },
    {
      geometry: chamferBox(0.08, 0.46, 0.3, 0.025),
      position: [0.86, 1.72, 1.46],
      tile: 1,
    },
    // Butacas separadas, con respaldo por debajo de la línea de ojos.
    ...[-1, 1].flatMap((side) => [
      {
        geometry: chamferBox(0.5, 0.14, 0.5, 0.035),
        position: [side * 0.48, 0.89, 1.61] as Vec3,
        tile: 3 as AtlasTile,
      },
      {
        geometry: chamferBox(0.5, 0.58, 0.13, 0.035),
        position: [side * 0.48, 1.21, 1.4] as Vec3,
        rotation: [-0.14, 0, 0] as Euler,
        tile: 3 as AtlasTile,
      },
      createTubePart(
        [side * 0.7, 0.8, 1.42],
        [side * 0.7, 1.45, 1.34],
        0.025,
        8,
        2,
      ),
      createTubePart(
        [side * 0.28, 0.8, 1.42],
        [side * 0.28, 1.45, 1.34],
        0.025,
        8,
        2,
      ),
    ]),
    // Tablero escalonado: visera angosta, panel de instrumentos y consola.
    {
      geometry: chamferWedge({
        length: 0.28,
        height: 0.15,
        frontWidth: 0.9,
        rearWidth: 1.12,
        topFrontWidth: 0.78,
        topRearWidth: 1.0,
        chamfer: 0.035,
      }),
      position: [0, 1.08, 2.8],
      rotation: [-0.34, 0, 0],
      tile: 1,
    },
    {
      geometry: panel(0.92, 0.18, 0.045),
      position: [0, 1.18, 2.73],
      rotation: [-0.58, 0, 0],
      tile: 3,
    },
    {
      geometry: chamferBox(1.04, 0.045, 0.14, 0.018),
      position: [0, 1.29, 2.67],
      rotation: [-0.68, 0, 0],
      tile: 2,
    },
    {
      geometry: chamferWedge({
        length: 0.82,
        height: 0.32,
        frontWidth: 0.24,
        rearWidth: 0.34,
        chamfer: 0.035,
      }),
      position: [0, 0.98, 2.08],
      tile: 3,
    },
    {
      geometry: chamferBox(0.42, 0.04, 0.18, 0.015),
      position: [0, 2.08, 2.42],
      rotation: [0.05, 0, 0],
      tile: 3,
    },
    // Pedales, cíclicos y colectivos.
    ...[-1, 1].flatMap((side) => [
      {
        geometry: chamferBox(0.18, 0.04, 0.3, 0.015),
        position: [side * 0.42, 0.8, 2.62] as Vec3,
        rotation: [-0.28, 0, 0] as Euler,
        tile: 2 as AtlasTile,
      },
      createTubePart(
        [side * 0.48, 0.82, 1.87],
        [side * 0.48, 1.16, 1.79],
        0.028,
        8,
        2,
      ),
      {
        geometry: chamferBox(0.14, 0.06, 0.08, 0.018),
        position: [side * 0.48, 1.18, 1.77] as Vec3,
        tile: 3 as AtlasTile,
      },
      createTubePart(
        [side * 0.72, 0.84, 1.5],
        [side * 0.65, 1.04, 1.7],
        0.025,
        8,
        2,
      ),
    ]),
  ];
  for (const x of [-0.42, -0.14, 0.14, 0.42]) {
    parts.push({
      geometry: new CylinderGeometry(0.055, 0.055, 0.025, 10),
      position: [x * 0.78, 1.19, 2.71],
      rotation: [Math.PI / 2 - 0.58, 0, 0],
      tile: 2,
    });
  }
  return parts;
}

/**
 * Rotor principal de cinco palas. El cubo del Mi-8 es alto y lleno de herrajes
 * (plato cíclico, amortiguadores de arrastre, bielas de paso); resuelto como un
 * disco liso el helicóptero pierde justo la pieza que lo identifica de lejos.
 */
function createMainRotorGeometry(
  segments: number,
  simplified: boolean,
): BufferGeometry {
  const gripRadius = 0.38;
  const tip = 3.9;
  const parts: GeometryPart[] = [
    { geometry: new CylinderGeometry(0.3, 0.34, 0.26, segments), tile: 2 },
    { geometry: new CylinderGeometry(0.13, 0.13, 0.54, segments), position: [0, 0.26, 0], tile: 2 },
    { geometry: new CylinderGeometry(0.15, 0.18, 0.09, segments), position: [0, 0.5, 0], tile: 2 },
    // Plato cíclico bajo el cubo.
    { geometry: new CylinderGeometry(0.4, 0.4, 0.09, segments), position: [0, -0.24, 0], tile: 2 },
    { geometry: new CylinderGeometry(0.34, 0.3, 0.07, segments), position: [0, -0.34, 0], tile: 1 },
  ];
  const blades = simplified ? 3 : 5;
  const bladeLength = tip - gripRadius;
  for (let index = 0; index < blades; index += 1) {
    const angle = (Math.PI * 2 * index) / blades;
    const seat: Vec3 = [
      Math.sin(angle) * ((gripRadius + tip) / 2),
      0,
      Math.cos(angle) * ((gripRadius + tip) / 2),
    ];
    const spin: Euler = [0, angle, 0.13];
    // Banda antiabrasión del borde de ataque. Es una tira angosta, pero sin ella
    // la pala es una tabla de un solo tono y a contraluz lee como madera.
    const leadingEdge = chamferBox(0.05, 0.065, bladeLength, 0.012);
    leadingEdge.translate(0.11, 0, 0);
    parts.push(
      {
        // Pala con paso y afinada hacia la punta.
        geometry: chamferWedge({
          length: bladeLength,
          height: 0.055,
          frontWidth: 0.2,
          rearWidth: 0.3,
          chamfer: 0.014,
        }),
        position: seat,
        rotation: spin,
        tile: 1,
      },
      { geometry: leadingEdge, position: seat, rotation: spin, tile: 2 },
    );
    if (simplified) continue;
    parts.push(
      // Puño, amortiguador de arrastre y biela de paso.
      {
        geometry: chamferBox(0.15, 0.14, 0.46, 0.025),
        position: [Math.sin(angle) * 0.36, 0, Math.cos(angle) * 0.36],
        rotation: [0, angle, 0],
        tile: 2,
      },
      {
        geometry: new CylinderGeometry(0.045, 0.045, 0.3, 8),
        position: [Math.sin(angle + 0.4) * 0.36, -0.1, Math.cos(angle + 0.4) * 0.36],
        rotation: [Math.PI / 2, angle, 0],
        tile: 3,
      },
      createTubePart(
        [Math.sin(angle - 0.32) * 0.4, -0.22, Math.cos(angle - 0.32) * 0.4],
        [Math.sin(angle) * 0.3, 0.14, Math.cos(angle) * 0.3],
        0.022,
        6,
        2,
      ),
    );
  }
  return mergeParts(parts);
}

/** Rotor de cola de tres palas, montado de canto sobre la deriva. */
function createTailRotorGeometry(
  segments: number,
  simplified: boolean,
): BufferGeometry {
  const tip = 0.78;
  const hub = 0.14;
  const parts: GeometryPart[] = [
    { geometry: new CylinderGeometry(hub, hub, 0.2, segments), rotation: [Math.PI / 2, 0, 0], tile: 2 },
    { geometry: new CylinderGeometry(0.2, 0.17, 0.06, segments), position: [0, 0, -0.12], rotation: [Math.PI / 2, 0, 0], tile: 1 },
    { geometry: new SphereGeometry(0.11, segments, Math.max(4, segments / 2)), position: [0, 0, 0.13], scale: [1, 1, 1.4], tile: 2 },
  ];
  const blades = simplified ? 2 : 3;
  for (let index = 0; index < blades; index += 1) {
    const angle = (Math.PI * 2 * index) / blades;
    const radial: Vec3 = [
      Math.cos(angle + Math.PI / 2),
      Math.sin(angle + Math.PI / 2),
      0,
    ];
    const seat: Vec3 = [
      radial[0] * ((hub + tip) / 2),
      radial[1] * ((hub + tip) / 2),
      0,
    ];
    const spin: Euler = [Math.PI / 2, 0.24, angle];
    // Misma banda de borde de ataque que en el rotor principal.
    const leadingEdge = chamferBox(0.04, 0.05, tip - hub, 0.01);
    leadingEdge.translate(0.055, 0, 0);
    parts.push(
      {
        geometry: chamferWedge({
          length: tip - hub,
          height: 0.04,
          frontWidth: 0.14,
          rearWidth: 0.09,
          chamfer: 0.012,
        }),
        position: seat,
        rotation: spin,
        tile: 1,
      },
      { geometry: leadingEdge, position: seat, rotation: spin, tile: 2 },
    );
    if (simplified) continue;
    parts.push({
      geometry: chamferBox(0.08, 0.08, 0.12, 0.02),
      position: [radial[0] * (hub + 0.07), radial[1] * (hub + 0.07), 0],
      rotation: [0, 0, angle],
      tile: 2,
    });
  }
  return mergeParts(parts);
}

function wreckedHelicopterCabinParts(segments: number): GeometryPart[] {
  const parts: GeometryPart[] = [
    {
      geometry: chamferWedge({
        length: 3.25,
        height: 0.62,
        frontWidth: 1.05,
        rearWidth: 1.84,
        topFrontWidth: 1.58,
        topRearWidth: 2.02,
        topOffsetY: 0.08,
        chamfer: 0.12,
      }),
      position: [0, 0.55, 0.24],
      rotation: [-0.06, 0.03, -0.05],
      tile: 0,
    },
    {
      geometry: chamferBox(1.74, 0.1, 2.82, 0.035),
      position: [0, 0.8, 0.02],
      rotation: [-0.03, 0.02, -0.04],
      tile: 3,
    },
    {
      geometry: chamferBox(1.15, 0.08, 1.45, 0.025),
      position: [-0.3, 0.27, -0.12],
      rotation: [-0.08, 0.16, 0.13],
      tile: 3,
    },
    // El techo queda hundido y torcido, pero conserva la silueta de la cabina.
    {
      geometry: chamferWedge({
        length: 2.08,
        height: 0.17,
        frontWidth: 0.92,
        rearWidth: 1.18,
        chamfer: 0.055,
      }),
      position: [-0.32, 1.87, -0.22],
      rotation: [0.08, 0.03, 0.24],
      tile: 0,
    },
    {
      geometry: chamferWedge({
        length: 1.68,
        height: 0.15,
        frontWidth: 0.62,
        rearWidth: 0.86,
        chamfer: 0.05,
      }),
      position: [0.52, 1.72, -0.12],
      rotation: [-0.12, -0.14, -0.32],
      tile: 1,
    },
    {
      geometry: chamferBox(0.74, 0.07, 0.9, 0.025),
      position: [-0.42, 1.79, -0.58],
      rotation: [0.14, -0.1, 0.28],
      tile: 3,
    },
    // Costados partidos: los huecos exponen el interior en vez de depender de
    // ver la cara trasera de un casco cerrado.
    {
      geometry: chamferBox(0.13, 1.12, 1.56, 0.04),
      position: [1.02, 1.24, -0.48],
      rotation: [0.12, -0.18, -0.34],
      tile: 0,
    },
    {
      geometry: chamferBox(0.14, 0.72, 0.92, 0.04),
      position: [0.84, 1.1, 0.87],
      rotation: [-0.08, -0.18, -0.14],
      tile: 0,
    },
    {
      geometry: chamferBox(0.13, 0.98, 0.82, 0.04),
      position: [-0.92, 1.27, -1.0],
      rotation: [0.04, 0.05, 0.12],
      tile: 0,
    },
    {
      geometry: chamferBox(0.14, 0.58, 0.64, 0.04),
      position: [-0.78, 1.06, 0.98],
      rotation: [-0.1, 0.25, 0.2],
      tile: 0,
    },
    // Morro aplastado en dos capas, con la chapa clara expuesta en la rotura.
    {
      geometry: chamferWedge({
        length: 0.92,
        height: 0.74,
        frontWidth: 0.72,
        rearWidth: 1.58,
        topFrontWidth: 1.04,
        topRearWidth: 1.46,
        chamfer: 0.1,
      }),
      position: [0.06, 0.82, 1.79],
      rotation: [-0.2, 0.08, -0.08],
      tile: 1,
    },
    {
      geometry: chamferWedge({
        length: 0.62,
        height: 0.32,
        frontWidth: 0.52,
        rearWidth: 1.34,
        topFrontWidth: 0.8,
        topRearWidth: 1.24,
        chamfer: 0.07,
      }),
      position: [-0.08, 1.35, 1.7],
      rotation: [-0.25, -0.06, 0.12],
      tile: 0,
    },
    // Interior reconocible a través del lateral arrancado.
    {
      geometry: chamferBox(0.48, 0.12, 0.48, 0.035),
      position: [-0.42, 0.89, 0.75],
      rotation: [0.06, 0.1, 0.18],
      tile: 3,
    },
    {
      geometry: chamferBox(0.48, 0.56, 0.12, 0.035),
      position: [-0.39, 1.19, 0.55],
      rotation: [-0.22, 0.08, 0.18],
      tile: 3,
    },
    {
      geometry: chamferBox(0.52, 0.12, 0.48, 0.035),
      position: [0.38, 0.91, 0.62],
      rotation: [-0.08, -0.16, -0.12],
      tile: 3,
    },
    {
      geometry: chamferBox(0.52, 0.5, 0.12, 0.035),
      position: [0.42, 1.16, 0.46],
      rotation: [-0.35, -0.08, -0.12],
      tile: 3,
    },
    {
      geometry: chamferBox(1.22, 0.26, 0.3, 0.04),
      position: [0.02, 1.19, 1.28],
      rotation: [-0.48, 0.04, 0.04],
      tile: 3,
    },
    // Mamparo trasero carbonizado y caja de munición suelta.
    {
      geometry: chamferBox(1.58, 1.1, 0.11, 0.035),
      position: [0.02, 1.28, -1.45],
      rotation: [0.02, 0.04, -0.08],
      tile: 3,
    },
    {
      geometry: chamferBox(0.4, 0.3, 0.56, 0.04),
      position: [0.42, 0.98, -0.72],
      rotation: [0.12, 0.26, -0.18],
      tile: 1,
    },
    // Marco de parabrisas doblado; el vano queda realmente abierto.
    createTubePart([-0.7, 1.15, 1.98], [-0.55, 1.76, 1.46], 0.045, 8, 2),
    createTubePart([0.7, 1.13, 1.96], [0.62, 1.78, 1.45], 0.045, 8, 2),
    createTubePart([0, 1.13, 2.05], [0.08, 1.73, 1.48], 0.038, 8, 2),
    createTubePart([-0.55, 1.76, 1.46], [0.62, 1.78, 1.45], 0.045, 8, 2),
    createTubePart([-0.7, 1.15, 1.98], [0.7, 1.13, 1.96], 0.04, 8, 2),
    // Costillas expuestas en el corte de cola y marco de puerta.
    createTubePart([-0.82, 0.83, -1.5], [-0.78, 1.78, -1.46], 0.045, 8, 2),
    createTubePart([0.82, 0.82, -1.48], [0.75, 1.72, -1.45], 0.045, 8, 2),
    createTubePart([-0.82, 0.83, -1.5], [0.82, 0.82, -1.48], 0.04, 8, 2),
    createTubePart([-0.78, 1.78, -1.46], [0.75, 1.72, -1.45], 0.04, 8, 2),
    createTubePart([-0.94, 0.82, -0.35], [-0.91, 1.77, -0.28], 0.038, 8, 2),
    createTubePart([-0.94, 0.82, 0.62], [-0.82, 1.72, 0.6], 0.038, 8, 2),
    createTubePart([-0.91, 1.77, -0.28], [-0.82, 1.72, 0.6], 0.038, 8, 2),
  ];

  const mainWheel = buildWheel({
    radius: 0.28,
    width: 0.18,
    segments: Math.max(10, segments),
    treadCount: 0,
  });
  parts.push(
    {
      geometry: mainWheel.tire.clone(),
      position: [-1.06, 0.3, -0.5],
      rotation: [0.08, 0.12, -0.18],
      tile: 3,
    },
    {
      geometry: mainWheel.rim.clone(),
      position: [-1.06, 0.3, -0.5],
      rotation: [0.08, 0.12, -0.18],
      tile: 2,
    },
    {
      geometry: mainWheel.tire.clone(),
      position: [0.88, 0.29, -0.36],
      rotation: [0.36, 0.08, 0.34],
      tile: 3,
    },
    {
      geometry: mainWheel.rim.clone(),
      position: [0.88, 0.29, -0.36],
      rotation: [0.36, 0.08, 0.34],
      tile: 2,
    },
    createTubePart([-0.78, 0.85, -0.42], [-1.03, 0.36, -0.5], 0.06, 8, 2),
    createTubePart([0.72, 0.84, -0.44], [0.85, 0.35, -0.35], 0.06, 8, 2),
  );
  mainWheel.tire.dispose();
  mainWheel.rim.dispose();

  return parts;
}

function wreckedHelicopterEngineParts(segments: number): GeometryPart[] {
  return [
    {
      geometry: roundedBox(1.36, 0.5, 1.18, 0.14, 2),
      position: [0, 0.22, 0],
      rotation: [0.08, -0.06, -0.12],
      tile: 3,
    },
    ...[-1, 1].flatMap((side) => [
      {
        geometry: new CylinderGeometry(0.25, 0.22, 0.92, segments),
        position: [side * 0.34, 0.18, 0.05] as Vec3,
        rotation: [Math.PI / 2, 0, 0] as Euler,
        tile: 2 as AtlasTile,
      },
      {
        geometry: new TorusGeometry(0.24, 0.035, 5, segments),
        position: [side * 0.34, 0.18, 0.52] as Vec3,
        tile: 1 as AtlasTile,
      },
      createTubePart(
        [side * 0.42, 0.16, -0.38],
        [side * 0.74, 0.06, -0.72],
        0.11,
        Math.max(8, segments),
        2,
      ),
    ]),
    {
      geometry: new CylinderGeometry(0.34, 0.38, 0.22, segments),
      position: [0, 0.53, -0.1],
      tile: 2,
    },
    {
      geometry: new CylinderGeometry(0.11, 0.14, 0.72, segments),
      position: [0.06, 0.83, -0.08],
      rotation: [0.08, 0, 0.14],
      tile: 2,
    },
    createTubePart([-0.5, 0.42, 0.26], [0.46, 0.62, -0.28], 0.035, 8, 1),
    createTubePart([0.46, 0.4, 0.28], [-0.42, 0.58, -0.34], 0.03, 8, 1),
  ];
}

function wreckedHelicopterTailParts(segments: number): GeometryPart[] {
  const parts: GeometryPart[] = [
    {
      geometry: new CylinderGeometry(0.34, 0.17, 2.75, segments),
      position: [0, 0.54, -1.38],
      rotation: [Math.PI / 2 - 0.04, 0, 0],
      tile: 0,
    },
    // Collar arrancado y largueros/cables que quedan al descubierto.
    {
      geometry: new TorusGeometry(0.35, 0.045, 5, segments, Math.PI * 1.55),
      position: [0, 0.5, 0.01],
      rotation: [0, 0, 0.35],
      tile: 2,
    },
    createTubePart([-0.18, 0.5, 0.08], [-0.08, 0.43, -0.68], 0.022, 6, 2),
    createTubePart([0.16, 0.62, 0.04], [0.06, 0.55, -0.74], 0.022, 6, 1),
    {
      geometry: chamferWedge({
        length: 0.78,
        height: 1.0,
        frontWidth: 0.19,
        rearWidth: 0.1,
        chamfer: 0.03,
      }),
      position: [0, 1.08, -2.55],
      rotation: [-0.32, 0, 0.06],
      tile: 0,
    },
    {
      geometry: chamferWedge({
        length: 0.68,
        height: 0.14,
        frontWidth: 1.45,
        rearWidth: 0.88,
        chamfer: 0.035,
      }),
      position: [0, 0.66, -2.18],
      rotation: [0.02, 0.06, -0.1],
      tile: 1,
    },
    {
      geometry: chamferBox(0.32, 0.32, 0.38, 0.05),
      position: [0.13, 1.18, -2.7],
      tile: 2,
    },
  ];
  const tailRotor = createTailRotorGeometry(Math.max(8, segments), true);
  tailRotor.deleteAttribute("color");
  parts.push({
    geometry: tailRotor,
    position: [0.28, 1.2, -2.72],
    rotation: [0.18, Math.PI / 2, 0.28],
    scale: [0.72, 0.72, 0.72],
    tile: 2,
  });
  return parts;
}

function wreckedHelicopterRotorParts(segments: number): GeometryPart[] {
  const parts: GeometryPart[] = [
    {
      geometry: new CylinderGeometry(0.3, 0.34, 0.25, segments),
      position: [0, 0.18, 0],
      tile: 2,
    },
    {
      geometry: new CylinderGeometry(0.11, 0.14, 0.62, segments),
      position: [0.03, 0.44, 0],
      rotation: [0.12, 0, -0.16],
      tile: 2,
    },
    {
      geometry: new CylinderGeometry(0.38, 0.38, 0.08, segments),
      position: [0, 0.02, 0],
      tile: 1,
    },
  ];
  const bladeSpecs: readonly {
    readonly length: number;
    readonly angle: number;
    readonly lift: number;
    readonly bend: number;
  }[] = [
    { length: 2.82, angle: 0.08, lift: 0.13, bend: 0.1 },
    { length: 2.14, angle: 2.05, lift: 0.03, bend: -0.16 },
    { length: 1.22, angle: 4.2, lift: 0.2, bend: 0.24 },
  ];
  for (const blade of bladeSpecs) {
    const radialX = Math.sin(blade.angle);
    const radialZ = Math.cos(blade.angle);
    parts.push(
      {
        geometry: chamferWedge({
          length: blade.length,
          height: 0.065,
          frontWidth: 0.2,
          rearWidth: 0.3,
          chamfer: 0.014,
        }),
        position: [
          radialX * (blade.length / 2 + 0.28),
          blade.lift,
          radialZ * (blade.length / 2 + 0.28),
        ],
        rotation: [blade.bend, blade.angle, 0.12 + blade.bend],
        tile: 1,
      },
      {
        geometry: chamferBox(0.06, 0.07, blade.length * 0.88, 0.012),
        position: [
          radialX * (blade.length / 2 + 0.31),
          blade.lift + 0.015,
          radialZ * (blade.length / 2 + 0.31),
        ],
        rotation: [blade.bend, blade.angle, 0.12 + blade.bend],
        tile: 2,
      },
    );
  }
  return parts;
}

function wreckedHelicopterDebrisParts(segments: number): GeometryPart[] {
  return [
    // Puerta corrediza arrancada, apoyada de canto contra el casco.
    {
      geometry: chamferBox(0.09, 0.94, 0.96, 0.035),
      position: [-1.32, 0.55, 0.18],
      rotation: [0.18, -0.26, 0.92],
      tile: 0,
    },
    {
      geometry: chamferBox(0.06, 0.38, 0.74, 0.025),
      position: [1.28, 0.28, 1.02],
      rotation: [1.08, 0.2, -0.35],
      tile: 1,
    },
    {
      geometry: chamferWedge({
        length: 0.72,
        height: 0.07,
        frontWidth: 0.16,
        rearWidth: 0.58,
        chamfer: 0.018,
      }),
      position: [-1.22, 0.25, -1.28],
      rotation: [0.25, 0.46, 0.32],
      tile: 0,
    },
    {
      geometry: new TorusGeometry(0.2, 0.026, 5, Math.max(8, segments)),
      position: [1.18, 0.3, -1.36],
      rotation: [1.18, 0.22, 0.18],
      tile: 2,
    },
    createTubePart([-1.42, 0.24, 1.42], [-0.74, 0.32, 1.08], 0.025, 6, 2),
    createTubePart([0.92, 0.23, -1.5], [1.46, 0.3, -0.94], 0.022, 6, 1),
  ];
}

function wreckedHelicopterGlassParts(): GeometryPart[] {
  return [
    {
      geometry: chamferWedge({
        length: 0.56,
        height: 0.018,
        frontWidth: 0.08,
        rearWidth: 0.42,
        chamfer: 0.006,
      }),
      position: [-0.34, 0.29, 1.72],
      rotation: [0.28, 0.18, 0.24],
      tile: 0,
    },
    {
      geometry: chamferWedge({
        length: 0.42,
        height: 0.018,
        frontWidth: 0.06,
        rearWidth: 0.34,
        chamfer: 0.006,
      }),
      position: [0.64, 0.25, 1.53],
      rotation: [0.16, -0.42, -0.18],
      tile: 0,
    },
  ];
}

function buildHelicopterLod(
  context: BuildContext,
  root: Node,
  lod: 0 | 1 | 2,
  glassMaterial: Material,
): void {
  const suffix = lod === 0 ? "" : `_lod${lod}`;
  const segments = lod === 0 ? 22 : lod === 1 ? 12 : 6;
  const detailed = lod === 0;
  const { floorY, roofY, halfWidth } = HELI_CABIN;
  const glassParts: GeometryPart[] = [];
  const fuselageParts: GeometryPart[] = [
    // La piel del LOD0 se arma por bandas y comparte los vanos con el forro.
    // En distancia vuelve al volumen cerrado, donde esos huecos ya no ocupan
    // píxeles y sí encarecerían el modelo.
    ...helicopterCabinShellParts(detailed),
    // Panza del morro: cae y se angosta hacia la punta, por debajo del piso.
    {
      geometry: chamferWedge({
        length: 1.24,
        height: 0.66,
        frontWidth: 1.08,
        rearWidth: 1.98,
        topFrontWidth: 1.44,
        topRearWidth: 2.12,
        chamfer: 0.15,
      }),
      position: [0, 0.64, 2.42],
      rotation: [0.09, 0, 0],
      tile: 0,
    },
    // Piso y techo del puesto de vuelo. El morro va ABIERTO por delante: con el
    // parabrisas transparente, detrás tiene que haber una cabina y no el macizo
    // del fuselaje.
    { geometry: chamferBox(1.72, 0.1, 1.84, 0.04), position: [0, floorY, 2.14], tile: 3 },
    // El techo del puesto se angosta hacia el parabrisas y se empalma con la
    // cabina por un carenado: a tope de cajones el morro leía como una galería
    // de vidrio pegada al frente.
    {
      geometry: chamferWedge({
        length: 1.62,
        height: 0.13,
        frontWidth: 1.3,
        rearWidth: 1.82,
        chamfer: 0.05,
      }),
      position: [0, roofY - 0.11, 2.02],
      rotation: [0.06, 0, 0],
      tile: 0,
    },
    {
      geometry: chamferWedge({
        length: 0.5,
        height: 0.46,
        frontWidth: 1.86,
        rearWidth: 2.12,
        topFrontWidth: 1.56,
        topRearWidth: 1.96,
        chamfer: 0.14,
      }),
      position: [0, 1.98, 1.32],
      tile: 0,
    },
    // Mamparo que separa el puesto de la bodega. Va oscuro a propósito: es el
    // fondo que se ve a través del parabrisas, y en gris claro convertía el
    // cristal en un panel lechoso.
    { geometry: panel(1.9, 1.4, 0.08), position: [0, 1.45, 1.22], tile: 3 },
    // Cubierta de motores y carenado del mástil.
    {
      geometry: roundedBox(1.5, 0.66, 2.1, 0.24, detailed ? 3 : 1),
      position: [0, 2.5, 0.2],
      tile: 0,
    },
    { geometry: chamferWedge({ length: 0.8, height: 0.3, frontWidth: 0.7, rearWidth: 0.5, topFrontWidth: 0.5, topRearWidth: 0.34, chamfer: 0.06 }), position: [0, 2.92, HELI_ROTOR.z], tile: 2 },
    // Botalón: un solo cono continuo. Dos cilindros encadenados dejaban un
    // escalón anular justo en la unión, que a contraluz lee como una rotura.
    {
      geometry: new CylinderGeometry(0.34, 0.185, 4.1, segments),
      position: [0, 1.86, -3.66],
      rotation: [Math.PI / 2 - 0.035, 0, 0],
      tile: 0,
    },
    // Popa afinada: la cabina no termina en un tabique plano, se estrecha y
    // sube hasta empalmar con el botalón.
    {
      geometry: chamferWedge({
        length: 1.02,
        height: 1.5,
        frontWidth: 2.08,
        rearWidth: 0.92,
        topFrontWidth: 1.92,
        topRearWidth: 0.78,
        chamfer: 0.2,
      }),
      position: [0, 1.54, -2.44],
      rotation: [0.12, 0, 0],
      tile: 0,
    },
    // Deriva barrida, con raíz engrosada, y estabilizador horizontal.
    {
      geometry: chamferWedge({ length: 0.92, height: 1.2, frontWidth: 0.19, rearWidth: 0.1, chamfer: 0.03 }),
      position: [0, 2.16, -5.86],
      rotation: [-0.34, 0, 0],
      tile: 0,
    },
    {
      geometry: chamferWedge({ length: 1.15, height: 0.42, frontWidth: 0.3, rearWidth: 0.2, chamfer: 0.08 }),
      position: [0, 1.72, -5.62],
      rotation: [-0.34, 0, 0],
      tile: 0,
    },
    {
      geometry: chamferWedge({ length: 0.66, height: 0.13, frontWidth: 1.66, rearWidth: 1.18, chamfer: 0.03 }),
      position: [0, 1.79, -4.82],
      tile: 0,
    },
    // Carenados de anclaje del estabilizador al botalón.
    ...[-1, 1].map((side) => ({
      geometry: chamferWedge({ length: 0.76, height: 0.2, frontWidth: 0.24, rearWidth: 0.14, chamfer: 0.05 }),
      position: [side * 0.3, 1.8, -4.8] as Vec3,
      tile: 0 as AtlasTile,
    })),
  ];

  // Tren triciclo fijo: dos ruedas de morro juntas y un tren principal ancho
  // sobre balancines. El modelo anterior traía patines, que no son de este
  // aparato.
  const noseWheel = buildWheel({ radius: 0.17, width: 0.12, segments, treadCount: detailed ? 10 : 0 });
  const mainWheel = buildWheel({ radius: 0.3, width: 0.19, segments, treadCount: detailed ? 14 : 0 });
  for (const side of [-1, 1] as const) {
    fuselageParts.push(
      { geometry: noseWheel.tire.clone(), position: [side * 0.14, 0.17, 2.36], tile: 3 },
      { geometry: noseWheel.rim.clone(), position: [side * 0.14, 0.17, 2.36], tile: 2 },
      { geometry: mainWheel.tire.clone(), position: [side * 1.24, 0.3, -0.52], tile: 3 },
      { geometry: mainWheel.rim.clone(), position: [side * 1.24, 0.3, -0.52], tile: 2 },
      // Pata principal: balancín, compás y amortiguador oleoneumático.
      createTubePart([side * 0.86, 0.92, -0.28], [side * 1.2, 0.34, -0.5], 0.075, segments, 2),
      createTubePart([side * 0.8, 0.66, -1.12], [side * 1.2, 0.34, -0.56], 0.055, segments, 2),
      createTubePart([side * 0.92, 1.16, -0.52], [side * 1.18, 0.46, -0.52], 0.06, segments, 2),
    );
  }
  noseWheel.tire.dispose();
  noseWheel.rim.dispose();
  mainWheel.tire.dispose();
  mainWheel.rim.dispose();
  fuselageParts.push(
    createTubePart([0, 0.52, 2.36], [0, 0.2, 2.36], 0.07, segments, 2),
    { geometry: chamferBox(0.42, 0.1, 0.14, 0.03), position: [0, 0.2, 2.36], tile: 2 },
  );

  // Parabrisas del Mi-8: dos cristales grandes muy tumbados, partidos por el
  // montante central, más las ventanillas laterales del puesto. El cristal va
  // en su propia malla porque lleva otro material.
  const rake = HELI_WINDSHIELD.rake;
  for (const side of [-1, 1] as const) {
    glassParts.push({
      geometry: chamferBox(0.68, HELI_WINDSHIELD.height, 0.03, 0.01),
      position: [side * 0.37, HELI_WINDSHIELD.y, HELI_WINDSHIELD.z],
      rotation: [rake, 0, 0],
      tile: 0,
    });
    // Ventanilla lateral, sobre la puerta del puesto.
    glassParts.push({
      geometry: chamferBox(0.03, 0.52, 0.62, 0.01),
      position: [side * 0.9, 1.7, 2.3],
      rotation: [0, -side * 0.29, 0],
      tile: 0,
    });
  }
  fuselageParts.push(
    // Montante central, largueros del marco y montantes exteriores.
    { geometry: chamferBox(0.045, HELI_WINDSHIELD.height + 0.04, 0.05, 0.012), position: [0, HELI_WINDSHIELD.y, HELI_WINDSHIELD.z + 0.02], rotation: [rake, 0, 0], tile: 2 },
    { geometry: chamferBox(1.5, 0.06, 0.075, 0.018), position: [0, 2.09, 2.31], rotation: [rake, 0, 0], tile: 2 },
    { geometry: chamferBox(1.5, 0.075, 0.09, 0.02), position: [0, 1.36, 2.9], rotation: [rake, 0, 0], tile: 2 },
    ...[-1, 1].map((side) => ({
      geometry: chamferBox(0.05, HELI_WINDSHIELD.height + 0.04, 0.055, 0.012),
      position: [side * 0.74, HELI_WINDSHIELD.y, HELI_WINDSHIELD.z + 0.02] as Vec3,
      rotation: [rake, 0, 0] as Euler,
      tile: 2 as AtlasTile,
    })),
    // Costado bajo del puesto: de la cintura para abajo el morro es chapa.
    ...[-1, 1].map((side) => ({
      geometry: chamferBox(0.1, 0.66, 1.74, 0.04),
      position: [side * 0.9, 1.06, 2.08] as Vec3,
      rotation: [0, -side * 0.29, 0] as Euler,
      tile: 0 as AtlasTile,
    })),
    // Marco de las ventanillas laterales.
    ...[-1, 1].flatMap((side) => [
      {
        geometry: chamferBox(0.045, 0.045, 0.64, 0.012),
        position: [side * 0.9, 1.98, 2.3] as Vec3,
        rotation: [0, -side * 0.29, 0] as Euler,
        tile: 2 as AtlasTile,
      },
      {
        geometry: chamferBox(0.045, 0.045, 0.64, 0.012),
        position: [side * 0.9, 1.42, 2.3] as Vec3,
        rotation: [0, -side * 0.29, 0] as Euler,
        tile: 2 as AtlasTile,
      },
    ]),
  );

  // Portillas de la bodega. La banda de la puerta lleva menos porque ahí va el
  // vano corredizo y el pivote de la ametralladora.
  // Portillas de la bodega. Babor lleva sólo dos: el resto de la banda se la
  // come el vano de la puerta corrediza.
  const portholes = HELI_PORTHOLES;
  for (const [side, z] of portholes) {
    const porthole = portholeParts(
      [side * halfWidth, HELI_CABIN.portholeY, z],
      HELI_CABIN.portholeRadius,
      Math.max(8, segments),
    );
    fuselageParts.push(...porthole.shell);
    glassParts.push(...porthole.glass);
  }

  if (lod < 2) {
    fuselageParts.push(
      // Puerta corrediza abierta: la hoja va corrida hacia popa y por FUERA de
      // la piel. La chapa hundida que tapaba el vano le comía la vista al
      // artillero, que dispara justo por ahí.
      { geometry: chamferBox(0.09, 0.96, 1.0, 0.03), position: [-1.12, 1.5, -0.72], tile: 0 },
      ...[1.02, 1.98].map((y) => ({
        geometry: chamferBox(0.11, 0.06, 2.2, 0.02),
        position: [-1.1, y, -0.2] as Vec3,
        tile: 2 as AtlasTile,
      })),
      ...[0.88, -0.18].map((z) => ({
        geometry: chamferBox(0.12, 1.0, 0.09, 0.025),
        position: [-1.06, 1.5, z] as Vec3,
        tile: 2 as AtlasTile,
      })),
    );
  }

  if (detailed) {
    fuselageParts.push(
      // Tomas de aire de las turbinas y escapes laterales.
      ...[-1, 1].flatMap((side) => [
        {
          geometry: new CylinderGeometry(0.27, 0.27, 0.36, segments),
          position: [side * 0.4, 2.52, 1.26] as Vec3,
          rotation: [Math.PI / 2, 0, 0] as Euler,
          tile: 2 as AtlasTile,
        },
        {
          geometry: new TorusGeometry(0.27, 0.035, 5, segments),
          position: [side * 0.4, 2.52, 1.44] as Vec3,
          tile: 1 as AtlasTile,
        },
        createTubePart([side * 0.52, 2.42, -0.32], [side * 0.82, 2.52, -0.72], 0.15, segments, 2),
      ]),
      // Relieve de paneles y bocas de servicio del capó.
      ...ribParts([0, 2.83, 0.2], [0, 0, 1], 4, 0.44, [0.86, 0.035, 0.06], 0),
      { geometry: chamferBox(0.5, 0.06, 0.62, 0.02), position: [0.52, 2.8, 0.76], tile: 2 },
      // Larguerillos del costado: sin ellos el fuselaje son cuatro metros de
      // chapa lisa con las portillas flotando encima.
      ...[-1, 1].flatMap((side) => [
        {
          geometry: chamferBox(0.07, 0.09, 3.0, 0.02),
          position: [side * (HELI_CABIN.halfWidth + 0.01), 1.16, -0.38] as Vec3,
          tile: 0 as AtlasTile,
        },
        {
          geometry: chamferBox(0.06, 0.07, 3.0, 0.02),
          position: [side * (HELI_CABIN.halfWidth + 0.01), 2.02, -0.38] as Vec3,
          tile: 0 as AtlasTile,
        },
        {
          geometry: rivetRow(
            [side * (HELI_CABIN.halfWidth + 0.02), 1.28, -1.7],
            [side * (HELI_CABIN.halfWidth + 0.02), 1.28, 1.1],
            13,
            0.017,
            "x",
          ),
          tile: 2 as AtlasTile,
        },
      ]),
      // Refuerzos longitudinales del botalón y del empenaje.
      ...ribParts([0, 1.86, -3.0], [0, 0, 1], 6, 0.5, [0.52, 0.05, 0.06], 1),
      // Estribos de acceso, asideros y tubo de pitot.
      ...[-1, 1].flatMap((side) => [
        {
          geometry: chamferBox(0.3, 0.07, 0.16, 0.02),
          position: [side * 1.02, 0.55, 1.0] as Vec3,
          tile: 2 as AtlasTile,
        },
        createTubePart([side * 1.1, 1.0, 1.12], [side * 1.1, 1.62, 1.0], 0.03, 8, 2),
        createTubePart([side * 0.5, 1.32, 2.98], [side * 0.62, 1.28, 3.24], 0.022, 6, 2),
      ]),
      // Faro de aterrizaje bajo el morro y baliza sobre el botalón.
      { geometry: new CylinderGeometry(0.16, 0.16, 0.14, segments), position: [0, 0.42, 2.6], rotation: [Math.PI / 2 - 1.1, 0, 0], tile: 2 },
      { geometry: new CylinderGeometry(0.12, 0.12, 0.04, segments), position: [0, 0.35, 2.63], rotation: [Math.PI / 2 - 1.1, 0, 0], tile: 1 },
      { geometry: new SphereGeometry(0.08, 10, 8), position: [0, 2.02, -2.6], tile: 1 },
      // Antenas de látigo bajo el botalón.
      createTubePart([0, 1.5, -2.2], [0.1, 1.16, -2.75], 0.016, 6, 2),
      // Caja de engranajes del rotor de cola sobre la deriva.
      { geometry: chamferBox(0.34, 0.34, 0.4, 0.05), position: [HELI_TAIL_ROTOR.x * 0.45, HELI_TAIL_ROTOR.y, HELI_TAIL_ROTOR.z], tile: 2 },
      // Remachado del fuselaje y del arranque del botalón.
      { geometry: rivetRow([-1.1, 2.06, -1.6], [-1.1, 2.06, 1.1], 13, 0.019, "x"), tile: 2 },
      { geometry: rivetRow([1.1, 2.06, -1.6], [1.1, 2.06, 1.1], 13, 0.019, "x"), tile: 2 },
      { geometry: rivetRow([-0.78, 1.3, -1.98], [0.78, 1.3, -1.98], 10, 0.019, "z"), tile: 2 },
    );
  }

  createVisualNode(context, root, `helicopter_fuselage${suffix}`, fuselageParts);
  if (detailed) {
    // Forro de bodega, en malla aparte y SIN AO horneada. Va sólo en LOD0: la
    // cámara del tripulante vive dentro del casco, así que para él el LOD
    // siempre es el 0, y desde afuera la piel tapa el interior entero.
    // La AO va floja a propósito: a fuerza plena el horneado trata la bodega
    // como una cueva y la deja casi negra, y apagada del todo las paredes
    // quedan planas. Con poco alcanza para marcar rincones.
    createVisualNode(
      context,
      root,
      "helicopter_cabin",
      cabinInteriorParts(segments, portholes),
      { occlusionStrength: 0.36, extras: { kind: "interior" } },
    );
    createVisualNode(
      context,
      root,
      "helicopter_cockpit",
      helicopterCockpitInteriorParts(segments),
      { occlusionStrength: 0.22, extras: { kind: "interior" } },
    );
  }
  // El cristal va aparte: otro material y sin AO horneada, que sobre un vidrio
  // sólo lo ensucia.
  createVisualNode(context, root, `helicopter_glazing${suffix}`, glassParts, {
    material: glassMaterial,
    bakeOcclusion: false,
    extras: { kind: "glazing" },
  });

  // Los rotores entran en TODOS los LOD: un helicóptero sin disco a 190 m no
  // lee como lejano, lee como roto. Simplificados salen baratísimos.
  {
    const mainRotorGeometry = createMainRotorGeometry(segments, lod !== 0);
    const mainRotorMesh = createMesh(
      context,
      `helicopter_main_rotor_lod${lod}_mesh`,
      mainRotorGeometry,
    );
    mainRotorGeometry.dispose();
    createNode(context, root, `rotor_main${suffix}`, {
      mesh: mainRotorMesh,
      position: [0, HELI_ROTOR.y, HELI_ROTOR.z],
      extras: { kind: "rotor", axis: "+Y" },
    });

    const tailRotorGeometry = createTailRotorGeometry(segments, lod !== 0);
    const tailRotorMesh = createMesh(
      context,
      `helicopter_tail_rotor_lod${lod}_mesh`,
      tailRotorGeometry,
    );
    tailRotorGeometry.dispose();
    // El runtime hace girar `rotor_tail` sobre SU eje Z. El disco de un rotor de
    // cola es vertical y de canto, así que el nodo nace girado 90° en Y: de ahí
    // en más el mismo giro de siempre queda sobre el eje X del aparato.
    createNode(context, root, `rotor_tail${suffix}`, {
      mesh: tailRotorMesh,
      position: [HELI_TAIL_ROTOR.x, HELI_TAIL_ROTOR.y, HELI_TAIL_ROTOR.z],
      rotation: [0, Math.PI / 2, 0],
      extras: { kind: "rotor", axis: "+X" },
    });
  }

  if (lod < 2) {
    const turretYaw = createVisualNode(
      context,
      root,
      `turret_yaw${suffix}`,
      [
        // Pivote de la ametralladora de puerta, colgado del marco del vano.
        { geometry: new CylinderGeometry(0.21, 0.25, 0.18, segments), tile: 3 },
        { geometry: new CylinderGeometry(0.09, 0.09, 0.32, segments), position: [0, -0.19, 0], tile: 2 },
        { geometry: chamferBox(0.26, 0.07, 0.26, 0.02), position: [0, -0.34, 0], tile: 2 },
        ...(detailed
          ? [
              {
                geometry: chamferBox(0.2, 0.1, 0.2, 0.03),
                position: [0, 0.14, 0] as Vec3,
                tile: 1 as AtlasTile,
              },
            ]
          : []),
      ],
      {
        // Pintle vertical en el marco del vano, con el caño apuntando AFUERA
        // (−X). El cero de guiñada tiene que coincidir con el rumbo del ancla
        // `camera_gunner`: el rig le pasa al arma su `localYaw`, que es
        // relativo al ancla.
        position: [-1.12, 1.32, 0.35],
        rotation: [0, -Math.PI / 2, 0],
        extras: { kind: "turret-yaw" },
      },
    );
    const pitchParts: GeometryPart[] = [
      { geometry: chamferBox(0.3, 0.24, 0.4, 0.035), position: [0, 0, 0.08], tile: 1 },
      { geometry: new CylinderGeometry(0.055, 0.075, 1.15, segments), position: [0, 0, 0.66], rotation: [Math.PI / 2, 0, 0], tile: 2 },
    ];
    if (detailed) {
      pitchParts.push(
        // Camisa perforada, bocacha, cajón de cinta y empuñaduras.
        { geometry: new CylinderGeometry(0.095, 0.095, 0.44, segments), position: [0, 0, 0.42], rotation: [Math.PI / 2, 0, 0], tile: 1 },
        ...[0.7, 0.92].map((z) => ({
          geometry: new CylinderGeometry(0.085, 0.085, 0.035, segments),
          position: [0, 0, z] as Vec3,
          rotation: [Math.PI / 2, 0, 0] as Euler,
          tile: 1 as AtlasTile,
        })),
        { geometry: new CylinderGeometry(0.085, 0.1, 0.13, segments), position: [0, 0, 1.2], rotation: [Math.PI / 2, 0, 0], tile: 2 },
        { geometry: chamferBox(0.22, 0.24, 0.3, 0.03), position: [-0.22, -0.04, 0.02], tile: 3 },
        createTubePart([0, -0.1, -0.18], [0, -0.3, -0.3], 0.026, 8, 2),
        { geometry: chamferBox(0.07, 0.16, 0.06, 0.02), position: [0.13, -0.14, -0.14], tile: 2 },
      );
    }
    createVisualNode(
      context,
      turretYaw,
      `turret_pitch${suffix}`,
      pitchParts,
      { extras: { kind: "turret-pitch" } },
    );
  }
}

function buildHelicopter(context: BuildContext): void {
  const glassMaterial = createGlassMaterial(context.document, context.spec);
  for (const lod of [0, 1, 2] as const) {
    const root = createNode(context, context.sceneRoot, `visual_lod${lod}`, {
      extras: {
        kind: "vehicle-lod",
        lod,
        hiddenByDefault: lod !== 0,
        screenCoverage: lod === 0 ? 0.34 : lod === 1 ? 0.11 : 0,
      },
    });
    buildHelicopterLod(context, root, lod, glassMaterial);
  }

  createAnchor(context, "seat_pilot", [-0.48, 1.26, 1.55], "seat", {
    role: "pilot",
  });
  createAnchor(context, "seat_gunner", [-0.66, 1.18, 0.15], "seat", {
    role: "gunner",
  });
  createAnchor(
    context,
    "seat_passenger_left",
    [-0.5, 1.15, -0.72],
    "seat",
    { role: "passenger" },
  );
  createAnchor(
    context,
    "seat_passenger_right",
    [0.5, 1.15, -0.72],
    "seat",
    { role: "passenger" },
  );
  createAnchor(
    context,
    "camera_pilot",
    [-0.48, 1.72, 1.72],
    "camera",
    { role: "pilot", fov: 74 },
    true,
  );
  // El artillero mira POR LA PUERTA, no a proa: se sienta de costado y el arma
  // es de puerta. Va además un palmo hacia adentro del vano, porque pegado al
  // plano de la puerta el hueco le tapa todo el campo y no se ve ni el marco.
  createAnchor(
    context,
    "camera_gunner",
    [-0.58, 1.68, 0.5],
    "camera",
    { role: "gunner", fov: 78 },
    -Math.PI / 2,
  );
  // Comandante y pasajeros: sin su propia ancla el cambio de asiento caería al
  // rig procedural, que vive en otras coordenadas que este modelo.
  createAnchor(context, "seat_commander", [0.48, 1.26, 1.55], "seat", {
    role: "commander",
  });
  createAnchor(
    context,
    "camera_commander",
    [0.48, 1.72, 1.72],
    "camera",
    { role: "commander", fov: 74 },
    true,
  );
  // El pasajero va en la banqueta de estribor, de espaldas al forro: mira
  // hacia adentro de la bodega, no a proa como si condujera.
  createAnchor(
    context,
    "camera_passenger",
    [0.5, 1.6, -0.72],
    "camera",
    { role: "passenger", fov: 76 },
    -Math.PI / 2,
  );
  createAnchor(context, "exit_left", [-1.45, 0.92, -0.25], "exit", {
    seats: ["seat_gunner", "seat_passenger_left"],
  });
  createAnchor(context, "exit_right", [1.45, 0.92, -0.25], "exit", {
    seats: ["seat_pilot", "seat_passenger_right"],
  });
  createAnchor(context, "muzzle", [-2.39, 1.32, 0.35], "muzzle", {
    weapon: "door-machine-gun",
  });
  createAnchor(context, "audio_rotor", [0, HELI_ROTOR.y - 0.3, HELI_ROTOR.z], "audio", {
    layer: "rotor",
  });
  createAnchor(context, "audio_cabin", [0, 1.2, -0.05], "audio", {
    layer: "cabin",
  });
  createAnchor(context, "audio_alarm", [0, 1.72, 1.05], "audio", {
    layer: "alarm",
  });
  createAnchor(context, "damage_rotor", [0, HELI_ROTOR.y, HELI_ROTOR.z], "damage", {
    component: "rotor",
    halfExtents: [2.4, 0.18, 2.4],
  });
  createAnchor(context, "damage_engine", [0, 2.45, 0.34], "damage", {
    component: "engine",
    halfExtents: [0.9, 0.45, 0.9],
  });
  createAnchor(context, "damage_cockpit", [0, 1.4, 2.3], "damage", {
    component: "cockpit",
    halfExtents: [0.9, 0.8, 0.85],
  });
  createAnchor(context, "damage_fuel", [0.72, 1.35, -0.72], "damage", {
    component: "fuel",
    halfExtents: [0.35, 0.6, 0.55],
  });
  createAnchor(context, "damage_weapon", [-1.72, 1.32, 0.35], "damage", {
    component: "weapon",
    halfExtents: [0.8, 0.35, 0.35],
  });
  const wreckage = createNode(context, context.sceneRoot, "wreckage", {
    extras: {
      kind: "wreckage",
      hiddenByDefault: true,
      deterministicPieces: 6,
    },
  });
  const cabinPosition: Vec3 = [0, 0.12, 0.22];
  const cabinRotation: Euler = [0.03, -0.06, -0.08];
  createVisualNode(
    context,
    wreckage,
    "wreckage_cabin",
    wreckedHelicopterCabinParts(14),
    { position: cabinPosition, rotation: cabinRotation },
  );
  createVisualNode(
    context,
    wreckage,
    "wreckage_engine",
    wreckedHelicopterEngineParts(14),
    { position: [0.08, 1.08, -0.4], rotation: [0.1, -0.08, -0.12] },
  );
  createVisualNode(
    context,
    wreckage,
    "wreckage_tail",
    wreckedHelicopterTailParts(14),
    { position: [1.02, 0.14, -1.58], rotation: [0.1, 0.38, 0.2] },
  );
  createVisualNode(
    context,
    wreckage,
    "wreckage_rotor",
    wreckedHelicopterRotorParts(14),
    { position: [-0.42, 0.52, 0.54], rotation: [0.08, 0.18, -0.12] },
  );
  createVisualNode(
    context,
    wreckage,
    "wreckage_debris",
    wreckedHelicopterDebrisParts(12),
    { position: [0, 0.2, 0] },
  );
  createVisualNode(
    context,
    wreckage,
    "wreckage_glass",
    wreckedHelicopterGlassParts(),
    {
      position: cabinPosition,
      rotation: cabinRotation,
      material: glassMaterial,
      bakeOcclusion: false,
      extras: { kind: "glazing" },
    },
  );
}

export interface BuiltVehicleDocument {
  readonly document: Document;
  readonly lods: readonly [LodStats, LodStats, LodStats];
  readonly nodeNames: readonly string[];
}

function countNode(node: Node): LodStats {
  let triangles = 0;
  let draws = 0;
  const mesh = node.getMesh();
  if (mesh !== null) {
    for (const primitive of mesh.listPrimitives()) {
      const indices = primitive.getIndices();
      const positions = primitive.getAttribute("POSITION");
      triangles += Math.floor(
        (indices?.getCount() ?? positions?.getCount() ?? 0) / 3,
      );
      draws += 1;
    }
  }
  for (const child of node.listChildren()) {
    const childStats = countNode(child);
    triangles += childStats.triangles;
    draws += childStats.draws;
  }
  return { triangles, draws };
}

function createMaterial(
  document: Document,
  spec: VehicleAssetSpec,
  textures: GeneratedTextureSet,
) {
  document.createExtension(EXTTextureWebP).setRequired(true);
  const albedoTexture = document
    .createTexture(`${spec.id}_albedo`)
    .setImage(textures.albedo)
    .setMimeType("image/webp");
  const normalTexture = document
    .createTexture(`${spec.id}_normal`)
    .setImage(textures.normal)
    .setMimeType("image/webp");
  const pbrTexture = document
    .createTexture(`${spec.id}_pbr`)
    .setImage(textures.pbr)
    .setMimeType("image/webp");
  return document
    .createMaterial(`${spec.id}_weathered_pbr`)
    .setBaseColorFactor([1, 1, 1, 1])
    .setBaseColorTexture(albedoTexture)
    .setNormalTexture(normalTexture)
    .setNormalScale(0.52)
    .setOcclusionTexture(pbrTexture)
    .setOcclusionStrength(0.82)
    .setMetallicFactor(1)
    .setRoughnessFactor(1)
    .setMetallicRoughnessTexture(pbrTexture)
    .setDoubleSided(false);
}

export function createVehicleDocument(
  spec: VehicleAssetSpec,
  textures: GeneratedTextureSet,
): BuiltVehicleDocument {
  const document = new Document();
  const buffer = document.createBuffer(`${spec.id}_buffer`);
  const material = createMaterial(document, spec, textures);
  const scene = document.createScene(spec.id);
  const sceneRoot = document
    .createNode(`${spec.id}_vehicle`)
    .setExtras({
      kind: "vehicle-asset",
      archetype: spec.id,
      units: "meters",
      up: "+Y",
      physicalForward: "+Z",
      portalTraversal: "blocked",
      originalAsset: true,
      budget: {
        lod0Triangles: spec.maxTrianglesLod0,
        drawsPerLod: spec.maxDrawsPerLod,
        glbBytes: spec.maxGlbBytes,
      },
    });
  scene.addChild(sceneRoot);
  const context: BuildContext = {
    document,
    buffer,
    material,
    sceneRoot,
    nodeNames: [`${spec.id}_vehicle`],
    spec,
  };

  switch (spec.id) {
    case "buggy":
      buildBuggy(context);
      break;
    case "airboat":
      buildAirboat(context);
      break;
    case "helicopter":
      buildHelicopter(context);
      break;
    case "rebelCrawler":
      buildRebelCrawler(context);
      break;
    case "combineGlider":
      buildCombineGlider(context);
      break;
    case "combineSwimmer":
      buildCombineSwimmer(context);
      break;
  }

  const lodStats = ([0, 1, 2] as const).map((lod) => {
    const lodNode = sceneRoot
      .listChildren()
      .find((node) => node.getName() === `visual_lod${lod}`);
    if (lodNode === undefined) {
      throw new Error(`Falta visual_lod${lod} en ${spec.id}.`);
    }
    return countNode(lodNode);
  }) as unknown as readonly [LodStats, LodStats, LodStats];

  return {
    document,
    lods: lodStats,
    nodeNames: context.nodeNames,
  };
}

export function toGeneratedVehicleStats(
  spec: VehicleAssetSpec,
  built: BuiltVehicleDocument,
  glbBytes: number,
): GeneratedVehicleStats {
  return {
    id: spec.id,
    glbBytes,
    lods: built.lods,
    nodeNames: built.nodeNames,
  };
}
