import {
  BufferGeometry,
  Float32BufferAttribute,
  LOD,
  Matrix4,
  Mesh,
  Object3D,
  Uint32BufferAttribute,
  Vector3,
} from "three";
import type { Disposable } from "@shared/types/lifecycle";
import { PropDeformConfig, type PropDeformProfile } from "@game/config/props.config";
import type { GameEventBus } from "@game/GameEvents";
import type { PropInstance } from "./PropInstance";
import type { PropSystem } from "./PropSystem";

interface DeformedMesh {
  readonly mesh: Mesh;
  /** La del pack, compartida por todas las instancias del arquetipo. */
  readonly shared: BufferGeometry;
  readonly clone: BufferGeometry;
  /** Hundimiento acumulado por vértice: satura en vez de invertir la malla. */
  readonly depth: Float32Array;
}

interface DeformedProp {
  readonly meshes: DeformedMesh[];
  nextDentAt: number;
  /** Para reconocer los perdigones de una misma escopetada. */
  lastDentAt: number;
  /** Hay vértices movidos cuyas normales todavía no se recalcularon. */
  dirty: boolean;
}

const tmpInverse = new Matrix4();
const tmpPoint = new Vector3();
const tmpDirection = new Vector3();
const tmpVertex = new Vector3();
const tmpNormal = new Vector3();
const tmpScale = new Vector3();
const tmpTangent = new Vector3();

/**
 * Deformación plástica: el metal se abolla donde lo golpean antes de ceder.
 *
 * Sólo la familia metálica se abolla. Madera, vidrio y hormigón se rompen — no
 * es una limitación, es el vocabulario del material, y HL2 tampoco abolla otra
 * cosa. Un arquetipo entra sólo si declara `deform` en su tabla.
 *
 * El collider NO sigue al abollón, nunca. Rapier no tiene forma convexa
 * deformable, así que rehacer el casco por golpe significaría quitar y volver a
 * crear el collider: se tira el manifold de contacto (el prop pega un salto),
 * se invalida la metadata que ocho sitios leen de `collider(0)` y se fuerza un
 * reinsert de broadphase. Un abollón de 4 cm sobre un barril de 60 está dentro
 * del margen de colisión de todos modos.
 */
export class PropDeformationSystem implements Disposable {
  /** LRU por orden de inserción del Map: el primero es el más viejo. */
  private readonly deformed = new Map<string, DeformedProp>();
  private readonly disposers: (() => void)[] = [];
  private elapsed = 0;

  constructor(
    eventBus: GameEventBus,
    private readonly props: PropSystem,
  ) {
    this.disposers.push(
      eventBus.on("prop.damaged", (event) => {
        if (!event.point || !event.direction) return;
        const prop = this.props.get(event.propId);
        if (prop) this.dent(prop, event.point, event.direction, event.damage, this.elapsed);
      }),
      // Un prop roto ya no tiene malla: su clon debe volver y liberarse.
      eventBus.on("prop.broken", (event) => this.release(event.propId)),
    );
  }

  /**
   * El bus no trae reloj, así que el frame lo aporta. Además es donde se
   * recalculan las normales: una escopetada son ocho impactos en el mismo
   * frame y recalcular por perdigón sería pagar ocho veces lo mismo.
   */
  update(elapsed: number): void {
    this.elapsed = elapsed;
    for (const entry of this.deformed.values()) {
      if (!entry.dirty) continue;
      entry.dirty = false;
      for (const target of entry.meshes) {
        target.clone.getAttribute("position").needsUpdate = true;
        // Sin normales nuevas el abollón no atrapa luz ni se lee como hundido.
        target.clone.computeVertexNormals();
        target.clone.computeBoundingSphere();
      }
    }
  }

  /**
   * Prepara la malla densa de los arquetipos que se abollan.
   *
   * Subdividir cuesta decenas de milisegundos y sin esto se pagaban en el
   * primer disparo contra cada arquetipo, o sea en pleno combate. Acá corre en
   * la carga del nivel, detrás de la pantalla, y el resultado lo comparten
   * todas las instancias del mismo arquetipo.
   */
  warm(): void {
    for (const prop of this.props.all()) {
      const profile = prop.archetype.deform;
      if (!profile) continue;
      for (const mesh of collectLod0Meshes(prop.mesh)) {
        if (denseCache.has(mesh.geometry)) continue;
        denseCache.set(mesh.geometry, buildDense(mesh.geometry, profile.radius));
      }
    }
  }

  /**
   * Abolla el prop en el punto del golpe. Silencioso si el arquetipo no se
   * abolla, si el golpe fue muy leve o si todavía está en enfriamiento.
   */
  dent(
    prop: PropInstance,
    worldPoint: Vector3,
    worldDirection: Vector3,
    damage: number,
    elapsed: number,
  ): void {
    const profile = prop.archetype.deform;
    if (!profile || damage < PropDeformConfig.minDamage) return;
    if (worldDirection.lengthSq() < 1e-8) return;

    const existing = this.deformed.get(prop.id);
    // Los perdigones de una escopetada llegan todos en el mismo frame. Si el
    // enfriamiento los descartara, una escopeta abollaría como un solo
    // perdigón: la escopetada es UN golpe repartido, y suma.
    const sameShot = existing !== undefined && elapsed === existing.lastDentAt;
    if (existing && !sameShot && elapsed < existing.nextDentAt) return;

    const entry = existing ?? this.adopt(prop);
    if (!entry) return;
    entry.nextDentAt = elapsed + profile.cooldown;
    entry.lastDentAt = elapsed;
    // Re-insertar lo manda al final: el LRU expulsa lo que nadie tocó.
    this.deformed.delete(prop.id);
    this.deformed.set(prop.id, entry);

    // Un cañonazo hunde la chapa; un balazo de pistola la marca. Sin esto el
    // perfil daba el mismo abollón para cualquier daño que pasara el mínimo.
    const strength = Math.min(
      PropDeformConfig.maxDamageScale,
      damage / PropDeformConfig.referenceDamage,
    );
    for (const target of entry.meshes) {
      if (applyDent(target, worldPoint, worldDirection, profile, strength)) entry.dirty = true;
    }
  }

  /** Suelta el estado de un prop que murió o se removió. */
  release(propId: string): void {
    const entry = this.deformed.get(propId);
    if (!entry) return;
    this.deformed.delete(propId);
    restore(entry);
  }

  /** Props con geometría clonada viva. */
  count(): number {
    return this.deformed.size;
  }

  clear(): void {
    for (const entry of this.deformed.values()) restore(entry);
    this.deformed.clear();
  }

  dispose(): void {
    this.clear();
    for (const disposer of this.disposers) disposer();
    this.disposers.length = 0;
  }

  /** Clona y densifica la geometría del prop para poder abollarla. */
  private adopt(prop: PropInstance): DeformedProp | null {
    const profile = prop.archetype.deform;
    if (!profile) return null;
    const meshes = collectLod0Meshes(prop.mesh);
    if (meshes.length === 0) return null;

    // El techo se respeta ANTES de clonar, o el pico de memoria es de 13.
    while (this.deformed.size >= PropDeformConfig.maxDeformedProps) {
      const oldest = this.deformed.keys().next();
      if (oldest.done) break;
      this.release(oldest.value);
    }

    const targets: DeformedMesh[] = [];
    for (const mesh of meshes) {
      const shared = mesh.geometry;
      const clone = densify(shared, profile.radius);
      mesh.geometry = clone;
      targets.push({
        mesh,
        shared,
        clone,
        depth: new Float32Array(clone.getAttribute("position").count),
      });
    }
    const entry: DeformedProp = { meshes: targets, nextDentAt: 0, lastDentAt: -1, dirty: false };
    this.deformed.set(prop.id, entry);
    return entry;
  }
}

/**
 * Sólo el LOD0. Un abollón de 4 cm es invisible más allá de la distancia a la
 * que el prop cambia de nivel de detalle, así que clonar el LOD1 sería pagar el
 * doble por nada.
 */
function collectLod0Meshes(root: Object3D): Mesh[] {
  const lod = root.getObjectByName("runtime_visual_lods");
  const level =
    lod instanceof LOD ? lod.levels[0]?.object : root.getObjectByName("visual_lod0");
  if (!level) return [];
  const meshes: Mesh[] = [];
  level.traverse((node) => {
    if (node instanceof Mesh) meshes.push(node);
  });
  return meshes;
}

/**
 * Malla densa por geometría de origen. Todos los barriles del nivel comparten
 * la misma malla del pack, así que se tesela UNA vez y cada prop que se abolla
 * clona el resultado, que es una copia de arrays y no un recálculo.
 */
const denseCache = new WeakMap<BufferGeometry, BufferGeometry>();

/**
 * Copia con todos los atributos en Float32 sin normalizar.
 *
 * Los GLB salen cuantizados (`KHR_mesh_quantization` + meshopt): las posiciones
 * son `Int16` con `normalized: true`, y el valor real sale recién al
 * desnormalizar. `TessellateModifier` lee `attribute.array` EN CRUDO y escribe
 * un `Float32BufferAttribute` sin esa marca, así que las coordenadas quedaban
 * multiplicadas por 32767: el prop pasaba a ser gigante, la cámara quedaba
 * adentro y se veía completamente invisible.
 */
function toPlainFloatGeometry(source: BufferGeometry): BufferGeometry {
  const result = new BufferGeometry();
  const index = source.getIndex();
  if (index) result.setIndex(Array.from(index.array as ArrayLike<number>));

  for (const [name, attribute] of Object.entries(source.attributes)) {
    // La tangente se recalcula al final; copiarla acá sería arrastrar una que
    // ya no corresponde a la malla subdividida.
    if (name === "tangent") continue;
    const itemSize = attribute.itemSize;
    const values = new Float32Array(attribute.count * itemSize);
    for (let vertex = 0; vertex < attribute.count; vertex += 1) {
      const base = vertex * itemSize;
      values[base] = attribute.getX(vertex);
      if (itemSize > 1) values[base + 1] = attribute.getY(vertex);
      if (itemSize > 2) values[base + 2] = attribute.getZ(vertex);
      if (itemSize > 3) values[base + 3] = attribute.getW(vertex);
    }
    result.setAttribute(name, new Float32BufferAttribute(values, itemSize));
  }
  return result;
}

/**
 * Subdivide cada triángulo en cuatro, `levels` veces, conservando el índice.
 *
 * Es uniforme a propósito. Subdividir sólo los triángulos grandes dejaría
 * juntas en T contra los vecinos sin dividir, y al hundir un vértice el vecino
 * no lo acompañaría: se abriría una grieta justo en el borde del abollón.
 *
 * Conservar el índice es lo que la hace barata y correcta: los vértices siguen
 * compartidos, así que `computeVertexNormals` promedia y el abollón se ve
 * suave. Interpola TODOS los atributos por su tamaño real, sin suponer ninguno.
 */
function subdivide(source: BufferGeometry, levels: number): BufferGeometry {
  let geometry = source;
  for (let level = 0; level < levels; level += 1) {
    const index = geometry.getIndex();
    const position = geometry.getAttribute("position");
    if (!index || !position) break;

    // Primera pasada: numerar los puntos medios. Saber cuántos hay de antemano
    // deja reservar los buffers de una y llenarlos sin crecerlos.
    const midpoints = new Map<number, number>();
    const oldVertices = position.count;
    let nextVertex = oldVertices;
    for (let offset = 0; offset < index.count; offset += 3) {
      for (let edge = 0; edge < 3; edge += 1) {
        const a = index.getX(offset + edge);
        const b = index.getX(offset + ((edge + 1) % 3));
        const key = a < b ? a * MIDPOINT_STRIDE + b : b * MIDPOINT_STRIDE + a;
        if (!midpoints.has(key)) {
          midpoints.set(key, nextVertex);
          nextVertex += 1;
        }
      }
    }

    const next = new BufferGeometry();
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      const itemSize = attribute.itemSize;
      const source32 = attribute.array as ArrayLike<number>;
      const values = new Float32Array(nextVertex * itemSize);
      values.set(source32 as ArrayLike<number> & ArrayLike<number>, 0);
      for (const [key, target] of midpoints) {
        const a = Math.floor(key / MIDPOINT_STRIDE);
        const b = key % MIDPOINT_STRIDE;
        for (let component = 0; component < itemSize; component += 1) {
          values[target * itemSize + component] =
            ((source32[a * itemSize + component] ?? 0) +
              (source32[b * itemSize + component] ?? 0)) /
            2;
        }
      }
      next.setAttribute(name, new Float32BufferAttribute(values, itemSize));
    }

    const indices = new Uint32Array(index.count * 4);
    let cursor = 0;
    const midpointOf = (a: number, b: number): number =>
      midpoints.get(a < b ? a * MIDPOINT_STRIDE + b : b * MIDPOINT_STRIDE + a) ?? a;
    for (let offset = 0; offset < index.count; offset += 3) {
      const a = index.getX(offset);
      const b = index.getX(offset + 1);
      const c = index.getX(offset + 2);
      const ab = midpointOf(a, b);
      const bc = midpointOf(b, c);
      const ca = midpointOf(c, a);
      indices.set([a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca], cursor);
      cursor += 12;
    }
    next.setIndex(new Uint32BufferAttribute(indices, 1));

    if (geometry !== source) geometry.dispose();
    geometry = next;
  }
  return geometry;
}

/** Cabe cualquier índice de vértice realista sin perder precisión en el par. */
const MIDPOINT_STRIDE = 1 << 22;

/** Cuántas veces hay que partir para que el triángulo típico entre en el abollón. */
function subdivisionLevels(geometry: BufferGeometry, maxEdge: number): number {
  const index = geometry.getIndex();
  const position = geometry.getAttribute("position");
  if (!index || !position) return 0;

  let longest = 0;
  const a = new Vector3();
  const b = new Vector3();
  for (let offset = 0; offset < index.count; offset += 3) {
    for (let edge = 0; edge < 3; edge += 1) {
      a.fromBufferAttribute(position, index.getX(offset + edge));
      b.fromBufferAttribute(position, index.getX(offset + ((edge + 1) % 3)));
      longest = Math.max(longest, a.distanceTo(b));
    }
  }
  if (longest <= maxEdge) return 0;
  // Cada nivel cuadruplica los triángulos, y como la subdivisión es uniforme
  // la manda la arista más larga de toda la malla. Dos niveles ya son 16x: más
  // que eso es pagar densidad en superficies que nadie va a golpear.
  return Math.min(2, Math.ceil(Math.log2(longest / maxEdge)));
}

/**
 * Clon con suficientes vértices como para que un abollón exista.
 *
 * La malla del prop no los tiene: `chamferBox` es un casco convexo de 24 puntos
 * y el cuerpo del barril un cilindro con vértices SÓLO en sus dos bordes, así
 * que en el medio de una superficie no hay nada que hundir. Sin esto, disparar
 * al aro de un barril hunde el aro —que sí tiene vértices ahí— y deja la chapa
 * intacta al lado, que es exactamente como se veía roto.
 *
 * Se subdivide en runtime y no en el generador porque sólo lo necesitan los
 * pocos props que llegan a abollarse: el asset se mantiene liviano y el LOD1,
 * que nunca se abolla, no paga nada.
 */
function densify(shared: BufferGeometry, dentRadius: number): BufferGeometry {
  let dense = denseCache.get(shared);
  if (!dense) {
    dense = buildDense(shared, dentRadius);
    denseCache.set(shared, dense);
  }
  return dense.clone();
}

function buildDense(shared: BufferGeometry, dentRadius: number): BufferGeometry {
  const plain = toPlainFloatGeometry(shared);
  // Un puñado de vértices a lo ancho del abollón: menos se ve como un pico, y
  // más es geometría cara que nadie mira de cerca.
  const maxEdge = Math.max(0.03, dentRadius / 2);
  const dense = subdivide(plain, subdivisionLevels(plain, maxEdge));
  if (dense !== plain) plain.dispose();

  if (dense.getAttribute("uv")) {
    dense.computeTangents();
    sanitizeTangents(dense);
  }
  dense.computeBoundingSphere();
  return dense;
}

/**
 * Reemplaza los tangentes degenerados por uno cualquiera perpendicular a la
 * normal.
 *
 * `computeTangents` deja el vector en cero cuando el triángulo es degenerado en
 * UV, y las caras verticales de un prop con forma de caja lo son: la proyección
 * planar del generador les da `u` constante, o sea área cero en el espacio de
 * textura. En el shader `normalize(vec3(0))` es NaN —GLSL no tiene la guarda
 * `|| 1` que sí tiene `Vector3.normalize`— y el fragmento sale negro.
 *
 * El asset no sufre esto porque meshopt le pasa un filtro octaédrico a TANGENT
 * al empaquetarlo, que decodifica siempre unitario; el `computeTangents` de
 * runtime no tiene ese filtro. Un tangente inventado sobre una cara sin UV útil
 * no empeora nada: ahí el normal map no tiene orientación que respetar.
 *
 * Se corrige en vez de borrar el atributo porque `vertexTangents` SÍ entra en la
 * clave de programa del renderer: quitarlo recompilaría el shader.
 */
function sanitizeTangents(geometry: BufferGeometry): void {
  const tangents = geometry.getAttribute("tangent");
  const normals = geometry.getAttribute("normal");
  if (!tangents || !normals) return;

  for (let index = 0; index < tangents.count; index += 1) {
    tmpTangent.set(tangents.getX(index), tangents.getY(index), tangents.getZ(index));
    if (tmpTangent.lengthSq() > 1e-8) continue;

    tmpNormal.fromBufferAttribute(normals, index);
    // Cualquier eje sirve mientras no sea paralelo a la normal.
    tmpTangent.set(1, 0, 0);
    if (Math.abs(tmpNormal.x) > 0.9) tmpTangent.set(0, 1, 0);
    tmpTangent.cross(tmpNormal).normalize();
    tangents.setXYZ(index, tmpTangent.x, tmpTangent.y, tmpTangent.z);
  }
  tangents.needsUpdate = true;
}

/** Devuelve si movió algún vértice; las normales las recalcula el frame. */
function applyDent(
  target: DeformedMesh,
  worldPoint: Vector3,
  worldDirection: Vector3,
  profile: PropDeformProfile,
  strength: number,
): boolean {
  const mesh = target.mesh;
  mesh.updateWorldMatrix(true, false);
  tmpInverse.copy(mesh.matrixWorld).invert();
  tmpPoint.copy(worldPoint).applyMatrix4(tmpInverse);
  tmpDirection.copy(worldDirection).transformDirection(tmpInverse).normalize();

  // Radio y profundidad se autoran en metros del mundo; un prop escalado tiene
  // que recibir el mismo abollón físico, no uno proporcional a su tamaño.
  const scale = tmpScale.setFromMatrixScale(mesh.matrixWorld).x || 1;
  const radius = profile.radius / scale;
  const depth = (profile.depth * strength) / scale;
  const maxDepth = profile.maxDepth / scale;
  const radiusSq = radius * radius;

  const positions = target.clone.getAttribute("position");
  const normals = target.clone.getAttribute("normal");
  let touched = false;
  for (let index = 0; index < positions.count; index += 1) {
    tmpVertex.fromBufferAttribute(positions, index);
    const distanceSq = tmpVertex.distanceToSquared(tmpPoint);
    if (distanceSq > radiusSq) continue;

    // Sólo cede la cara que recibe el golpe. Sin esto, en un prop finito —un
    // radiador, un televisor— la cara de atrás también entra en el radio y se
    // mueve igual: el prop se desplaza entero en vez de hundirse.
    if (normals) {
      tmpNormal.fromBufferAttribute(normals, index);
      if (tmpNormal.dot(tmpDirection) > -0.05) continue;
    }

    // Caída suave al borde: un cono dejaría un pico en el centro del abollón.
    const falloff = (1 - distanceSq / radiusSq) ** 2;
    const previous = target.depth[index] ?? 0;
    const next = Math.min(maxDepth, previous + depth * falloff);
    const applied = next - previous;
    if (applied <= 0) continue;

    target.depth[index] = next;
    positions.setXYZ(
      index,
      tmpVertex.x + tmpDirection.x * applied,
      tmpVertex.y + tmpDirection.y * applied,
      tmpVertex.z + tmpDirection.z * applied,
    );
    touched = true;
  }

  return touched;
}

function restore(entry: DeformedProp): void {
  for (const target of entry.meshes) {
    // El prop pudo morir mientras estaba abollado: su malla ya no existe.
    if (target.mesh.geometry === target.clone) target.mesh.geometry = target.shared;
    target.clone.dispose();
  }
}
