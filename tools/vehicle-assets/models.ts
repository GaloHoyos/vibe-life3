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
  panel,
  rivetRow,
  roundedBox,
  wheel as buildWheel,
} from "./geometry.js";
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

const CAMERA_FORWARD_ROTATION: readonly [number, number, number, number] = [
  0, 1, 0, 0,
];

function createHullGeometry(
  length: number,
  width: number,
  height: number,
  frontWidth: number,
  rearWidth: number,
): BufferGeometry {
  const frontZ = length / 2;
  const rearZ = -length / 2;
  const bottomY = -height / 2;
  const topY = height / 2;
  const vertices = new Float32Array([
    -rearWidth / 2,
    bottomY,
    rearZ,
    rearWidth / 2,
    bottomY,
    rearZ,
    -frontWidth / 2,
    bottomY,
    frontZ,
    frontWidth / 2,
    bottomY,
    frontZ,
    -width / 2,
    topY,
    rearZ,
    width / 2,
    topY,
    rearZ,
    -frontWidth / 2,
    topY,
    frontZ,
    frontWidth / 2,
    topY,
    frontZ,
  ]);
  const indices = [
    0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 4, 2, 4, 6, 2, 1, 3, 5, 5, 3,
    7, 2, 6, 3, 3, 6, 7, 0, 1, 4, 4, 1, 5,
  ];
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const uv = new Float32Array(8 * 2);
  for (let index = 0; index < 8; index += 1) {
    const vertexOffset = index * 3;
    uv[index * 2] = vertices[vertexOffset]! / width + 0.5;
    uv[index * 2 + 1] = vertices[vertexOffset + 2]! / length + 0.5;
  }
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  return geometry;
}

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

function remapUv(geometry: BufferGeometry, tile: AtlasTile): void {
  const uv = geometry.getAttribute("uv");
  if (uv === undefined) {
    const position = geometry.getAttribute("position");
    const generated = new Float32Array(position.count * 2);
    for (let index = 0; index < position.count; index += 1) {
      generated[index * 2] = position.getX(index) * 0.25 + 0.5;
      generated[index * 2 + 1] = position.getZ(index) * 0.25 + 0.5;
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
  options: { readonly bakeOcclusion?: boolean } = {},
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
    bakeVertexOcclusion(merged);
  }
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

function createMesh(
  context: BuildContext,
  name: string,
  geometry: BufferGeometry,
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
    .setMaterial(context.material);
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
    readonly cameraForward?: boolean;
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
  if (options.cameraForward === true) {
    node.setRotation([...CAMERA_FORWARD_ROTATION]);
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
  } = {},
): Node {
  const geometry = mergeParts(parts);
  const mesh = createMesh(context, `${name}_mesh`, geometry);
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
  cameraForward = false,
): Node {
  return createNode(context, context.sceneRoot, name, {
    position,
    cameraForward,
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
  const bodyParts: GeometryPart[] = [
    // Piso y largueros del bastidor.
    { geometry: chamferBox(1.62, 0.14, 3.1, 0.03), position: [0, 0.6, 0], tile: 3 },
    { geometry: chamferBox(0.17, 0.26, 3.15, 0.035), position: [-0.79, 0.63, 0], tile: 1 },
    { geometry: chamferBox(0.17, 0.26, 3.15, 0.035), position: [0.79, 0.63, 0], tile: 1 },
    // Morro: capó inclinado y trompa.
    {
      geometry: chamferWedge({
        length: 1.5,
        height: 0.44,
        frontWidth: 1.24,
        rearWidth: 1.6,
        topFrontWidth: 1.06,
        topRearWidth: 1.5,
        chamfer: 0.04,
      }),
      position: [0, 0.95, 1.12],
      rotation: [-0.07, 0, 0],
      tile: 0,
    },
    // Compartimiento de motor trasero y tapa.
    { geometry: roundedBox(1.5, 0.44, 0.94, 0.08, detailed ? 3 : 1), position: [0, 0.94, -1.14], tile: 1 },
    { geometry: panel(1.36, 0.82, 0.05), position: [0, 1.17, -1.14], rotation: [Math.PI / 2, 0, 0], tile: 2 },
    // Consola central y tablero.
    { geometry: chamferBox(1.02, 0.16, 0.72, 0.025), position: [0, 1.04, -0.2], tile: 2 },
    { geometry: panel(1.28, 0.34, 0.06), position: [0, 1.15, 0.5], rotation: [-0.42, 0, 0], tile: 2 },
  ];

  // Asientos: base, respaldo y apoyacabeza en vez de una caja suelta.
  for (const side of [-1, 1] as const) {
    bodyParts.push(
      { geometry: chamferBox(0.46, 0.12, 0.5, 0.03), position: [side * 0.38, 0.75, -0.2], tile: 3 },
      { geometry: chamferBox(0.46, 0.62, 0.13, 0.03), position: [side * 0.38, 1.06, -0.46], rotation: [-0.16, 0, 0], tile: 3 },
    );
    if (detailed) {
      bodyParts.push(
        { geometry: chamferBox(0.34, 0.2, 0.12, 0.03), position: [side * 0.38, 1.42, -0.52], tile: 3 },
        // Cartelas laterales del asiento.
        { geometry: panel(0.05, 0.4, 0.44), position: [side * 0.61, 0.92, -0.3], tile: 1 },
      );
    }
  }

  if (lod < 2) {
    const tube = 0.058;
    bodyParts.push(
      // Antivuelco principal.
      createTubePart([-0.78, 0.67, -1.42], [-0.78, 1.74, -0.56], tube, segments, 1),
      createTubePart([0.78, 0.67, -1.42], [0.78, 1.74, -0.56], tube, segments, 1),
      createTubePart([-0.78, 1.74, -0.56], [0.78, 1.74, -0.56], tube, segments, 1),
      createTubePart([-0.78, 1.74, -0.56], [-0.7, 1.56, 0.66], 0.05, segments, 1),
      createTubePart([0.78, 1.74, -0.56], [0.7, 1.56, 0.66], 0.05, segments, 1),
      // Travesaños de proa y refuerzo diagonal.
      createTubePart([-0.78, 0.72, 1.3], [0.78, 0.72, 1.3], 0.046, segments, 2),
      createTubePart([-0.7, 1.56, 0.66], [0.7, 1.56, 0.66], 0.046, segments, 1),
      gusset([-0.78, 1.74, -0.56], 0.15, 1),
      gusset([0.78, 1.74, -0.56], 0.15, 1),
      // Parachoques delantero tubular.
      createTubePart([-0.72, 0.62, 1.62], [0.72, 0.62, 1.62], 0.052, segments, 3),
      createTubePart([-0.72, 0.62, 1.62], [-0.62, 0.95, 1.5], 0.042, segments, 3),
      createTubePart([0.72, 0.62, 1.62], [0.62, 0.95, 1.5], 0.042, segments, 3),
    );
  }

  if (detailed) {
    bodyParts.push(
      // Parrilla de láminas.
      ...ribParts([0, 0.86, 1.83], [1, 0, 0], 7, 0.15, [0.05, 0.3, 0.1], 1),
      { geometry: chamferBox(1.16, 0.36, 0.1, 0.03), position: [0, 0.86, 1.79], tile: 1 },
      // Faros con lente.
      { geometry: new CylinderGeometry(0.13, 0.13, 0.16, 12), position: [-0.42, 1.0, 1.76], rotation: [Math.PI / 2, 0, 0], tile: 2 },
      { geometry: new CylinderGeometry(0.13, 0.13, 0.16, 12), position: [0.42, 1.0, 1.76], rotation: [Math.PI / 2, 0, 0], tile: 2 },
      { geometry: new CylinderGeometry(0.1, 0.1, 0.03, 12), position: [-0.42, 1.0, 1.85], rotation: [Math.PI / 2, 0, 0], tile: 0 },
      { geometry: new CylinderGeometry(0.1, 0.1, 0.03, 12), position: [0.42, 1.0, 1.85], rotation: [Math.PI / 2, 0, 0], tile: 0 },
      // Bloque de motor, radiador y escapes.
      { geometry: chamferBox(0.66, 0.44, 0.62, 0.04), position: [0, 0.99, -1.5], tile: 2 },
      ...ribParts([0, 0.99, -1.72], [0, 1, 0], 5, 0.09, [0.62, 0.04, 0.16], 1),
      createTubePart([-0.28, 0.78, -1.62], [-0.34, 0.72, -1.95], 0.05, 10, 2),
      createTubePart([0.28, 0.78, -1.62], [0.34, 0.72, -1.95], 0.05, 10, 2),
      // Paneles remendados: chapas superpuestas fuera de escuadra.
      { geometry: panel(0.05, 0.36, 0.72), position: [-0.84, 0.86, 0.34], rotation: [0, 0, 0.06], tile: 3 },
      { geometry: panel(0.05, 0.3, 0.58), position: [0.84, 0.9, -0.28], rotation: [0, 0, -0.05], tile: 1 },
      { geometry: panel(0.42, 0.05, 0.5), position: [0.3, 1.02, 1.2], rotation: [0.04, 0, 0.03], tile: 3 },
      // Tablero: bisel de instrumentos, columna y volante.
      { geometry: chamferBox(0.44, 0.16, 0.2, 0.03), position: [-0.38, 1.26, 0.36], rotation: [-0.42, 0, 0], tile: 2 },
      createTubePart([-0.38, 1.2, 0.42], [-0.38, 1.0, 0.16], 0.035, 8, 2),
      ...steeringWheelParts([-0.38, 1.22, 0.4], 0.19, 12, 2),
      // Bidón de repuesto y caja de herramientas en la cubierta trasera.
      { geometry: new CylinderGeometry(0.16, 0.16, 0.44, 12), position: [-0.46, 1.32, -1.12], rotation: [0, 0, Math.PI / 2], tile: 3 },
      { geometry: chamferBox(0.42, 0.22, 0.32, 0.03), position: [0.42, 1.29, -1.12], tile: 1 },
      // Remaches sobre las costuras de chapa.
      { geometry: rivetRow([-0.82, 1.02, -0.28], [-0.82, 1.02, 0.98], 9, 0.018, "x"), tile: 1 },
      { geometry: rivetRow([0.82, 1.02, -0.28], [0.82, 1.02, 0.98], 9, 0.018, "x"), tile: 1 },
      { geometry: rivetRow([-0.68, 1.2, 1.62], [0.68, 1.2, 1.62], 10, 0.018, "z"), tile: 1 },
      { geometry: rivetRow([-0.68, 0.68, 1.72], [0.68, 0.68, 1.72], 10, 0.018, "z"), tile: 1 },
      { geometry: rivetRow([-0.7, 1.18, -1.6], [0.7, 1.18, -1.6], 9, 0.018, "y"), tile: 1 },
    );
  }

  // Guardabarros y suspensión visible por rueda.
  const wheelSpots: readonly Vec3[] = [
    [-1, 0.52, 1.08],
    [1, 0.52, 1.08],
    [-1, 0.52, -1.12],
    [1, 0.52, -1.12],
  ];
  if (lod < 2) {
    for (const [x, y, z] of wheelSpots) {
      bodyParts.push(
        ...fenderParts(
          [x * 0.94, y, z],
          0.62,
          0.42,
          detailed ? 7 : 4,
          1,
        ),
      );
      if (detailed) {
        const inner = Math.sign(x) * 0.72;
        bodyParts.push(
          // Trapecio y amortiguador.
          createTubePart([inner, y - 0.04, z], [x * 0.96, y - 0.02, z], 0.045, 8, 2),
          createTubePart([inner, y + 0.22, z + 0.1], [x * 0.94, y + 0.06, z], 0.036, 8, 2),
          createTubePart([inner + Math.sign(x) * 0.06, y + 0.52, z], [x * 0.94, y + 0.04, z], 0.05, 10, 3),
          { geometry: new CylinderGeometry(0.07, 0.07, 0.2, 10), position: [x * 0.86, y + 0.3, z], rotation: [0, 0, Math.sign(x) * 0.34], tile: 1 },
        );
      }
    }
  }

  createVisualNode(context, root, `buggy_body${suffix}`, bodyParts);
  const built = buildWheel({
    radius: 0.43,
    width: 0.34,
    segments,
    treadCount: detailed ? 16 : lod === 1 ? 8 : 0,
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
    ["wheel_front_left", [-1, 0.52, 1.08]],
    ["wheel_front_right", [1, 0.52, 1.08]],
    ["wheel_rear_left", [-1, 0.52, -1.12]],
    ["wheel_rear_right", [1, 0.52, -1.12]],
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
      { geometry: new CylinderGeometry(0.3, 0.36, 0.14, segments), tile: 1 },
      { geometry: new CylinderGeometry(0.22, 0.22, 0.16, segments), position: [0, 0.13, 0], tile: 2 },
    ];
    if (detailed) {
      yawParts.push(
        ...ribParts([0, 0.02, 0], [0, 1, 0], 3, 0.05, [0.74, 0.03, 0.74], 1),
        { geometry: chamferBox(0.16, 0.2, 0.16, 0.03), position: [-0.26, 0.1, -0.16], tile: 3 },
      );
    }
    const turretYaw = createVisualNode(
      context,
      root,
      `turret_yaw${suffix}`,
      yawParts,
      { position: [0, 1.02, 0.82], extras: { kind: "turret-yaw" } },
    );

    const pitchParts: GeometryPart[] = [
      // Cañón con manguito y freno de boca.
      { geometry: new CylinderGeometry(0.075, 0.095, 1.5, segments), position: [0, 0, 0.72], rotation: [Math.PI / 2, 0, 0], tile: 2 },
      { geometry: new CylinderGeometry(0.115, 0.115, 0.4, segments), position: [0, 0, 0.34], rotation: [Math.PI / 2, 0, 0], tile: 1 },
      { geometry: chamferBox(0.36, 0.3, 0.46, 0.04), position: [0, 0, 0.14], tile: 1 },
    ];
    if (detailed) {
      pitchParts.push(
        { geometry: new CylinderGeometry(0.11, 0.13, 0.16, segments), position: [0, 0, 1.44], rotation: [Math.PI / 2, 0, 0], tile: 2 },
        // Anillos disipadores a lo largo del cañón.
        ...[0.6, 0.85, 1.1].map((z) => ({
          geometry: new CylinderGeometry(0.105, 0.105, 0.045, segments),
          position: [0, 0, z] as Vec3,
          rotation: [Math.PI / 2, 0, 0] as Euler,
          tile: 1 as AtlasTile,
        })),
        { geometry: chamferBox(0.2, 0.16, 0.3, 0.03), position: [0.24, 0.02, 0.06], tile: 3 },
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

  createAnchor(context, "seat_driver", [-0.38, 1.22, -0.16], "seat", {
    role: "driver",
  });
  createAnchor(context, "seat_gunner", [0.38, 1.22, -0.16], "seat", {
    role: "gunner",
  });
  createAnchor(
    context,
    "camera_driver",
    [-0.38, 1.62, -0.06],
    "camera",
    { role: "driver", fov: 76 },
    true,
  );
  // El artillero comparte el habitáculo: sin ancla propia, cambiar de asiento
  // saltaba al rig procedural, que tiene otra disposición.
  createAnchor(
    context,
    "camera_gunner",
    [0.38, 1.62, -0.06],
    "camera",
    { role: "gunner", fov: 76 },
    true,
  );
  createAnchor(context, "exit_left", [-1.35, 0.8, -0.2], "exit", {
    seat: "seat_driver",
  });
  createAnchor(context, "exit_right", [1.35, 0.8, -0.2], "exit", {
    seat: "seat_gunner",
  });
  createAnchor(context, "muzzle", [0, 1.12, 2.27], "muzzle", {
    weapon: "induction-cannon",
  });
  createAnchor(context, "audio_engine", [0, 0.95, -1.35], "audio", {
    layer: "engine",
  });
  createAnchor(context, "audio_transmission", [0, 0.65, 0], "audio", {
    layer: "transmission",
  });
  createAnchor(context, "damage_engine", [0, 0.95, -1.3], "damage", {
    component: "engine",
    halfExtents: [0.55, 0.4, 0.5],
  });
  createAnchor(context, "damage_steering", [0, 0.65, 0.9], "damage", {
    component: "steering",
    halfExtents: [0.75, 0.25, 0.4],
  });
  createAnchor(context, "damage_weapon", [0, 1.25, 0.9], "damage", {
    component: "weapon",
    halfExtents: [0.3, 0.3, 0.8],
  });
  createAnchor(context, "damage_fuel", [0, 0.92, -0.88], "damage", {
    component: "fuel",
    halfExtents: [0.5, 0.35, 0.35],
  });
  const wreckage = createNode(context, context.sceneRoot, "wreckage", {
    extras: { kind: "wreckage", hiddenByDefault: true },
  });
  createVisualNode(context, wreckage, "wreckage_chassis", [
    {
      geometry: new BoxGeometry(1.7, 0.3, 2.2),
      rotation: [0.18, 0.08, -0.12],
      tile: 3,
    },
    createTubePart([-0.75, 0.1, -1], [0.55, 0.65, 0.9], 0.07, 8, 1),
  ]);
}

function createFanGeometry(segments: number, simplified: boolean): BufferGeometry {
  const parts: GeometryPart[] = [
    {
      geometry: new TorusGeometry(0.58, 0.055, Math.max(6, segments / 2), segments * 2),
      tile: 2,
    },
    // Cubo con plato de anclaje y cono frontal.
    {
      geometry: new CylinderGeometry(0.13, 0.11, 0.3, segments),
      rotation: [Math.PI / 2, 0, 0],
      tile: 2,
    },
    {
      geometry: new CylinderGeometry(0.2, 0.2, 0.05, segments),
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 0, -0.1],
      tile: 1,
    },
    {
      geometry: new SphereGeometry(0.12, segments, Math.max(4, segments / 2)),
      position: [0, 0, 0.16],
      scale: [1, 1, 1.4],
      tile: 2,
    },
  ];
  const blades = simplified ? 2 : 5;
  for (let index = 0; index < blades; index += 1) {
    const angle = (Math.PI * 2 * index) / blades;
    // Pala con paso: torcida sobre su eje y afinada hacia la punta.
    parts.push({
      geometry: chamferWedge({
        length: 0.9,
        height: 0.04,
        frontWidth: 0.09,
        rearWidth: 0.16,
        chamfer: 0.012,
      }),
      position: [Math.cos(angle + Math.PI / 2) * 0.5, Math.sin(angle + Math.PI / 2) * 0.5, 0],
      rotation: [Math.PI / 2, 0.34, angle],
      tile: 3,
    });
    if (!simplified) {
      parts.push({
        geometry: chamferBox(0.09, 0.09, 0.13, 0.02),
        position: [Math.cos(angle + Math.PI / 2) * 0.16, Math.sin(angle + Math.PI / 2) * 0.16, 0],
        rotation: [0, 0, angle],
        tile: 1,
      });
    }
  }
  return mergeParts(parts);
}

function buildAirboatLod(
  context: BuildContext,
  root: Node,
  lod: 0 | 1 | 2,
): void {
  const suffix = lod === 0 ? "" : `_lod${lod}`;
  const segments = lod === 0 ? 18 : lod === 1 ? 10 : 6;
  const detailed = lod === 0;
  const bodyParts: GeometryPart[] = [
    // Casco: fondo plano de planeo con proa levantada y espejo de popa.
    {
      geometry: chamferWedge({
        length: 4.7,
        height: 0.7,
        frontWidth: 0.62,
        rearWidth: 2.0,
        topFrontWidth: 1.5,
        topRearWidth: 2.16,
        chamfer: 0.05,
      }),
      position: [0, 0.62, 0.15],
      tile: 0,
    },
    // Regala perimetral: el borde grueso que separa casco de cubierta.
    { geometry: chamferBox(2.24, 0.14, 3.4, 0.04), position: [0, 0.95, -0.2], tile: 1 },
    {
      geometry: chamferWedge({
        length: 3.45,
        height: 0.3,
        frontWidth: 0.5,
        rearWidth: 1.66,
        chamfer: 0.04,
      }),
      position: [0, 0.93, 0.45],
      tile: 1,
    },
    // Consola central y bancos.
    { geometry: chamferBox(1.28, 0.24, 0.85, 0.04), position: [0, 1.17, -0.25], tile: 2 },
    { geometry: panel(1.12, 0.42, 0.06), position: [0, 1.42, 0.16], rotation: [-0.34, 0, 0], tile: 2 },
    // Espejo de popa con refuerzos.
    { geometry: chamferBox(2.08, 0.5, 0.14, 0.04), position: [0, 1.06, -2.02], tile: 3 },
  ];

  for (const side of [-1, 1] as const) {
    bodyParts.push(
      { geometry: chamferBox(0.54, 0.14, 0.56, 0.035), position: [side * 0.38, 1.02, -0.1], tile: 1 },
      { geometry: chamferBox(0.54, 0.62, 0.14, 0.035), position: [side * 0.38, 1.32, -0.36], rotation: [-0.14, 0, 0], tile: 1 },
    );
  }

  if (lod < 2) {
    bodyParts.push(
      // Bancada del ventilador.
      createTubePart([-1.02, 0.98, -2.03], [-1.02, 2.1, -1.55], 0.048, segments, 2),
      createTubePart([1.02, 0.98, -2.03], [1.02, 2.1, -1.55], 0.048, segments, 2),
      createTubePart([-1.02, 2.1, -1.55], [1.02, 2.1, -1.55], 0.048, segments, 2),
      createTubePart([-0.98, 0.98, -1.22], [-0.98, 2.1, -1.55], 0.048, segments, 2),
      createTubePart([0.98, 0.98, -1.22], [0.98, 2.1, -1.55], 0.048, segments, 2),
      gusset([-1.02, 2.1, -1.55], 0.14, 2),
      gusset([1.02, 2.1, -1.55], 0.14, 2),
      // Bita de proa.
      {
        geometry: new CylinderGeometry(0.12, 0.14, 0.62, segments),
        position: [0, 1.08, 2.28],
        rotation: [Math.PI / 2, 0, 0],
        tile: 2,
      },
    );
    // Jaula del ventilador: aros concéntricos y radios.
    const cageRadius = 1.05;
    for (const ringZ of detailed ? [-1.42, -1.62, -1.82] : [-1.62]) {
      bodyParts.push({
        geometry: new TorusGeometry(cageRadius, 0.035, 6, segments * 2),
        position: [0, 1.55, ringZ],
        tile: 2,
      });
    }
    const spokes = detailed ? 10 : 6;
    for (let index = 0; index < spokes; index += 1) {
      const angle = (index / spokes) * Math.PI * 2;
      bodyParts.push({
        geometry: new CylinderGeometry(0.022, 0.022, cageRadius * 2, 6),
        position: [0, 1.55, -1.62],
        rotation: [Math.PI / 2, 0, angle],
        tile: 2,
      });
    }
  }

  if (detailed) {
    bodyParts.push(
      // Cajones de equipo y flotadores laterales.
      { geometry: chamferBox(0.4, 0.52, 0.52, 0.04), position: [-0.78, 1.24, -1.37], tile: 3 },
      { geometry: chamferBox(0.4, 0.52, 0.52, 0.04), position: [0.78, 1.24, -1.37], tile: 3 },
      createTubePart([-1.12, 0.86, -1.0], [-1.12, 0.86, 1.7], 0.075, 10, 2),
      createTubePart([1.12, 0.86, -1.0], [1.12, 0.86, 1.7], 0.075, 10, 2),
      // Refuerzos remachados del casco.
      ...ribParts([-1.06, 0.72, 0.2], [0, 0, 1], 5, 0.62, [0.08, 0.34, 0.07], 3),
      ...ribParts([1.06, 0.72, 0.2], [0, 0, 1], 5, 0.62, [0.08, 0.34, 0.07], 3),
      // Motor sobre la popa y escape.
      { geometry: chamferBox(0.72, 0.5, 0.66, 0.045), position: [0, 1.32, -1.9], tile: 2 },
      createTubePart([-0.2, 1.6, -1.94], [-0.2, 1.94, -2.12], 0.05, 10, 1),
      // Tablero e instrumentos del piloto.
      { geometry: chamferBox(0.42, 0.16, 0.2, 0.03), position: [-0.38, 1.5, 0.28], rotation: [-0.34, 0, 0], tile: 2 },
      ...steeringWheelParts([-0.38, 1.48, 0.32], 0.17, 12, 2),
      // Faro de proa.
      { geometry: new CylinderGeometry(0.12, 0.12, 0.14, 12), position: [0, 1.24, 2.1], rotation: [Math.PI / 2, 0, 0], tile: 2 },
      { geometry: new CylinderGeometry(0.09, 0.09, 0.03, 12), position: [0, 1.24, 2.18], rotation: [Math.PI / 2, 0, 0], tile: 0 },
      // Remachado del casco a la regala, a lo largo de las dos bandas.
      { geometry: rivetRow([-1.02, 0.98, -1.8], [-0.42, 0.98, 2.0], 16, 0.019), tile: 1 },
      { geometry: rivetRow([1.02, 0.98, -1.8], [0.42, 0.98, 2.0], 16, 0.019), tile: 1 },
      { geometry: rivetRow([-0.92, 1.14, -2.06], [0.92, 1.14, -2.06], 11, 0.019, "z"), tile: 1 },
    );
  }
  createVisualNode(context, root, `airboat_body${suffix}`, bodyParts);

  if (lod < 2) {
    const fanGeometry = createFanGeometry(segments, lod !== 0);
    const fanMesh = createMesh(context, `airboat_fan_lod${lod}_mesh`, fanGeometry);
    fanGeometry.dispose();
    createNode(context, root, `fan_left${suffix}`, {
      mesh: fanMesh,
      position: [-0.65, 1.55, -1.58],
      extras: { kind: "fan", side: "left" },
    });
    createNode(context, root, `fan_right${suffix}`, {
      mesh: fanMesh,
      position: [0.65, 1.55, -1.58],
      extras: { kind: "fan", side: "right" },
    });

    const rudderGeometry = mergeParts([
      // Timón con perfil: borde de ataque grueso y fuga afilada.
      {
        geometry: chamferWedge({
          length: 0.48,
          height: 0.85,
          frontWidth: 0.075,
          rearWidth: 0.03,
          chamfer: 0.012,
        }),
        position: [0, -0.1, 0],
        tile: 0,
      },
      { geometry: chamferBox(0.09, 0.12, 0.12, 0.02), position: [0, 0.32, 0.16], tile: 2 },
      { geometry: chamferBox(0.09, 0.12, 0.12, 0.02), position: [0, -0.5, 0.16], tile: 2 },
    ]);
    const rudderMesh = createMesh(
      context,
      `airboat_rudder_lod${lod}_mesh`,
      rudderGeometry,
    );
    rudderGeometry.dispose();
    createNode(context, root, `rudder_left${suffix}`, {
      mesh: rudderMesh,
      position: [-0.45, 1.35, -2.05],
      extras: { kind: "rudder", side: "left" },
    });
    createNode(context, root, `rudder_right${suffix}`, {
      mesh: rudderMesh,
      position: [0.45, 1.35, -2.05],
      extras: { kind: "rudder", side: "right" },
    });

    const turretYaw = createVisualNode(
      context,
      root,
      `turret_yaw${suffix}`,
      [
        { geometry: new CylinderGeometry(0.26, 0.32, 0.14, segments), tile: 3 },
        { geometry: new CylinderGeometry(0.18, 0.18, 0.14, segments), position: [0, 0.12, 0], tile: 2 },
        ...(detailed
          ? [{ geometry: chamferBox(0.14, 0.16, 0.14, 0.03), position: [-0.22, 0.08, -0.12] as Vec3, tile: 1 as AtlasTile }]
          : []),
      ],
      { position: [0, 1.06, 1.18], extras: { kind: "turret-yaw" } },
    );
    const pitchParts: GeometryPart[] = [
      { geometry: chamferBox(0.32, 0.26, 0.44, 0.035), position: [0, 0, 0.12], tile: 0 },
      { geometry: new CylinderGeometry(0.06, 0.08, 1.22, segments), position: [0, 0, 0.7], rotation: [Math.PI / 2, 0, 0], tile: 2 },
    ];
    if (detailed) {
      pitchParts.push(
        // Camisa de refrigeración perforada y bocacha.
        { geometry: new CylinderGeometry(0.1, 0.1, 0.42, segments), position: [0, 0, 0.36], rotation: [Math.PI / 2, 0, 0], tile: 1 },
        ...[0.62, 0.86].map((z) => ({
          geometry: new CylinderGeometry(0.088, 0.088, 0.04, segments),
          position: [0, 0, z] as Vec3,
          rotation: [Math.PI / 2, 0, 0] as Euler,
          tile: 1 as AtlasTile,
        })),
        { geometry: new CylinderGeometry(0.095, 0.11, 0.14, segments), position: [0, 0, 1.24], rotation: [Math.PI / 2, 0, 0], tile: 2 },
        { geometry: chamferBox(0.16, 0.14, 0.26, 0.03), position: [0.2, 0.02, 0.04], tile: 3 },
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

  createAnchor(context, "seat_driver", [-0.38, 1.5, -0.1], "seat", {
    role: "driver",
  });
  createAnchor(context, "seat_gunner", [0.38, 1.5, -0.1], "seat", {
    role: "gunner",
  });
  createAnchor(
    context,
    "camera_driver",
    [-0.38, 1.86, 0.05],
    "camera",
    { role: "driver", fov: 78 },
    true,
  );
  createAnchor(context, "exit_left", [-1.48, 0.95, -0.05], "exit", {
    seat: "seat_driver",
  });
  createAnchor(context, "exit_right", [1.48, 0.95, -0.05], "exit", {
    seat: "seat_gunner",
  });
  createAnchor(context, "muzzle", [0, 1.16, 2.48], "muzzle", {
    weapon: "pulse-cannon",
  });
  createAnchor(context, "audio_fan", [0, 1.58, -1.58], "audio", {
    layer: "fan",
  });
  createAnchor(context, "audio_water", [0, 0.35, 0.3], "audio", {
    layer: "water",
  });
  createAnchor(context, "damage_engine", [0, 1.15, -1.5], "damage", {
    component: "engine",
    halfExtents: [1, 0.7, 0.6],
  });
  createAnchor(context, "damage_hull", [0, 0.62, 0.2], "damage", {
    component: "hull",
    halfExtents: [1.15, 0.4, 2.2],
  });
  createAnchor(context, "damage_weapon", [0, 1.18, 1.4], "damage", {
    component: "weapon",
    halfExtents: [0.3, 0.3, 0.8],
  });
  createAnchor(context, "damage_fuel", [0, 1.05, -0.78], "damage", {
    component: "fuel",
    halfExtents: [0.55, 0.4, 0.4],
  });
  const wreckage = createNode(context, context.sceneRoot, "wreckage", {
    extras: { kind: "wreckage", hiddenByDefault: true },
  });
  createVisualNode(context, wreckage, "wreckage_hull", [
    {
      geometry: createHullGeometry(3.8, 2.2, 0.65, 0.6, 1.9),
      rotation: [-0.14, 0.05, 0.1],
      tile: 3,
    },
    {
      geometry: new TorusGeometry(0.52, 0.07, 6, 12),
      position: [0.62, 0.65, -1.35],
      rotation: [0.12, 0.35, 0],
      tile: 2,
    },
  ]);
}

function createMainRotorGeometry(
  segments: number,
  simplified: boolean,
): BufferGeometry {
  const parts: GeometryPart[] = [
    // Cubo del rotor: plato, mástil y tapa.
    { geometry: new CylinderGeometry(0.22, 0.28, 0.24, segments), tile: 2 },
    { geometry: new CylinderGeometry(0.1, 0.1, 0.46, segments), position: [0, 0.2, 0], tile: 2 },
    { geometry: new CylinderGeometry(0.34, 0.3, 0.07, segments), position: [0, -0.16, 0], tile: 1 },
  ];
  const blades = simplified ? 2 : 4;
  for (let index = 0; index < blades; index += 1) {
    const angle = (Math.PI * 2 * index) / blades;
    // Pala afinada con paso: la punta más angosta que la raíz.
    parts.push({
      geometry: chamferWedge({
        length: 3.9,
        height: 0.05,
        frontWidth: 0.15,
        rearWidth: 0.24,
        chamfer: 0.014,
      }),
      position: [0, 0, 1.85],
      rotation: [0, angle, 0.14],
      tile: index % 2 === 0 ? 1 : 2,
    });
    if (!simplified) {
      parts.push(
        // Tirante y brazo de paso de cada pala.
        {
          geometry: chamferBox(0.13, 0.11, 0.42, 0.02),
          position: [Math.sin(angle) * 0.34, 0, Math.cos(angle) * 0.34],
          rotation: [0, angle, 0],
          tile: 2,
        },
        {
          geometry: new CylinderGeometry(0.02, 0.02, 0.34, 6),
          position: [Math.sin(angle) * 0.28, 0.24, Math.cos(angle) * 0.28],
          tile: 2,
        },
      );
    }
  }
  return mergeParts(parts);
}

function createTailRotorGeometry(
  segments: number,
  simplified: boolean,
): BufferGeometry {
  const parts: GeometryPart[] = [
    { geometry: new CylinderGeometry(0.13, 0.13, 0.18, segments), rotation: [Math.PI / 2, 0, 0], tile: 2 },
    { geometry: new CylinderGeometry(0.2, 0.18, 0.05, segments), position: [0, 0, -0.1], rotation: [Math.PI / 2, 0, 0], tile: 1 },
  ];
  const blades = simplified ? 2 : 4;
  for (let index = 0; index < blades; index += 1) {
    const angle = (Math.PI * 2 * index) / blades;
    parts.push({
      geometry: chamferWedge({
        length: 1.18,
        height: 0.04,
        frontWidth: 0.07,
        rearWidth: 0.12,
        chamfer: 0.012,
      }),
      position: [Math.cos(angle + Math.PI / 2) * 0.62, Math.sin(angle + Math.PI / 2) * 0.62, 0],
      rotation: [Math.PI / 2, 0.22, angle],
      tile: index % 2 === 0 ? 1 : 3,
    });
  }
  return mergeParts(parts);
}

function buildHelicopterLod(
  context: BuildContext,
  root: Node,
  lod: 0 | 1 | 2,
): void {
  const suffix = lod === 0 ? "" : `_lod${lod}`;
  const segments = lod === 0 ? 22 : lod === 1 ? 12 : 6;
  const detailed = lod === 0;
  const fuselageParts: GeometryPart[] = [
    // Cabina principal: sección de carga donde viaja la escuadra.
    {
      geometry: chamferWedge({
        length: 4.35,
        height: 1.72,
        frontWidth: 1.9,
        rearWidth: 1.5,
        topFrontWidth: 1.72,
        topRearWidth: 1.24,
        chamfer: 0.06,
      }),
      position: [0, 1.18, 0.18],
      tile: 0,
    },
    // Morro acristalado.
    {
      geometry: new SphereGeometry(1, segments, Math.max(8, segments / 2)),
      position: [0, 1.25, 1.9],
      scale: [0.92, 0.86, 1.12],
      tile: 1,
    },
    // Cubierta de motores y toma de aire.
    { geometry: roundedBox(1.76, 0.54, 1.18, 0.13, detailed ? 3 : 1), position: [0, 2.13, -0.2], rotation: [-0.05, 0, 0], tile: 3 },
    { geometry: chamferBox(0.9, 0.26, 0.5, 0.04), position: [0, 2.44, 0.3], rotation: [-0.12, 0, 0], tile: 2 },
    // Botalón de cola en dos tramos: la conicidad evita el tubo recto.
    createTubePart([0, 1.45, -1.65], [0, 1.3, -3.9], 0.26, segments, 0),
    createTubePart([0, 1.3, -3.9], [0, 1.22, -5.95], 0.17, segments, 0),
    // Deriva y estabilizador horizontal.
    { geometry: chamferWedge({ length: 1.15, height: 1.05, frontWidth: 0.12, rearWidth: 0.07, chamfer: 0.02 }), position: [0, 1.82, -5.72], rotation: [0.18, 0, 0], tile: 1 },
    { geometry: chamferWedge({ length: 0.62, height: 0.07, frontWidth: 1.7, rearWidth: 1.2, chamfer: 0.02 }), position: [0, 1.36, -5.1], tile: 1 },
    // Patines de aterrizaje con travesaños.
    createTubePart([-0.72, 0.28, -0.9], [-0.72, 0.08, -2.15], 0.055, segments, 2),
    createTubePart([0.72, 0.28, -0.9], [0.72, 0.08, -2.15], 0.055, segments, 2),
    createTubePart([-0.72, 0.08, -2.15], [-0.72, 0.08, 1.3], 0.07, segments, 2),
    createTubePart([0.72, 0.08, -2.15], [0.72, 0.08, 1.3], 0.07, segments, 2),
    createTubePart([-0.72, 0.08, 1.3], [-0.52, 0.42, 1.65], 0.045, segments, 2),
    createTubePart([0.72, 0.08, 1.3], [0.52, 0.42, 1.65], 0.045, segments, 2),
    createTubePart([-0.72, 0.3, 0.62], [0.72, 0.3, 0.62], 0.05, segments, 2),
    createTubePart([-0.72, 0.3, -1.1], [0.72, 0.3, -1.1], 0.05, segments, 2),
    // Blindaje soldado sobre los laterales.
    { geometry: panel(0.08, 1.45, 1.52), position: [-1.08, 1.25, -0.05], rotation: [0, 0, -0.04], tile: 1 },
    { geometry: panel(0.08, 1.45, 1.52), position: [1.08, 1.25, -0.05], rotation: [0, 0, 0.04], tile: 1 },
  ];

  if (lod < 2) {
    fuselageParts.push(
      // Marco de las puertas correderas.
      { geometry: chamferBox(0.1, 1.3, 0.12, 0.03), position: [-1.02, 1.3, 1.02], tile: 3 },
      { geometry: chamferBox(0.1, 1.3, 0.12, 0.03), position: [-1.02, 1.3, -0.72], tile: 3 },
      { geometry: chamferBox(0.1, 1.3, 0.12, 0.03), position: [1.02, 1.3, 1.02], tile: 3 },
      { geometry: chamferBox(0.1, 1.3, 0.12, 0.03), position: [1.02, 1.3, -0.72], tile: 3 },
      // Asientos de cabina: banco corrido con respaldos.
      { geometry: chamferBox(0.78, 0.14, 0.56, 0.035), position: [-0.48, 0.82, 0.1], rotation: [-0.1, 0, 0], tile: 2 },
      { geometry: chamferBox(0.78, 0.14, 0.56, 0.035), position: [0.48, 0.82, 0.1], rotation: [-0.1, 0, 0], tile: 2 },
      { geometry: chamferBox(0.58, 0.74, 0.14, 0.035), position: [-0.48, 1.16, -0.7], tile: 2 },
      { geometry: chamferBox(0.58, 0.74, 0.14, 0.035), position: [0.48, 1.16, -0.7], tile: 2 },
      // Mamparo trasero y agarraderas.
      { geometry: panel(1.9, 1.3, 0.07), position: [0, 1.3, -1.6], tile: 1 },
      createTubePart([-0.88, 0.46, -0.78], [-0.88, 1.95, -0.78], 0.035, 8, 3),
      createTubePart([0.88, 0.46, -0.78], [0.88, 1.95, -0.78], 0.035, 8, 3),
    );
  }

  if (detailed) {
    fuselageParts.push(
      // Estribos y placas remendadas.
      { geometry: panel(0.74, 0.12, 1.15), position: [-0.92, 1.65, 0.3], rotation: [0.04, -0.03, -0.11], tile: 3 },
      { geometry: panel(0.74, 0.12, 1.15), position: [0.92, 1.65, 0.3], rotation: [0.04, 0.03, 0.11], tile: 3 },
      { geometry: chamferBox(0.64, 0.24, 0.57, 0.04), position: [-0.7, 2.32, -0.18], tile: 1 },
      { geometry: chamferBox(0.64, 0.24, 0.57, 0.04), position: [0.7, 2.32, -0.18], tile: 1 },
      createTubePart([-1.05, 0.65, 1.35], [-1.05, 1.95, 1.15], 0.035, 8, 3),
      createTubePart([1.05, 0.65, 1.35], [1.05, 1.95, 1.15], 0.035, 8, 3),
      // Escapes de turbina.
      createTubePart([-0.5, 2.16, -0.72], [-0.62, 2.1, -1.12], 0.13, segments, 2),
      createTubePart([0.5, 2.16, -0.72], [0.62, 2.1, -1.12], 0.13, segments, 2),
      // Refuerzos longitudinales del botalón.
      ...ribParts([0, 1.38, -2.9], [0, 0, 1], 6, 0.5, [0.5, 0.05, 0.06], 1),
      // Marco del parabrisas y limpiaparabrisas.
      createTubePart([-0.62, 1.86, 2.06], [0.62, 1.86, 2.06], 0.045, 10, 3),
      createTubePart([0, 1.86, 2.06], [0, 0.72, 2.34], 0.038, 10, 3),
      // Tablero de vuelo y palanca de mando.
      { geometry: chamferBox(1.24, 0.3, 0.32, 0.04), position: [0, 1.16, 2.28], rotation: [-0.5, 0, 0], tile: 2 },
      createTubePart([-0.42, 0.86, 2.02], [-0.42, 1.2, 1.94], 0.032, 8, 2),
      createTubePart([0.42, 0.86, 2.02], [0.42, 1.2, 1.94], 0.032, 8, 2),
      // Faro de búsqueda y baliza.
      { geometry: new CylinderGeometry(0.15, 0.15, 0.18, segments), position: [0, 0.62, 1.62], rotation: [Math.PI / 2, 0, 0], tile: 2 },
      { geometry: new SphereGeometry(0.09, 10, 8), position: [0, 2.5, -0.9], tile: 0 },
      // Cajas de munición junto a la puerta.
      { geometry: chamferBox(0.34, 0.28, 0.44, 0.035), position: [-0.72, 0.9, -1.24], tile: 3 },
      { geometry: chamferBox(0.34, 0.28, 0.44, 0.035), position: [0.72, 0.9, -1.24], tile: 3 },
      // Remachado del blindaje y de la unión botalón-cabina.
      { geometry: rivetRow([-1.13, 1.9, -0.72], [-1.13, 1.9, 0.62], 10, 0.019, "x"), tile: 1 },
      { geometry: rivetRow([-1.13, 0.6, -0.72], [-1.13, 0.6, 0.62], 10, 0.019, "x"), tile: 1 },
      { geometry: rivetRow([1.13, 1.9, -0.72], [1.13, 1.9, 0.62], 10, 0.019, "x"), tile: 1 },
      { geometry: rivetRow([1.13, 0.6, -0.72], [1.13, 0.6, 0.62], 10, 0.019, "x"), tile: 1 },
      { geometry: rivetRow([-0.62, 1.72, -1.66], [0.62, 1.72, -1.66], 9, 0.019, "z"), tile: 1 },
    );
  }

  createVisualNode(context, root, `helicopter_fuselage${suffix}`, fuselageParts);
  if (lod < 2) {
    const mainRotorGeometry = createMainRotorGeometry(segments, lod !== 0);
    const mainRotorMesh = createMesh(
      context,
      `helicopter_main_rotor_lod${lod}_mesh`,
      mainRotorGeometry,
    );
    mainRotorGeometry.dispose();
    createNode(context, root, `rotor_main${suffix}`, {
      mesh: mainRotorMesh,
      position: [0, 2.58, -0.2],
      extras: { kind: "rotor", axis: "+Y" },
    });

    const tailRotorGeometry = createTailRotorGeometry(segments, lod !== 0);
    const tailRotorMesh = createMesh(
      context,
      `helicopter_tail_rotor_lod${lod}_mesh`,
      tailRotorGeometry,
    );
    tailRotorGeometry.dispose();
    createNode(context, root, `rotor_tail${suffix}`, {
      mesh: tailRotorMesh,
      position: [0, 1.3, -6.05],
      extras: { kind: "rotor", axis: "+Z" },
    });

    const turretYaw = createVisualNode(
      context,
      root,
      `turret_yaw${suffix}`,
      [
        // Pivote de la ametralladora de puerta, colgado del marco.
        { geometry: new CylinderGeometry(0.21, 0.25, 0.18, segments), tile: 3 },
        { geometry: new CylinderGeometry(0.09, 0.09, 0.34, segments), position: [0, 0.2, 0], tile: 2 },
        ...(detailed
          ? [
              {
                geometry: chamferBox(0.2, 0.1, 0.2, 0.03),
                position: [0, 0.36, 0] as Vec3,
                tile: 1 as AtlasTile,
              },
            ]
          : []),
      ],
      {
        position: [-1.18, 1.15, 0.35],
        rotation: [0, 0, Math.PI / 2],
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
  for (const lod of [0, 1, 2] as const) {
    const root = createNode(context, context.sceneRoot, `visual_lod${lod}`, {
      extras: {
        kind: "vehicle-lod",
        lod,
        hiddenByDefault: lod !== 0,
        screenCoverage: lod === 0 ? 0.34 : lod === 1 ? 0.11 : 0,
      },
    });
    buildHelicopterLod(context, root, lod);
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
  createAnchor(
    context,
    "camera_gunner",
    [-0.88, 1.55, 0.2],
    "camera",
    { role: "gunner", fov: 78 },
    true,
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
  createAnchor(
    context,
    "camera_passenger",
    [0.5, 1.6, -0.72],
    "camera",
    { role: "passenger", fov: 76 },
    true,
  );
  createAnchor(context, "exit_left", [-1.45, 0.92, -0.25], "exit", {
    seats: ["seat_gunner", "seat_passenger_left"],
  });
  createAnchor(context, "exit_right", [1.45, 0.92, -0.25], "exit", {
    seats: ["seat_pilot", "seat_passenger_right"],
  });
  createAnchor(context, "muzzle", [-1.18, 1.16, 1.58], "muzzle", {
    weapon: "door-machine-gun",
  });
  createAnchor(context, "audio_rotor", [0, 2.35, -0.2], "audio", {
    layer: "rotor",
  });
  createAnchor(context, "audio_cabin", [0, 1.2, -0.05], "audio", {
    layer: "cabin",
  });
  createAnchor(context, "audio_alarm", [0, 1.72, 1.05], "audio", {
    layer: "alarm",
  });
  createAnchor(context, "damage_rotor", [0, 2.55, -0.2], "damage", {
    component: "rotor",
    halfExtents: [2.4, 0.18, 2.4],
  });
  createAnchor(context, "damage_engine", [0, 2.05, -0.35], "damage", {
    component: "engine",
    halfExtents: [0.9, 0.45, 0.7],
  });
  createAnchor(context, "damage_cockpit", [0, 1.4, 1.7], "damage", {
    component: "cockpit",
    halfExtents: [0.9, 0.8, 0.85],
  });
  createAnchor(context, "damage_fuel", [0.72, 1.35, -0.72], "damage", {
    component: "fuel",
    halfExtents: [0.35, 0.6, 0.55],
  });
  createAnchor(context, "damage_weapon", [-1.18, 1.16, 0.65], "damage", {
    component: "weapon",
    halfExtents: [0.35, 0.35, 0.8],
  });
  const wreckage = createNode(context, context.sceneRoot, "wreckage", {
    extras: {
      kind: "wreckage",
      hiddenByDefault: true,
      deterministicPieces: 4,
    },
  });
  createVisualNode(context, wreckage, "wreckage_cabin", [
    {
      geometry: createHullGeometry(3.35, 2.05, 1.55, 1.1, 1.75),
      rotation: [0.12, 0.09, -0.16],
      tile: 3,
    },
  ]);
  createVisualNode(
    context,
    wreckage,
    "wreckage_tail",
    [
      createTubePart([0, 0, 0], [0.25, 0.35, -3.45], 0.24, 8, 0),
      {
        geometry: new BoxGeometry(0.08, 0.65, 0.95),
        position: [0.25, 0.65, -3.2],
        tile: 1,
      },
    ],
    { position: [0.2, 0.35, -1.5], rotation: [0.2, 0.1, 0.08] },
  );
  createVisualNode(
    context,
    wreckage,
    "wreckage_rotor",
    [
      {
        geometry: new BoxGeometry(0.18, 0.05, 3.4),
        tile: 2,
      },
      {
        geometry: new BoxGeometry(0.18, 0.05, 2.6),
        rotation: [0, 1.15, 0],
        tile: 2,
      },
    ],
    { position: [1.2, 0.4, -0.6], rotation: [0.25, 0.35, 0.16] },
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
