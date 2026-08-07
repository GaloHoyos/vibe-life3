import { describe, expect, it } from "vitest";
import { Group, Mesh, MeshStandardMaterial, Vector3 } from "three";
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

  it("mantiene la malla soldada para que el abollon se vea suave", () => {
    const { prop, mesh, system } = buildBarrel();
    system.dent(prop, HIT, INWARD, 20, 0);

    // Indexada = vertices compartidos = normales promediadas = superficie
    // suave. Sin soldar, `computeVertexNormals` deja el abollon facetado.
    expect(mesh.geometry.getIndex()).not.toBeNull();
    expect(mesh.geometry.getAttribute("normal")).toBeDefined();
  });
});
