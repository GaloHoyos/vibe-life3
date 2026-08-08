import {
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Vector3,
} from "three";
import { ConvexGeometry } from "three/addons/geometries/ConvexGeometry.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Primitivas con canto biselado y horneado de oclusión ambiental.
 *
 * Una caja cruda lee como blockout: los cantos a 90° no atrapan luz y todas las
 * caras devuelven el mismo valor. Un chaflán de pocos milímetros agrega un
 * highlight en cada arista, que es lo que hace que una silueta simple parezca
 * una pieza construida. El AO horneado a vertex colors cierra el efecto
 * oscureciendo cavidades (pasos de rueda, interior de cabina, bajo el chasis)
 * sin costo en runtime.
 */

/**
 * Caja con chaflán plano en aristas y esquinas, como casco convexo de las 24
 * esquinas desplazadas. El hull produce exactamente las 6 caras, los 12 planos
 * de arista y los 8 de esquina, con normales duras por cara.
 */
export function chamferBox(
  width: number,
  height: number,
  depth: number,
  chamfer = 0.02,
): BufferGeometry {
  const hx = width / 2;
  const hy = height / 2;
  const hz = depth / 2;
  const c = Math.min(chamfer, hx * 0.9, hy * 0.9, hz * 0.9);
  const points: Vector3[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        points.push(
          new Vector3(sx * (hx - c), sy * hy, sz * hz),
          new Vector3(sx * hx, sy * (hy - c), sz * hz),
          new Vector3(sx * hx, sy * hy, sz * (hz - c)),
        );
      }
    }
  }
  return finalize(new ConvexGeometry(points));
}

/**
 * Caja de cantos redondeados: casco convexo de octantes de esfera en cada
 * esquina. Más cara que `chamferBox` pero es lo que hace que una superficie
 * grande (capó, casco, fuselaje) deje de leer como caja. Reservada para las
 * piezas protagonistas.
 */
export function roundedBox(
  width: number,
  height: number,
  depth: number,
  radius = 0.06,
  subdivisions = 2,
): BufferGeometry {
  const r = Math.min(radius, width / 2.2, height / 2.2, depth / 2.2);
  const hx = width / 2 - r;
  const hy = height / 2 - r;
  const hz = depth / 2 - r;
  const points: Vector3[] = [];
  const steps = Math.max(1, subdivisions);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (let u = 0; u <= steps; u += 1) {
          for (let v = 0; v <= steps; v += 1) {
            const theta = (u / steps) * (Math.PI / 2);
            const phi = (v / steps) * (Math.PI / 2);
            points.push(
              new Vector3(
                sx * (hx + r * Math.cos(theta) * Math.sin(phi)),
                sy * (hy + r * Math.cos(phi)),
                sz * (hz + r * Math.sin(theta) * Math.sin(phi)),
              ),
            );
          }
        }
      }
    }
  }
  return finalize(new ConvexGeometry(points));
}

/**
 * Hilera de remaches sobre una costura. Detalle barato por pieza y de los que
 * más lectura agregan: sin remaches una chapa soldada parece una caja pintada.
 */
export function rivetRow(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  count: number,
  radius = 0.018,
  axis: "x" | "y" | "z" = "y",
): BufferGeometry {
  const start = new Vector3(...from);
  const end = new Vector3(...to);
  const rivets: BufferGeometry[] = [];
  for (let index = 0; index < count; index += 1) {
    const t = count === 1 ? 0.5 : index / (count - 1);
    const head = new CylinderGeometry(radius, radius * 0.82, radius * 1.3, 6);
    if (axis === "x") head.rotateZ(Math.PI / 2);
    if (axis === "z") head.rotateX(Math.PI / 2);
    head.translate(
      start.x + (end.x - start.x) * t,
      start.y + (end.y - start.y) * t,
      start.z + (end.z - start.z) * t,
    );
    rivets.push(head);
  }
  return mergeAll(rivets);
}

/**
 * Prisma trapezoidal con chaflán: sirve para cascos, capós y morros donde el
 * ancho cambia entre proa y popa.
 */
export function chamferWedge(
  options: {
    readonly length: number;
    readonly height: number;
    readonly frontWidth: number;
    readonly rearWidth: number;
    readonly topFrontWidth?: number;
    readonly topRearWidth?: number;
    readonly topOffsetY?: number;
    readonly chamfer?: number;
  },
): BufferGeometry {
  const {
    length,
    height,
    frontWidth,
    rearWidth,
    topFrontWidth = frontWidth,
    topRearWidth = rearWidth,
    topOffsetY = 0,
    chamfer = 0.02,
  } = options;
  const hz = length / 2;
  const hy = height / 2;
  const corners: readonly (readonly [number, number, number])[] = [
    [rearWidth / 2, -hy, -hz],
    [frontWidth / 2, -hy, hz],
    [topRearWidth / 2, hy + topOffsetY, -hz],
    [topFrontWidth / 2, hy + topOffsetY, hz],
  ];
  const points: Vector3[] = [];
  for (const [halfWidth, y, z] of corners) {
    for (const sx of [-1, 1]) {
      const x = sx * halfWidth;
      const c = Math.min(chamfer, Math.abs(halfWidth) * 0.9, hy * 0.9, hz * 0.9);
      points.push(
        new Vector3(x - Math.sign(x || 1) * c, y, z),
        new Vector3(x, y - Math.sign(y || 1) * c, z),
        new Vector3(x, y, z - Math.sign(z || 1) * c),
      );
    }
  }
  return finalize(new ConvexGeometry(points));
}

export interface LoftSection {
  readonly z: number;
  /** Semiancho de la sección. En cero la sección es una punta. */
  readonly halfWidth: number;
  readonly top: number;
  readonly bottom: number;
  /** Desplazamiento del plano medio, para lomos que suben y bajan. */
  readonly y?: number;
}

/**
 * Cuerpo interpolado entre secciones elípticas a lo largo de Z, con normales
 * suavizadas. Es la única superficie de curvatura continua de este módulo:
 * todo lo demás son cascos convexos, y en una silueta orgánica cada faceta se
 * lee como chapa. El canto sale afilado solo, porque la altura de la sección
 * se anula en el borde, así que sirve tanto para un cuerpo como para un ala.
 *
 * Las secciones con `halfWidth` en cero cierran el volumen en punta; van
 * primera y última.
 */
export function loftedBody(
  sections: readonly LoftSection[],
  radialSegments: number,
  shape = 0.8,
): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const ringStarts: number[] = [];
  const ringSizes: number[] = [];

  for (const section of sections) {
    ringStarts.push(positions.length / 3);
    const midY = section.y ?? 0;
    if (section.halfWidth <= 1e-5) {
      ringSizes.push(1);
      positions.push(0, midY, section.z);
      continue;
    }
    ringSizes.push(radialSegments);
    for (let index = 0; index < radialSegments; index += 1) {
      const angle = (index / radialSegments) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const reach = sin >= 0 ? section.top : section.bottom;
      positions.push(
        section.halfWidth * Math.sign(cos) * Math.abs(cos) ** shape,
        midY + reach * Math.sign(sin) * Math.abs(sin) ** shape,
        section.z,
      );
    }
  }

  for (let index = 0; index + 1 < sections.length; index += 1) {
    const startA = ringStarts[index]!;
    const startB = ringStarts[index + 1]!;
    const sizeA = ringSizes[index]!;
    const sizeB = ringSizes[index + 1]!;
    for (let step = 0; step < radialSegments; step += 1) {
      const next = (step + 1) % radialSegments;
      const a0 = startA + (sizeA === 1 ? 0 : step);
      const a1 = startA + (sizeA === 1 ? 0 : next);
      const b0 = startB + (sizeB === 1 ? 0 : step);
      const b1 = startB + (sizeB === 1 ? 0 : next);
      if (sizeA === 1) {
        indices.push(a0, b1, b0);
        continue;
      }
      if (sizeB === 1) {
        indices.push(a0, a1, b0);
        continue;
      }
      indices.push(a0, a1, b1, a0, b1, b0);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return finalize(geometry);
}

/** Placa fina biselada: paneles, remiendos soldados, blindaje. */
export function panel(
  width: number,
  height: number,
  thickness = 0.035,
): BufferGeometry {
  return chamferBox(width, height, thickness, Math.min(0.012, thickness * 0.4));
}

/**
 * Rueda completa: neumático con taco, llanta hundida y cubo. Un toro suelto
 * lee como dona; el hundido de la llanta es lo que la vuelve una rueda.
 */
export function wheel(
  options: {
    readonly radius: number;
    readonly width: number;
    readonly rimRatio?: number;
    readonly segments: number;
    readonly treadCount?: number;
  },
): { tire: BufferGeometry; rim: BufferGeometry } {
  const { radius, width, rimRatio = 0.58, segments, treadCount = 0 } = options;
  const rimRadius = radius * rimRatio;
  const tireParts: BufferGeometry[] = [
    orient(new CylinderGeometry(radius, radius, width, segments, 1, true)),
    // Flancos: anillo entre el neumático y la llanta, a cada lado.
    orient(
      new CylinderGeometry(radius, rimRadius, width * 0.16, segments, 1, true),
    ).translate(width * 0.42, 0, 0),
    orient(
      new CylinderGeometry(rimRadius, radius, width * 0.16, segments, 1, true),
    ).translate(-width * 0.42, 0, 0),
  ];
  for (let index = 0; index < treadCount; index += 1) {
    const angle = (index / treadCount) * Math.PI * 2;
    const block = chamferBox(width * 0.82, radius * 0.09, radius * 0.3, 0.012);
    block.rotateX(angle);
    block.translate(
      0,
      Math.cos(angle) * (radius + radius * 0.02),
      Math.sin(angle) * (radius + radius * 0.02),
    );
    tireParts.push(block);
  }

  const rimParts: BufferGeometry[] = [
    orient(new CylinderGeometry(rimRadius, rimRadius, width * 0.55, segments)),
    orient(
      new CylinderGeometry(rimRadius * 0.34, rimRadius * 0.3, width * 1.02, 10),
    ),
  ];
  const spokes = Math.max(4, Math.round(segments / 2));
  for (let index = 0; index < spokes; index += 1) {
    const angle = (index / spokes) * Math.PI * 2;
    const spoke = chamferBox(width * 0.3, rimRadius * 1.35, rimRadius * 0.3, 0.01);
    spoke.rotateX(angle);
    rimParts.push(spoke);
  }

  return { tire: mergeAll(tireParts), rim: mergeAll(rimParts) };
}

/** Cilindro tumbado sobre X (eje natural de ruedas y rotores). */
function orient(geometry: BufferGeometry): BufferGeometry {
  geometry.rotateZ(Math.PI / 2);
  return geometry;
}

function mergeAll(geometries: readonly BufferGeometry[]): BufferGeometry {
  const merged = new BufferGeometry();
  const positions: number[] = [];
  const normals: number[] = [];
  for (const geometry of geometries) {
    const indexed = geometry.index ? geometry.toNonIndexed() : geometry;
    const position = indexed.getAttribute("position");
    const normal = indexed.getAttribute("normal");
    for (let index = 0; index < position.count; index += 1) {
      positions.push(
        position.getX(index),
        position.getY(index),
        position.getZ(index),
      );
      normals.push(normal.getX(index), normal.getY(index), normal.getZ(index));
    }
    if (indexed !== geometry) indexed.dispose();
  }
  merged.setAttribute("position", new Float32BufferAttribute(positions, 3));
  merged.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  return finalize(merged);
}

/** Indexa y garantiza normales; ConvexGeometry sale sin índice ni UV. */
function finalize(geometry: BufferGeometry): BufferGeometry {
  geometry.deleteAttribute("uv");
  const indexed = mergeVertices(geometry, 1e-4);
  if (indexed !== geometry) geometry.dispose();
  indexed.computeVertexNormals();
  return indexed;
}

interface OcclusionGrid {
  readonly resolution: number;
  readonly min: Vector3;
  readonly size: Vector3;
  readonly solid: Uint8Array;
}

const AO_DIRECTIONS: readonly Vector3[] = buildHemisphereDirections();

/**
 * Hornea oclusión ambiental en `COLOR_0` marchando rayos contra una rejilla de
 * ocupación de la propia malla. La rejilla evita un BVH: con 96³ celdas el
 * costo es una lectura por paso y el resultado es estable entre corridas.
 */
export function bakeVertexOcclusion(
  geometry: BufferGeometry,
  options: { readonly resolution?: number; readonly strength?: number } = {},
): void {
  const resolution = options.resolution ?? 96;
  const strength = options.strength ?? 0.85;
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  if (position === undefined || normal === undefined) return;

  const curvatures = computeCurvature(geometry);
  const grid = voxelize(geometry, resolution);
  const step = Math.max(grid.size.x, grid.size.y, grid.size.z) / resolution;
  const reach = step * 9;
  const colors = new Float32Array(position.count * 3);
  const origin = new Vector3();
  const normalVector = new Vector3();
  const sample = new Vector3();

  for (let index = 0; index < position.count; index += 1) {
    origin.set(
      position.getX(index),
      position.getY(index),
      position.getZ(index),
    );
    normalVector
      .set(normal.getX(index), normal.getY(index), normal.getZ(index))
      .normalize();

    let occluded = 0;
    let total = 0;
    for (const direction of AO_DIRECTIONS) {
      const alignment = direction.dot(normalVector);
      if (alignment <= 0.08) continue;
      total += alignment;
      for (let stepIndex = 2; stepIndex <= 9; stepIndex += 1) {
        sample
          .copy(direction)
          .multiplyScalar(step * stepIndex)
          .add(origin);
        if (isSolid(grid, sample)) {
          // Lo cercano ocluye más que lo lejano.
          occluded += alignment * (1 - (stepIndex * step) / reach);
          break;
        }
      }
    }

    const ao = total > 0 ? 1 - (occluded / total) * strength : 1;
    // Desgaste por convexidad: la pintura se va primero en las aristas y la
    // mugre se junta en los rincones. Es lo que más hace leer un objeto como
    // usado, y sin esto un prop procedural queda parejo y plano por más buena
    // que sea su textura.
    const curvature = curvatures[index]!;
    const worn = 1 + Math.max(0, curvature) * EDGE_WEAR;
    const grimy = 1 + Math.min(0, curvature) * CAVITY_DIRT;
    const shade = Math.max(0.4, Math.min(1, ao * worn * grimy));
    colors[index * 3] = shade;
    colors[index * 3 + 1] = shade;
    colors[index * 3 + 2] = shade;
  }

  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
}

/** Cuánto aclara una arista viva. `COLOR_0` multiplica, así que el tope es 1. */
const EDGE_WEAR = 0.22;
/** Cuánto oscurece un rincón por encima de la oclusión. */
const CAVITY_DIRT = 0.45;

/**
 * Convexidad por vértice, en −1..1. Positivo es arista viva, negativo rincón.
 *
 * Se mide comparando la normal del vértice contra la dirección al promedio de
 * sus vecinos por arista: en una esquina saliente los vecinos quedan "detrás"
 * de la normal, y en un rincón quedan por delante.
 */
function computeCurvature(geometry: BufferGeometry): Float32Array {
  const position = geometry.getAttribute("position")!;
  const index = geometry.getIndex();
  const count = position.count;

  // Se trabaja sobre la malla SOLDADA POR POSICIÓN, no sobre la partida.
  // La proyección de caja parte cada vértice de arista en una copia por cara, y
  // cada copia sólo ve a los vecinos de su propia cara: la esquina se mediría
  // plana y no habría desgaste justo donde más importa.
  const byPosition = new Map<string, number>();
  const representative = new Uint32Array(count);
  const key = (vertex: number): string =>
    `${Math.round(position.getX(vertex) * 1e4)},` +
    `${Math.round(position.getY(vertex) * 1e4)},` +
    `${Math.round(position.getZ(vertex) * 1e4)}`;
  for (let vertex = 0; vertex < count; vertex += 1) {
    const id = key(vertex);
    const existing = byPosition.get(id);
    if (existing === undefined) {
      byPosition.set(id, vertex);
      representative[vertex] = vertex;
    } else {
      representative[vertex] = existing;
    }
  }

  const sums = new Float32Array(count * 3);
  const degree = new Uint32Array(count);
  const normalSums = new Float32Array(count * 3);
  const addEdge = (from: number, to: number): void => {
    const root = representative[from]!;
    sums[root * 3] += position.getX(to);
    sums[root * 3 + 1] += position.getY(to);
    sums[root * 3 + 2] += position.getZ(to);
    degree[root] += 1;
  };
  const triangles = index ? index.count : count;
  const edge1 = new Vector3();
  const edge2 = new Vector3();
  const faceNormal = new Vector3();
  const corner = new Vector3();
  for (let offset = 0; offset < triangles; offset += 3) {
    const a = index ? index.getX(offset) : offset;
    const b = index ? index.getX(offset + 1) : offset + 1;
    const c = index ? index.getX(offset + 2) : offset + 2;
    addEdge(a, b); addEdge(a, c);
    addEdge(b, a); addEdge(b, c);
    addEdge(c, a); addEdge(c, b);
    // La normal del vértice soldado es el promedio de sus caras, no la partida:
    // en una arista viva las dos caras miran a lados distintos y su promedio es
    // justamente la bisectriz que apunta hacia afuera.
    corner.set(position.getX(a), position.getY(a), position.getZ(a));
    edge1.set(position.getX(b), position.getY(b), position.getZ(b)).sub(corner);
    edge2.set(position.getX(c), position.getY(c), position.getZ(c)).sub(corner);
    faceNormal.crossVectors(edge1, edge2).normalize();
    for (const vertex of [a, b, c]) {
      const root = representative[vertex]!;
      normalSums[root * 3] += faceNormal.x;
      normalSums[root * 3 + 1] += faceNormal.y;
      normalSums[root * 3 + 2] += faceNormal.z;
    }
  }

  const curvature = new Float32Array(count);
  const toNeighbours = new Vector3();
  const vertexNormal = new Vector3();
  const here = new Vector3();
  for (let vertex = 0; vertex < count; vertex += 1) {
    const root = representative[vertex]!;
    if (degree[root] === 0) continue;
    here.set(position.getX(root), position.getY(root), position.getZ(root));
    toNeighbours
      .set(sums[root * 3]!, sums[root * 3 + 1]!, sums[root * 3 + 2]!)
      .divideScalar(degree[root]!)
      .sub(here);
    const reach = toNeighbours.length();
    if (reach < 1e-6) continue;
    vertexNormal.set(
      normalSums[root * 3]!,
      normalSums[root * 3 + 1]!,
      normalSums[root * 3 + 2]!,
    );
    if (vertexNormal.lengthSq() < 1e-12) continue;
    vertexNormal.normalize();
    // Vecinos por detrás de la normal ⇒ convexo. Se divide por el alcance para
    // que el resultado no dependa de lo densa que sea la malla.
    curvature[vertex] = Math.max(
      -1,
      Math.min(1, (-toNeighbours.dot(vertexNormal) / reach) * 3.2),
    );
  }
  return curvature;
}

function voxelize(geometry: BufferGeometry, resolution: number): OcclusionGrid {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) {
    throw new Error("La geometría no tiene bounding box para hornear AO.");
  }
  const min = box.min.clone().addScalar(-0.05);
  const size = box.max.clone().addScalar(0.05).sub(min);
  const solid = new Uint8Array(resolution * resolution * resolution);
  const grid: OcclusionGrid = { resolution, min, size, solid };

  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const point = new Vector3();

  for (let i = 0; i < count; i += 3) {
    const ia = index ? index.getX(i) : i;
    const ib = index ? index.getX(i + 1) : i + 1;
    const ic = index ? index.getX(i + 2) : i + 2;
    a.set(position.getX(ia), position.getY(ia), position.getZ(ia));
    b.set(position.getX(ib), position.getY(ib), position.getZ(ib));
    c.set(position.getX(ic), position.getY(ic), position.getZ(ic));
    // Muestreo baricéntrico denso: más barato que rasterizar el triángulo y
    // suficiente porque sólo hace falta que la celda quede marcada.
    const steps = triangleSteps(a, b, c, grid);
    for (let u = 0; u <= steps; u += 1) {
      for (let v = 0; v + u <= steps; v += 1) {
        const wu = u / steps;
        const wv = v / steps;
        point
          .copy(a)
          .addScaledVector(b.clone().sub(a), wu)
          .addScaledVector(c.clone().sub(a), wv);
        markSolid(grid, point);
      }
    }
  }
  return grid;
}

function triangleSteps(
  a: Vector3,
  b: Vector3,
  c: Vector3,
  grid: OcclusionGrid,
): number {
  const cell = Math.max(grid.size.x, grid.size.y, grid.size.z) / grid.resolution;
  const longest = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
  return Math.max(1, Math.min(24, Math.ceil(longest / cell)));
}

function cellIndex(grid: OcclusionGrid, point: Vector3): number | null {
  const x = Math.floor(
    ((point.x - grid.min.x) / grid.size.x) * grid.resolution,
  );
  const y = Math.floor(
    ((point.y - grid.min.y) / grid.size.y) * grid.resolution,
  );
  const z = Math.floor(
    ((point.z - grid.min.z) / grid.size.z) * grid.resolution,
  );
  if (
    x < 0 ||
    y < 0 ||
    z < 0 ||
    x >= grid.resolution ||
    y >= grid.resolution ||
    z >= grid.resolution
  ) {
    return null;
  }
  return (z * grid.resolution + y) * grid.resolution + x;
}

function markSolid(grid: OcclusionGrid, point: Vector3): void {
  const index = cellIndex(grid, point);
  if (index !== null) grid.solid[index] = 1;
}

function isSolid(grid: OcclusionGrid, point: Vector3): boolean {
  const index = cellIndex(grid, point);
  return index !== null && grid.solid[index] === 1;
}

/** Direcciones fijas en la semiesfera: mismo set en cada corrida. */
function buildHemisphereDirections(): Vector3[] {
  const directions: Vector3[] = [];
  const count = 32;
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let index = 0; index < count; index += 1) {
    const y = 1 - (index / (count - 1)) * 0.92;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * index;
    directions.push(
      new Vector3(Math.cos(theta) * radius, y, Math.sin(theta) * radius)
        .normalize(),
    );
  }
  // Espejar para cubrir también hacia abajo; el filtro por normal elige.
  return [
    ...directions,
    ...directions.map((direction) =>
      new Vector3(direction.x, -direction.y, direction.z),
    ),
  ];
}
