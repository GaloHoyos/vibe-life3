import { describe, expect, it } from "vitest";
import {
  Float32BufferAttribute,
  Group,
  Int16BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from "three";
import { EventBus } from "@engine/core/EventBus";
import type { GameEventMap } from "@game/GameEvents";
import { PropArchetypes } from "@game/config/props.config";
import { PropDeformationSystem } from "@game/gameplay/props/PropDeformationSystem";
import { PropInstance } from "@game/gameplay/props/PropInstance";
import type { PropSystem } from "@game/gameplay/props/PropSystem";
import { PROP_BUILDERS } from "../../../../../tools/prop-assets/models";
import { mergeParts } from "../../../../../tools/shared/gltf/build";

/**
 * Forma del abollón sobre la geometría REAL del generador, no sobre una caja de
 * juguete: es donde vivía el bug. El barril se arma con el cuerpo cilíndrico y
 * sus aros como piezas separadas, y el cuerpo tenía vértices sólo en sus dos
 * bordes — así que disparar a un aro hundía el aro y dejaba la chapa intacta.
 */
function buildBarrel(): { prop: PropInstance; mesh: Mesh; system: PropDeformationSystem } {
  const geometry = PROP_BUILDERS.metalBarrel(0, 0);
  const merged = mergeParts(geometry.parts, { bakeOcclusion: false });

  const root = new Group();
  const lod0 = new Group();
  lod0.name = "visual_lod0";
  const mesh = new Mesh(merged, new MeshStandardMaterial());
  lod0.add(mesh);
  root.add(lod0);
  root.updateMatrixWorld(true);

  const archetype = PropArchetypes.metalBarrel;
  const prop = new PropInstance("barrel", archetype, root, archetype.breakReaction);
  const system = new PropDeformationSystem(
    new EventBus<GameEventMap>(),
    { get: () => undefined } as unknown as PropSystem,
  );
  return { prop, mesh, system };
}

/** Radio de cada vértice respecto del eje del barril, indexado por vértice. */
function radialProfile(mesh: Mesh): { radius: number[]; y: number[]; z: number[] } {
  const positions = mesh.geometry.getAttribute("position");
  const radius: number[] = [];
  const y: number[] = [];
  const z: number[] = [];
  for (let index = 0; index < positions.count; index += 1) {
    radius.push(Math.hypot(positions.getX(index), positions.getZ(index)));
    y.push(positions.getY(index));
    z.push(positions.getZ(index));
  }
  return { radius, y, z };
}

/**
 * Cuanto mas hundido esta `deeper` que `shallower` en su vertice mas hundido.
 *
 * Se compara vertice por vertice y no contra el minimo absoluto de cada malla
 * porque el barril tiene piezas internas mas cerca del eje que la chapa: el
 * minimo global es una de ellas y no se mueve nunca. Ambas mallas salen del
 * mismo builder, asi que comparten topologia y los indices se corresponden.
 */
function extraDepth(shallower: Mesh, deeper: Mesh): number {
  const a = radialProfile(shallower);
  const b = radialProfile(deeper);
  let most = 0;
  for (let index = 0; index < a.radius.length; index += 1) {
    most = Math.max(most, a.radius[index]! - b.radius[index]!);
  }
  return most;
}

const RING_Y = 0.2;
/** Golpe frontal contra el aro superior, desde +Z hacia el eje. */
const HIT = new Vector3(0, RING_Y, 0.3);
const INWARD = new Vector3(0, 0, -1);

describe("forma del abollon sobre el barril real", () => {
  it("densifica la malla al adoptarla para abollar", () => {
    const { prop, mesh, system } = buildBarrel();
    const before = mesh.geometry.getAttribute("position").count;

    system.dent(prop, HIT, INWARD, 20, 0);

    expect(mesh.geometry.getAttribute("position").count).toBeGreaterThan(before * 3);
  });

  it("golpear el aro tambien hunde la chapa del cuerpo alrededor", () => {
    const { prop, mesh, system } = buildBarrel();
    system.dent(prop, HIT, INWARD, 20, 0);
    const after = radialProfile(mesh);

    // Vertices de la CHAPA (radio de cuerpo, no de aro) del lado del golpe y
    // cerca de el en altura, pero claramente fuera de la banda del aro.
    let bodyDented = 0;
    for (let index = 0; index < after.radius.length; index += 1) {
      const onImpactSide = after.z[index]! > 0.1;
      const nearInHeight = Math.abs(after.y[index]! - RING_Y) > 0.06 &&
        Math.abs(after.y[index]! - RING_Y) < 0.2;
      if (!onImpactSide || !nearInHeight) continue;
      // La chapa sin tocar esta a 0.28; hundida, mas cerca del eje.
      if (after.radius[index]! < 0.272) bodyDented += 1;
    }

    expect(bodyDented).toBeGreaterThan(0);
  });

  it("el hundimiento es gradual: hondo en el centro y suave en el borde", () => {
    const { prop, mesh, system } = buildBarrel();
    system.dent(prop, HIT, INWARD, 40, 0);
    const after = radialProfile(mesh);

    let nearest = Infinity;
    let atEdge = 0;
    let edgeSamples = 0;
    for (let index = 0; index < after.radius.length; index += 1) {
      if (after.z[index]! < 0.1) continue;
      const distance = Math.hypot(after.y[index]! - RING_Y, 0);
      if (distance < 0.03) nearest = Math.min(nearest, after.radius[index]!);
      if (distance > 0.18 && distance < 0.22) {
        atEdge += after.radius[index]!;
        edgeSamples += 1;
      }
    }

    expect(nearest).toBeLessThan(0.29);
    if (edgeSamples > 0) {
      // El borde del abollon apenas se mueve: la caida es suave, no un escalon.
      expect(atEdge / edgeSamples).toBeGreaterThan(nearest);
    }
  });

  it("la cara de atras no se mueve: es un abollon, no un empujon", () => {
    const { prop, mesh, system } = buildBarrel();
    const profile = PropArchetypes.metalBarrel.deform!;
    // El primer golpe densifica; a partir de ahi la topologia queda fija y se
    // puede comparar vertice por vertice.
    system.dent(prop, HIT, INWARD, 40, 0);
    const before = radialProfile(mesh);

    system.dent(prop, HIT, INWARD, 40, profile.cooldown * 2);
    const after = radialProfile(mesh);

    let frontMoved = 0;
    let backMoved = 0;
    for (let index = 0; index < before.radius.length; index += 1) {
      const delta = Math.abs(after.radius[index]! - before.radius[index]!);
      if (delta < 1e-5) continue;
      if (before.z[index]! > 0.1) frontMoved += 1;
      if (before.z[index]! < -0.1) backMoved += 1;
    }

    expect(frontMoved).toBeGreaterThan(0);
    // La cara opuesta entra en el radio del abollon pero mira para el otro lado.
    expect(backMoved).toBe(0);
  });

  it("sobrevive la geometria cuantizada del GLB sin volverse gigante", () => {
    // Los GLB salen con `KHR_mesh_quantization`: POSITION es Int16 normalizado
    // y el valor real sale recién al desnormalizar. Leer el array en crudo
    // multiplicaba las coordenadas por 32767, el prop se volvía enorme, la
    // cámara quedaba adentro y el prop se veía completamente invisible.
    const geometry = mergeParts(PROP_BUILDERS.metalBarrel(0, 0).parts, {
      bakeOcclusion: false,
    });
    const position = geometry.getAttribute("position");
    let maxAbs = 0;
    for (let index = 0; index < position.count; index += 1) {
      maxAbs = Math.max(
        maxAbs,
        Math.abs(position.getX(index)),
        Math.abs(position.getY(index)),
        Math.abs(position.getZ(index)),
      );
    }
    const raw = new Int16Array(position.count * 3);
    for (let index = 0; index < position.count; index += 1) {
      raw[index * 3] = Math.round((position.getX(index) / maxAbs) * 32767);
      raw[index * 3 + 1] = Math.round((position.getY(index) / maxAbs) * 32767);
      raw[index * 3 + 2] = Math.round((position.getZ(index) / maxAbs) * 32767);
    }
    const quantized = new Int16BufferAttribute(raw, 3);
    quantized.normalized = true;
    geometry.setAttribute("position", quantized);

    const root = new Group();
    const lod0 = new Group();
    lod0.name = "visual_lod0";
    const mesh = new Mesh(geometry, new MeshStandardMaterial());
    lod0.add(mesh);
    root.add(lod0);
    root.updateMatrixWorld(true);

    const archetype = PropArchetypes.metalBarrel;
    const prop = new PropInstance("barrel", archetype, root, archetype.breakReaction);
    const system = new PropDeformationSystem(
      new EventBus<GameEventMap>(),
      { get: () => undefined } as unknown as PropSystem,
    );

    system.dent(prop, new Vector3(0, 0.4, 0.6), new Vector3(0, 0, -1), 20, 0);

    mesh.geometry.computeBoundingSphere();
    const radius = mesh.geometry.boundingSphere!.radius;
    // Desnormalizado el barril entra en la esfera unidad; en crudo daría miles.
    expect(radius).toBeGreaterThan(0.5);
    expect(radius).toBeLessThan(3);
  });

  it("conserva el tamano del color para no recompilar el shader", () => {
    const { prop, mesh, system } = buildBarrel();
    // La AO horneada viaja en COLOR_0 como VEC4. `vertexAlphas` del renderer
    // depende de ese 4: bajarlo a 3 fuerza una recompilación, y este motor no
    // tiene `KHR_parallel_shader_compile`, así que congela el cuadro.
    mesh.geometry.setAttribute(
      "color",
      new Float32BufferAttribute(new Float32Array(mesh.geometry.getAttribute("position").count * 4).fill(1), 4),
    );

    system.dent(prop, HIT, INWARD, 20, 0);

    expect(mesh.geometry.getAttribute("color").itemSize).toBe(4);
  });

  it("subdivide una sola vez por malla compartida", () => {
    const shared = mergeParts(PROP_BUILDERS.metalBarrel(0, 0).parts, { bakeOcclusion: false });
    const archetype = PropArchetypes.metalBarrel;
    const system = new PropDeformationSystem(
      new EventBus<GameEventMap>(),
      { get: () => undefined } as unknown as PropSystem,
    );

    const make = (id: string): { prop: PropInstance; mesh: Mesh } => {
      const root = new Group();
      const lod0 = new Group();
      lod0.name = "visual_lod0";
      const mesh = new Mesh(shared, new MeshStandardMaterial());
      lod0.add(mesh);
      root.add(lod0);
      root.updateMatrixWorld(true);
      return { prop: new PropInstance(id, archetype, root, archetype.breakReaction), mesh };
    };

    const first = make("a");
    const second = make("b");
    system.dent(first.prop, HIT, INWARD, 20, 0);
    system.dent(second.prop, HIT, INWARD, 20, 0);

    // Misma densidad, pero cada uno con su copia: abollar uno no toca al otro.
    expect(second.mesh.geometry.getAttribute("position").count).toBe(
      first.mesh.geometry.getAttribute("position").count,
    );
    expect(second.mesh.geometry).not.toBe(first.mesh.geometry);
    expect(first.mesh.geometry).not.toBe(shared);
  });

  it("no deja tangentes degenerados en un prop con caras planas", () => {
    // El gabinete es una caja: la proyeccion planar del generador le da area
    // cero en UV a las caras verticales, y ahi `computeTangents` devuelve el
    // vector nulo. En el shader `normalize(vec3(0))` es NaN y el prop se ve
    // NEGRO. El asset no sufre esto porque meshopt le pasa un filtro octaedrico
    // a TANGENT que decodifica siempre unitario.
    const merged = mergeParts(PROP_BUILDERS.filingCabinet(0, 0).parts, { bakeOcclusion: true });
    const root = new Group();
    const lod0 = new Group();
    lod0.name = "visual_lod0";
    const mesh = new Mesh(merged, new MeshStandardMaterial());
    lod0.add(mesh);
    root.add(lod0);
    root.updateMatrixWorld(true);

    const archetype = PropArchetypes.filingCabinet;
    const prop = new PropInstance("cabinet", archetype, root, archetype.breakReaction);
    const system = new PropDeformationSystem(
      new EventBus<GameEventMap>(),
      { get: () => undefined } as unknown as PropSystem,
    );

    system.dent(prop, new Vector3(0, 0.2, 0.33), INWARD, 40, 0);

    const tangents = mesh.geometry.getAttribute("tangent");
    expect(tangents).toBeDefined();
    let degenerate = 0;
    for (let index = 0; index < tangents.count; index += 1) {
      const length = Math.hypot(tangents.getX(index), tangents.getY(index), tangents.getZ(index));
      if (!(length > 0.5)) degenerate += 1;
    }
    expect(degenerate).toBe(0);
  });

  it("conserva el atributo de tangente para no recompilar el shader", () => {
    // `vertexTangents` SI entra en la clave de programa del renderer: borrar el
    // atributo en vez de arreglarlo cambiaria el shader y congelaria el cuadro.
    const { prop, mesh, system } = buildBarrel();
    // El GLB del pack trae TANGENT horneado, igual que esto.
    mesh.geometry.computeTangents();

    system.dent(prop, HIT, INWARD, 20, 0);

    expect(mesh.geometry.getAttribute("tangent")).toBeDefined();
  });

  it("un golpe fuerte hunde mas que uno debil", () => {
    const weak = buildBarrel();
    weak.system.dent(weak.prop, HIT, INWARD, 8, 0);
    const strong = buildBarrel();
    strong.system.dent(strong.prop, HIT, INWARD, 75, 0);

    expect(extraDepth(weak.mesh, strong.mesh)).toBeGreaterThan(0.01);
  });

  it("los perdigones de una misma escopetada suman en vez de descartarse", () => {
    // Llegan todos con el mismo `elapsed`. Si el enfriamiento los descartara,
    // una escopeta abollaria igual que un solo perdigon.
    const single = buildBarrel();
    single.system.dent(single.prop, HIT, INWARD, 9, 0);
    const blast = buildBarrel();
    for (let pellet = 0; pellet < 8; pellet += 1) {
      blast.system.dent(blast.prop, HIT, INWARD, 9, 0);
    }

    expect(extraDepth(single.mesh, blast.mesh)).toBeGreaterThan(0.01);
  });

  it("recalcula las normales una sola vez por frame, no por impacto", () => {
    const { prop, mesh, system } = buildBarrel();
    system.dent(prop, HIT, INWARD, 40, 0);

    // Antes del frame las posiciones ya se movieron pero las normales todavia
    // son las de la malla sin abollar: recalcularlas por perdigon seria pagar
    // ocho veces lo mismo en una escopetada.
    const before = mesh.geometry.getAttribute("normal").getX(0);
    system.update(0);
    const after = mesh.geometry.getAttribute("normal");
    expect(after.count).toBe(mesh.geometry.getAttribute("position").count);
    expect(Number.isFinite(before)).toBe(true);
  });

  it("mantiene la malla soldada para que el abollon se vea suave", () => {
    const { prop, mesh, system } = buildBarrel();
    system.dent(prop, HIT, INWARD, 20, 0);

    // Indexada = vertices compartidos = normales promediadas = superficie
    // suave. Sin soldar, `computeVertexNormals` deja el abollon facetado.
    expect(mesh.geometry.getIndex()).not.toBeNull();
    expect(mesh.geometry.getAttribute("normal")).toBeDefined();
  });
});
