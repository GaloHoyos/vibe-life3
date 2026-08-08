import {
  Accessor,
  type Document,
  type Material,
  type Mesh,
  type Node,
} from "@gltf-transform/core";
import { EXTTextureWebP } from "@gltf-transform/extensions";
import {
  BufferGeometry,
  Euler as ThreeEuler,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  Vector3,
} from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

import { bakeVertexOcclusion } from "./geometry.js";
import type {
  AtlasTile,
  BuildContext,
  Euler,
  GeneratedTextureSet,
  GeometryPart,
  LodStats,
  Vec3,
} from "./types.js";

/**
 * Andamiaje genérico para armar un GLB procedural: transformar partes, mapearlas
 * al atlas de cuatro casillas, fusionarlas y volcarlas a nodos glTF.
 *
 * No sabe nada de vehículos ni de props. Lo que sí sabe es la convención del
 * atlas y el layout de accessors que espera el runtime.
 */

/**
 * Aplica una transformación común a un subconjunto ya armado. Sirve para piezas
 * que se diseñan cómodas en su propio origen y después se cuelgan inclinadas.
 */
export function groupParts(
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

/**
 * Repetición espejada dentro de [0,1]. La proyección plana de abajo se sale del
 * rango en cuanto una pieza pasa los 2 m del origen, y recortar ahí deja a toda
 * la pieza muestreando un solo téxel del borde: una superficie larga salía como
 * una plancha de color liso. Espejar mantiene idéntico lo que ya caía en rango y
 * le devuelve grano a los extremos sin invadir la casilla vecina del atlas.
 */
export function mirrorUnit(value: number): number {
  const wrapped = ((value % 2) + 2) % 2;
  return wrapped > 1 ? 2 - wrapped : wrapped;
}

/**
 * UVs por proyección de CAJA: cada cara se proyecta sobre el plano al que
 * realmente mira, elegido por su normal dominante.
 *
 * Reemplaza una proyección cenital (x, z) que era el peor defecto del pipeline.
 * Sobre una cara vertical la coordenada X o Z es constante, así que la cara
 * entera muestreaba una LÍNEA de téxeles: un cajón medía 484 caras con 264
 * degeneradas —el 55%— y su cara más grande usaba 37×37 píxeles estirados sobre
 * 86 cm. Se veía como plástico liso, y de paso es lo que producía tangentes
 * nulas y props negros al abollarlos.
 *
 * La malla se desindexa a propósito: dos caras que miran a distinta pared
 * necesitan UVs distintas en el mismo vértice, y con índice compartido eso no se
 * puede expresar. Estas piezas tienen decenas de triángulos, no miles.
 */
/**
 * Cuántos metros de mundo cubre una casilla del atlas.
 *
 * Fija la densidad de téxel de TODO el catálogo: con casillas de 512 px son
 * ~430 px/m parejos, de una lata a un ropero. Bajarlo da más detalle pero manda
 * más caras al camino de reducción; subirlo lo contrario.
 */
const METERS_PER_TILE = 1.2;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Desplazamiento estable por cara, para que no todas muestreen el mismo rincón. */
function hashUnit(seed: number, salt: number): number {
  let value = Math.imul(seed + salt, 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
}

function boxProjectUv(geometry: BufferGeometry): void {
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = source.getAttribute("position");
  const uvs = new Float32Array(position.count * 2);

  const ax = new Vector3();
  const bx = new Vector3();
  const cx = new Vector3();
  const edge1 = new Vector3();
  const edge2 = new Vector3();
  const normal = new Vector3();
  for (let triangle = 0; triangle < position.count; triangle += 3) {
    ax.fromBufferAttribute(position, triangle);
    bx.fromBufferAttribute(position, triangle + 1);
    cx.fromBufferAttribute(position, triangle + 2);
    edge1.subVectors(bx, ax);
    edge2.subVectors(cx, ax);
    normal.crossVectors(edge1, edge2);

    const absX = Math.abs(normal.x);
    const absY = Math.abs(normal.y);
    const absZ = Math.abs(normal.z);
    // Ejes del plano al que la cara mira de frente.
    let uAxis: "x" | "y" | "z" = "x";
    let vAxis: "x" | "y" | "z" = "y";
    if (absX >= absY && absX >= absZ) {
      uAxis = "z";
      vAxis = "y";
    } else if (absY >= absX && absY >= absZ) {
      uAxis = "x";
      vAxis = "z";
    }

    // Escala de MUNDO, no relativa a la pieza: así una lata de 11 cm y un
    // ropero de 1.9 m muestran el grano al mismo tamaño de téxel. Antes cada
    // pieza ocupaba la casilla entera y la densidad variaba 20x entre props.
    const rawU = [ax[uAxis], bx[uAxis], cx[uAxis]].map((v) => v / METERS_PER_TILE);
    const rawV = [ax[vAxis], bx[vAxis], cx[vAxis]].map((v) => v / METERS_PER_TILE);
    const minU = Math.min(...rawU);
    const minV = Math.min(...rawV);
    const spanU = Math.max(...rawU) - minU;
    const spanV = Math.max(...rawV) - minV;

    // La cara se corre entera dentro de la casilla en vez de espejarse por
    // vértice: espejar vértice a vértice parte la cara al cruzar el borde y deja
    // una costura reflejada en el medio del triángulo. Una cara más grande que
    // la casilla se achica, que es degradar la densidad sólo donde hace falta.
    const fit = Math.min(1, 1 / Math.max(spanU, spanV, 1e-6));
    const room = 1 - Math.max(spanU, spanV) * fit;
    const jitterU = room * hashUnit(triangle, 0x9e37);
    const jitterV = room * hashUnit(triangle, 0x85eb);

    for (let corner = 0; corner < 3; corner += 1) {
      const target = (triangle + corner) * 2;
      uvs[target] = clamp01((rawU[corner]! - minU) * fit + jitterU);
      uvs[target + 1] = clamp01((rawV[corner]! - minV) * fit + jitterV);
    }
  }
  source.setAttribute("uv", new Float32BufferAttribute(uvs, 2));

  if (source === geometry) return;
  // Se vuelca sobre la geometría original porque `remapUv` muta en el lugar y
  // el llamador sigue usando la misma referencia.
  geometry.setIndex(null);
  for (const name of Object.keys(geometry.attributes)) geometry.deleteAttribute(name);
  for (const [name, attribute] of Object.entries(source.attributes)) {
    geometry.setAttribute(name, attribute);
  }
  // Índice secuencial: aguas abajo `createMesh` exige malla indexada, y sin él
  // la pieza se descarta por incompleta.
  const vertices = geometry.getAttribute("position").count;
  geometry.setIndex(Array.from({ length: vertices }, (_, index) => index));
  source.dispose();

  // Y se vuelve a soldar: desindexar triplica los vértices, y dentro de una
  // misma cara ya comparten posición, normal y UV. Sólo quedan partidos los
  // bordes entre caras que proyectan a planos distintos, que es justo lo que
  // hay que conservar. Sin esto los packs crecían un 30%.
  const welded = mergeVertices(geometry, 1e-5);
  if (welded !== geometry) {
    geometry.setIndex(welded.getIndex());
    for (const name of Object.keys(welded.attributes)) {
      geometry.setAttribute(name, welded.getAttribute(name));
    }
    welded.dispose();
  }
}

export function remapUv(geometry: BufferGeometry, tile: AtlasTile): void {
  if (geometry.getAttribute("uv") === undefined) {
    boxProjectUv(geometry);
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

export function prepareGeometry(part: GeometryPart): BufferGeometry {
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

export function mergeParts(
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
 * Vidrio. Va como material aparte porque el atlas de cuatro casillas es opaco
 * por definición: una ventana pintada sobre la chapa nunca deja ver el interior.
 * Alcanza con `BLEND` y alfa baja; `KHR_materials_transmission` sería más
 * correcto pero obliga a un render target extra por cuadro, que es mucho pedir
 * para una ventanilla.
 */
export function createGlassMaterial(document: Document, assetId: string): Material {
  return document
    .createMaterial(`${assetId}_glazing`)
    .setBaseColorFactor([0.24, 0.29, 0.34, 0.4])
    .setMetallicFactor(0.04)
    // Casi espejo (0.07) el cristal devolvía el entorno como una mancha blanca
    // que tapaba la cabina entera. Con algo de rugosidad el reflejo se abre y
    // se ve lo que hay detrás, que es todo el punto de ponerle vidrio.
    .setRoughnessFactor(0.17)
    .setAlphaMode("BLEND")
    // Desde adentro se mira el cristal por su cara interna.
    .setDoubleSided(true);
}

/**
 * Superficie que emite: pantallas, testigos, energía Combine.
 *
 * Va como material aparte por el mismo motivo que el vidrio: el atlas de cuatro
 * casillas describe superficies que reciben luz, y un emisor pintado ahí sería
 * apenas una mancha clara. Con `emissiveFactor` la pieza se lee encendida
 * incluso en un cuarto a oscuras, que es de lo que se trata.
 *
 * NO agrega una luz a la escena. Sumar o esconder una luz recompila todos los
 * materiales y cuesta segundos de freeze; un emisor que ilumine el ambiente es
 * trabajo del sistema de VFX, no del asset.
 */
export function createEmissiveMaterial(
  document: Document,
  assetId: string,
  color: readonly [number, number, number],
): Material {
  return document
    .createMaterial(`${assetId}_emissive`)
    .setBaseColorFactor([color[0] * 0.3, color[1] * 0.3, color[2] * 0.3, 1])
    .setEmissiveFactor([...color] as [number, number, number])
    .setMetallicFactor(0.1)
    .setRoughnessFactor(0.3);
}

/** Material PBR castigado del asset: albedo + normal + (oclusión, rugosidad, metal). */
export function createWeatheredMaterial(
  document: Document,
  assetId: string,
  textures: GeneratedTextureSet,
): Material {
  document.createExtension(EXTTextureWebP).setRequired(true);
  const albedoTexture = document
    .createTexture(`${assetId}_albedo`)
    .setImage(textures.albedo)
    .setMimeType("image/webp");
  const normalTexture = document
    .createTexture(`${assetId}_normal`)
    .setImage(textures.normal)
    .setMimeType("image/webp");
  const pbrTexture = document
    .createTexture(`${assetId}_pbr`)
    .setImage(textures.pbr)
    .setMimeType("image/webp");
  return document
    .createMaterial(`${assetId}_weathered_pbr`)
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

export function createMesh(
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

export function createNode(
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

export function createVisualNode(
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

/** Nodo vacío con `extras.kind`: así se publican asientos, bocas y anclajes. */
export function createAnchor(
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

/** Triángulos y draws de un nodo y toda su descendencia. */
export function countNode(node: Node): LodStats {
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
