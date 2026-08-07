import { BufferGeometry, LOD, Matrix4, Mesh, Object3D, Vector3 } from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { TessellateModifier } from "three/addons/modifiers/TessellateModifier.js";
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
}

const tmpInverse = new Matrix4();
const tmpPoint = new Vector3();
const tmpDirection = new Vector3();
const tmpVertex = new Vector3();
const tmpNormal = new Vector3();
const tmpScale = new Vector3();

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

  /** El bus no trae reloj, así que el frame lo aporta. */
  update(elapsed: number): void {
    this.elapsed = elapsed;
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
    if (existing && elapsed < existing.nextDentAt) return;

    const entry = existing ?? this.adopt(prop);
    if (!entry) return;
    entry.nextDentAt = elapsed + profile.cooldown;
    // Re-insertar lo manda al final: el LRU expulsa lo que nadie tocó.
    this.deformed.delete(prop.id);
    this.deformed.set(prop.id, entry);

    for (const target of entry.meshes) {
      applyDent(target, worldPoint, worldDirection, profile);
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
    const entry: DeformedProp = { meshes: targets, nextDentAt: 0 };
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
  // Media docena de vértices a lo ancho del abollón: menos se ve como un pico,
  // más es geometría que nadie mira de cerca.
  const maxEdge = Math.max(0.02, dentRadius / 3);
  const dense = new TessellateModifier(maxEdge, 6).modify(shared.clone());
  // `TessellateModifier` devuelve la malla sin índices, o sea con cada triángulo
  // por su cuenta: sin volver a soldar, `computeVertexNormals` daría normales
  // planas y el abollón se vería facetado en vez de hundido.
  const welded = mergeVertices(dense);
  dense.dispose();
  if (welded.getAttribute("uv")) welded.computeTangents();
  welded.computeBoundingSphere();
  return welded;
}

function applyDent(
  target: DeformedMesh,
  worldPoint: Vector3,
  worldDirection: Vector3,
  profile: PropDeformProfile,
): void {
  const mesh = target.mesh;
  mesh.updateWorldMatrix(true, false);
  tmpInverse.copy(mesh.matrixWorld).invert();
  tmpPoint.copy(worldPoint).applyMatrix4(tmpInverse);
  tmpDirection.copy(worldDirection).transformDirection(tmpInverse).normalize();

  // Radio y profundidad se autoran en metros del mundo; un prop escalado tiene
  // que recibir el mismo abollón físico, no uno proporcional a su tamaño.
  const scale = tmpScale.setFromMatrixScale(mesh.matrixWorld).x || 1;
  const radius = profile.radius / scale;
  const depth = profile.depth / scale;
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

  if (!touched) return;
  positions.needsUpdate = true;
  // Sin normales nuevas el abollón no atrapa luz y no se ve como un hundimiento.
  target.clone.computeVertexNormals();
  target.clone.computeBoundingSphere();
}

function restore(entry: DeformedProp): void {
  for (const target of entry.meshes) {
    // El prop pudo morir mientras estaba abollado: su malla ya no existe.
    if (target.mesh.geometry === target.clone) target.mesh.geometry = target.shared;
    target.clone.dispose();
  }
}
